import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { env } from '../config/env.js';
import { verifyToken, type AuthContext } from '../services/auth.service.js';
import {
  accountRoom,
  setRealtimeServer,
  type ClientToServerEvents,
  type RealtimeServer,
  type ServerToClientEvents,
} from './publisher.js';

interface SocketData {
  auth: AuthContext;
}

/**
 * Attaches Socket.IO to the HTTP server.
 *
 * A socket is only accepted with a valid JWT, and the room it joins comes from
 * the token's accountId. Clients cannot ask to join a room, so there is no way
 * to subscribe to another account's events.
 */
export function createRealtimeServer(httpServer: HttpServer): RealtimeServer {
  const io = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    Record<string, never>,
    SocketData
  >(httpServer, {
    cors: { origin: env.CLIENT_ORIGIN },
  });

  io.use((socket, next) => {
    const token: unknown = socket.handshake.auth.token;
    if (typeof token !== 'string') {
      next(new Error('Authentication required'));
      return;
    }
    try {
      socket.data.auth = verifyToken(token);
      next();
    } catch {
      next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', (socket) => {
    void socket.join(accountRoom(socket.data.auth.accountId));
  });

  setRealtimeServer(io);
  return io;
}
