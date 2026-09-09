import assert from "node:assert/strict";
import test from "node:test";

import type { CrisisEvent } from "../../lib/db/schema";
import {
  type CrisisHandlingDeps,
  handleSevereCrisis,
} from "../../lib/safety/crisis-handler";

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
    createEvent: (context) => {
      createdContext = context;
      return Promise.resolve([fakeEvent]);
    },
    notify: (event) => {
      notifiedEvent = event;
      return Promise.resolve({ channel: "webhook" as const, ok: true });
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
    createEvent: () => Promise.resolve([]),
    notify: () => {
      notified = true;
      return Promise.resolve({ channel: "webhook" as const, ok: true });
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
