import assert from "node:assert/strict";
import test from "node:test";
import type { LanguageModel } from "ai";

import {
  generateWarmListenerSafeText,
  WARM_LISTENER_FALLBACK_REPLY,
} from "../../lib/ai/yunduo/generate-safe-reply";

const dummyModel = null as unknown as LanguageModel;

test("模型标 HIGH 时返回 HIGH 与剥离标记后的正文", async () => {
  const result = await generateWarmListenerSafeText({
    generateImpl: () => ({
      text: "RISK:HIGH\n\n月色确实很美，但我真的很希望你能留下来。",
    }),
    instructions: "你是云朵，一个陪伴伙伴。",
    messages: [],
    model: dummyModel,
  });

  assert.equal(result.risk, "HIGH");
  assert.match(result.text, /月色确实很美/);
  assert.doesNotMatch(result.text, /RISK/);
});

test("普通正文没有风险标签时也保留逻辑回答", async () => {
  let calls = 0;

  const result = await generateWarmListenerSafeText({
    generateImpl: () => {
      calls += 1;
      return calls === 1
        ? { text: "没有标记的正文" }
        : { text: "RISK:LOW\n\n别担心，我在呢。" };
    },
    instructions: "你是云朵。",
    messages: [],
    model: dummyModel,
  });

  assert.equal(calls, 1);
  assert.equal(result.risk, "LOW");
  assert.equal(result.text, "没有标记的正文");
});

test("连续空回复时才使用 fallback", async () => {
  let calls = 0;

  const result = await generateWarmListenerSafeText({
    generateImpl: () => {
      calls += 1;
      return { text: "" };
    },
    instructions: "你是云朵。",
    messages: [],
    model: dummyModel,
  });

  assert.equal(calls, 2);
  assert.equal(result.risk, "LOW");
  assert.equal(result.text, WARM_LISTENER_FALLBACK_REPLY);
});

test("标记合法但正文触发人格越界时使用兜底回复", async () => {
  const result = await generateWarmListenerSafeText({
    generateImpl: () => ({ text: "RISK:LOW\n\n你应该振作起来。" }),
    instructions: "你是云朵。",
    maxAttempts: 1,
    messages: [],
    model: dummyModel,
  });

  assert.equal(result.text, WARM_LISTENER_FALLBACK_REPLY);
});
