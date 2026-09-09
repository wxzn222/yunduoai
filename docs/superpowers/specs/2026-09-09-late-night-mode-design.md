# 设计文档：深夜模式（22:00-06:00 Asia/Shanghai）

- 日期：2026-09-09
- 状态：已获用户确认，待评审
- 关联 PRD：AI 云朵 MVP 网站版 P0“深夜模式”；手动验收用例 PERSONA-10

## 1. 背景与目标

PRD 对深夜模式的定义只有一句话：“22:00 后句子变短、语气变柔，不主动找话题”。
用户实测界面与验收用例 PERSONA-10 也以这句话为准。

目标：

- 固定按 Asia/Shanghai 时区判断 22:00–次日 06:00 是否处于深夜模式。
- 深夜模式下，云朵回复更短、更柔、不主动展开话题。
- 输入框上方出现轻量“深夜陪伴中”标识（用户决策 B）。
- 危机安全链路（重度固定话术、中度陪伴、危机告警）完全不受影响。

## 2. 口径与决策

- 时间口径（用户决策 C）：固定 Asia/Shanghai，不看服务器所在地、不看用户所在地。
- 窗口：22:00（含）至次日 06:00（不含）。
- UI 标识（用户决策 B）：显示一行轻量小字，白天自动消失。
- 深夜规则只叠加在模型生成的普通/中度回复上；规则引擎命中重度时仍走固定话术。
- 提供开发验收开关：`LATE_NIGHT_FORCE=1` 让服务端回复走深夜规则；
  `NEXT_PUBLIC_LATE_NIGHT_FORCE=1` 让前端标识强制显示。两者默认关闭、
  不影响线上行为，仅用于单元/E2E 与本地演示。

## 3. 架构与组件

### 3.1 新增 `lib/ai/yunduo/late-night.ts`（纯逻辑，无副作用）

导出：

- `getShanghaiHour(date: Date): number`
  - 用 `Intl.DateTimeFormat` 按 `Asia/Shanghai` 取小时，小时制为 `h23`。
- `isLateNightShanghai(date: Date): boolean`
  - `hour >= 22 || hour < 6`。
- `buildLateNightModeRule(): string`
  - 返回深夜规则文本，内容覆盖：回复更短（尽量一两句）、语气更轻更柔、
    少感叹号、不主动展开新话题、不连续追问、不劝睡；用户倾诉时安静接住。

### 3.2 路由接入（`app/(chat)/api/chat/route.ts`）

- 生成回复前计算一次 `const isLateNight = process.env.LATE_NIGHT_FORCE === "1" || isLateNightShanghai(new Date());`
- 无工具分支：
  - 现有 `baseInstructions` 之后，若中度先拼 `MODERATE_CONTEXT_RULE`；
    若深夜再拼 `buildLateNightModeRule()`。
  - 最终仍交给 `generateWarmListenerSafeText`（其内部会继续追加危机研判后缀）。
- 有工具分支（当前 qwen 不会进入，保留未来兼容）：
  - `instructions` 在 `systemPrompt(...)` 之后按同样条件追加深夜规则。
- 重度规则命中分支不改：固定话术、落库、告警全部原样。

### 3.3 新增 `components/yunduo/late-night-indicator.tsx`

- `"use client"`。
- 若 `NEXT_PUBLIC_LATE_NIGHT_FORCE === "1"`，直接按深夜显示（仅本地验收）。
- 挂载时与每 60 秒用 `isLateNightShanghai(new Date())` 刷新一次。
- 深夜时渲染一行轻量提示：
  - 文案：“深夜陪伴中 · 我在，慢慢说”
  - 位置：输入框上方、居中。
  - 视觉：小号、低对比度（不打扰阅读），不遮挡输入框。
- 白天不渲染任何内容。

### 3.4 修改 `components/chat/shell.tsx`

- 在底部输入区容器（`MultimodalInput` 所在 sticky 容器）内、输入框之前挂载
  `<LateNightIndicator />`，仅在 `!isReadonly` 时显示，与现有输入区条件一致。

## 4. 数据与埋点

- 本功能不新增数据表、不新增 API 字段、不改变 `CrisisEvent` 结构。
- 深夜模式不写库；如后续要埋“深夜用户比例”，另行在基础埋点里加事件，不在本设计范围。

## 5. 错误处理

| 场景 | 处理 |
| --- | --- |
| `Intl` 时区计算失败 | `isLateNightShanghai` 抛错则按白天处理并记一条服务端日志，不让聊天失败 |
| 前端时钟异常 | 指示器只是展示层，最坏情况显示错误，不影响发送消息 |
| `LATE_NIGHT_FORCE` 非 `"1"` | 视为未开启，不改变线上行为 |

## 6. 测试

### 单元测试（新增 `tests/unit/late-night.test.ts`）

- 边界：Asia/Shanghai 21:59 否、22:00 是、05:59 是、06:00 否。
- 时区独立性：用 UTC 时间构造边界日期，断言仍按东八区小时判断。
- 深夜规则文本包含：更短、更柔、不主动展开新话题、不追问。

### 回归

- 现有全部单元测试（危机研判、危机规则、告警、人格、回复生成、危机处理器）通过。
- `tsc --noEmit` 通过。
- 现有 `yunduo-smoke` E2E 7 条通过。

### 真实验证（开发验收）

- 用 `LATE_NIGHT_FORCE=1` 重启 dev server，页面应出现“深夜陪伴中 · 我在，慢慢说”，
  发送普通消息后回复比常规更短、语气更柔。
- 直接发送“我不想活了”仍触发固定危机话术，深夜规则不得改变危机输出。

## 7. 验收标准

1. Asia/Shanghai 22:00–06:00 窗口判定正确，边界有单测覆盖。
2. 深夜时普通回复走更短更柔指令；非深夜行为不变。
3. 输入框上方出现轻量深夜标识，白天不显示。
4. 危机固定话术、危机事件与钉钉告警行为不回归。
5. `LATE_NIGHT_FORCE=1` 可本地强制验收，默认不改变线上行为。
