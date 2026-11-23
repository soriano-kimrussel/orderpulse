import { Router } from 'express';
import { authenticate, getAuth } from '../middleware/auth.js';
import { getUser, login, registerAccount } from '../services/auth.service.js';
import { loginSchema, registerSchema } from '../validation/schemas.js';

export const authRouter = Router();

/** Creates a new account and its first admin user. */
authRouter.post('/register', async (req, res) => {
  const result = await registerAccount(registerSchema.parse(req.body));
  res.status(201).json(result);
});

authRouter.post('/login', async (req, res) => {
  const result = await login(loginSchema.parse(req.body));
  res.json(result);
});

authRouter.get('/me', authenticate, async (req, res) => {
  res.json({ user: await getUser(getAuth(req)) });
});
