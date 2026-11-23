import { env } from '../config/env.js';
import { WebhookEventModel, type WebhookEventDocument } from '../models/WebhookEvent.js';
import { PermanentError, applyWebhookEvent } from '../services/webhook.service.js';

/** How long a claimed event stays hidden from other workers. */
const VISIBILITY_TIMEOUT_MS = 30_000;
const MAX_BACKOFF_MS = 60_000;

/** 2s, 4s, 8s, ... capped at one minute. */
export function backoffMs(attempts: number): number {
  return Math.min(1000 * 2 ** attempts, MAX_BACKOFF_MS);
}

/**
 * Atomically claims the oldest due event, or returns null if the queue is empty.
 *
 * findOneAndUpdate both selects and modifies the document in one operation, so
 * two workers polling at the same moment can never claim the same event.
 * Claiming pushes nextAttemptAt forward: if this process dies mid-flight, the
 * event simply becomes due again later instead of being lost.
 */
export async function claimNextEvent(now: Date): Promise<WebhookEventDocument | null> {
  return WebhookEventModel.findOneAndUpdate(
    { status: 'received', nextAttemptAt: { $lte: now } },
    {
      $set: { nextAttemptAt: new Date(now.getTime() + VISIBILITY_TIMEOUT_MS) },
      $inc: { attempts: 1 },
    },
    { sort: { nextAttemptAt: 1 }, returnDocument: 'after' },
  );
}

async function processEvent(event: WebhookEventDocument, now: Date): Promise<void> {
  // The status guard means a slow worker whose claim has expired cannot
  // overwrite the result of whoever finished the event in the meantime.
  const stillOpen = { _id: event._id, status: 'received' as const };

  try {
    await applyWebhookEvent(event.payload);
    await WebhookEventModel.updateOne(stillOpen, {
      $set: { status: 'processed', processedAt: new Date(), lastError: null },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const giveUp = error instanceof PermanentError || event.attempts >= env.WORKER_MAX_ATTEMPTS;

    await WebhookEventModel.updateOne(
      stillOpen,
      giveUp
        ? { $set: { status: 'failed', lastError: message } }
        : {
            $set: {
              lastError: message,
              nextAttemptAt: new Date(now.getTime() + backoffMs(event.attempts)),
            },
          },
    );
  }
}

/**
 * Processes every event that is due at `now`. Returns how many were handled.
 * `now` is a parameter so tests can move the clock past a retry backoff.
 */
export async function drainQueue(now: Date = new Date()): Promise<number> {
  let handled = 0;
  for (;;) {
    const event = await claimNextEvent(now);
    if (!event) return handled;
    await processEvent(event, now);
    handled += 1;
  }
}

export interface WorkerHandle {
  stop(): Promise<void>;
}

/** Polls the queue on an interval. One drain runs at a time. */
export function startWebhookWorker(pollMs: number = env.WORKER_POLL_MS): WorkerHandle {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let current: Promise<void> = Promise.resolve();

  const tick = (): void => {
    current = drainQueue()
      .then(() => undefined)
      .catch((error: unknown) => {
        console.error('[worker] poll failed', error);
      })
      .finally(() => {
        // Schedule the next poll only after this one finishes, so slow
        // batches never overlap.
        if (!stopped) timer = setTimeout(tick, pollMs);
      });
  };

  tick();

  return {
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await current;
    },
  };
}
