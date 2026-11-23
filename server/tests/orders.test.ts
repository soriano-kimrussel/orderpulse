import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { OrderModel } from '../src/models/Order.js';
import { app, bearer, createOrder, registerAdmin, sampleItems, setStatus } from './support/helpers.js';

describe('creating orders', () => {
  it('creates a pending order with a generated orderId', async () => {
    const admin = await registerAdmin();
    const order = await createOrder(admin);

    expect(order).toMatchObject({
      customerName: 'Ada Lovelace',
      status: 'pending',
      items: sampleItems,
      amount: 11_000,
    });
    expect(order.orderId).toMatch(/^ORD-[2-9A-Z]{8}$/);
  });

  it('computes the amount on the server and ignores one sent by the client', async () => {
    const admin = await registerAdmin();
    const order = await createOrder(admin, { amount: 1, status: 'shipped' });

    expect(order.amount).toBe(11_000);
    expect(order.status).toBe('pending');
  });

  it('accepts a caller-supplied orderId and rejects a duplicate with 409', async () => {
    const admin = await registerAdmin();
    await createOrder(admin, { orderId: 'SHOP-42' });

    await request(app)
      .post('/api/orders')
      .set(bearer(admin.token))
      .send({ orderId: 'SHOP-42', customerName: 'Someone Else', items: sampleItems })
      .expect(409);

    expect(await OrderModel.countDocuments({ orderId: 'SHOP-42' })).toBe(1);
  });

  it.each([
    ['no items', { customerName: 'A', items: [] }],
    ['a zero quantity', { customerName: 'A', items: [{ name: 'X', qty: 0, price: 100 }] }],
    ['a negative price', { customerName: 'A', items: [{ name: 'X', qty: 1, price: -1 }] }],
    ['a fractional price', { customerName: 'A', items: [{ name: 'X', qty: 1, price: 9.99 }] }],
    ['a missing customer', { items: sampleItems }],
  ])('rejects an order with %s', async (_label, body) => {
    const admin = await registerAdmin();
    await request(app).post('/api/orders').set(bearer(admin.token)).send(body).expect(400);
    expect(await OrderModel.countDocuments()).toBe(0);
  });
});

describe('reading orders', () => {
  it('gets one order by orderId and returns 404 for an unknown one', async () => {
    const admin = await registerAdmin();
    const order = await createOrder(admin);

    const res = await request(app)
      .get(`/api/orders/${order.orderId}`)
      .set(bearer(admin.token))
      .expect(200);
    expect(res.body.order).toEqual(order);

    await request(app).get('/api/orders/ORD-MISSING').set(bearer(admin.token)).expect(404);
  });

  it('paginates, newest first', async () => {
    const admin = await registerAdmin();
    const base = Date.UTC(2026, 0, 1);
    await OrderModel.insertMany(
      Array.from({ length: 25 }, (_, i) => ({
        accountId: admin.accountId,
        orderId: `P-${String(i).padStart(2, '0')}`,
        customerName: 'Paging',
        items: [{ name: 'Widget', qty: 1, price: 100 }],
        amount: 100,
        status: 'pending',
        createdAt: new Date(base + i * 60_000),
      })),
    );

    const page1 = await request(app)
      .get('/api/orders?page=1&limit=10')
      .set(bearer(admin.token))
      .expect(200);
    expect(page1.body.pagination).toEqual({ page: 1, limit: 10, total: 25, totalPages: 3 });
    expect(page1.body.data).toHaveLength(10);
    expect(page1.body.data[0].orderId).toBe('P-24');
    expect(page1.body.data[9].orderId).toBe('P-15');

    const page3 = await request(app)
      .get('/api/orders?page=3&limit=10')
      .set(bearer(admin.token))
      .expect(200);
    expect(page3.body.data.map((o: { orderId: string }) => o.orderId)).toEqual([
      'P-04',
      'P-03',
      'P-02',
      'P-01',
      'P-00',
    ]);
  });

  it('filters by status', async () => {
    const admin = await registerAdmin();
    const a = await createOrder(admin);
    const b = await createOrder(admin);
    await createOrder(admin);
    await setStatus(admin, a.orderId, 'paid').expect(200);
    await setStatus(admin, b.orderId, 'paid').expect(200);

    const paid = await request(app).get('/api/orders?status=paid').set(bearer(admin.token)).expect(200);
    expect(paid.body.pagination.total).toBe(2);
    expect(paid.body.data.every((o: { status: string }) => o.status === 'paid')).toBe(true);

    const pending = await request(app)
      .get('/api/orders?status=pending')
      .set(bearer(admin.token))
      .expect(200);
    expect(pending.body.pagination.total).toBe(1);
  });

  it('rejects invalid query parameters', async () => {
    const admin = await registerAdmin();
    await request(app).get('/api/orders?status=refunded').set(bearer(admin.token)).expect(400);
    await request(app).get('/api/orders?limit=1000').set(bearer(admin.token)).expect(400);
    await request(app).get('/api/orders?page=0').set(bearer(admin.token)).expect(400);
  });
});

describe('updating order status', () => {
  it('moves an order pending -> paid -> shipped', async () => {
    const admin = await registerAdmin();
    const order = await createOrder(admin);

    const paid = await setStatus(admin, order.orderId, 'paid').expect(200);
    expect(paid.body.order.status).toBe('paid');

    const shipped = await setStatus(admin, order.orderId, 'shipped').expect(200);
    expect(shipped.body.order.status).toBe('shipped');
  });

  it('treats repeating the current status as a no-op', async () => {
    const admin = await registerAdmin();
    const order = await createOrder(admin);
    await setStatus(admin, order.orderId, 'paid').expect(200);

    const again = await setStatus(admin, order.orderId, 'paid').expect(200);
    expect(again.body.order.status).toBe('paid');
  });

  it('rejects transitions that skip a step or leave a final status', async () => {
    const admin = await registerAdmin();
    const order = await createOrder(admin);

    await setStatus(admin, order.orderId, 'shipped').expect(409); // not paid yet

    await setStatus(admin, order.orderId, 'paid').expect(200);
    await setStatus(admin, order.orderId, 'shipped').expect(200);

    await setStatus(admin, order.orderId, 'cancelled').expect(409); // already shipped
    await setStatus(admin, order.orderId, 'pending').expect(409);
  });

  it('returns 404 for an unknown order and 400 for an unknown status', async () => {
    const admin = await registerAdmin();
    const order = await createOrder(admin);

    await setStatus(admin, 'ORD-MISSING', 'paid').expect(404);
    await setStatus(admin, order.orderId, 'refunded').expect(400);
  });
});

describe('deleting orders', () => {
  it('deletes an order', async () => {
    const admin = await registerAdmin();
    const order = await createOrder(admin);

    await request(app).delete(`/api/orders/${order.orderId}`).set(bearer(admin.token)).expect(204);
    await request(app).delete(`/api/orders/${order.orderId}`).set(bearer(admin.token)).expect(404);
    expect(await OrderModel.countDocuments()).toBe(0);
  });
});
