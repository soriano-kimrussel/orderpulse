import type { AuthContext } from '../services/auth.service.js';

declare global {
  namespace Express {
    interface Request {
      /** Set by the `authenticate` middleware. */
      auth?: AuthContext;
    }
  }
}

export {};
