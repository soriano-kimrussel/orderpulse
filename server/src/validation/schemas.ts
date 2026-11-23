import { z } from 'zod';
import { ORDER_STATUSES } from '../models/Order.js';
import { USER_ROLES } from '../models/User.js';

const email = z.string().trim().toLowerCase().pipe(z.email().max(254));
const password = z.string().min(8, 'Password must be at least 8 characters').max(128);
const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Must be a 24-character hex id');
const orderId = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9._-]+$/, 'May only contain letters, digits, ".", "_" and "-"');

// ---------- Auth ----------

export const registerSchema = z.object({
  accountName: z.string().trim().min(1).max(120),
  email,
  password,
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(128),
});

export const createUserSchema = z.object({
  email,
  password,
  role: z.enum(USER_ROLES).default('member'),
});

// ---------- Orders ----------

export const orderItemSchema = z.object({
  name: z.string().trim().min(1).max(200),
  qty: z.number().int().min(1).max(100_000),
  /** Unit price in cents. */
  price: z.number().int().min(0).max(100_000_000),
});

export const createOrderSchema = z.object({
  orderId: orderId.optional(),
  customerName: z.string().trim().min(1).max(200),
  items: z.array(orderItemSchema).min(1).max(100),
});

export const updateStatusSchema = z.object({
  status: z.enum(ORDER_STATUSES),
});

export const listOrdersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(ORDER_STATUSES).optional(),
});

export const topProductsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(5),
});

// ---------- Webhooks ----------

const webhookBase = {
  eventId: z.string().min(1).max(200),
  accountId: objectId,
};

/**
 * The body of POST /webhooks/orders. `order.created` carries the full order;
 * the status events only need to say which order they are about.
 */
export const webhookPayloadSchema = z.discriminatedUnion('type', [
  z.object({
    ...webhookBase,
    type: z.literal('order.created'),
    data: z.object({
      orderId,
      customerName: z.string().trim().min(1).max(200),
      items: z.array(orderItemSchema).min(1).max(100),
    }),
  }),
  z.object({
    ...webhookBase,
    type: z.enum(['order.paid', 'order.shipped', 'order.cancelled']),
    data: z.object({ orderId }),
  }),
]);

export type WebhookPayload = z.infer<typeof webhookPayloadSchema>;
export type CreateOrderInput = z.infer<typeof createOrderSchema>;
