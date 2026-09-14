import { geolocation, ipAddress } from "@vercel/functions";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
  isStepCount,
  streamText,
  toUIMessageStream,
} from "ai";
import { checkBotId } from "botid/server";
import { after } from "next/server";
import { createResumableStreamContext } from "resumable-stream";
import { auth, type UserType } from "@/app/(auth)/auth";
import { entitlementsByUserType } from "@/lib/ai/entitlements";
import {
  allowedModelIds,
  chatModels,
  DEFAULT_CHAT_MODEL,
  getCapabilities,
  getModelAvailability,
} from "@/lib/ai/models";
import { type RequestHints, systemPrompt } from "@/lib/ai/prompts";
import { getLanguageModel } from "@/lib/ai/providers";
import { createDocument } from "@/lib/ai/tools/create-document";
import { editDocument } from "@/lib/ai/tools/edit-document";
import { getWeather } from "@/lib/ai/tools/get-weather";
import { requestSuggestions } from "@/lib/ai/tools/request-suggestions";
import { updateDocument } from "@/lib/ai/tools/update-document";
import { generateWarmListenerSafeText } from "@/lib/ai/yunduo/generate-safe-reply";
import {
  buildLateNightModeRule,
  isLateNightShanghai,
} from "@/lib/ai/yunduo/late-night";
import {
  buildConversationMemory,
  getShortTermTurnLimit,
  selectRecentConversationMessages,
} from "@/lib/ai/yunduo/memory";
import { isProductionEnvironment } from "@/lib/constants";
import {
  createStreamId,
  deleteChatById,
  getChatById,
  getLatestMemorySummaryByUserId,
  getMessageCountByUserId,
  getMessagesByChatId,
  saveChat,
  saveMessages,
  updateMessage,
  upsertMemorySummary,
} from "@/lib/db/queries";
import type { DBMessage } from "@/lib/db/schema";
import { ChatbotError } from "@/lib/errors";
import { checkIpRateLimit } from "@/lib/ratelimit";
import {
  assessCrisis,
  MODERATE_CONTEXT_RULE,
  SEVERE_CRISIS_RESPONSE,
} from "@/lib/safety/crisis";
import { handleSevereCrisis } from "@/lib/safety/crisis-handler";
import type { ChatMessage, WaitingStatusData } from "@/lib/types";
import {
  convertToUIMessages,
  generateUUID,
  getTextFromMessage,
} from "@/lib/utils";
import { type PostRequestBody, postRequestBodySchema } from "./schema";

export const maxDuration = 60;

const HEALTH_CHECK_DELAY_MS = 9000;

function createChatTitleFromText(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) {
    return "New chat";
  }
  return normalized.length > 24 ? `${normalized.slice(0, 24)}…` : normalized;
}

async function refreshConversationMemory(chatId: string, userId: string) {
  const storedMessages = await getMessagesByChatId({ id: chatId });
  const memory = buildConversationMemory(
    convertToUIMessages(storedMessages).map((storedMessage) => ({
      role: storedMessage.role,
      text: getTextFromMessage(storedMessage),
    }))
  );

  if (!memory) {
    return;
  }

  await upsertMemorySummary({
    chatId,
    isSensitive: memory.isSensitive,
    summary: memory.summary,
    userId,
  });
}

function isModelStreamActivity(chunk: { type: string }) {
  return !["start", "start-step", "finish-step", "finish", "raw"].includes(
    chunk.type
  );
}

function getStreamContext() {
  try {
    return createResumableStreamContext({ waitUntil: after });
  } catch {
    return null;
  }
}

export { getStreamContext };

export async function POST(request: Request) {
  let requestBody: PostRequestBody;

  try {
    const json = await request.json();
    requestBody = postRequestBodySchema.parse(json);
  } catch {
    return new ChatbotError("bad_request:api").toResponse();
  }

  try {
    const { id, message, messages, selectedChatModel, selectedVisibilityType } =
      requestBody;

    // Vercel BotId 依赖 Vercel 平台的校验服务，只在 Vercel 上才有意义。
    // 自建服务器上调用它会得到永远无法通过的结果，并往日志里刷误导性的配置警告。
    const isVercelDeployment = Boolean(process.env.VERCEL);
    const [botIdResult, session] = await Promise.all([
      isVercelDeployment ? checkBotId().catch(() => null) : null,
      auth(),
    ]);

    if (botIdResult?.isBot) {
      return new ChatbotError("forbidden:api").toResponse();
    }

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const chatModel = allowedModelIds.has(selectedChatModel)
      ? selectedChatModel
      : DEFAULT_CHAT_MODEL;

    await checkIpRateLimit(ipAddress(request));

    const userType: UserType = session.user.type;

    const messageCount = await getMessageCountByUserId({
      differenceInHours: 1,
      id: session.user.id,
    });

    if (messageCount > entitlementsByUserType[userType].maxMessagesPerHour) {
      return new ChatbotError("rate_limit:chat").toResponse();
    }

    const isToolApprovalFlow = Boolean(messages);
    const currentUserText =
      message?.role === "user" ? getTextFromMessage(message) : "";
    const crisisAssessment = assessCrisis(currentUserText);
    const isLateNight =
      process.env.LATE_NIGHT_FORCE === "1" || isLateNightShanghai(new Date());

    const chat = await getChatById({ id });
    let messagesFromDb: DBMessage[] = [];

    if (chat) {
      if (chat.userId !== session.user.id) {
        return new ChatbotError("forbidden:chat").toResponse();
      }
      messagesFromDb = await getMessagesByChatId({ id });
    } else if (message?.role === "user") {
      await saveChat({
        id,
        title:
          crisisAssessment.level === "severe"
            ? "危机对话"
            : createChatTitleFromText(currentUserText),
        userId: session.user.id,
        visibility: selectedVisibilityType,
      });
    }

    let uiMessages: ChatMessage[];

    if (isToolApprovalFlow && messages) {
      const dbMessages = convertToUIMessages(messagesFromDb);
      const approvalStates = new Map(
        messages.flatMap(
          (m) =>
            m.parts
              ?.filter(
                (p: Record<string, unknown>) =>
                  p.state === "approval-responded" ||
                  p.state === "output-denied"
              )
              .map((p: Record<string, unknown>) => [
                String(p.toolCallId ?? ""),
                p,
              ]) ?? []
        )
      );
      uiMessages = dbMessages.map((msg) => ({
        ...msg,
        parts: msg.parts.map((part) => {
          if (
            "toolCallId" in part &&
            approvalStates.has(String(part.toolCallId))
          ) {
            return { ...part, ...approvalStates.get(String(part.toolCallId)) };
          }
          return part;
        }),
      })) as ChatMessage[];
    } else {
      uiMessages = [
        ...convertToUIMessages(messagesFromDb),
        message as ChatMessage,
      ];
    }

    const { longitude, latitude, city, country } = geolocation(request);

    const requestHints: RequestHints = {
      city,
      country,
      latitude,
      longitude,
    };

    if (message?.role === "user") {
      await saveMessages({
        messages: [
          {
            attachments: [],
            chatId: id,
            createdAt: new Date(),
            id: message.id,
            parts: message.parts,
            role: "user",
          },
        ],
      });
    }

    const modelConfig = chatModels.find((m) => m.id === chatModel);
    const modelCapabilities = await getCapabilities();
    const capabilities = modelCapabilities[chatModel];
    const isReasoningModel = capabilities?.reasoning === true;
    const supportsTools = capabilities?.tools === true;

    const recentUiMessages = selectRecentConversationMessages(
      uiMessages,
      getShortTermTurnLimit()
    );
    const modelMessages = await convertToModelMessages(recentUiMessages);
    const latestMemory = await getLatestMemorySummaryByUserId({
      userId: session.user.id,
    });
    const memoryInstruction =
      latestMemory && !latestMemory.isSensitive
        ? `\n\n可用于保持连续性的非敏感长期摘要：${latestMemory.summary}\n只在当前话题相关时自然参考，不要声称记得用户未说过的内容，也不要主动追问身份信息。`
        : "";

    const stream = createUIMessageStream({
      execute: async ({ writer: dataStream }) => {
        const modelName = modelConfig?.name ?? chatModel;
        let hasModelActivity = false;
        let healthCheckTimer: ReturnType<typeof setTimeout> | undefined;

        const clearHealthCheckTimer = () => {
          if (healthCheckTimer) {
            clearTimeout(healthCheckTimer);
          }
        };

        const writeWaitingStatus = (
          phase: WaitingStatusData["phase"],
          messageText: string
        ) => {
          if (hasModelActivity && phase !== "thinking") {
            return;
          }
          dataStream.write({
            data: {
              message: messageText,
              modelId: chatModel,
              modelName,
              phase,
            },
            transient: true,
            type: "data-waiting-status",
          });
        };

        const writeAssistantText = (text: string) => {
          const assistantMessageId = generateUUID();
          const textPartId = generateUUID();

          dataStream.write({ messageId: assistantMessageId, type: "start" });
          dataStream.write({ type: "start-step" });
          dataStream.write({ id: textPartId, type: "text-start" });
          dataStream.write({
            delta: text,
            id: textPartId,
            type: "text-delta",
          });
          dataStream.write({ id: textPartId, type: "text-end" });
          dataStream.write({ type: "finish-step" });
          dataStream.write({ finishReason: "stop", type: "finish" });
        };

        if (crisisAssessment.level === "severe") {
          writeWaitingStatus("waiting", "Waiting...");
          after(async () => {
            try {
              await handleSevereCrisis({
                chatId: id,
                matchedRuleIds: crisisAssessment.matchedRuleIds,
                messageText: currentUserText,
                userId: session.user.id,
              });
            } catch (error) {
              console.error("[yunduo-crisis-event] 记录或告警失败", error);
            }
          });
          writeAssistantText(SEVERE_CRISIS_RESPONSE);
          return;
        }

        if (!supportsTools) {
          writeWaitingStatus("waiting", "Waiting...");
          hasModelActivity = true;
          writeWaitingStatus("thinking", "Thinking...");

          const baseInstructions = `${systemPrompt({
            requestHints,
            supportsTools,
          })}${memoryInstruction}`;
          const instructions =
            crisisAssessment.level === "moderate"
              ? `${baseInstructions}\n\n${MODERATE_CONTEXT_RULE}`
              : baseInstructions;
          const instructionsWithLateNight = isLateNight
            ? `${instructions}\n\n${buildLateNightModeRule()}`
            : instructions;

          const safeReply = await generateWarmListenerSafeText({
            instructions: instructionsWithLateNight,
            messages: modelMessages,
            model: getLanguageModel(chatModel),
          });

          if (safeReply.risk === "HIGH") {
            after(async () => {
              try {
                await handleSevereCrisis({
                  chatId: id,
                  matchedRuleIds: ["llm-implicit-severe"],
                  messageText: currentUserText,
                  userId: session.user.id,
                });
              } catch (error) {
                console.error("[yunduo-crisis-event] 记录或告警失败", error);
              }
            });
            writeAssistantText(SEVERE_CRISIS_RESPONSE);
            return;
          }

          writeAssistantText(safeReply.text);

          return;
        }

        writeWaitingStatus("waiting", "Waiting...");

        healthCheckTimer = setTimeout(() => {
          getModelAvailability(chatModel)
            .then((availability) => {
              if (availability === "impacted") {
                writeWaitingStatus(
                  "health",
                  `${modelName} may be slow or unavailable right now...`
                );
              } else {
                writeWaitingStatus("still-waiting", "Still waiting...");
              }
            })
            .catch(() => {
              writeWaitingStatus("still-waiting", "Still waiting...");
            });
        }, HEALTH_CHECK_DELAY_MS);

        const markModelActive = () => {
          if (hasModelActivity) {
            return;
          }
          hasModelActivity = true;
          clearHealthCheckTimer();
          writeWaitingStatus("thinking", "Thinking...");
        };

        const stopWaitingStatus = () => {
          hasModelActivity = true;
          clearHealthCheckTimer();
        };

        const baseToolInstructions = `${systemPrompt({
          requestHints,
          supportsTools,
        })}${memoryInstruction}`;
        const toolInstructions = isLateNight
          ? `${baseToolInstructions}\n\n${buildLateNightModeRule()}`
          : baseToolInstructions;

        const result = streamText({
          activeTools:
            isReasoningModel && !supportsTools
              ? []
              : [
                  "getWeather",
                  "createDocument",
                  "editDocument",
                  "updateDocument",
                  "requestSuggestions",
                ],
          instructions: toolInstructions,
          messages: modelMessages,
          model: getLanguageModel(chatModel),
          onAbort() {
            stopWaitingStatus();
          },
          onChunk({ chunk }) {
            if (isModelStreamActivity(chunk)) {
              markModelActive();
            }
          },
          onEnd() {
            stopWaitingStatus();
          },
          onError() {
            stopWaitingStatus();
          },
          providerOptions: {
            ...(modelConfig?.gatewayOrder && {
              gateway: { order: modelConfig.gatewayOrder },
            }),
            ...(modelConfig?.reasoningEffort && {
              openai: { reasoningEffort: modelConfig.reasoningEffort },
            }),
          },
          stopWhen: isStepCount(5),
          telemetry: {
            functionId: "stream-text",
            isEnabled: isProductionEnvironment,
          },
          tools: {
            createDocument: createDocument({
              dataStream,
              modelId: chatModel,
              session,
            }),
            editDocument: editDocument({ dataStream, session }),
            getWeather,
            requestSuggestions: requestSuggestions({
              dataStream,
              modelId: chatModel,
              session,
            }),
            updateDocument: updateDocument({
              dataStream,
              modelId: chatModel,
              session,
            }),
          },
        });

        dataStream.merge(
          toUIMessageStream({
            sendReasoning: isReasoningModel,
            stream: result.stream,
          })
        );
      },
      generateId: generateUUID,
      onEnd: async ({ messages: finishedMessages }) => {
        if (isToolApprovalFlow) {
          await Promise.all(
            finishedMessages.map(async (finishedMsg) => {
              const existingMsg = uiMessages.find(
                (m) => m.id === finishedMsg.id
              );
              if (existingMsg) {
                await updateMessage({
                  id: finishedMsg.id,
                  parts: finishedMsg.parts,
                });
                return;
              }

              await saveMessages({
                messages: [
                  {
                    attachments: [],
                    chatId: id,
                    createdAt: new Date(),
                    id: finishedMsg.id,
                    parts: finishedMsg.parts,
                    role: finishedMsg.role,
                  },
                ],
              });
            })
          );
        } else if (finishedMessages.length > 0) {
          await saveMessages({
            messages: finishedMessages.map((currentMessage) => ({
              attachments: [],
              chatId: id,
              createdAt: new Date(),
              id: currentMessage.id,
              parts: currentMessage.parts,
              role: currentMessage.role,
            })),
          });
        }

        try {
          await refreshConversationMemory(id, session.user.id);
        } catch (error) {
          console.error("[yunduo-memory] 摘要刷新失败", error);
        }
      },
      onError: (error) => {
        if (
          error instanceof Error &&
          error.message?.includes(
            "AI Gateway requires a valid credit card on file to service requests"
          )
        ) {
          return "AI Gateway requires a valid credit card on file to service requests. Please visit https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%3Fmodal%3Dadd-credit-card to add a card and unlock your free credits.";
        }
        return "Oops, an error occurred!";
      },
      originalMessages: isToolApprovalFlow ? uiMessages : undefined,
    });

    return createUIMessageStreamResponse({
      async consumeSseStream({ stream: sseStream }) {
        if (!process.env.REDIS_URL) {
          return;
        }
        try {
          const streamContext = getStreamContext();
          if (streamContext) {
            const streamId = generateId();
            await createStreamId({ chatId: id, streamId });
            await streamContext.createNewResumableStream(
              streamId,
              () => sseStream
            );
          }
        } catch {
          /* non-critical */
        }
      },
      stream,
    });
  } catch (error) {
    const vercelId = request.headers.get("x-vercel-id");

    if (error instanceof ChatbotError) {
      return error.toResponse();
    }

    if (
      error instanceof Error &&
      error.message?.includes(
        "AI Gateway requires a valid credit card on file to service requests"
      )
    ) {
      return new ChatbotError("bad_request:activate_gateway").toResponse();
    }

    console.error("Unhandled error in chat API:", error, { vercelId });
    return new ChatbotError("offline:chat").toResponse();
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return new ChatbotError("bad_request:api").toResponse();
  }

  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }

  const chat = await getChatById({ id });

  if (chat?.userId !== session.user.id) {
    return new ChatbotError("forbidden:chat").toResponse();
  }

  const deletedChat = await deleteChatById({ id });

  return Response.json(deletedChat, { status: 200 });
}
