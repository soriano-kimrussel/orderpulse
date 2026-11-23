import { randomInt } from 'node:crypto';
import {
  OrderModel,
  type Order,
  type OrderItem,
  type OrderStatus,
} from '../models/Order.js';
import { publishToAccount } from '../realtime/publisher.js';
import { conflict, isDuplicateKeyError, notFound } from '../utils/errors.js';

export interface OrderDTO {
  id: string;
  orderId: string;
  customerName: string;
  items: OrderItem[];
  amount: number;
  status: OrderStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Paginated<T> {
  data: T[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

/**
 * For each target status, the statuses an order may move there from.
 *   pending -> paid -> shipped, and pending/paid -> cancelled.
 * Shipped and cancelled are final.
 */
const ALLOWED_FROM: Record<OrderStatus, OrderStatus[]> = {
  pending: [],
  paid: ['pending'],
  shipped: ['paid'],
  cancelled: ['pending', 'paid'],
};

export type TransitionResult =
  | { outcome: 'updated'; order: OrderDTO }
  /** The order was already in the requested status. Nothing changed. */
  | { outcome: 'noop'; order: OrderDTO }
  /** The order exists but cannot move to the requested status. */
  | { outcome: 'invalid'; order: OrderDTO }
  | { outcome: 'not_found' };

type OrderRecord = Order & { _id: { toString(): string } };

export function toOrderDTO(order: OrderRecord): OrderDTO {
  return {
    id: order._id.toString(),
    orderId: order.orderId,
    customerName: order.customerName,
    items: order.items.map(({ name, qty, price }) => ({ name, qty, price })),
    amount: order.amount,
    status: order.status,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}

/** Order total in cents. Integer arithmetic, so there is no float rounding. */
export function computeAmount(items: Pick<OrderItem, 'qty' | 'price'>[]): number {
  return items.reduce((total, item) => total + item.qty * item.price, 0);
}

const ORDER_ID_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0/O or 1/I lookalikes

export function generateOrderId(): string {
  let suffix = '';
  for (let i = 0; i < 8; i += 1) {
    suffix += ORDER_ID_ALPHABET[randomInt(ORDER_ID_ALPHABET.length)];
  }
  return `ORD-${suffix}`;
}

export async function createOrder(
  accountId: string,
  input: { orderId?: string; customerName: string; items: OrderItem[] },
): Promise<OrderDTO> {
  try {
    const order = await OrderModel.create({
      accountId,
      orderId: input.orderId ?? generateOrderId(),
      customerName: input.customerName,
      items: input.items,
      amount: computeAmount(input.items),
      status: 'pending',
    });
    const dto = toOrderDTO(order);
    publishToAccount(accountId, 'order:created', dto);
    return dto;
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw conflict('An order with this orderId already exists');
    }
    throw error;
  }
}

/**
 * Creates an order if it does not exist yet. Safe to call any number of times
 * with the same orderId: the upsert plus the unique index mean exactly one
 * order is ever written. Used by the webhook worker.
 *
 * Returns `created: false` when the order was already there.
 */
export async function ensureOrder(
  accountId: string,
  input: { orderId: string; customerName: string; items: OrderItem[] },
): Promise<{ created: boolean; conflict: boolean }> {
  const now = new Date();
  try {
    const result = await OrderModel.updateOne(
      { accountId, orderId: input.orderId },
      {
        // Everything is in $setOnInsert, so a replay writes nothing at all.
        $setOnInsert: {
          customerName: input.customerName,
          items: input.items,
          amount: computeAmount(input.items),
          status: 'pending',
          createdAt: now,
          updatedAt: now,
        },
      },
      // Timestamps are set by hand above: Mongoose's automatic ones would
      // bump updatedAt on every replay.
      { upsert: true, timestamps: false },
    );

    if (result.upsertedCount === 0) return { created: false, conflict: false };
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    // The unique orderId index rejected the insert. Either a concurrent writer
    // just created this same order (fine), or the id belongs to another account.
    const mine = await OrderModel.exists({ accountId, orderId: input.orderId });
    return { created: false, conflict: !mine };
  }

  const order = await OrderModel.findOne({ accountId, orderId: input.orderId }).lean();
  if (order) publishToAccount(accountId, 'order:created', toOrderDTO(order));
  return { created: true, conflict: false };
}

export async function listOrders(
  accountId: string,
  query: { page: number; limit: number; status?: OrderStatus },
): Promise<Paginated<OrderDTO>> {
  const filter = { accountId, ...(query.status ? { status: query.status } : {}) };

  const [orders, total] = await Promise.all([
    OrderModel.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    OrderModel.countDocuments(filter),
  ]);

  return {
    data: orders.map(toOrderDTO),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  };
}

export async function getOrder(accountId: string, orderId: string): Promise<OrderDTO> {
  const order = await OrderModel.findOne({ accountId, orderId }).lean();
  if (!order) throw notFound('Order not found');
  return toOrderDTO(order);
}

/**
 * Moves an order to a new status.
 *
 * The allowed source statuses are part of the update's filter, so the check and
 * the write are one atomic operation: two concurrent requests cannot both move
 * the same order, and a stale or repeated request simply matches nothing.
 */
export async function transitionOrderStatus(
  accountId: string,
  orderId: string,
  status: OrderStatus,
): Promise<TransitionResult> {
  const updated = await OrderModel.findOneAndUpdate(
    { accountId, orderId, status: { $in: ALLOWED_FROM[status] } },
    { $set: { status } },
    { returnDocument: 'after' },
  ).lean();

  if (updated) {
    const dto = toOrderDTO(updated);
    publishToAccount(accountId, 'order:updated', dto);
    return { outcome: 'updated', order: dto };
  }

  const existing = await OrderModel.findOne({ accountId, orderId }).lean();
  if (!existing) return { outcome: 'not_found' };

  const dto = toOrderDTO(existing);
  return existing.status === status
    ? { outcome: 'noop', order: dto }
    : { outcome: 'invalid', order: dto };
}

/** Status update for the REST API: turns transition outcomes into HTTP errors. */
export async function updateOrderStatus(
  accountId: string,
  orderId: string,
  status: OrderStatus,
): Promise<OrderDTO> {
  const result = await transitionOrderStatus(accountId, orderId, status);
  switch (result.outcome) {
    case 'updated':
    case 'noop':
      return result.order;
    case 'invalid':
      throw conflict(`Cannot change a ${result.order.status} order to ${status}`);
    case 'not_found':
      throw notFound('Order not found');
  }
}

export async function deleteOrder(accountId: string, orderId: string): Promise<void> {
  const deleted = await OrderModel.findOneAndDelete({ accountId, orderId }).lean();
  if (!deleted) throw notFound('Order not found');
  publishToAccount(accountId, 'order:deleted', { orderId });
}
