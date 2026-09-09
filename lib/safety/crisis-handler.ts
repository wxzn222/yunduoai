import type { CrisisEvent } from "../db/schema";
import { type CrisisAlertEvent, notifyCrisisAlert } from "./crisis-alert";

export type CrisisHandlingContext = {
  chatId: string;
  matchedRuleIds: string[];
  messageText: string;
  userId: string;
};

export type CrisisHandlingDeps = {
  createEvent?: (context: CrisisHandlingContext) => Promise<CrisisEvent[]>;
  notify?: (
    event: CrisisAlertEvent
  ) => Promise<{ channel: "webhook" | "console"; ok: boolean }>;
};

export async function handleSevereCrisis(
  context: CrisisHandlingContext,
  deps: CrisisHandlingDeps = {}
): Promise<void> {
  const createEvent =
    deps.createEvent ?? (await import("../db/queries")).createCrisisEvent;
  const notify = deps.notify ?? notifyCrisisAlert;

  const [event] = await createEvent(context);
  if (!event) {
    return;
  }

  await notify({
    chatId: event.chatId,
    id: event.id,
    matchedRuleIds: event.matchedRuleIds,
    messageText: event.messageText,
    occurredAt: event.createdAt.toISOString(),
    userId: event.userId,
  });
}
