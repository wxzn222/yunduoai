import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCrisisAlertPayload,
  type CrisisAlertEvent,
  notifyCrisisAlert,
} from "../../lib/safety/crisis-alert";

const sampleEvent: CrisisAlertEvent = {
  chatId: "chat-1",
  id: "event-1",
  matchedRuleIds: ["suicide-wish"],
  messageText: "我不想活了",
  userId: "user-1",
};

test("危机告警消息包含事件与用户可见的关键信息", () => {
  const payload = buildCrisisAlertPayload(sampleEvent);

  assert.match(payload, /危机告警/);
  assert.match(payload, /suicide-wish/);
  assert.match(payload, /我不想活了/);
  assert.match(payload, /chat-1/);
});

test("配置了 Webhook 时通过 POST 发送告警", async () => {
  const previousUrl = process.env.CRISIS_ALERT_WEBHOOK_URL;
  process.env.CRISIS_ALERT_WEBHOOK_URL = "https://example.test/hook";

  let sentBody = "";
  let sentHeaders: HeadersInit | undefined;

  const result = await notifyCrisisAlert(sampleEvent, async (_url, init) => {
    sentBody = String(init?.body);
    sentHeaders = init?.headers;
    return new Response("ok", { status: 200 });
  });

  if (previousUrl === undefined) {
    delete process.env.CRISIS_ALERT_WEBHOOK_URL;
  } else {
    process.env.CRISIS_ALERT_WEBHOOK_URL = previousUrl;
  }

  assert.equal(result.channel, "webhook");
  assert.equal(result.ok, true);
  assert.match(sentBody, /我不想活了/);
  assert.match(JSON.stringify(sentHeaders), /application\/json/i);
});

test("钉钉机器人使用 text 消息格式发送告警", async () => {
  const previousUrl = process.env.CRISIS_ALERT_WEBHOOK_URL;
  process.env.CRISIS_ALERT_WEBHOOK_URL =
    "https://oapi.dingtalk.com/robot/send?access_token=test-token";

  let sentBody = "";

  const result = await notifyCrisisAlert(sampleEvent, async (_url, init) => {
    sentBody = String(init?.body);
    return new Response('{"errcode":0}', { status: 200 });
  });

  if (previousUrl === undefined) {
    delete process.env.CRISIS_ALERT_WEBHOOK_URL;
  } else {
    process.env.CRISIS_ALERT_WEBHOOK_URL = previousUrl;
  }

  assert.equal(result.channel, "webhook");
  assert.equal(result.ok, true);
  const body = JSON.parse(sentBody) as {
    msgtype?: string;
    text?: { content?: string };
  };
  assert.equal(body.msgtype, "text");
  assert.match(body.text?.content ?? "", /我不想活了/);
});

test("钉钉返回 HTTP 200 但 errcode 非 0 时判定为发送失败", async () => {
  const previousUrl = process.env.CRISIS_ALERT_WEBHOOK_URL;
  process.env.CRISIS_ALERT_WEBHOOK_URL =
    "https://oapi.dingtalk.com/robot/send?access_token=test-token";

  const result = await notifyCrisisAlert(
    sampleEvent,
    async () =>
      new Response(
        JSON.stringify({ errcode: 310_000, errmsg: "keywords not in content" }),
        { status: 200 }
      )
  );

  if (previousUrl === undefined) {
    delete process.env.CRISIS_ALERT_WEBHOOK_URL;
  } else {
    process.env.CRISIS_ALERT_WEBHOOK_URL = previousUrl;
  }

  assert.equal(result.channel, "webhook");
  assert.equal(result.ok, false);
});

test("未配置 Webhook 时降级为控制台告警", async () => {
  const previousUrl = process.env.CRISIS_ALERT_WEBHOOK_URL;
  delete process.env.CRISIS_ALERT_WEBHOOK_URL;

  const result = await notifyCrisisAlert(sampleEvent, async () => {
    throw new Error("不应调用网络请求");
  });

  if (previousUrl !== undefined) {
    process.env.CRISIS_ALERT_WEBHOOK_URL = previousUrl;
  }

  assert.equal(result.channel, "console");
  assert.equal(result.ok, true);
});
