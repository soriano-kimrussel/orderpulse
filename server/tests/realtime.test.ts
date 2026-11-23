import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setRealtimeServer, type RealtimeServer } from '../src/realtime/publisher.js';
import { createRealtimeServer } from '../src/realtime/socket.js';
import type { OrderDTO } from '../src/services/order.service.js';
import { drainQueue } from '../src/worker/webhookWorker.js';
import {
  app,
  createOrder,
  orderCreatedEvent,
  registerAdmin,
  sendWebhook,
  setStatus,
} from './support/helpers.js';

let httpServer: HttpServer;
let io: RealtimeServer;
let url: string;
const sockets: Socket[] = [];

beforeAll(async () => {
  httpServer = createServer(app);
  io = createRealtimeServer(httpServer);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
});

afterEach(() => {
  for (const socket of sockets.splice(0)) socket.disconnect();
});

afterAll(async () => {
  setRealtimeServer(null);
  await io.close();
});

/** Connects a dashboard socket and records every order event it receives. */
async function openDashboard(token: string) {
  const socket = connect(url, { auth: { token }, transports: ['websocket'], reconnection: false });
  sockets.push(socket);

  const events: { name: string; payload: unknown }[] = [];
  socket.onAny((name: string, payload: unknown) => events.push({ name, payload }));

  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  return { socket, events };
}

async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for a socket event');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

describe('socket authentication', () => {
  it('refuses a connection without a token', async () => {
    const socket = connect(url, { transports: ['websocket'], reconnection: false });
    sockets.push(socket);

    const error = await new Promise<Error>((resolve) => socket.once('connect_error', resolve));
    expect(error.message).toBe('Authentication required');
    expect(socket.connected).toBe(false);
  });

  it('refuses a connection with an invalid token', async () => {
    await expect(openDashboard('not-a-jwt')).rejects.toThrow('Invalid or expired token');
  });
});

describe('order events', () => {
  it("emits order:created to the order's account only", async () => {
    const a = await registerAdmin('Account A');
    const b = await registerAdmin('Account B');
    const dashboardA = await openDashboard(a.token);
    const dashboardB = await openDashboard(b.token);

    const order = await createOrder(a);

    await waitFor(() => dashboardA.events.length > 0);
    expect(dashboardA.events).toEqual([{ name: 'order:created', payload: order }]);

    await settle();
    expect(dashboardB.events).toEqual([]);
  });

  it('emits order:updated when the status changes, but not for a no-op', async () => {
    const a = await registerAdmin();
    const order = await createOrder(a);
    const dashboard = await openDashboard(a.token);

    await setStatus(a, order.orderId, 'paid').expect(200);
    await waitFor(() => dashboard.events.length > 0);

    expect(dashboard.events[0]?.name).toBe('order:updated');
    expect((dashboard.events[0]?.payload as OrderDTO).status).toBe('paid');

    await setStatus(a, order.orderId, 'paid').expect(200); // already paid
    await settle();
    expect(dashboard.events).toHaveLength(1);
  });

  it('emits when the worker creates an order from a webhook, once', async () => {
    const a = await registerAdmin();
    const dashboard = await openDashboard(a.token);
    const event = orderCreatedEvent(a.accountId);

    await sendWebhook(event).expect(202);
    await sendWebhook(event).expect(202); // duplicate delivery
    await drainQueue();

    await waitFor(() => dashboard.events.length > 0);
    await settle();

    expect(dashboard.events).toHaveLength(1);
    expect(dashboard.events[0]?.name).toBe('order:created');
    expect((dashboard.events[0]?.payload as OrderDTO).orderId).toBe('WH-1001');
  });
});
