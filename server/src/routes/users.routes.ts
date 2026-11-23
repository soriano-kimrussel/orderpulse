import { Router } from 'express';
import { authenticate, getAuth, requireRole } from '../middleware/auth.js';
import { createUser, listUsers } from '../services/auth.service.js';
import { createUserSchema } from '../validation/schemas.js';

export const usersRouter = Router();

// Managing the account's users is admin-only.
usersRouter.use(authenticate, requireRole('admin'));

usersRouter.get('/', async (req, res) => {
  res.json({ data: await listUsers(getAuth(req).accountId) });
});

/** Adds a user (member by default) to the caller's own account. */
usersRouter.post('/', async (req, res) => {
  const user = await createUser(getAuth(req).accountId, createUserSchema.parse(req.body));
  res.status(201).json({ user });
});
