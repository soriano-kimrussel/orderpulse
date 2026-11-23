import { Schema, model, type HydratedDocument, type Types } from 'mongoose';

export const USER_ROLES = ['admin', 'member'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export interface User {
  accountId: Types.ObjectId;
  email: string;
  passwordHash: string;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<User>(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: USER_ROLES, required: true, default: 'member' },
  },
  { timestamps: true },
);

// Login looks a user up by email, and an email identifies exactly one user.
userSchema.index({ email: 1 }, { unique: true });
// Listing the members of an account.
userSchema.index({ accountId: 1 });

export type UserDocument = HydratedDocument<User>;
export const UserModel = model<User>('User', userSchema);
