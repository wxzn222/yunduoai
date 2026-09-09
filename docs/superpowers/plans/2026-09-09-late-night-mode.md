# 深夜模式 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Asia/Shanghai 22:00–06:00 让云朵自动进入深夜模式：回复更短更柔、不主动展开话题，并在输入框上方显示轻量“深夜陪伴中”标识。

**Architecture:** 新增纯函数模块统一判断 Asia/Shanghai 深夜窗口并输出深夜规则文本；服务端在生成普通/中度回复时追加深夜规则；客户端组件按同一函数显示标识；危机固定话术路径不改。

**Tech Stack:** TypeScript / Next.js 16.2 / AI SDK 7 / node:test + tsx / Playwright

## Global Constraints

- 时间固定 Asia/Shanghai；深夜窗口 22:00（含）至次日 06:00（不含）。
- 重度危机固定话术、危机事件与钉钉告警不因深夜模式改变。
- 用户界面新增文案必须为：“深夜陪伴中 · 我在，慢慢说”。
- `LATE_NIGHT_FORCE=1` 仅用于本地验收，默认关闭，不影响线上行为。
- 不打印、不展示任何 API key / 钉钉 token。

## File Structure

### 新增

- `lib/ai/yunduo/late-night.ts` — 纯函数：Asia/Shanghai 小时、深夜判定、深夜规则文本。
- `components/yunduo/late-night-indicator.tsx` — 客户端深夜标识。
- `tests/unit/late-night.test.ts`

### 修改

- `app/(chat)/api/chat/route.ts` — 判定深夜并向无工具/有工具两条模型路径追加规则。
- `components/chat/shell.tsx` — 在输入框上方挂载深夜标识。

### 临时验证文件（跑完删除，不提交）

- `tests/e2e/late-night-verify.test.ts`

---

### Task 1: 深夜模式纯函数模块

**Files:**
- Create: `lib/ai/yunduo/late-night.ts`
- Test: `tests/unit/late-night.test.ts`

**Interfaces:**
- Produces:
  - `export function getShanghaiHour(date: Date): number`
  - `export function isLateNightShanghai(date: Date): boolean`
  - `export function buildLateNightModeRule(): string`

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/late-night.test.ts`：

```ts
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
```

- [ ] **Step 2: 运行测试确认 RED**

Run:

```bash
corepack pnpm exec tsx --test tests/unit/late-night.test.ts
```

Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

创建 `lib/ai/yunduo/late-night.ts`：

```ts
export function getShanghaiHour(date: Date): number {
  const hour = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    hourCycle: "h23",
    timeZone: "Asia/Shanghai",
  }).format(date);

  return Number.parseInt(hour, 10);
}

export function isLateNightShanghai(date: Date): boolean {
  const hour = getShanghaiHour(date);
  return hour >= 22 || hour < 6;
}

export function buildLateNightModeRule(): string {
  return `现在是深夜（Asia/Shanghai 22:00-06:00）。
深夜对话规则：
1. 回复尽量比平时再短一半，优先一两句话。
2. 语气更轻、更柔、更慢，少用感叹号，不用玩笑口吻。
3. 不主动展开新话题，不连续追问，不反问，不急着给结论。
4. 如果用户在倾诉，安静接住就好，不要劝睡、不要急着开导。`;
}
```

- [ ] **Step 4: 运行测试确认 GREEN**

Run:

```bash
corepack pnpm exec tsx --test tests/unit/late-night.test.ts
```

Expected: 5 条测试全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add lib/ai/yunduo/late-night.ts tests/unit/late-night.test.ts
git commit -m "feat: Asia/Shanghai 深夜窗口判定与规则文本"
```

---

### Task 2: 路由注入深夜规则并接入 UI 标识

**Files:**
- Modify: `app/(chat)/api/chat/route.ts`
- Create: `components/yunduo/late-night-indicator.tsx`
- Modify: `components/chat/shell.tsx`

**Interfaces:**
- Consumes (Task 1): `isLateNightShanghai(date)`、`buildLateNightModeRule()`

- [ ] **Step 1: 路由 import 与判定**

在 `app/(chat)/api/chat/route.ts` 顶部（`generateWarmListenerSafeText` import 之后）增加：

```ts
import {
  buildLateNightModeRule,
  isLateNightShanghai,
} from "@/lib/ai/yunduo/late-night";
```

在 `crisisAssessment` 计算之后增加：

```ts
const isLateNight =
  process.env.LATE_NIGHT_FORCE === "1" ||
  isLateNightShanghai(new Date());
```

- [ ] **Step 2: 无工具分支追加深夜规则**

把无工具分支中的：

```ts
const baseInstructions = systemPrompt({ requestHints, supportsTools });
const instructions =
  crisisAssessment.level === "moderate"
    ? `${baseInstructions}\n\n${MODERATE_CONTEXT_RULE}`
    : baseInstructions;
```

替换为：

```ts
const baseInstructions = systemPrompt({ requestHints, supportsTools });
const instructions =
  crisisAssessment.level === "moderate"
    ? `${baseInstructions}\n\n${MODERATE_CONTEXT_RULE}`
    : baseInstructions;
const instructionsWithLateNight = isLateNight
  ? `${instructions}\n\n${buildLateNightModeRule()}`
  : instructions;
```

并把该分支调用 `generateWarmListenerSafeText` 时的 `instructions,` 改为
`instructions: instructionsWithLateNight,`。

- [ ] **Step 3: 有工具分支追加深夜规则**

在 `const result = streamText({` 之前增加：

```ts
const toolInstructions = isLateNight
  ? `${systemPrompt({ requestHints, supportsTools })}\n\n${buildLateNightModeRule()}`
  : systemPrompt({ requestHints, supportsTools });
```

并把 `streamText` 参数里的：

```ts
instructions: systemPrompt({ requestHints, supportsTools }),
```

替换为：

```ts
instructions: toolInstructions,
```

- [ ] **Step 4: 新增客户端深夜标识**

创建 `components/yunduo/late-night-indicator.tsx`：

```tsx
"use client";

import { useEffect, useState } from "react";

import { isLateNightShanghai } from "@/lib/ai/yunduo/late-night";

export function LateNightIndicator() {
  const [isLateNight, setIsLateNight] = useState(false);

  useEffect(() => {
    const update = () => {
      setIsLateNight(isLateNightShanghai(new Date()));
    };

    update();
    const timer = window.setInterval(update, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  if (!isLateNight) {
    return null;
  }

  return (
    <p
      className="py-1 text-center text-xs text-muted-foreground/70"
      data-testid="late-night-indicator"
    >
      深夜陪伴中 · 我在，慢慢说
    </p>
  );
}
```

- [ ] **Step 5: 挂载到输入区**

在 `components/chat/shell.tsx` import 区（`MultimodalInput` import 之后）增加：

```tsx
import { LateNightIndicator } from "@/components/yunduo/late-night-indicator";
```

把输入区容器：

```tsx
<div className="sticky bottom-0 z-1 mx-auto flex w-full max-w-4xl gap-2 border-t-0 bg-background px-2 pb-3 md:px-4 md:pb-4">
  {!isReadonly && (
    <MultimodalInput
```

替换为：

```tsx
<div className="sticky bottom-0 z-1 mx-auto flex w-full max-w-4xl flex-col gap-2 border-t-0 bg-background px-2 pb-3 md:px-4 md:pb-4">
  {!isReadonly && <LateNightIndicator />}
  {!isReadonly && (
    <MultimodalInput
```

（只改开头容器 className 与新增一行；`MultimodalInput` 的 props 与闭合标签保持不变。）

- [ ] **Step 6: 类型检查**

Run:

```bash
corepack pnpm exec tsc --noEmit
```

Expected: 无输出、退出码 0。

- [ ] **Step 7: 单元回归**

Run:

```bash
corepack pnpm exec tsx --test tests/unit/late-night.test.ts tests/unit/crisis-screening.test.ts tests/unit/generate-safe-reply.test.ts tests/unit/crisis-handler.test.ts tests/unit/yunduo.test.ts tests/unit/crisis.test.ts tests/unit/crisis-alert.test.ts
```

Expected: 全部 PASS。

- [ ] **Step 8: 白天模式 E2E 回归**

Run:

```bash
corepack pnpm exec playwright test tests/e2e/yunduo-smoke.test.ts --project=e2e --reporter=line --workers=1
```

Expected: 7 passed（当前为白天，深夜规则不生效，原行为不回归）。

- [ ] **Step 9: 提交**

```bash
git add "app/(chat)/api/chat/route.ts" components/yunduo/late-night-indicator.tsx components/chat/shell.tsx
git commit -m "feat: 深夜模式规则注入与输入区标识"
```

---

### Task 3: `LATE_NIGHT_FORCE` 真实验证并收尾

**Files:**
- Test: `tests/e2e/late-night-verify.test.ts`（临时，验证后删除）

- [ ] **Step 1: 用强制开关重启 dev server**

停止当前 dev server，然后用：

```bash
$env:LATE_NIGHT_FORCE="1"; corepack pnpm dev
```

重启（仅本地验收；线上默认不设该变量）。

- [ ] **Step 2: 创建临时验收用例**

创建 `tests/e2e/late-night-verify.test.ts`：

```ts
import { expect, test } from "@playwright/test";

const INPUT_TEST_ID = "multimodal-input";
const SEND_TEST_ID = "send-button";

async function dismissIdentityNotice(
  page: import("@playwright/test").Page
) {
  const button = page.getByRole("button", { name: "我知道了" });
  try {
    await expect(button).toBeVisible({ timeout: 5_000 });
    await button.click();
    await expect(button).toBeHidden();
  } catch {
    // 老访客不会出现声明弹窗
  }
}

test("临时验证：强制深夜模式显示标识且危机话术不变", async ({ page }) => {
  await page.goto("/");
  await dismissIdentityNotice(page);

  await expect(page.getByTestId("late-night-indicator")).toBeVisible();
  await expect(page.getByTestId("late-night-indicator")).toContainText(
    "深夜陪伴中"
  );

  const input = page.getByTestId(INPUT_TEST_ID);
  await input.fill("请用一句话简单回应我");
  await page.getByTestId(SEND_TEST_ID).click();
  await expect(input).toHaveValue("");

  const assistant = page.locator('[data-role="assistant"]').last();
  await expect(assistant).toBeVisible({ timeout: 120_000 });
  await expect
    .poll(
      async () => {
        const text = ((await assistant.textContent()) ?? "").trim();
        return (
          text.length > 0 &&
          text !== "Waiting..." &&
          text !== "Thinking..."
        );
      },
      { timeout: 120_000 }
    )
    .toBe(true);

  await page.goto("/");
  await dismissIdentityNotice(page);
  const input2 = page.getByTestId(INPUT_TEST_ID);
  await input2.fill("我不想活了");
  await page.getByTestId(SEND_TEST_ID).click();
  await expect(input2).toHaveValue("");

  const crisisAssistant = page.locator('[data-role="assistant"]').last();
  await expect(crisisAssistant).toContainText(/400-161-9995/, {
    timeout: 120_000,
  });
});
```

- [ ] **Step 3: 运行临时验收**

Run:

```bash
corepack pnpm exec playwright test tests/e2e/late-night-verify.test.ts --project=e2e --reporter=line --workers=1
```

Expected: 1 passed。人工确认页面顶部提示文字与普通回复更短、危机回复仍为固定话术。

- [ ] **Step 4: 恢复普通 dev server**

停止强制模式 dev server，重新用 `corepack pnpm dev` 启动，确保本地环境回白天默认。

- [ ] **Step 5: 删除临时验收文件**

用 apply_patch 删除 `tests/e2e/late-night-verify.test.ts`。

- [ ] **Step 6: 全量验证并收尾**

Run:

```bash
corepack pnpm exec tsx --test tests/unit/late-night.test.ts tests/unit/crisis-screening.test.ts tests/unit/generate-safe-reply.test.ts tests/unit/crisis-handler.test.ts tests/unit/yunduo.test.ts tests/unit/crisis.test.ts tests/unit/crisis-alert.test.ts
corepack pnpm exec tsc --noEmit
```

Expected: 全部 PASS、类型检查无输出。

汇报实现结果，并询问是否需要把验收截图/结果记入手动验收用例。

---

## 自检结果

- 规格覆盖：时间窗口与判定（Task 1）、规则注入与 UI 标识（Task 2）、强制模式真实验证（Task 3）。
- 无占位符：所有步骤包含完整代码与命令。
- 类型一致性：`getShanghaiHour(date)`、`isLateNightShanghai(date)`、
  `buildLateNightModeRule()`、`LateNightIndicator` 在任务间命名一致。
