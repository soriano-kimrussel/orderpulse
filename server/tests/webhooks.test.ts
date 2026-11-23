import { describe, expect, it } from 'vitest';
import { env } from '../src/config/env.js';
import { OrderModel } from '../src/models/Order.js';
import { WebhookEventModel } from '../src/models/WebhookEvent.js';
import { signPayload } from '../src/utils/signature.js';
import { drainQueue } from '../src/worker/webhookWorker.js';
import {
  orderCreatedEvent,
  orderStatusEvent,
  registerAdmin,
  sendWebhook,
} from './support/helpers.js';

const MINUTE = 60_000;
const later = (minutes: number) => new Date(Date.now() + minutes * MINUTE);

describe('webhook signature verification', () => {
  it('rejects a request with no signature', async () => {
    const admin = await registerAdmin();
    await sendWebhook(orderCreatedEvent(admin.accountId), { signature: null }).expect(401);
    expect(await WebhookEventModel.countDocuments()).toBe(0);
  });

  it('rejects a signature made with the wrong secret', async () => {
    const admin = await registerAdmin();
    await sendWebhook(orderCreatedEvent(admin.accountId), {
      secret: 'not-the-shared-secret',
    }).expect(401);
    expect(await WebhookEventModel.countDocuments()).toBe(0);
  });

  it('rejects a body that was changed after signing', async () => {
    const admin = await registerAdmin();
    const signedFor = orderCreatedEvent(admin.accountId);
    const signature = signPayload(JSON.stringify(signedFor), env.WEBHOOK_SECRET);

    const tampered = { ...signedFor, data: { ...signedFor.data, customerName: 'Mallory' } };
    await sendWebhook(tampered, { signature }).expect(401);
    expect(await WebhookEventModel.countDocuments()).toBe(0);
  });

  it('rejects a correctly signed but invalid payload with 400', async () => {
    const admin = await registerAdmin();
    await sendWebhook({ eventId: 'evt_1', type: 'order.exploded', accountId: admin.accountId }).expect(
      400,
    );
    expect(await WebhookEventModel.countDocuments()).toBe(0);
  });
});

describe('webhook ingestion', () => {
  it('acknowledges with 202 and queues the event without touching orders yet', async () => {
    const admin = await registerAdmin();
    const event = orderCreatedEvent(admin.accountId);

    const res = await sendWebhook(event).expect(202);
    expect(res.body).toEqual({ received: true, duplicate: false, eventId: event.eventId });

    const stored = await WebhookEventModel.findOne({ eventId: event.eventId }).lean();
    expect(stored).toMatchObject({ status: 'received', attempts: 0, type: 'order.created' });
    expect(stored?.processedAt).toBeNull();
    expect(await OrderModel.countDocuments()).toBe(0);
  });

  it('creates the order when the worker processes the event', async () => {
    const admin = await registerAdmin();
    const event = orderCreatedEvent(admin.accountId);
    await sendWebhook(event).expect(202);

    expect(await drainQueue()).toBe(1);

    const order = await OrderModel.findOne({ orderId: 'WH-1001' }).lean();
    expect(order).toMatchObject({
      customerName: 'Grace Hopper',
      status: 'pending',
      amount: 11_000,
    });
    expect(order?.accountId.toString()).toBe(admin.accountId);

    const stored = await WebhookEventModel.findOne({ eventId: event.eventId }).lean();
    expect(stored).toMatchObject({ status: 'processed', attempts: 1, lastError: null });
    expect(stored?.processedAt).toBeInstanceOf(Date);
  });
});

describe('webhook idempotency', () => {
  it('stores the same eventId once and creates one order', async () => {
    const admin = await registerAdmin();
    const event = orderCreatedEvent(admin.accountId);

    const first = await sendWebhook(event).expect(202);
    const second = await sendWebhook(event).expect(202);

    expect(first.body.duplicate).toBe(false);
    expect(second.body.duplicate).toBe(true);
    expect(await WebhookEventModel.countDocuments({ eventId: event.eventId })).toBe(1);

    await drainQueue();
    expect(await OrderModel.countDocuments({ orderId: 'WH-1001' })).toBe(1);
  });

  it('ignores a redelivery that arrives after the event was processed', async () => {
    const admin = await registerAdmin();
    const event = orderCreatedEvent(admin.accountId);

    await sendWebhook(event).expect(202);
    await drainQueue();
    const before = await OrderModel.findOne({ orderId: 'WH-1001' }).lean();

    const retry = await sendWebhook(event).expect(202);
    expect(retry.body.duplicate).toBe(true);
    expect(await drainQueue()).toBe(0); // nothing was re-queued

    const after = await OrderModel.find({ orderId: 'WH-1001' }).lean();
    expect(after).toHaveLength(1);
    expect(after[0]).toEqual(before); // untouched, including updatedAt
  });

  it('survives the same event being delivered concurrently', async () => {
    const admin = await registerAdmin();
    const event = orderCreatedEvent(admin.accountId);

    const responses = await Promise.all(Array.from({ length: 8 }, () => sendWebhook(event)));

    expect(responses.every((res) => res.status === 202)).toBe(true);
    expect(responses.filter((res) => res.body.duplicate === false)).toHaveLength(1);
    expect(await WebhookEventModel.countDocuments()).toBe(1);

    await drainQueue();
    expect(await OrderModel.countDocuments()).toBe(1);
  });

  it('creates one order when two different events describe the same order', async () => {
    const admin = await registerAdmin();

    await sendWebhook(orderCreatedEvent(admin.accountId)).expect(202);
    await sendWebhook(orderCreatedEvent(admin.accountId)).expect(202); // new eventId, same orderId
    expect(await drainQueue()).toBe(2);

    expect(await OrderModel.countDocuments({ orderId: 'WH-1001' })).toBe(1);
    expect(await WebhookEventModel.countDocuments({ status: 'processed' })).toBe(2);
  });

  it('applies a repeated status event only once', async () => {
    const admin = await registerAdmin();
    await sendWebhook(orderCreatedEvent(admin.accountId)).expect(202);
    await sendWebhook(orderStatusEvent(admin.accountId, 'order.paid')).expect(202);
    await drainQueue();
    const paid = await OrderModel.findOne({ orderId: 'WH-1001' }).lean();
    expect(paid?.status).toBe('paid');

    await sendWebhook(orderStatusEvent(admin.accountId, 'order.paid')).expect(202);
    await drainQueue();

    const after = await OrderModel.findOne({ orderId: 'WH-1001' }).lean();
    expect(after).toEqual(paid);
    expect(await WebhookEventModel.countDocuments({ status: 'processed' })).toBe(3);
  });
});

describe('webhook processing', () => {
  it('updates an existing order from status events', async () => {
    const admin = await registerAdmin();
    await sendWebhook(orderCreatedEvent(admin.accountId)).expect(202);
    await sendWebhook(orderStatusEvent(admin.accountId, 'order.paid')).expect(202);
    await sendWebhook(orderStatusEvent(admin.accountId, 'order.shipped')).expect(202);

    await drainQueue();

    const order = await OrderModel.findOne({ orderId: 'WH-1001' }).lean();
    expect(order?.status).toBe('shipped');
  });

  it('ignores a stale status event instead of moving an order backwards', async () => {
    const admin = await registerAdmin();
    await sendWebhook(orderCreatedEvent(admin.accountId)).expect(202);
    await sendWebhook(orderStatusEvent(admin.accountId, 'order.paid')).expect(202);
    await sendWebhook(orderStatusEvent(admin.accountId, 'order.shipped')).expect(202);
    await drainQueue();

    const stale = orderStatusEvent(admin.accountId, 'order.cancelled');
    await sendWebhook(stale).expect(202);
    await drainQueue();

    const order = await OrderModel.findOne({ orderId: 'WH-1001' }).lean();
    expect(order?.status).toBe('shipped');
    const event = await WebhookEventModel.findOne({ eventId: stale.eventId }).lean();
    expect(event?.status).toBe('processed');
  });

  it('retries an event that arrives before the order it refers to', async () => {
    const admin = await registerAdmin();
    const paid = orderStatusEvent(admin.accountId, 'order.paid');

    // "paid" is delivered first: the order does not exist yet.
    await sendWebhook(paid).expect(202);
    await drainQueue();

    let event = await WebhookEventModel.findOne({ eventId: paid.eventId }).lean();
    expect(event).toMatchObject({ status: 'received', attempts: 1 });
    expect(event?.lastError).toContain('does not exist yet');
    expect(event?.nextAttemptAt.getTime()).toBeGreaterThan(Date.now()); // backing off

    // It is not due yet, so an immediate poll leaves it alone.
    expect(await drainQueue()).toBe(0);

    // "created" arrives; once the backoff has passed, the retry succeeds.
    await sendWebhook(orderCreatedEvent(admin.accountId)).expect(202);
    await drainQueue(later(5));

    event = await WebhookEventModel.findOne({ eventId: paid.eventId }).lean();
    expect(event).toMatchObject({ status: 'processed', attempts: 2, lastError: null });
    const order = await OrderModel.findOne({ orderId: 'WH-1001' }).lean();
    expect(order?.status).toBe('paid');
  });

  it('marks an event failed after the maximum number of attempts', async () => {
    const admin = await registerAdmin();
    const orphan = orderStatusEvent(admin.accountId, 'order.paid', 'NEVER-CREATED');
    await sendWebhook(orphan).expect(202);

    for (let attempt = 1; attempt <= env.WORKER_MAX_ATTEMPTS; attempt += 1) {
      expect(await drainQueue(later(attempt * 5))).toBe(1);
    }

    const event = await WebhookEventModel.findOne({ eventId: orphan.eventId }).lean();
    expect(event).toMatchObject({ status: 'failed', attempts: env.WORKER_MAX_ATTEMPTS });
    expect(event?.processedAt).toBeNull();

    // A failed event is out of the queue for good.
    expect(await drainQueue(later(1000))).toBe(0);
  });

  it('fails immediately, without retries, for an unknown account', async () => {
    const event = orderCreatedEvent('0123456789abcdef01234567');
    await sendWebhook(event).expect(202);
    await drainQueue();

    const stored = await WebhookEventModel.findOne({ eventId: event.eventId }).lean();
    expect(stored).toMatchObject({ status: 'failed', attempts: 1 });
    expect(stored?.lastError).toContain('Unknown account');
    expect(await OrderModel.countDocuments()).toBe(0);
  });

  it("does not let a webhook take over another account's orderId", async () => {
    const a = await registerAdmin('Account A');
    const b = await registerAdmin('Account B');

    await sendWebhook(orderCreatedEvent(a.accountId)).expect(202);
    await drainQueue();

    const hijack = orderCreatedEvent(b.accountId, {
      data: { orderId: 'WH-1001', customerName: 'Mallory', items: [{ name: 'X', qty: 1, price: 1 }] },
    });
    await sendWebhook(hijack).expect(202);
    await drainQueue();

    const orders = await OrderModel.find({ orderId: 'WH-1001' }).lean();
    expect(orders).toHaveLength(1);
    expect(orders[0]?.accountId.toString()).toBe(a.accountId);
    expect(orders[0]?.customerName).toBe('Grace Hopper');

    const event = await WebhookEventModel.findOne({ eventId: hijack.eventId }).lean();
    expect(event?.status).toBe('failed');
  });
});
