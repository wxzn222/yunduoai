import assert from "node:assert/strict";
import test from "node:test";
import {
  detectWarmListenerViolations,
  type WarmListenerViolationKind,
} from "../../lib/ai/yunduo/guardrails";
import { buildWarmListenerSystemPrompt } from "../../lib/ai/yunduo/persona";

test("温暖倾听者系统 Prompt 包含身份边界", () => {
  const prompt = buildWarmListenerSystemPrompt();

  assert.match(prompt, /AI 陪伴伙伴/);
  assert.match(prompt, /不是心理咨询师/);
  assert.match(prompt, /不评判/);
  assert.match(prompt, /不给建议/);
  assert.match(prompt, /不灌鸡汤/);
  assert.match(prompt, /回复.*短/);
});

test("温暖倾听者系统 Prompt 声明不诊断、不冒充咨询师", () => {
  const prompt = buildWarmListenerSystemPrompt();

  assert.match(prompt, /不诊断|不开方/);
  assert.doesNotMatch(prompt, /我是(?:你的)?心理咨询师/);
});

test("合规回复不触发人格越界检测", () => {
  const violations = detectWarmListenerViolations(
    "听起来今天真的很难受。嗯，我在呢，你愿意的话可以再多说一点。"
  );

  assert.deepEqual(violations, []);
});

test("说教与建议式表达会被检测出来", () => {
  const adviceReplies = [
    "你应该振作起来",
    "我建议你去找朋友聊聊",
    "你必须积极一点",
  ];

  for (const reply of adviceReplies) {
    const kinds = detectWarmListenerViolations(reply).map(
      (v) => v.kind
    ) as WarmListenerViolationKind[];
    assert.ok(kinds.includes("advice"), `${reply} 应被识别为给建议`);
  }
});

test("鸡汤式表达会被检测出来", () => {
  const violations = detectWarmListenerViolations("加油，一切都会好的！");

  assert.ok(violations.some((v) => v.kind === "cliche"));
});

test("越界身份与隐私追问会被检测出来", () => {
  const boundaryReplies = [
    "我是你的心理咨询师",
    "你可能有抑郁症",
    "告诉我你在哪个学校",
  ];

  for (const reply of boundaryReplies) {
    const kinds = detectWarmListenerViolations(reply).map((v) => v.kind);
    assert.notEqual(kinds.length, 0, `${reply} 应触发越界检测`);
  }
});
