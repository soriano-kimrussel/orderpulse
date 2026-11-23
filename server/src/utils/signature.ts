import { createHmac, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_HEADER = 'x-orderpulse-signature';
const PREFIX = 'sha256=';

/** `sha256=<hex HMAC-SHA256 of the raw request body>`. */
export function signPayload(body: string | Buffer, secret: string): string {
  return PREFIX + createHmac('sha256', secret).update(body).digest('hex');
}

/**
 * Checks a signature header against the raw body.
 *
 * The comparison is constant-time, so response timing does not leak how many
 * leading characters of a forged signature were correct.
 */
export function verifySignature(
  body: Buffer,
  header: string | undefined,
  secret: string,
): boolean {
  if (!header?.startsWith(PREFIX)) return false;

  const expected = Buffer.from(signPayload(body, secret));
  const received = Buffer.from(header);
  return expected.length === received.length && timingSafeEqual(expected, received);
}
