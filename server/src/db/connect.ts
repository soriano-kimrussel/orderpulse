import mongoose from 'mongoose';
import { AccountModel } from '../models/Account.js';
import { OrderModel } from '../models/Order.js';
import { UserModel } from '../models/User.js';
import { WebhookEventModel } from '../models/WebhookEvent.js';

/**
 * Connects to MongoDB and waits until every model's indexes are built.
 *
 * Idempotency depends on the unique indexes (orderId, eventId), so the app
 * must not start serving traffic before they exist.
 */
export async function connectDatabase(uri: string): Promise<void> {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri);
  await Promise.all([
    AccountModel.init(),
    UserModel.init(),
    OrderModel.init(),
    WebhookEventModel.init(),
  ]);
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}
