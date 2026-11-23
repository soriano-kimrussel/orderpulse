import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { env } from '../../src/config/env.js';
import type { OrderDTO } from '../../src/services/order.service.js';
import { SIGNATURE_HEADER, signPayload } from '../../src/utils/signature.js';

export const app = createApp();

export const PASSWORD = 'correct-horse-battery';

export interface TestUser {
  token: string;
  accountId: string;
  email: string;
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Registers a new account and returns its admin user. */
export async function registerAdmin(accountName = 'Acme'): Promise<TestUser> {
  const email = `admin-${randomUUID()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ accountName, email, password: PASSWORD })
    .expect(201);
  return { token: res.body.token, accountId: res.body.user.accountId, email };
}

/** Adds a member to the admin's account and logs them in. */
export async function addMember(admin: TestUser): Promise<TestUser> {
  const email = `member-${randomUUID()}@example.com`;
  await request(app)
    .post('/api/users')
    .set(bearer(admin.token))
    .send({ email, password: PASSWORD, role: 'member' })
    .expect(201);
  const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
  return { token: res.body.token, accountId: res.body.user.accountId, email };
}

export const sampleItems = [
  { name: 'Keyboard', qty: 2, price: 4_500 },
  { name: 'Mouse', qty: 1, price: 2_000 },
]; // total: 11_000 cents

export async function createOrder(
  user: TestUser,
  overrides: Record<string, unknown> = {},
): Promise<OrderDTO> {
  const res = await request(app)
    .post('/api/orders')
    .set(bearer(user.token))
    .send({ customerName: 'Ada Lovelace', items: sampleItems, ...overrides })
    .expect(201);
  return res.body.order as OrderDTO;
}

export function setStatus(user: TestUser, orderId: string, status: string) {
  return request(app)
    .patch(`/api/orders/${orderId}/status`)
    .set(bearer(user.token))
    .send({ status });
}

/** Posts a webhook, signed with the real secret unless told otherwise. */
export function sendWebhook(
  payload: unknown,
  options: { secret?: string; signature?: string | null } = {},
) {
  const body = JSON.stringify(payload);
  const signature =
    options.signature === undefined
      ? signPayload(body, options.secret ?? env.WEBHOOK_SECRET)
      : options.signature;

  const req = request(app).post('/webhooks/orders').set('Content-Type', 'application/json');
  if (signature !== null) req.set(SIGNATURE_HEADER, signature);
  return req.send(body);
}

export function orderCreatedEvent(accountId: string, overrides: Record<string, unknown> = {}) {
  return {
    eventId: `evt_${randomUUID()}`,
    type: 'order.created',
    accountId,
    data: { orderId: 'WH-1001', customerName: 'Grace Hopper', items: sampleItems },
    ...overrides,
  };
}

export function orderStatusEvent(
  accountId: string,
  type: 'order.paid' | 'order.shipped' | 'order.cancelled',
  orderId = 'WH-1001',
) {
  return { eventId: `evt_${randomUUID()}`, type, accountId, data: { orderId } };
}
