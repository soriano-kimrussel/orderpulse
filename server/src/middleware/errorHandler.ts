import type { ErrorRequestHandler, RequestHandler } from 'express';
import mongoose from 'mongoose';
import { ZodError } from 'zod';
import { env } from '../config/env.js';
import { HttpError, isDuplicateKeyError } from '../utils/errors.js';

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
};

// Express identifies error handlers by their four-argument signature.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  if (error instanceof ZodError) {
    res.status(400).json({
      error: 'Validation failed',
      details: error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
    return;
  }

  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message, details: error.details });
    return;
  }

  if (error instanceof mongoose.Error.ValidationError || error instanceof mongoose.Error.CastError) {
    res.status(400).json({ error: error.message });
    return;
  }

  if (isDuplicateKeyError(error)) {
    res.status(409).json({ error: 'A record with this identifier already exists' });
    return;
  }

  // Malformed JSON bodies and oversized payloads from express.json().
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = Number(error.status);
    if (status >= 400 && status < 500) {
      res.status(status).json({ error: 'Malformed request' });
      return;
    }
  }

  if (env.NODE_ENV !== 'test') {
    console.error('[error]', error);
  }
  res.status(500).json({ error: 'Internal server error' });
};
