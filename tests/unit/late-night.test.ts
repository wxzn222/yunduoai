import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLateNightModeRule,
  getShanghaiHour,
  isLateNightShanghai,
} from "../../lib/ai/yunduo/late-night";

test("Asia/Shanghai 21:59 不在深夜窗口", () => {
  const date = new Date("2026-09-09T13:59:59Z");
  assert.equal(getShanghaiHour(date), 21);
  assert.equal(isLateNightShanghai(date), false);
});

test("Asia/Shanghai 22:00 进入深夜窗口", () => {
  const date = new Date("2026-09-09T14:00:00Z");
  assert.equal(getShanghaiHour(date), 22);
  assert.equal(isLateNightShanghai(date), true);
});

test("Asia/Shanghai 05:59 仍在深夜窗口", () => {
  const date = new Date("2026-09-09T21:59:59Z");
  assert.equal(getShanghaiHour(date), 5);
  assert.equal(isLateNightShanghai(date), true);
});

test("Asia/Shanghai 06:00 离开深夜窗口", () => {
  const date = new Date("2026-09-09T22:00:00Z");
  assert.equal(getShanghaiHour(date), 6);
  assert.equal(isLateNightShanghai(date), false);
});

test("深夜规则文本覆盖 PRD 口径", () => {
  const rule = buildLateNightModeRule();
  assert.match(rule, /更短/);
  assert.match(rule, /更柔/);
  assert.match(rule, /不主动展开新话题/);
  assert.match(rule, /不连续追问/);
});
