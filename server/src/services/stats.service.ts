import { Types, type PipelineStage } from 'mongoose';
import { ORDER_STATUSES, OrderModel, type OrderStatus } from '../models/Order.js';

/** Orders that count as revenue: money has actually been taken. */
export const REVENUE_STATUSES: OrderStatus[] = ['paid', 'shipped'];

export const REVENUE_WINDOW_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface DailyRevenue {
  /** UTC calendar day, YYYY-MM-DD. */
  date: string;
  /** Cents. */
  revenue: number;
  orders: number;
}

export type StatusCounts = Record<OrderStatus, number>;

export interface TopProduct {
  name: string;
  /** Cents. */
  revenue: number;
  unitsSold: number;
  orders: number;
}

// Unlike find(), aggregate() does not cast values using the schema, so the
// accountId string must be turned into an ObjectId by hand. Passing the string
// would silently match nothing.
const toObjectId = (id: string) => new Types.ObjectId(id);

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Revenue per UTC day for the last 14 days (today included).
 *
 * $match is first and uses the (accountId, createdAt) index, so only this
 * account's orders inside the window are read. $dateTrunc buckets each order
 * into its day, and $group sums inside the database.
 */
export function revenueByDayPipeline(accountId: string, from: Date, to: Date): PipelineStage[] {
  return [
    {
      $match: {
        accountId: toObjectId(accountId),
        createdAt: { $gte: from, $lt: to },
        status: { $in: REVENUE_STATUSES },
      },
    },
    {
      $group: {
        _id: { $dateTrunc: { date: '$createdAt', unit: 'day', timezone: 'UTC' } },
        revenue: { $sum: '$amount' },
        orders: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
    {
      $project: {
        _id: 0,
        date: { $dateToString: { date: '$_id', format: '%Y-%m-%d', timezone: 'UTC' } },
        revenue: 1,
        orders: 1,
      },
    },
  ];
}

export async function getRevenueByDay(
  accountId: string,
  now: Date = new Date(),
): Promise<DailyRevenue[]> {
  const to = new Date(startOfUtcDay(now).getTime() + DAY_MS); // exclusive: start of tomorrow
  const from = new Date(to.getTime() - REVENUE_WINDOW_DAYS * DAY_MS);

  const rows = await OrderModel.aggregate<DailyRevenue>(revenueByDayPipeline(accountId, from, to));

  // The database did the arithmetic. This only fills in the days that had no
  // revenue, so a chart always gets 14 evenly spaced points.
  const byDate = new Map(rows.map((row) => [row.date, row]));
  return Array.from({ length: REVENUE_WINDOW_DAYS }, (_, index) => {
    const date = new Date(from.getTime() + index * DAY_MS).toISOString().slice(0, 10);
    return byDate.get(date) ?? { date, revenue: 0, orders: 0 };
  });
}

/** Number of orders in each status. */
export function statusCountsPipeline(accountId: string): PipelineStage[] {
  return [
    { $match: { accountId: toObjectId(accountId) } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ];
}

export async function getStatusCounts(accountId: string): Promise<StatusCounts> {
  const rows = await OrderModel.aggregate<{ _id: OrderStatus; count: number }>(
    statusCountsPipeline(accountId),
  );

  const counts = Object.fromEntries(ORDER_STATUSES.map((status) => [status, 0])) as StatusCounts;
  for (const row of rows) counts[row._id] = row.count;
  return counts;
}

/**
 * Best-selling products by revenue.
 *
 * $unwind turns each order into one document per line item, so items can be
 * grouped by product name across orders. Line revenue is qty * price.
 */
export function topProductsPipeline(accountId: string, limit: number): PipelineStage[] {
  return [
    { $match: { accountId: toObjectId(accountId), status: { $in: REVENUE_STATUSES } } },
    { $unwind: '$items' },
    {
      $group: {
        _id: '$items.name',
        revenue: { $sum: { $multiply: ['$items.qty', '$items.price'] } },
        unitsSold: { $sum: '$items.qty' },
        orderIds: { $addToSet: '$_id' },
      },
    },
    // Name as a tiebreaker keeps the order stable between requests.
    { $sort: { revenue: -1, _id: 1 } },
    { $limit: limit },
    {
      $project: {
        _id: 0,
        name: '$_id',
        revenue: 1,
        unitsSold: 1,
        orders: { $size: '$orderIds' },
      },
    },
  ];
}

export async function getTopProducts(accountId: string, limit: number): Promise<TopProduct[]> {
  return OrderModel.aggregate<TopProduct>(topProductsPipeline(accountId, limit));
}
