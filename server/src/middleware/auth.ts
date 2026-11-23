import type { Request, RequestHandler } from 'express';
import type { UserRole } from '../models/User.js';
import { verifyToken, type AuthContext } from '../services/auth.service.js';
import { forbidden, unauthorized } from '../utils/errors.js';

/** Requires a valid `Authorization: Bearer <jwt>` header and sets `req.auth`. */
export const authenticate: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw unauthorized();
  }
  req.auth = verifyToken(header.slice('Bearer '.length));
  next();
};

/** Allows the request only if the authenticated user has one of the roles. */
export function requireRole(...roles: UserRole[]): RequestHandler {
  return (req, _res, next) => {
    if (!roles.includes(getAuth(req).role)) {
      throw forbidden(`This action requires the ${roles.join(' or ')} role`);
    }
    next();
  };
}

/**
 * The authenticated caller. Every service call takes its accountId from here,
 * which is what keeps one account from ever touching another account's data.
 */
export function getAuth(req: Request): AuthContext {
  if (!req.auth) throw unauthorized();
  return req.auth;
}
