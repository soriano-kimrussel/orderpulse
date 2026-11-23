import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';
import { AccountModel } from '../models/Account.js';
import { OrderModel, type OrderItem, type OrderStatus } from '../models/Order.js';
import { UserModel } from '../models/User.js';
import { WebhookEventModel } from '../models/WebhookEvent.js';
import { computeAmount } from '../services/order.service.js';

/** Demo credentials. Public on purpose: they only ever exist in a demo database. */
export const DEMO_ADMIN_EMAIL = 'admin@orderpulse.dev';
export const DEMO_MEMBER_EMAIL = 'member@orderpulse.dev';
export const DEMO_PASSWORD = 'orderpulse-demo';

const DAY_MS = 24 * 60 * 60 * 1000;

const CUSTOMERS = [
  'Ada Lovelace',
  'Grace Hopper',
  'Alan Turing',
  'Katherine Johnson',
  'Linus Torvalds',
  'Margaret Hamilton',
];

const PRODUCTS: { name: string; price: number }[] = [
  { name: 'Mechanical Keyboard', price: 12_900 },
  { name: 'Wireless Mouse', price: 4_900 },
  { name: '27" Monitor', price: 32_900 },
  { name: 'USB-C Dock', price: 8_900 },
  { name: 'Laptop Stand', price: 3_900 },
  { name: 'Webcam', price: 6_900 },
];

/**
 * A small deterministic pseudo-random generator (mulberry32), so every seed
 * run produces the same demo data.
 */
function createRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function statusForAge(ageDays: number, roll: number): OrderStatus {
  if (roll < 0.08) return 'cancelled';
  if (ageDays === 0) return roll < 0.5 ? 'pending' : 'paid';
  if (ageDays <= 2) return roll < 0.25 ? 'pending' : roll < 0.65 ? 'paid' : 'shipped';
  return roll < 0.3 ? 'paid' : 'shipped';
}

export interface SeedResult {
  accountId: string;
  orders: number;
}

/**
 * Creates the demo account, an admin, a member and sample orders spread over
 * the last 14 days. Re-running replaces the previous demo account.
 */
export async function seedDemoData(): Promise<SeedResult> {
  const existing = await UserModel.findOne({ email: DEMO_ADMIN_EMAIL }).lean();
  if (existing) {
    const accountId = existing.accountId;
    await Promise.all([
      OrderModel.deleteMany({ accountId }),
      WebhookEventModel.deleteMany({ accountId }),
      UserModel.deleteMany({ accountId }),
      AccountModel.deleteOne({ _id: accountId }),
    ]);
  }

  const account = await AccountModel.create({ name: 'Acme Demo Store' });
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, env.BCRYPT_ROUNDS);
  await UserModel.create([
    { accountId: account._id, email: DEMO_ADMIN_EMAIL, passwordHash, role: 'admin' },
    { accountId: account._id, email: DEMO_MEMBER_EMAIL, passwordHash, role: 'member' },
  ]);

  const random = createRandom(42);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)] as T;
  const now = Date.now();
  const orders = [];

  for (let ageDays = 13; ageDays >= 0; ageDays -= 1) {
    const ordersThatDay = 2 + Math.floor(random() * 4);
    for (let n = 0; n < ordersThatDay; n += 1) {
      const items = new Map<string, OrderItem>();
      const lineCount = 1 + Math.floor(random() * 3);
      while (items.size < lineCount) {
        const product = pick(PRODUCTS);
        items.set(product.name, { ...product, qty: 1 + Math.floor(random() * 3) });
      }
      const lines = [...items.values()];
      // Spread through the day, but never in the future.
      const createdAt = new Date(now - ageDays * DAY_MS - Math.floor(random() * 0.4 * DAY_MS));

      orders.push({
        accountId: account._id,
        orderId: `DEMO-${String(orders.length + 1).padStart(4, '0')}`,
        customerName: pick(CUSTOMERS),
        items: lines,
        amount: computeAmount(lines),
        status: statusForAge(ageDays, random()),
        createdAt,
        updatedAt: createdAt,
      });
    }
  }

  await OrderModel.insertMany(orders);
  return { accountId: account.id as string, orders: orders.length };
}
