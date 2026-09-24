import { generateText, type LanguageModel } from "ai";
import { qwenNoThinking } from "../qwen-options";

const MIN_SUMMARY_LENGTH = 400;
const MAX_SUMMARY_LENGTH = 500;

export type MemorySummaryGenerator = (args: {
  instructions: string;
  model: LanguageModel;
  prompt: string;
}) => { text: string } | Promise<{ text: string }>;

export const MEMORY_COMPRESSION_INSTRUCTIONS = `你是会话摘要整理器。请把给定的同一聊天窗口内容压缩成一段 400-500 个中文字符的摘要。
只记录用户明确说过的事实、感受、经历、正在讨论的事情和用户使用的表达。尽量沿用用户原话。
不要做心理诊断，不要推断用户没有说过的身份、动机或事实，不要加入建议、评价或安慰。
只输出摘要正文，不要标题、列表、引号、Markdown 或字数说明。`;

function normalizeSummary(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function isValidMemorySummary(text: string): boolean {
  const { length } = normalizeSummary(text);
  return length >= MIN_SUMMARY_LENGTH && length <= MAX_SUMMARY_LENGTH;
}

export async function generateMemorySummary({
  generateImpl,
  model,
  prompt,
}: {
  generateImpl?: MemorySummaryGenerator;
  model: LanguageModel;
  prompt: string;
}): Promise<string> {
  const generate =
    generateImpl ??
    (async (args: {
      instructions: string;
      model: LanguageModel;
      prompt: string;
    }) => ({
      text: (await generateText({ ...args, ...qwenNoThinking })).text ?? "",
    }));
  const result = await generate({
    instructions: MEMORY_COMPRESSION_INSTRUCTIONS,
    model,
    prompt,
  });
  const summary = normalizeSummary(result.text);
  if (!isValidMemorySummary(summary)) {
    throw new Error("memory_summary_invalid_length");
  }
  return summary;
}
