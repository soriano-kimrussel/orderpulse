import { Schema, model, type HydratedDocument } from 'mongoose';

export interface Account {
  name: string;
  createdAt: Date;
}

const accountSchema = new Schema<Account>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export type AccountDocument = HydratedDocument<Account>;
export const AccountModel = model<Account>('Account', accountSchema);
