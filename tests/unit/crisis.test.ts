import assert from "node:assert/strict";
import test from "node:test";

import { assessCrisis, SEVERE_CRISIS_RESPONSE } from "../../lib/safety/crisis";

test("普通负面情绪不会被误判为危机", () => {
  const assessment = assessCrisis("今天有点烦，跟室友闹得不开心");

  assert.equal(assessment.level, "none");
  assert.deepEqual(assessment.matchedRuleIds, []);
});

test("明确自伤自杀表达会被判定为重度危机", () => {
  const severePhrases = [
    "我不想活了",
    "我想自杀",
    "我要割腕",
    "我想结束自己的生命",
    "我已经计划好怎么结束生命了",
  ];

  for (const phrase of severePhrases) {
    const assessment = assessCrisis(phrase);
    assert.equal(assessment.level, "severe", `${phrase} 应判定为重度危机`);
  }
});

test("持续失眠、自我否定等表达会被判定为中度困扰", () => {
  const moderatePhrases = [
    "我最近一直失眠，觉得自己很没用",
    "我最近总是想哭，情绪很低落",
    "我觉得自己可能撑不下去了，但还没有伤害自己的打算",
  ];

  for (const phrase of moderatePhrases) {
    const assessment = assessCrisis(phrase);
    assert.equal(assessment.level, "moderate", `${phrase} 应判定为中度困扰`);
  }
});

test("同时出现中度与重度表达时优先判定重度", () => {
  const assessment = assessCrisis("我最近一直失眠，现在真的不想活了");

  assert.equal(assessment.level, "severe");
});

test("重度危机固定话术包含求助渠道且不讨论具体方法", () => {
  assert.match(SEVERE_CRISIS_RESPONSE, /400-161-9995/);
  assert.match(SEVERE_CRISIS_RESPONSE, /学校心理中心/);
  assert.doesNotMatch(SEVERE_CRISIS_RESPONSE, /割腕|安眠药|跳楼|上吊/);
});
