import express, { Router } from 'express';
import { env } from '../config/env.js';
import { recordWebhookEvent } from '../services/webhook.service.js';
import { badRequest, unauthorized } from '../utils/errors.js';
import { SIGNATURE_HEADER, verifySignature } from '../utils/signature.js';
import { webhookPayloadSchema } from '../validation/schemas.js';

export const webhooksRouter = Router();

/**
 * POST /webhooks/orders
 *
 * Not behind JWT auth: the caller is another system, authenticated by an HMAC
 * signature over the request body.
 *
 * The body is read as raw bytes (express.raw) because the signature covers the
 * exact bytes that were sent. Parsing to JSON first and re-serialising would
 * not reproduce them.
 *
 * The handler only verifies, stores and acknowledges. The actual work happens
 * in the background worker, so the sender gets a fast response and a slow or
 * failing order update never causes a webhook timeout.
 */
webhooksRouter.post(
  '/orders',
  express.raw({ type: 'application/json', limit: '100kb' }),
  async (req, res) => {
    const rawBody: unknown = req.body;
    if (!Buffer.isBuffer(rawBody)) {
      throw badRequest('Expected a JSON body with Content-Type: application/json');
    }

    if (!verifySignature(rawBody, req.get(SIGNATURE_HEADER), env.WEBHOOK_SECRET)) {
      throw unauthorized('Invalid webhook signature');
    }

    let json: unknown;
    try {
      json = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw badRequest('Body is not valid JSON');
    }

    const payload = webhookPayloadSchema.parse(json);
    const { duplicate } = await recordWebhookEvent(payload);

    // 202: accepted for processing, not processed yet. A duplicate gets the
    // same success response, which tells the sender to stop retrying.
    res.status(202).json({ received: true, duplicate, eventId: payload.eventId });
  },
);
