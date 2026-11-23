import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// 127.0.0.1 rather than "localhost": on Windows, Node resolves localhost to
// IPv6 (::1) first, which does not always match what the other side listens on.
const API_TARGET = process.env.VITE_PROXY_TARGET ?? 'http://127.0.0.1:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    // The browser talks to one origin; Vite forwards API and socket traffic.
    proxy: {
      '/api': API_TARGET,
      '/socket.io': { target: API_TARGET, ws: true },
    },
  },
});
