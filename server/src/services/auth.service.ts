import bcrypt from 'bcryptjs';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../config/env.js';
import { AccountModel } from '../models/Account.js';
import { USER_ROLES, UserModel, type UserDocument, type UserRole } from '../models/User.js';
import { conflict, isDuplicateKeyError, unauthorized } from '../utils/errors.js';

/** Who is making the request. Derived from a verified JWT, never from user input. */
export interface AuthContext {
  userId: string;
  accountId: string;
  role: UserRole;
}

export interface UserDTO {
  id: string;
  accountId: string;
  email: string;
  role: UserRole;
}

export interface AuthResult {
  token: string;
  user: UserDTO;
}

const tokenClaimsSchema = z.object({
  sub: z.string(),
  accountId: z.string(),
  role: z.enum(USER_ROLES),
});

function toUserDTO(user: UserDocument): UserDTO {
  return {
    id: user.id as string,
    accountId: user.accountId.toString(),
    email: user.email,
    role: user.role,
  };
}

export function signToken(user: UserDTO): string {
  const options: SignOptions = {
    subject: user.id,
    expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'],
  };
  return jwt.sign({ accountId: user.accountId, role: user.role }, env.JWT_SECRET, options);
}

/** Verifies a JWT and returns the caller's identity. Throws 401 if invalid. */
export function verifyToken(token: string): AuthContext {
  try {
    const claims = tokenClaimsSchema.parse(jwt.verify(token, env.JWT_SECRET));
    return { userId: claims.sub, accountId: claims.accountId, role: claims.role };
  } catch {
    throw unauthorized('Invalid or expired token');
  }
}

/** Creates a new account (tenant) together with its first admin user. */
export async function registerAccount(input: {
  accountName: string;
  email: string;
  password: string;
}): Promise<AuthResult> {
  const email = input.email.toLowerCase();
  if (await UserModel.exists({ email })) {
    throw conflict('An account with this email already exists');
  }

  const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_ROUNDS);
  const account = await AccountModel.create({ name: input.accountName });

  try {
    const user = await UserModel.create({
      accountId: account._id,
      email,
      passwordHash,
      role: 'admin',
    });
    const dto = toUserDTO(user);
    return { token: signToken(dto), user: dto };
  } catch (error) {
    // Lost a race on the unique email index: do not leave an orphan account.
    await AccountModel.deleteOne({ _id: account._id });
    if (isDuplicateKeyError(error)) {
      throw conflict('An account with this email already exists');
    }
    throw error;
  }
}

export async function login(input: { email: string; password: string }): Promise<AuthResult> {
  const user = await UserModel.findOne({ email: input.email.toLowerCase() });
  // Same message for "no such user" and "wrong password", so the endpoint
  // cannot be used to discover which emails are registered.
  if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
    throw unauthorized('Invalid email or password');
  }
  const dto = toUserDTO(user);
  return { token: signToken(dto), user: dto };
}

/** Adds a user to an existing account. Only admins reach this (see users.routes). */
export async function createUser(
  accountId: string,
  input: { email: string; password: string; role: UserRole },
): Promise<UserDTO> {
  try {
    const user = await UserModel.create({
      accountId,
      email: input.email.toLowerCase(),
      passwordHash: await bcrypt.hash(input.password, env.BCRYPT_ROUNDS),
      role: input.role,
    });
    return toUserDTO(user);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw conflict('A user with this email already exists');
    }
    throw error;
  }
}

export async function listUsers(accountId: string): Promise<UserDTO[]> {
  const users = await UserModel.find({ accountId }).sort({ createdAt: 1 });
  return users.map(toUserDTO);
}

export async function getUser(auth: AuthContext): Promise<UserDTO> {
  const user = await UserModel.findOne({ _id: auth.userId, accountId: auth.accountId });
  if (!user) throw unauthorized('User no longer exists');
  return toUserDTO(user);
}
