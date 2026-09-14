export type CrisisAlertEvent = {
  id: string;
  userId: string;
  chatId: string;
  matchedRuleIds: string[];
  messageText: string;
  occurredAt?: string;
};

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

export function buildCrisisAlertPayload(event: CrisisAlertEvent): string {
  return [
    "【AI 云朵 · 危机告警】",
    `事件 ID：${event.id}`,
    `触发规则：${event.matchedRuleIds.join("、") || "unknown"}`,
    `会话 ID：${event.chatId}`,
    `用户消息：${event.messageText}`,
    event.occurredAt ? `发生时间：${event.occurredAt}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function notifyCrisisAlert(
  event: CrisisAlertEvent,
  fetchImpl: FetchLike = fetch
): Promise<{ channel: "webhook" | "console"; ok: boolean }> {
  const webhookUrl = process.env.CRISIS_ALERT_WEBHOOK_URL;

  if (!webhookUrl) {
    console.error("[yunduo-crisis-alert] 未配置 Webhook，降级为控制台告警", {
      event,
    });
    return { channel: "console", ok: true };
  }

  try {
    const payload = buildCrisisAlertPayload(event);
    const isDingTalk = /oapi\.dingtalk\.com\/robot\/send/i.test(webhookUrl);
    const response = await fetchImpl(webhookUrl, {
      body: JSON.stringify(
        isDingTalk
          ? { msgtype: "text", text: { content: payload } }
          : { text: payload }
      ),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    if (!response.ok) {
      console.error("[yunduo-crisis-alert] Webhook 发送失败", {
        status: response.status,
        eventId: event.id,
      });
      return { channel: "console", ok: false };
    }

    if (isDingTalk) {
      try {
        const result = (await response.json()) as {
          errcode?: number;
          errmsg?: string;
        };
        if (result.errcode !== undefined && result.errcode !== 0) {
          console.error("[yunduo-crisis-alert] 钉钉机器人拒绝消息", {
            errcode: result.errcode,
            errmsg: result.errmsg,
            eventId: event.id,
          });
          return { channel: "webhook", ok: false };
        }
      } catch {
        // 钉钉正常响应是 JSON；解析失败时保持成功，交由上层状态码判断
      }
    }

    return { channel: "webhook", ok: true };
  } catch (error) {
    console.error("[yunduo-crisis-alert] Webhook 请求异常", error);
    return { channel: "console", ok: false };
  }
}
