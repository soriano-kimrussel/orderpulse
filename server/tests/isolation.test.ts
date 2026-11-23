import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { OrderModel } from '../src/models/Order.js';
import { app, bearer, createOrder, registerAdmin, setStatus } from './support/helpers.js';

/**
 * Account B's admin is a fully privileged user, just in the wrong account.
 * None of these requests may reveal or change anything that belongs to A.
 */
describe('account isolation', () => {
  it("does not list another account's orders", async () => {
    const a = await registerAdmin('Account A');
    const b = await registerAdmin('Account B');
    await createOrder(a);
    await createOrder(a);
    const own = await createOrder(b);

    const res = await request(app).get('/api/orders').set(bearer(b.token)).expect(200);

    expect(res.body.pagination.total).toBe(1);
    expect(res.body.data.map((o: { orderId: string }) => o.orderId)).toEqual([own.orderId]);
  });

  it("returns 404 when reading another account's order", async () => {
    const a = await registerAdmin('Account A');
    const b = await registerAdmin('Account B');
    const order = await createOrder(a);

    // 404, not 403: B must not even learn that the order exists.
    await request(app).get(`/api/orders/${order.orderId}`).set(bearer(b.token)).expect(404);
  });

  it("cannot change the status of another account's order", async () => {
    const a = await registerAdmin('Account A');
    const b = await registerAdmin('Account B');
    const order = await createOrder(a);

    await setStatus(b, order.orderId, 'paid').expect(404);
    await setStatus(b, order.orderId, 'cancelled').expect(404);

    const stored = await OrderModel.findOne({ orderId: order.orderId }).lean();
    expect(stored?.status).toBe('pending');
  });

  it("cannot delete another account's order", async () => {
    const a = await registerAdmin('Account A');
    const b = await registerAdmin('Account B');
    const order = await createOrder(a);

    await request(app).delete(`/api/orders/${order.orderId}`).set(bearer(b.token)).expect(404);

    expect(await OrderModel.countDocuments({ orderId: order.orderId })).toBe(1);
  });

  it("keeps another account's orders out of the stats", async () => {
    const a = await registerAdmin('Account A');
    const b = await registerAdmin('Account B');
    const order = await createOrder(a);
    await setStatus(a, order.orderId, 'paid').expect(200);

    const [status, revenue, products] = await Promise.all([
      request(app).get('/api/stats/status').set(bearer(b.token)).expect(200),
      request(app).get('/api/stats/revenue').set(bearer(b.token)).expect(200),
      request(app).get('/api/stats/top-products').set(bearer(b.token)).expect(200),
    ]);

    expect(status.body.data).toEqual({ pending: 0, paid: 0, shipped: 0, cancelled: 0 });
    expect(revenue.body.data.every((day: { revenue: number }) => day.revenue === 0)).toBe(true);
    expect(products.body.data).toEqual([]);
  });

  it("does not list another account's users", async () => {
    const a = await registerAdmin('Account A');
    const b = await registerAdmin('Account B');

    const res = await request(app).get('/api/users').set(bearer(b.token)).expect(200);

    expect(res.body.data.map((u: { email: string }) => u.email)).toEqual([b.email]);
    expect(JSON.stringify(res.body)).not.toContain(a.email);
  });
});
