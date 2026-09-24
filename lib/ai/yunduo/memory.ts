import { assessCrisis } from "../../safety/crisis";

export const DEFAULT_SHORT_TERM_TURNS = 8;
export const CONVERSATION_COMPRESSION_TURNS = 20;

type ConversationMessage = {
  id?: string;
  role: string;
  text: string;
};

export type MemoryCompressionState = {
  coveredTurns: number;
  coveredToMessageId: string | null;
};

export function getCompletedTurnCount(messages: ConversationMessage[]): number {
  let completedTurns = 0;
  let hasUserMessage = false;

  for (const message of messages) {
    if (message.role === "user") {
      hasUserMessage = true;
      continue;
    }
    if (message.role === "assistant" && hasUserMessage) {
      completedTurns += 1;
      hasUserMessage = false;
    }
  }

  return completedTurns;
}

export function shouldCompressConversation(
  messages: ConversationMessage[],
  previous: MemoryCompressionState | null
): boolean {
  const completedTurns = getCompletedTurnCount(messages);
  if (!previous) {
    return completedTurns >= CONVERSATION_COMPRESSION_TURNS;
  }

  return (
    completedTurns - previous.coveredTurns >= CONVERSATION_COMPRESSION_TURNS
  );
}

export function buildRollingSummaryInput({
  messages,
  previousCoveredToMessageId,
  previousSummary,
}: {
  messages: ConversationMessage[];
  previousCoveredToMessageId: string | null;
  previousSummary: string;
}): string {
  const previousIndex = previousCoveredToMessageId
    ? messages.findIndex((message) => message.id === previousCoveredToMessageId)
    : -1;
  const newMessages = messages.slice(previousIndex + 1);
  const formattedMessages = newMessages
    .map((message) => `${message.role}: ${message.text}`)
    .join("\n");

  return [
    "已有会话摘要：",
    previousSummary.trim(),
    "",
    "上次摘要之后新增的对话：",
    formattedMessages,
  ].join("\n");
}

const sensitiveMemoryPattern =
  /自伤|自残|自杀|不想活|结束生命|割腕|跳楼|上吊|吞药|安眠药|性侵|强奸|猥亵|家暴|虐待|我叫|名字是|住在|具体住址|身份证|学号|手机号|微信号|银行卡|密码/;

export function getShortTermTurnLimit(): number {
  const configured = Number.parseInt(
    process.env.YUNDUO_SHORT_TERM_TURNS ?? "",
    10
  );
  return Number.isFinite(configured) && configured > 0
    ? Math.min(configured, 20)
    : DEFAULT_SHORT_TERM_TURNS;
}

export function selectRecentConversationMessages<T extends { role: string }>(
  messages: T[],
  maxUserTurns = DEFAULT_SHORT_TERM_TURNS
): T[] {
  if (maxUserTurns <= 0 || messages.length === 0) {
    return [];
  }

  let userTurns = 0;
  let startIndex = 0;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role !== "user") {
      continue;
    }
    userTurns += 1;
    if (userTurns === maxUserTurns) {
      startIndex = index;
      break;
    }
  }

  return messages.slice(startIndex);
}

export function isSensitiveMemoryText(text: string): boolean {
  return (
    assessCrisis(text).level !== "none" || sensitiveMemoryPattern.test(text)
  );
}

function normalizeSummaryText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/[。！？!?]+$/g, "")
    .trim();
}

export function buildConversationMemory(messages: ConversationMessage[]): {
  isSensitive: boolean;
  summary: string;
} | null {
  const userTexts = messages
    .filter((message) => message.role === "user")
    .map((message) => normalizeSummaryText(message.text))
    .filter(Boolean);

  const totalLength = userTexts.reduce((sum, text) => sum + text.length, 0);
  const combined = userTexts.slice(-2).join("；");
  if (isSensitiveMemoryText(combined)) {
    return {
      isSensitive: true,
      summary: "这次对话包含不适合主动回顾的内容。",
    };
  }

  if (userTexts.length < 2 && totalLength < 24) {
    return null;
  }

  const clipped = combined.length > 90 ? `${combined.slice(0, 90)}…` : combined;
  return {
    isSensitive: false,
    summary: `最近聊到：${clipped}。`,
  };
}

const ordinaryOpenings = [
  "今天想从哪里聊起都可以。",
  "你来了，想说什么都可以慢慢说。",
  "这会儿心里有什么，随便聊聊就好。",
];

const memoryOpenings = [
  (summary: string) =>
    `上次你提到${summary.replace(/^最近聊到：/, "")}今天想从哪里聊起都可以。`,
  (summary: string) =>
    `我记得你之前说过${summary.replace(/^最近聊到：/, "")}这次也可以慢慢说。`,
  (summary: string) =>
    `之前我们聊到${summary.replace(/^最近聊到：/, "")}今天不用急，想到什么说什么。`,
];

export function buildOpeningMessage(
  memory: { isSensitive: boolean; summary: string } | null,
  variant = 0
): string {
  const normalizedVariant = Math.abs(variant);
  if (!memory || memory.isSensitive || !memory.summary.trim()) {
    return ordinaryOpenings[normalizedVariant % ordinaryOpenings.length];
  }
  return memoryOpenings[normalizedVariant % memoryOpenings.length](
    memory.summary.trim()
  );
}
