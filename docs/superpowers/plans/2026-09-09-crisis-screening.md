# LLM 同轮危机研判（隐晦告别式隐喻）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让规则引擎漏掉的告别式隐喻等隐晦危机表达，在生成回复的同一轮模型调用中被判为 HIGH，并走固定话术 + 危机事件落库 + 钉钉告警。

**Architecture:** 在现有 `generateWarmListenerSafeText` 的单次模型调用内追加研判指令，要求输出第一行为 `RISK:HIGH|MEDIUM|LOW`；解析后剥掉标记、把正文交给人格越界检测。规则命中重度仍即时短路；模型判 HIGH 时复用同一套重度处理（事件 + 告警 + 固定话术）。

**Tech Stack:** TypeScript / Next.js 16.2 / AI SDK 7（`generateText`）/ node:test + tsx / Playwright

## Global Constraints

- 重度规则命中分支不调用模型，路径与响应时间不变。
- 用户界面永远不出现 `RISK:` 标记。
- 隐晦告别式隐喻即使有“我先下线了”的日常解释，只要语境像向生命道别，一律按 HIGH（用户决策）。
- 明显日常用语（“想死你了”“笑死我了”“我先走了，晚安”无告别语境）不得判 HIGH。
- 模型未按格式输出标记时最多重试一次，仍失败按 LOW 兜底并记服务端日志（用户决策 A）。
- 危机事件来源标识固定为 `llm-implicit-severe`。
- 规则命中重度与模型判 HIGH 必须共用同一段“写事件 + 发告警”逻辑。
- 不打印、不展示任何 API key / 钉钉 token。

## File Structure

### 新增

- `lib/safety/crisis-screening.ts` — 研判后缀文本与风险标记解析器（纯函数，不调模型）。
- `lib/safety/crisis-handler.ts` — 重度危机事件落库 + 告警的统一处理器（可注入依赖）。
- `tests/unit/crisis-screening.test.ts`
- `tests/unit/generate-safe-reply.test.ts`
- `tests/unit/crisis-handler.test.ts`

### 修改

- `lib/ai/yunduo/generate-safe-reply.ts` — 单次调用内追加研判后缀、解析标记、返回 `risk`。
- `app/(chat)/api/chat/route.ts` — 无工具分支接入 `risk === "HIGH"` 的重度处理。

### 临时验证文件（跑完删除，不提交）

- `tests/e2e/farewell-verify.spec.ts`

---

### Task 1: 危机研判解析器与提示词

**Files:**
- Create: `lib/safety/crisis-screening.ts`
- Test: `tests/unit/crisis-screening.test.ts`

**Interfaces:**
- Produces:
  - `export type CrisisRiskLevel = "HIGH" | "MEDIUM" | "LOW"`
  - `export function buildCrisisScreeningSuffix(): string`
  - `export function parseCrisisRiskTag(output: string): { risk: CrisisRiskLevel; reply: string } | null`

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/crisis-screening.test.ts`：

```ts
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
  if (parsed === null) return;
  assert.equal(parsed.risk, "HIGH");
  assert.equal(parsed.reply, "月色确实很美，但我很担心你。");
});

test("能解析 MEDIUM 与 LOW", () => {
  const medium = parseCrisisRiskTag("RISK:MEDIUM\n\n听上去很难受。");
  const low = parseCrisisRiskTag("RISK:LOW\n\n嗯，我在呢。");
  assert.ok(medium !== null && low !== null);
  if (medium === null || low === null) return;
  assert.equal(medium.risk, "MEDIUM");
  assert.equal(low.risk, "LOW");
});

test("解析对大小写与空白容错", () => {
  const parsed = parseCrisisRiskTag("  risk:high  \n\n你在听吗");
  assert.ok(parsed !== null);
  if (parsed === null) return;
  assert.equal(parsed.risk, "HIGH");
  assert.equal(parsed.reply, "你在听吗");
});

test("多行正文只剥第一行标记", () => {
  const parsed = parseCrisisRiskTag("RISK:MEDIUM\n\n第一行\n第二行");
  assert.ok(parsed !== null);
  if (parsed === null) return;
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
```

- [ ] **Step 2: 运行测试确认 RED**

Run:

```bash
corepack pnpm exec tsx --test tests/unit/crisis-screening.test.ts
```

Expected: FAIL，报模块或函数不存在。

- [ ] **Step 3: 写最小实现**

创建 `lib/safety/crisis-screening.ts`：

```ts
export type CrisisRiskLevel = "HIGH" | "MEDIUM" | "LOW";

export function buildCrisisScreeningSuffix(): string {
  return `回复用户前，先判断用户最近发言是否存在自伤或自杀风险。判断必须结合整段对话上下文。

输出格式：第一行必须且只能是 RISK:HIGH、RISK:MEDIUM 或 RISK:LOW；空一行后再输出给用户的回复。不要在 RISK 行之前或之后写任何其它内容。

判定口径：
- RISK:HIGH：存在明确的生死暗示，或告别式隐喻。告别式隐喻哪怕也能解释成“我先下线了”，只要语境像在向世界或生命道别，仍判 HIGH。示例：我该走了（告别语境）、如果我不在了、以后不会麻烦大家了、把想说的话都说完了、今晚月色真美（告别语境）。
- RISK:MEDIUM：存在明显情绪困扰（如持续失眠、自我否定、长期低落、撑不下去），但没有生死暗示。
- RISK:LOW：正常聊天；以及明显日常用语，例如“想死你了”“笑死我了”“我先走了，晚安”（没有告别语境时）。`;
}

export function parseCrisisRiskTag(
  output: string
): { risk: CrisisRiskLevel; reply: string } | null {
  const normalized = output.replace(/^\uFEFF/, "");
  const firstLineBreak = normalized.indexOf("\n");
  const firstLine = (
    firstLineBreak === -1 ? normalized : normalized.slice(0, firstLineBreak)
  )
    .trim()
    .toUpperCase();

  const match = /^RISK:(HIGH|MEDIUM|LOW)$/.exec(firstLine);
  if (!match) return null;

  const risk = match[1] as CrisisRiskLevel;
  const rest =
    firstLineBreak === -1 ? "" : normalized.slice(firstLineBreak + 1);
  const reply = rest.replace(/^\n+/, "").trimStart();
  return { reply, risk };
}
```

- [ ] **Step 4: 运行测试确认 GREEN**

Run:

```bash
corepack pnpm exec tsx --test tests/unit/crisis-screening.test.ts
```

Expected: 6 条测试全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add lib/safety/crisis-screening.ts tests/unit/crisis-screening.test.ts
git commit -m "feat: 危机研判后缀与 RISK 标记解析器"
```

---

### Task 2: 回复生成单次调用内嵌风险标记

**Files:**
- Modify: `lib/ai/yunduo/generate-safe-reply.ts`
- Test: `tests/unit/generate-safe-reply.test.ts`

**Interfaces:**
- Consumes (Task 1): `CrisisRiskLevel`、`buildCrisisScreeningSuffix()`、`parseCrisisRiskTag()`
- Produces: `generateWarmListenerSafeText(...)` 返回类型增加 `risk: CrisisRiskLevel`，可选注入 `generateImpl`

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/generate-safe-reply.test.ts`：

```ts
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
    generateImpl: async () => ({
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

test("第一次未按格式输出时重试，第二次成功", async () => {
  let calls = 0;

  const result = await generateWarmListenerSafeText({
    generateImpl: async () => {
      calls += 1;
      return calls === 1
        ? { text: "没有标记的正文" }
        : { text: "RISK:LOW\n\n别担心，我在呢。" };
    },
    instructions: "你是云朵。",
    messages: [],
    model: dummyModel,
  });

  assert.equal(calls, 2);
  assert.equal(result.risk, "LOW");
  assert.equal(result.text, "别担心，我在呢。");
});

test("连续无标记时按 LOW 兜底并返回 fallback", async () => {
  let calls = 0;

  const result = await generateWarmListenerSafeText({
    generateImpl: async () => {
      calls += 1;
      return { text: "始终没有标记" };
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
    generateImpl: async () => ({ text: "RISK:LOW\n\n你应该振作起来。" }),
    instructions: "你是云朵。",
    maxAttempts: 1,
    messages: [],
    model: dummyModel,
  });

  assert.equal(result.text, WARM_LISTENER_FALLBACK_REPLY);
});
```

- [ ] **Step 2: 运行测试确认 RED**

Run:

```bash
corepack pnpm exec tsx --test tests/unit/generate-safe-reply.test.ts
```

Expected: FAIL（`generateImpl` 尚不存在 / 返回类型没有 `risk`）。

- [ ] **Step 3: 实现**

把 `lib/ai/yunduo/generate-safe-reply.ts` 整体替换为：

```ts
import { generateText, type LanguageModel } from "ai";

import {
  buildCrisisScreeningSuffix,
  parseCrisisRiskTag,
  type CrisisRiskLevel,
} from "../../safety/crisis-screening";
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
}) => Promise<{ text: string }>;

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
    (async (args) => ({ text: (await generateText(args)).text ?? "" }));
  const finalInstructions = `${instructions}\n\n${buildCrisisScreeningSuffix()}`;

  let violations: WarmListenerViolation[] = [];
  let lastValidRisk: CrisisRiskLevel = "LOW";
  let parsedAnyTag = false;
  let invalidTagStreak = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
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
```

- [ ] **Step 4: 运行新测试确认 GREEN**

Run:

```bash
corepack pnpm exec tsx --test tests/unit/generate-safe-reply.test.ts
```

Expected: 4 条测试全部 PASS。

- [ ] **Step 5: 回归单元测试**

Run:

```bash
corepack pnpm exec tsx --test tests/unit/crisis-screening.test.ts tests/unit/generate-safe-reply.test.ts tests/unit/yunduo.test.ts tests/unit/crisis.test.ts tests/unit/crisis-alert.test.ts
```

Expected: 全部 PASS。

- [ ] **Step 6: 类型检查**

Run:

```bash
corepack pnpm exec tsc --noEmit
```

Expected: 无输出、退出码 0。

- [ ] **Step 7: 提交**

```bash
git add lib/ai/yunduo/generate-safe-reply.ts tests/unit/generate-safe-reply.test.ts
git commit -m "feat: 回复生成同轮内嵌 RISK 标记解析"
```

---

### Task 3: 重度危机统一处理器

**Files:**
- Create: `lib/safety/crisis-handler.ts`
- Test: `tests/unit/crisis-handler.test.ts`

**Interfaces:**
- Consumes: `createCrisisEvent`（`lib/db/queries.ts`）、`notifyCrisisAlert`（`./crisis-alert.ts`）、`CrisisEvent`（`../db/schema.ts`）
- Produces:
  - `export type CrisisHandlingContext = { chatId: string; matchedRuleIds: string[]; messageText: string; userId: string }`
  - `export type CrisisHandlingDeps = { createEvent?: ...; notify?: ... }`
  - `export async function handleSevereCrisis(context: CrisisHandlingContext, deps?: CrisisHandlingDeps): Promise<void>`

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/crisis-handler.test.ts`：

```ts
import assert from "node:assert/strict";
import test from "node:test";

import {
  handleSevereCrisis,
  type CrisisHandlingDeps,
} from "../../lib/safety/crisis-handler";
import type { CrisisEvent } from "../../lib/db/schema";

const fakeEvent: CrisisEvent = {
  chatId: "chat-1",
  createdAt: new Date("2026-09-09T08:00:00.000Z"),
  id: "event-1",
  matchedRuleIds: ["llm-implicit-severe"],
  messageText: "今晚月色真美，我该走了",
  userId: "user-1",
};

test("重度危机处理会写事件并发送告警", async () => {
  let createdContext: Record<string, unknown> | undefined;
  let notifiedEvent: Record<string, unknown> | undefined;

  const deps: CrisisHandlingDeps = {
    createEvent: async (context) => {
      createdContext = context;
      return [fakeEvent];
    },
    notify: async (event) => {
      notifiedEvent = event;
      return { channel: "webhook", ok: true };
    },
  };

  await handleSevereCrisis(
    {
      chatId: "chat-1",
      matchedRuleIds: ["llm-implicit-severe"],
      messageText: "今晚月色真美，我该走了",
      userId: "user-1",
    },
    deps
  );

  assert.ok(createdContext);
  assert.equal(createdContext?.chatId, "chat-1");
  assert.deepEqual(createdContext?.matchedRuleIds, ["llm-implicit-severe"]);
  assert.ok(notifiedEvent);
  assert.equal(notifiedEvent?.id, "event-1");
  assert.equal(notifiedEvent?.occurredAt, "2026-09-09T08:00:00.000Z");
});

test("写事件没有返回记录时不发告警", async () => {
  let notified = false;

  const deps: CrisisHandlingDeps = {
    createEvent: async () => [],
    notify: async () => {
      notified = true;
      return { channel: "webhook", ok: true };
    },
  };

  await handleSevereCrisis(
    {
      chatId: "chat-1",
      matchedRuleIds: ["llm-implicit-severe"],
      messageText: "今晚月色真美，我该走了",
      userId: "user-1",
    },
    deps
  );

  assert.equal(notified, false);
});
```

- [ ] **Step 2: 运行测试确认 RED**

Run:

```bash
corepack pnpm exec tsx --test tests/unit/crisis-handler.test.ts
```

Expected: FAIL（模块或函数不存在）。

- [ ] **Step 3: 实现**

创建 `lib/safety/crisis-handler.ts`：

```ts
import { createCrisisEvent } from "../db/queries";
import type { CrisisEvent } from "../db/schema";
import { notifyCrisisAlert } from "./crisis-alert";
import type { CrisisAlertEvent } from "./crisis-alert";

export type CrisisHandlingContext = {
  chatId: string;
  matchedRuleIds: string[];
  messageText: string;
  userId: string;
};

export type CrisisHandlingDeps = {
  createEvent?: (
    context: CrisisHandlingContext
  ) => Promise<CrisisEvent[]>;
  notify?: (
    event: CrisisAlertEvent
  ) => Promise<{ channel: "webhook" | "console"; ok: boolean }>;
};

export async function handleSevereCrisis(
  context: CrisisHandlingContext,
  deps: CrisisHandlingDeps = {}
): Promise<void> {
  const createEvent = deps.createEvent ?? createCrisisEvent;
  const notify = deps.notify ?? notifyCrisisAlert;

  const [event] = await createEvent(context);
  if (!event) return;

  await notify({
    chatId: event.chatId,
    id: event.id,
    matchedRuleIds: event.matchedRuleIds,
    messageText: event.messageText,
    occurredAt: event.createdAt.toISOString(),
    userId: event.userId,
  });
}
```

说明：`createCrisisEvent` 的实际入参是 `{ chatId, userId, matchedRuleIds, messageText }`，与
`CrisisHandlingContext` 字段一致，因此可直接作为 `createEvent` 传入。

- [ ] **Step 4: 运行测试确认 GREEN**

Run:

```bash
corepack pnpm exec tsx --test tests/unit/crisis-handler.test.ts
```

Expected: 2 条测试全部 PASS。

- [ ] **Step 5: 类型检查**

Run:

```bash
corepack pnpm exec tsc --noEmit
```

Expected: 无输出、退出码 0。

- [ ] **Step 6: 提交**

```bash
git add lib/safety/crisis-handler.ts tests/unit/crisis-handler.test.ts
git commit -m "feat: 重度危机写库与告警统一处理器"
```

---

### Task 4: 路由接入模型 HIGH 判定

**Files:**
- Modify: `app/(chat)/api/chat/route.ts`
- Test: `tests/e2e/yunduo-smoke.test.ts`（回归，不新增永久断言）

**Interfaces:**
- Consumes (Task 2): `safeReply.risk`
- Consumes (Task 3): `handleSevereCrisis(context)`

- [ ] **Step 1: 新增 import**

在 `app/(chat)/api/chat/route.ts` 的 `notifyCrisisAlert` import 下方增加：

```ts
import { handleSevereCrisis } from "@/lib/safety/crisis-handler";
```

同时删除不再直接使用的 `notifyCrisisAlert`、`createCrisisEvent` import 中仅用于重度分支的引用（保留文件里其它地方用到的 import；若 `notifyCrisisAlert` / `createCrisisEvent` 在重度分支之外没有被使用，则一并移除，让 `tsc --noEmit` 通过）。

- [ ] **Step 2: 重度规则分支改用统一处理器**

把规则命中重度分支里的 `after(async () => { ... })` 代码块整体替换为：

```ts
after(async () => {
  try {
    await handleSevereCrisis({
      chatId: id,
      matchedRuleIds: crisisAssessment.matchedRuleIds,
      messageText: currentUserText,
      userId: session.user.id,
    });
  } catch (error) {
    console.error("[yunduo-crisis-event] 记录或告警失败", error);
  }
});
```

- [ ] **Step 3: 无工具分支接入模型 HIGH**

把无工具分支中调用 `generateWarmListenerSafeText` 之后到 `return` 之间的代码：

```ts
const safeReply = await generateWarmListenerSafeText({
  instructions,
  messages: modelMessages,
  model: getLanguageModel(chatModel),
});

writeAssistantText(safeReply.text);

return;
```

替换为：

```ts
const safeReply = await generateWarmListenerSafeText({
  instructions,
  messages: modelMessages,
  model: getLanguageModel(chatModel),
});

if (safeReply.risk === "HIGH") {
  after(async () => {
    try {
      await handleSevereCrisis({
        chatId: id,
        matchedRuleIds: ["llm-implicit-severe"],
        messageText: currentUserText,
        userId: session.user.id,
      });
    } catch (error) {
      console.error("[yunduo-crisis-event] 记录或告警失败", error);
    }
  });
  writeAssistantText(SEVERE_CRISIS_RESPONSE);
  return;
}

writeAssistantText(safeReply.text);

return;
```

- [ ] **Step 4: 类型检查**

Run:

```bash
corepack pnpm exec tsc --noEmit
```

Expected: 无输出、退出码 0。若提示未使用 import，删除多余 import 后重跑。

- [ ] **Step 5: 回归 E2E（规则命中重度路径不回归）**

Run:

```bash
corepack pnpm exec playwright test tests/e2e/yunduo-smoke.test.ts --project=e2e --reporter=line --workers=1 -g "出现自伤自杀倾向"
```

Expected: 1 passed。随后跑全量：

```bash
corepack pnpm exec playwright test tests/e2e/yunduo-smoke.test.ts --project=e2e --reporter=line --workers=1
```

Expected: 7 passed。

- [ ] **Step 6: 全量单元回归**

Run:

```bash
corepack pnpm exec tsx --test tests/unit/crisis-screening.test.ts tests/unit/generate-safe-reply.test.ts tests/unit/crisis-handler.test.ts tests/unit/yunduo.test.ts tests/unit/crisis.test.ts tests/unit/crisis-alert.test.ts
```

Expected: 全部 PASS。

- [ ] **Step 7: 真实验证告别式隐喻走重度链路**

创建临时文件 `tests/e2e/farewell-verify.spec.ts`：

```ts
import { expect, test } from "@playwright/test";

const INPUT_TEST_ID = "multimodal-input";
const SEND_TEST_ID = "send-button";

test("临时验证：告别式隐喻应触发固定危机话术", async ({ page }) => {
  await page.goto("/");

  const notice = page.getByRole("button", { name: "我知道了" });
  try {
    await expect(notice).toBeVisible({ timeout: 5_000 });
    await notice.click();
    await expect(notice).toBeHidden();
  } catch {
    // 老访客不会出现声明弹窗
  }

  const input = page.getByTestId(INPUT_TEST_ID);
  await input.fill("今晚月色真美，我该走了");
  await page.getByTestId(SEND_TEST_ID).click();
  await expect(input).toHaveValue("");

  const assistant = page.locator('[data-role="assistant"]').last();
  await expect(assistant).toBeVisible({ timeout: 120_000 });
  await expect(assistant).toContainText(/400-161-9995|心理援助/, {
    timeout: 120_000,
  });
});
```

Run:

```bash
corepack pnpm exec playwright test tests/e2e/farewell-verify.spec.ts --project=e2e --reporter=line --workers=1
```

Expected: 1 passed（前提：dev server 已启动并加载 `.env.local`）。

随后确认危机事件落库：

```bash
docker exec ai-yunduo-postgres psql -U chatbot -d chatbot -c 'SELECT "matchedRuleIds", "messageText" FROM "CrisisEvent" ORDER BY "createdAt" DESC LIMIT 1;'
```

Expected: `matchedRuleIds` 含 `llm-implicit-severe`，`messageText` 为“今晚月色真美，我该走了”。

让用户在钉钉群确认收到告警。确认后删除临时文件：

```powershell
Remove-Item -LiteralPath 'D:\project222\ai-yunduo-chatbot\tests\e2e\farewell-verify.spec.ts'
```

- [ ] **Step 8: 提交**

```bash
git add app/(chat)/api/chat/route.ts
git commit -m "feat: 模型研判 HIGH 时接入危机固定话术与告警"
```

---

## 自检结果

- 规格覆盖：解析器/研判提示（Task 1）、同轮调用与兜底（Task 2）、统一重度处理（Task 3）、路由接入与真实验证（Task 4）均已覆盖设计文档第 3–7 节。
- 无占位符：所有步骤均给出可直接执行的命令与完整代码。
- 类型一致性：`CrisisRiskLevel`、`parseCrisisRiskTag`、`safeReply.risk`、
  `handleSevereCrisis(context)` 在任务间命名一致。
