import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { OrderModel, type OrderItem, type OrderStatus } from '../src/models/Order.js';
import { app, bearer, registerAdmin, type TestUser } from './support/helpers.js';

const DAY = 24 * 60 * 60 * 1000;

/** Noon UTC, `days` days before today: safely inside that UTC calendar day. */
function daysAgo(days: number): Date {
  const now = new Date();
  const noonToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12);
  return new Date(noonToday - days * DAY);
}

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

let counter = 0;
function order(
  accountId: string,
  status: OrderStatus,
  createdAt: Date,
  items: OrderItem[],
): Record<string, unknown> {
  counter += 1;
  return {
    accountId,
    orderId: `S-${counter}`,
    customerName: 'Stats Customer',
    items,
    amount: items.reduce((sum, item) => sum + item.qty * item.price, 0),
    status,
    createdAt,
    updatedAt: createdAt,
  };
}

const laptop = (qty: number): OrderItem => ({ name: 'Laptop', qty, price: 100_000 });
const mouse = (qty: number): OrderItem => ({ name: 'Mouse', qty, price: 2_500 });
const cable = (qty: number): OrderItem => ({ name: 'Cable', qty, price: 1_000 });

describe('stats aggregation', () => {
  let admin: TestUser;
  let other: TestUser;

  beforeEach(async () => {
    admin = await registerAdmin('Stats Co');
    other = await registerAdmin('Other Co');

    await OrderModel.insertMany([
      // Today: two revenue orders.
      order(admin.accountId, 'paid', daysAgo(0), [laptop(1), mouse(2)]), //   105_000
      order(admin.accountId, 'shipped', daysAgo(0), [mouse(4)]), //            10_000
      // Today, but not revenue.
      order(admin.accountId, 'pending', daysAgo(0), [laptop(5)]),
      order(admin.accountId, 'cancelled', daysAgo(0), [laptop(3)]),
      // Three days ago.
      order(admin.accountId, 'paid', daysAgo(3), [cable(7), mouse(1)]), //      9_500
      // The oldest day still inside the 14-day window.
      order(admin.accountId, 'shipped', daysAgo(13), [cable(2)]), //            2_000
      // Just outside the window: counts for status and products, not for daily revenue.
      order(admin.accountId, 'paid', daysAgo(14), [laptop(1)]), //            100_000
      // Another account: must never show up.
      order(other.accountId, 'paid', daysAgo(0), [laptop(10)]),
    ]);
  });

  it('returns revenue per day for the last 14 days', async () => {
    const res = await request(app).get('/api/stats/revenue').set(bearer(admin.token)).expect(200);
    const days: { date: string; revenue: number; orders: number }[] = res.body.data;

    expect(days).toHaveLength(14);
    expect(days[0]?.date).toBe(isoDay(daysAgo(13)));
    expect(days[13]?.date).toBe(isoDay(daysAgo(0)));

    const byDate = new Map(days.map((day) => [day.date, day]));
    expect(byDate.get(isoDay(daysAgo(0)))).toMatchObject({ revenue: 115_000, orders: 2 });
    expect(byDate.get(isoDay(daysAgo(3)))).toMatchObject({ revenue: 9_500, orders: 1 });
    expect(byDate.get(isoDay(daysAgo(13)))).toMatchObject({ revenue: 2_000, orders: 1 });

    // Every other day is present and zero-filled.
    const quietDays = days.filter(
      (day) => ![0, 3, 13].some((n) => day.date === isoDay(daysAgo(n))),
    );
    expect(quietDays).toHaveLength(11);
    expect(quietDays.every((day) => day.revenue === 0 && day.orders === 0)).toBe(true);

    // The order from 14 days ago is outside the window.
    expect(days.reduce((sum, day) => sum + day.revenue, 0)).toBe(126_500);
  });

  it('returns order counts by status', async () => {
    const res = await request(app).get('/api/stats/status').set(bearer(admin.token)).expect(200);
    expect(res.body.data).toEqual({ pending: 1, paid: 3, shipped: 2, cancelled: 1 });
  });

  it('returns top products by revenue', async () => {
    const res = await request(app)
      .get('/api/stats/top-products')
      .set(bearer(admin.token))
      .expect(200);

    // Paid and shipped orders only:
    //   Laptop: 1 + 1 units          = 200_000 across 2 orders
    //   Mouse:  2 + 4 + 1 units      =  17_500 across 3 orders
    //   Cable:  7 + 2 units          =   9_000 across 2 orders
    expect(res.body.data).toEqual([
      { name: 'Laptop', revenue: 200_000, unitsSold: 2, orders: 2 },
      { name: 'Mouse', revenue: 17_500, unitsSold: 7, orders: 3 },
      { name: 'Cable', revenue: 9_000, unitsSold: 9, orders: 2 },
    ]);
  });

  it('honours the top-products limit', async () => {
    const res = await request(app)
      .get('/api/stats/top-products?limit=1')
      .set(bearer(admin.token))
      .expect(200);
    expect(res.body.data).toEqual([{ name: 'Laptop', revenue: 200_000, unitsSold: 2, orders: 2 }]);
  });

  it('returns zeros for an account with no orders', async () => {
    const empty = await registerAdmin('Empty Co');

    const revenue = await request(app).get('/api/stats/revenue').set(bearer(empty.token)).expect(200);
    expect(revenue.body.data).toHaveLength(14);
    expect(revenue.body.data.every((day: { revenue: number }) => day.revenue === 0)).toBe(true);

    const status = await request(app).get('/api/stats/status').set(bearer(empty.token)).expect(200);
    expect(status.body.data).toEqual({ pending: 0, paid: 0, shipped: 0, cancelled: 0 });
  });
});
