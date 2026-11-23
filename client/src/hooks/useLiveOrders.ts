import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { API_URL, ApiError, fetchRecentOrders } from '../api';
import type { Order, ServerToClientEvents } from '../types';

const MAX_ORDERS = 25;

export interface LiveOrders {
  orders: Order[];
  /** Whether the Socket.IO connection is currently up. */
  connected: boolean;
  /** Increases on every server event. Other data can re-fetch when it changes. */
  eventCount: number;
  /** orderId -> the eventCount at which it last changed, for the row highlight. */
  changedAt: Record<string, number>;
  error: string | null;
}

/**
 * Keeps a list of the most recent orders in sync with the server.
 *
 * Loads the list over REST, then applies order:created / order:updated /
 * order:deleted events from the account's Socket.IO room. After a reconnect it
 * reloads the list, since events sent while offline are not replayed.
 */
export function useLiveOrders(token: string, onUnauthorized: () => void): LiveOrders {
  const [orders, setOrders] = useState<Order[]>([]);
  const [connected, setConnected] = useState(false);
  const [eventCount, setEventCount] = useState(0);
  const [changedAt, setChangedAt] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const load = async (): Promise<void> => {
      try {
        const recent = await fetchRecentOrders(token, MAX_ORDERS);
        if (!active) return;
        setOrders(recent);
        setError(null);
      } catch (cause) {
        if (!active) return;
        if (cause instanceof ApiError && cause.status === 401) onUnauthorized();
        else setError(cause instanceof Error ? cause.message : 'Could not load orders');
      }
    };

    let received = 0;
    const markChanged = (orderId: string): void => {
      received += 1;
      const stamp = received;
      setEventCount(stamp);
      setChangedAt((previous) => ({ ...previous, [orderId]: stamp }));
    };

    // The JWT goes in the handshake; the server uses it to pick the room.
    const options = { auth: { token } };
    const socket: Socket<ServerToClientEvents> = API_URL ? io(API_URL, options) : io(options);

    socket.on('connect', () => {
      setConnected(true);
      void load();
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => setConnected(false));

    socket.on('order:created', (order) => {
      setOrders((current) =>
        [order, ...current.filter((o) => o.orderId !== order.orderId)].slice(0, MAX_ORDERS),
      );
      markChanged(order.orderId);
    });

    socket.on('order:updated', (order) => {
      setOrders((current) => current.map((o) => (o.orderId === order.orderId ? order : o)));
      markChanged(order.orderId);
    });

    socket.on('order:deleted', ({ orderId }) => {
      setOrders((current) => current.filter((o) => o.orderId !== orderId));
      markChanged(orderId);
    });

    // Show data even if the socket cannot connect.
    void load();

    return () => {
      active = false;
      socket.disconnect();
    };
  }, [token, onUnauthorized]);

  return { orders, connected, eventCount, changedAt, error };
}
