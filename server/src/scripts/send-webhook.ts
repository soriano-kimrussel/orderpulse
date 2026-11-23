import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { env } from '../config/env.js';
import { WEBHOOK_EVENT_TYPES } from '../models/WebhookEvent.js';
import { SIGNATURE_HEADER, signPayload } from '../utils/signature.js';

/**
 * Sends a signed test webhook to a running server, the way an external
 * payment or shop system would.
 *
 *   npm run webhook:send -- --account <accountId>
 *   npm run webhook:send -- --account <accountId> --type order.paid --order WH-1234
 *   npm run webhook:send -- --account <accountId> --event evt_1   (run twice: deduplicated)
 */
const { values } = parseArgs({
  options: {
    account: { type: 'string' },
    type: { type: 'string', default: 'order.created' },
    order: { type: 'string' },
    event: { type: 'string' },
    url: { type: 'string', default: `http://localhost:${env.PORT}` },
  },
});

if (!values.account) {
  console.error('Missing --account <accountId>. The seed script prints the demo account id.');
  process.exit(1);
}
if (!(WEBHOOK_EVENT_TYPES as readonly string[]).includes(values.type)) {
  console.error(`--type must be one of: ${WEBHOOK_EVENT_TYPES.join(', ')}`);
  process.exit(1);
}

const orderId = values.order ?? `WH-${Math.floor(1000 + Math.random() * 9000)}`;
const payload = {
  eventId: values.event ?? `evt_${randomUUID()}`,
  type: values.type,
  accountId: values.account,
  data:
    values.type === 'order.created'
      ? {
          orderId,
          customerName: 'Webhook Customer',
          items: [
            { name: 'Mechanical Keyboard', qty: 1, price: 12_900 },
            { name: 'Wireless Mouse', qty: 2, price: 4_900 },
          ],
        }
      : { orderId },
};

// Sign the exact string that is sent: the server verifies the raw bytes.
const body = JSON.stringify(payload);
const response = await fetch(`${values.url}/webhooks/orders`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    [SIGNATURE_HEADER]: signPayload(body, env.WEBHOOK_SECRET),
  },
  body,
});

console.log(`${payload.type} for ${orderId} (event ${payload.eventId})`);
console.log(`-> ${response.status}`, await response.json());
