import type { Server } from 'socket.io';
import type { OrderDTO } from '../services/order.service.js';

/** Events the server pushes to dashboards. Shared shape with the client. */
export interface ServerToClientEvents {
  'order:created': (order: OrderDTO) => void;
  'order:updated': (order: OrderDTO) => void;
  'order:deleted': (payload: { orderId: string }) => void;
}

// Clients never send events; everything they do goes through the REST API.
export type ClientToServerEvents = Record<string, never>;

export type RealtimeServer = Server<ClientToServerEvents, ServerToClientEvents>;

export const accountRoom = (accountId: string): string => `account:${accountId}`;

let io: RealtimeServer | null = null;

export function setRealtimeServer(server: RealtimeServer | null): void {
  io = server;
}

/**
 * Emits an event to one account's room only. Services call this after a
 * successful write. It is a no-op when no Socket.IO server is attached
 * (scripts, most tests), so services never depend on a live socket.
 */
export function publishToAccount<E extends keyof ServerToClientEvents>(
  accountId: string,
  event: E,
  ...args: Parameters<ServerToClientEvents[E]>
): void {
  io?.to(accountRoom(accountId)).emit(event, ...args);
}
