import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCrisisScreeningSuffix,
  parseCrisisRiskTag,
} from "../../lib/safety/crisis-screening";

test("能解析 RISK:HIGH 并剥掉标记行", () => {
  const parsed = parseCrisisRiskTag(
    "RISK:HIGH\n\n月色确实很美，但我很担心你。"
  );
  assert.ok(parsed !== null);
  if (parsed === null) {
    return;
  }
  assert.equal(parsed.risk, "HIGH");
  assert.equal(parsed.reply, "月色确实很美，但我很担心你。");
});

test("能解析 MEDIUM 与 LOW", () => {
  const medium = parseCrisisRiskTag("RISK:MEDIUM\n\n听上去很难受。");
  const low = parseCrisisRiskTag("RISK:LOW\n\n嗯，我在呢。");
  assert.ok(medium !== null && low !== null);
  if (medium === null || low === null) {
    return;
  }
  assert.equal(medium.risk, "MEDIUM");
  assert.equal(low.risk, "LOW");
});

test("解析对大小写与空白容错", () => {
  const parsed = parseCrisisRiskTag("  risk:high  \n\n你在听吗");
  assert.ok(parsed !== null);
  if (parsed === null) {
    return;
  }
  assert.equal(parsed.risk, "HIGH");
  assert.equal(parsed.reply, "你在听吗");
});

test("多行正文只剥第一行标记", () => {
  const parsed = parseCrisisRiskTag("RISK:MEDIUM\n\n第一行\n第二行");
  assert.ok(parsed !== null);
  if (parsed === null) {
    return;
  }
  assert.equal(parsed.reply, "第一行\n第二行");
});

test("无标记或格式错误返回 null", () => {
  assert.equal(parseCrisisRiskTag("今晚月色真美"), null);
  assert.equal(parseCrisisRiskTag("RISK:UNKNOWN\n\n回复"), null);
  assert.equal(parseCrisisRiskTag("先说别的\nRISK:HIGH\n\n回复"), null);
});

test("研判后缀包含告别式隐喻口径与日常用语排除", () => {
  const suffix = buildCrisisScreeningSuffix();
  assert.match(suffix, /RISK:HIGH/);
  assert.match(suffix, /RISK:MEDIUM/);
  assert.match(suffix, /RISK:LOW/);
  assert.match(suffix, /告别式隐喻/);
  assert.match(suffix, /我该走了/);
  assert.match(suffix, /想死你了/);
  assert.match(suffix, /第一行/);
});
