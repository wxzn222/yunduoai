# 设计文档：LLM 同轮危机研判（隐晦表达与告别式隐喻）

- 日期：2026-09-09
- 状态：已获用户确认，待评审
- 关联功能：AI 云朵危机干预规则引擎、钉钉危机告警

## 1. 背景与问题

当前危机检测只依赖 `lib/safety/crisis.ts` 的规则引擎（关键词/正则）。
规则引擎只能捕获字面表达，例如“我不想活了”“想自杀”“割腕”。

实测现象：用户发送“今晚月色真美，我该走了”，规则判定结果为
`{ level: "none", matchedRuleIds: [] }`，因此没有写危机事件、没有钉钉告警；
但千问在生成陪伴回复时自行识别出告别隐喻，并给出了危机类回应
（拨打 110、心理援助热线 400-161-9995）。

这造成状态不一致：用户面前像在做危机干预，后台却完全没有记录和告警，
而且模型回复不稳定，换一种说法可能连热线都不提。

## 2. 目标与非目标

### 目标

- 不新增独立模型调用（用户选定方案 C）：在生成回复的同一轮调用里，
  让模型先输出一个机器可读的危机风险标记，再接真正回复用户的内容。
- 模型标记为 HIGH 的隐晦/告别式隐喻消息，与规则命中重度走同一条安全链路：
  固定危机话术、写入 `CrisisEvent`、发送钉钉告警。
- 用户看到的回复永远不包含 RISK 标记。

### 非目标

- 不做独立的前置 LLM 风险筛查调用（方案 A）。
- 不做关键词预筛（方案 B）。
- 不改变规则引擎已命中重度时的即时处理路径。
- 不处理危机事件告警内容与现有格式之外的其它通知渠道。

## 3. 判定口径（用户决策）

模型在回复前先判断用户最近发言是否存在自伤/自杀风险，并输出一个标记：

- `RISK:HIGH`：存在明确生死暗示，或**告别式隐喻**。
  用户决策：“告别式隐喻本身就可以是最后一次留言，等人确认可能就来不及。”
  因此只要语境像在向世界/生命道别，即使句子也能解释成“我先下线了”，
  仍判 HIGH。
- `RISK:MEDIUM`：存在明显情绪困扰，但没有生死暗示。
- `RISK:LOW`：正常聊天，以及明显日常用语，例如“想死你了”“笑死我了”
  “我先走了，晚安”（无告别语境时）。

研判必须结合对话上下文，而不是只看最新一句。判断对象是“语境是否像在道别”，
不是孤立的字面词。

规则引擎命中重度永远优先于模型研判，且不走模型（保持零延迟、可预期、防提示注入）。

## 4. 架构与组件

### 4.1 新增 `lib/safety/crisis-screening.ts`

单一职责：危机研判提示词与结果解析，不直接调用模型。

导出内容：

- `type CrisisRiskLevel = "HIGH" | "MEDIUM" | "LOW"`（供回复生成模块与路由复用）。
- `buildCrisisScreeningSuffix(): string`：返回要拼到模型指令末尾的研判要求与
  口径示例，要求回复第一行必须是 `RISK:HIGH` / `RISK:MEDIUM` / `RISK:LOW`，
  空一行后再输出给用户的回复。
- `parseCrisisRiskTag(output: string)`：解析第一行风险标记。
  - 成功返回 `{ risk: CrisisRiskLevel; reply: string }`，`reply` 为剥掉标记后的正文。
  - 失败返回 `null`。
  - 对大小写、首尾空白容错。

### 4.2 修改 `lib/ai/yunduo/generate-safe-reply.ts`

`generateWarmListenerSafeText` 是所有“温暖倾听者回复”的单一入口，目前只在
`app/(chat)/api/chat/route.ts` 使用。

修改为：

- 接收方继续传 `instructions`；模块内部追加 `buildCrisisScreeningSuffix()`。
- 每次 `generateText` 后先用 `parseCrisisRiskTag` 解析。
  - 标记合法：正文（剥掉标记后的内容）继续走现有 `detectWarmListenerViolations`
    人格越界检测。
  - 标记缺失或无法解析：算一次格式失败，触发重试。
- 重试策略（用户选定方案 A）：
  - 总尝试上限沿用现有 `maxAttempts`（默认 3）。
  - 格式失败会触发下一次尝试；若连续两次都没有合法标记
    （即格式问题经历 2 次尝试后仍未解决），按方案 A 兜底。
  - 兜底时风险按 `LOW`，返回现有
    `WARM_LISTENER_FALLBACK_REPLY`，并记服务端日志
    `[yunduo-crisis-screening] 无法解析风险标记`，不触发危机告警。
  - 标记合法但正文始终越界 → 维持现有兜底回复；风险使用最后一次合法解析值。
- 返回类型扩展为：
  `{ risk: CrisisRiskLevel; text: string; violations; attempts }`。

为保证可测试，模块增加可选注入参数 `generateImpl?: typeof generateText`，
默认仍是真实 `generateText`；测试传入假实现返回固定文本。

### 4.3 修改 `app/(chat)/api/chat/route.ts`

重度规则命中分支保持不变：

```text
用户消息 → assessCrisis()
  ├─ severe → 固定话术 + 写 CrisisEvent + 钉钉告警（不调用模型）
  └─ none / moderate → 生成带研判标记的回复
       ├─ 返回 risk = HIGH → 丢弃模型正文，走与 severe 相同的重度链路
       └─ 返回 risk = MEDIUM / LOW → 输出剥掉标记后的正文
```

具体改动：

1. 无工具分支（qwen 当前路径）调用 `generateWarmListenerSafeText` 后，
   先判断 `safeReply.risk`。
2. `risk === "HIGH"` 时：
   - 不把模型正文写给用户，改为写 `SEVERE_CRISIS_RESPONSE` 固定话术。
   - 用 `after(async () => ...)` 调用 `createCrisisEvent`，其中
     `matchedRuleIds` 填 `["llm-implicit-severe"]`，`messageText` 为
     当前用户消息原文。
   - 落库成功后调用 `notifyCrisisAlert`，参数与现有重度分支一致。
   - 复用现有重度处理逻辑；若重复代码明显，抽成一个局部函数，两个分支共用。
3. `risk` 为 MEDIUM / LOW 时，沿用现有行为：
   - moderate 消息仍拼接 `MODERATE_CONTEXT_RULE` 后生成回复；
   - 输出 `safeReply.text`。
4. 有工具分支（`supportsTools === true` 时）仍走原 `streamText` 路径，
   本轮不做模型研判；qwen 当前 `getCapabilities()` 返回
   `{ reasoning:false, tools:false, vision:false }`，实际不会进入该分支。

### 4.4 数据与告警

- `CrisisEvent.matchedRuleIds` 新增来源标识 `llm-implicit-severe`，用于区分
  “规则命中”与“模型研判命中”，便于后续统计与审计。
- 钉钉告警内容沿用 `buildCrisisAlertPayload`，包含原始用户消息、会话 ID、
  事件 ID、触发规则与发生时间。隐私口径与现有规则命中一致，本设计不改变。

## 5. 错误处理

| 场景 | 处理 |
| --- | --- |
| 模型未按格式输出标记 | 计入尝试次数并重试，总尝试 2 次；仍失败按 LOW 兜底 + 服务端日志 |
| 模型正文触发人格越界 | 现有重试逻辑；耗尽后使用 `WARM_LISTENER_FALLBACK_REPLY` |
| 模型调用网络错误 | 沿用路由现有 catch，不新增告警误报 |
| 写库失败 | 沿用 `after` 内现有 try/catch，记录日志，不阻塞用户回复 |
| 钉钉发送失败 | 沿用 `notifyCrisisAlert` 现有日志与返回 |

## 6. 测试

### 单元测试（新增）

- `tests/unit/crisis-screening.test.ts`：
  - 解析 `RISK:HIGH` / `RISK:MEDIUM` / `RISK:LOW` 并剥掉标记；
  - 大小写与首尾空白容错；
  - 无标记或格式错误返回 `null`；
  - 研判后缀包含告别式隐喻口径（HIGH 示例与 LOW 日常用语示例）。
- `tests/unit/generate-safe-reply.test.ts`（新增）：
  - 注入假模型，文本为 `RISK:HIGH\n\n…` 时返回 `risk: "HIGH"` 且正文干净；
  - 第一次无标记、第二次合法时重试成功；
  - 两次均无标记时按 LOW 兜底并返回 fallback 文本；
  - 标记合法但正文越界时仍返回 fallback。

### 回归

- 现有 `tests/unit/yunduo.test.ts`、`tests/unit/crisis.test.ts`、
  `tests/unit/crisis-alert.test.ts` 全部通过。
- 现有 `tests/e2e/yunduo-smoke.test.ts` 全部通过。

### 真实验证（实现后手动执行）

- 向真实页面发送“今晚月色真美，我该走了”：
  - 用户应收到固定危机话术；
  - 数据库新增 `matchedRuleIds` 含 `llm-implicit-severe` 的事件；
  - 钉钉群收到告警。
- 发送“我先走了，晚安”等日常语句，确认正常回复、不落危机事件、不告警。

## 7. 验收标准

1. 隐晦告别式隐喻消息经模型研判为 HIGH 后，用户看到固定危机话术，
   后台落库并触发钉钉告警。
2. 规则直接命中重度的消息处理路径与响应时间不改变。
3. 正常消息与日常用语不产生误报，且用户界面永远看不到 RISK 标记。
4. 标记格式异常时按“重试一次、仍失败按 LOW”兜底，并有服务端日志。
5. 所有新增与既有测试通过。
