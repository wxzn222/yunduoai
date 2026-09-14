import assert from "node:assert/strict";
import test from "node:test";

import {
  buildConversationMemory,
  buildOpeningMessage,
  isSensitiveMemoryText,
  selectRecentConversationMessages,
} from "../../lib/ai/yunduo/memory";

test("短期上下文只保留最近 N 个用户轮次", () => {
  const messages = [
    { role: "user", text: "第一轮" },
    { role: "assistant", text: "回应一" },
    { role: "user", text: "第二轮" },
    { role: "assistant", text: "回应二" },
    { role: "user", text: "第三轮" },
  ];

  assert.deepEqual(selectRecentConversationMessages(messages, 2), [
    { role: "user", text: "第二轮" },
    { role: "assistant", text: "回应二" },
    { role: "user", text: "第三轮" },
  ]);
});

test("内容过短时不生成长期摘要", () => {
  assert.equal(buildConversationMemory([{ role: "user", text: "你好" }]), null);
});

test("有效普通对话生成一条非敏感摘要", () => {
  const memory = buildConversationMemory([
    { role: "user", text: "最近课程作业很多，有点忙不过来" },
    { role: "assistant", text: "听起来这段时间挺挤的。" },
    { role: "user", text: "主要是小组作业的分工让我有点烦" },
  ]);

  assert.equal(memory?.isSensitive, false);
  assert.match(memory?.summary ?? "", /^最近聊到：/);
  assert.match(memory?.summary ?? "", /小组作业/);
});

test("危机、创伤和身份信息不会用于主动记忆唤起", () => {
  const sensitiveSamples = [
    "我不想活了",
    "之前遭遇过性侵",
    "我叫张三，手机号是13800138000",
  ];

  for (const sample of sensitiveSamples) {
    assert.equal(isSensitiveMemoryText(sample), true);
    const memory = buildConversationMemory([
      { role: "user", text: sample.repeat(2) },
    ]);
    assert.equal(memory?.isSensitive, true);
    assert.doesNotMatch(buildOpeningMessage(memory, 0), new RegExp(sample));
  }
});

test("合规摘要可自然唤起，敏感摘要退化为普通开场", () => {
  const safeMemory = {
    isSensitive: false,
    summary: "最近聊到：课程安排有点紧。",
  };
  const sensitiveMemory = {
    isSensitive: true,
    summary: "这次对话包含不适合主动回顾的内容。",
  };

  assert.match(buildOpeningMessage(safeMemory, 0), /课程安排/);
  assert.doesNotMatch(
    buildOpeningMessage(sensitiveMemory, 0),
    /不适合主动回顾/
  );
  assert.notEqual(buildOpeningMessage(null, 0), buildOpeningMessage(null, 1));
});
