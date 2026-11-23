import { Schema, model, type HydratedDocument, type Types } from 'mongoose';

export const ORDER_STATUSES = ['pending', 'paid', 'shipped', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export interface OrderItem {
  name: string;
  /** Whole units. */
  qty: number;
  /** Unit price in integer minor units (cents). */
  price: number;
}

export interface Order {
  accountId: Types.ObjectId;
  /** Business identifier, e.g. "ORD-7K2M9QX4". Unique across the system. */
  orderId: string;
  customerName: string;
  items: OrderItem[];
  /** Order total in integer minor units (cents). Always computed server-side. */
  amount: number;
  status: OrderStatus;
  createdAt: Date;
  updatedAt: Date;
}

const integer = {
  validator: Number.isInteger,
  message: '{PATH} must be an integer',
};

const orderItemSchema = new Schema<OrderItem>(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    qty: { type: Number, required: true, min: 1, validate: integer },
    price: { type: Number, required: true, min: 0, validate: integer },
  },
  { _id: false },
);

const orderSchema = new Schema<Order>(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true },
    orderId: { type: String, required: true, trim: true, maxlength: 64 },
    customerName: { type: String, required: true, trim: true, maxlength: 200 },
    items: {
      type: [orderItemSchema],
      required: true,
      validate: {
        validator: (items: OrderItem[]) => items.length > 0,
        message: 'An order needs at least one item',
      },
    },
    amount: { type: Number, required: true, min: 0, validate: integer },
    status: { type: String, enum: ORDER_STATUSES, required: true, default: 'pending' },
  },
  { timestamps: true },
);

// 1. orderId is the public identifier and the idempotency key for webhook-created
//    orders: the unique index is what makes "create this order" safe to retry.
orderSchema.index({ orderId: 1 }, { unique: true });

// 2. The dashboard query: "this account's most recent orders". Equality on
//    accountId, then createdAt descending, so MongoDB walks the index in order
//    and never sorts in memory. Also bounds the 14-day stats range scans.
orderSchema.index({ accountId: 1, createdAt: -1 });

// 3. The same list with a status filter. Follows the ESR rule (Equality, Sort,
//    Range): both equality fields first, then the sort key.
orderSchema.index({ accountId: 1, status: 1, createdAt: -1 });

export type OrderDocument = HydratedDocument<Order>;
export const OrderModel = model<Order>('Order', orderSchema);
