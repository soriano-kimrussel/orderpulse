import { Schema, model, type HydratedDocument, type Types } from 'mongoose';

export const WEBHOOK_EVENT_STATUSES = ['received', 'processed', 'failed'] as const;
export type WebhookEventStatus = (typeof WEBHOOK_EVENT_STATUSES)[number];

export const WEBHOOK_EVENT_TYPES = [
  'order.created',
  'order.paid',
  'order.shipped',
  'order.cancelled',
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

export interface WebhookEvent {
  /** Sender-supplied identifier. Unique: this is the idempotency key. */
  eventId: string;
  accountId: Types.ObjectId;
  type: WebhookEventType;
  /** The verified request body, stored as received. */
  payload: unknown;
  status: WebhookEventStatus;
  /** How many times a worker has claimed this event. */
  attempts: number;
  /**
   * Earliest time a worker may claim the event. Doubles as a visibility
   * timeout: claiming pushes it into the future, so a crashed worker's event
   * becomes claimable again on its own.
   */
  nextAttemptAt: Date;
  processedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const webhookEventSchema = new Schema<WebhookEvent>(
  {
    eventId: { type: String, required: true, maxlength: 200 },
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true },
    type: { type: String, enum: WEBHOOK_EVENT_TYPES, required: true },
    payload: { type: Schema.Types.Mixed, required: true },
    status: { type: String, enum: WEBHOOK_EVENT_STATUSES, required: true, default: 'received' },
    attempts: { type: Number, required: true, default: 0 },
    nextAttemptAt: { type: Date, required: true, default: () => new Date() },
    processedAt: { type: Date, default: null },
    lastError: { type: String, default: null },
  },
  { timestamps: true },
);

// 1. Deduplication. A retried delivery carries the same eventId, and the unique
//    index guarantees it can only ever be stored once, even under a race.
webhookEventSchema.index({ eventId: 1 }, { unique: true });

// 2. The queue poll: "oldest event that is still 'received' and due". Without
//    this the worker would scan the whole collection every second.
webhookEventSchema.index({ status: 1, nextAttemptAt: 1 });

export type WebhookEventDocument = HydratedDocument<WebhookEvent>;
export const WebhookEventModel = model<WebhookEvent>('WebhookEvent', webhookEventSchema);
