import { generateText, type LanguageModel } from "ai";

import {
  buildCrisisScreeningSuffix,
  type CrisisRiskLevel,
  parseCrisisRiskTag,
} from "../../safety/crisis-screening";
import { qwenNoThinking } from "../qwen-options";
import {
  detectWarmListenerViolations,
  type WarmListenerViolation,
} from "./guardrails";

export const WARM_LISTENER_FALLBACK_REPLY =
  "听起来真的不容易。嗯，我在呢。你想说的话，可以慢慢说。";

type GenerateTextLike = (args: {
  instructions: string;
  messages: NonNullable<Parameters<typeof generateText>[0]["messages"]>;
  model: LanguageModel;
}) => { text: string } | Promise<{ text: string }>;

export async function generateWarmListenerSafeText({
  generateImpl,
  instructions,
  maxAttempts = 3,
  messages,
  model,
}: {
  generateImpl?: GenerateTextLike;
  instructions: string;
  maxAttempts?: number;
  messages: NonNullable<Parameters<typeof generateText>[0]["messages"]>;
  model: LanguageModel;
}): Promise<{
  attempts: number;
  risk: CrisisRiskLevel;
  text: string;
  violations: WarmListenerViolation[];
}> {
  const callGenerate: GenerateTextLike =
    generateImpl ??
    (async (args) => ({
      text: (await generateText({ ...args, ...qwenNoThinking })).text ?? "",
    }));
  const finalInstructions = `${instructions}\n\n${buildCrisisScreeningSuffix()}`;

  let violations: WarmListenerViolation[] = [];
  let lastValidRisk: CrisisRiskLevel = "LOW";
  let parsedAnyTag = false;
  let invalidTagStreak = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    // biome-ignore lint/performance/noAwaitInLoops: 重试必须顺序执行，不能并发
    const result = await callGenerate({
      instructions: finalInstructions,
      messages,
      model,
    });
    const raw = result.text ?? "";
    const parsed = parseCrisisRiskTag(raw);

    if (!parsed) {
      invalidTagStreak += 1;
      if (invalidTagStreak >= 2) {
        break;
      }
      continue;
    }

    parsedAnyTag = true;
    invalidTagStreak = 0;
    lastValidRisk = parsed.risk;
    violations = detectWarmListenerViolations(parsed.reply);

    if (violations.length === 0) {
      return {
        attempts: attempt,
        risk: parsed.risk,
        text: parsed.reply,
        violations,
      };
    }
  }

  if (!parsedAnyTag) {
    console.warn("[yunduo-crisis-screening] 无法解析风险标记", {
      attempts: maxAttempts,
    });
  }

  return {
    attempts: maxAttempts,
    risk: lastValidRisk,
    text: WARM_LISTENER_FALLBACK_REPLY,
    violations,
  };
}
