import { AccountModel } from '../models/Account.js';
import type { OrderStatus } from '../models/Order.js';
import { WebhookEventModel, type WebhookEventType } from '../models/WebhookEvent.js';
import { isDuplicateKeyError } from '../utils/errors.js';
import { webhookPayloadSchema, type WebhookPayload } from '../validation/schemas.js';
import { ensureOrder, transitionOrderStatus } from './order.service.js';

/** Processing failed in a way that retrying cannot fix. */
export class PermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentError';
  }
}

/**
 * Stores a verified webhook so the worker can process it later.
 *
 * Idempotent: the upsert only writes when no event with this eventId exists,
 * and the unique index on eventId settles any race between two simultaneous
 * deliveries. A redelivery is acknowledged but changes nothing.
 */
export async function recordWebhookEvent(payload: WebhookPayload): Promise<{ duplicate: boolean }> {
  const now = new Date();
  try {
    const result = await WebhookEventModel.updateOne(
      { eventId: payload.eventId },
      {
        $setOnInsert: {
          accountId: payload.accountId,
          type: payload.type,
          payload,
          status: 'received',
          attempts: 0,
          nextAttemptAt: now,
          processedAt: null,
          lastError: null,
          createdAt: now,
          updatedAt: now,
        },
      },
      { upsert: true, timestamps: false },
    );
    return { duplicate: result.upsertedCount === 0 };
  } catch (error) {
    if (isDuplicateKeyError(error)) return { duplicate: true };
    throw error;
  }
}

const STATUS_FOR_EVENT: Record<Exclude<WebhookEventType, 'order.created'>, OrderStatus> = {
  'order.paid': 'paid',
  'order.shipped': 'shipped',
  'order.cancelled': 'cancelled',
};

/**
 * Applies one event to the orders collection.
 *
 * Every branch is safe to run more than once, because the worker guarantees
 * at-least-once processing, not exactly-once:
 *  - order.created is an upsert keyed on orderId;
 *  - status events are guarded transitions, and repeating one is a no-op.
 *
 * Throws PermanentError when retrying is pointless, and a plain Error when a
 * later attempt may succeed.
 */
export async function applyWebhookEvent(rawPayload: unknown): Promise<void> {
  const parsed = webhookPayloadSchema.safeParse(rawPayload);
  if (!parsed.success) {
    throw new PermanentError('Stored payload is not a valid webhook event');
  }
  const payload = parsed.data;

  if (!(await AccountModel.exists({ _id: payload.accountId }))) {
    throw new PermanentError(`Unknown account ${payload.accountId}`);
  }

  if (payload.type === 'order.created') {
    const result = await ensureOrder(payload.accountId, payload.data);
    if (result.conflict) {
      throw new PermanentError(`orderId ${payload.data.orderId} belongs to another account`);
    }
    return;
  }

  const result = await transitionOrderStatus(
    payload.accountId,
    payload.data.orderId,
    STATUS_FOR_EVENT[payload.type],
  );

  if (result.outcome === 'not_found') {
    // Webhooks can arrive out of order. The matching order.created is probably
    // still in the queue, so fail this attempt and let the retry pick it up.
    throw new Error(`Order ${payload.data.orderId} does not exist yet`);
  }
  // 'updated': done. 'noop': already applied. 'invalid': a stale event (for
  // example "paid" arriving after "shipped"), which is correct to ignore.
}
