import assert from "node:assert/strict";
import test from "node:test";

import {
  generateMemorySummary,
  isValidMemorySummary,
  MEMORY_COMPRESSION_INSTRUCTIONS,
} from "../../lib/ai/yunduo/compress-memory";

const validSummary = `用户说${"今天感到有些疲惫，最近一直在准备考试，也在和家人讨论之后的安排。".repeat(14)}`;

test("摘要生成器要求模型只输出 400-500 字正文", async () => {
  let received = "";
  const summary = await generateMemorySummary({
    generateImpl: ({ instructions, prompt }) => {
      received = `${instructions}\n${prompt}`;
      return { text: validSummary };
    },
    model: {} as never,
    prompt: "user: 我最近在准备考试。",
  });

  assert.equal(summary, validSummary);
  assert.match(received, /只记录用户明确说过的事实/);
  assert.match(received, /不要做心理诊断/);
  assert.equal(isValidMemorySummary(summary), true);
});

test("模型输出过短时摘要生成失败", async () => {
  await assert.rejects(
    generateMemorySummary({
      generateImpl: async () => ({ text: "太短了" }),
      model: {} as never,
      prompt: "user: 你好",
    }),
    /memory_summary_invalid_length/
  );
  assert.match(MEMORY_COMPRESSION_INSTRUCTIONS, /400-500/);
});
