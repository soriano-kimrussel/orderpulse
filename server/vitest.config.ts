import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // One in-memory MongoDB for the whole run; each test file gets its own database.
    globalSetup: ['tests/support/globalSetup.ts'],
    setupFiles: ['tests/support/setup.ts'],
    testTimeout: 20_000,
    // The first run downloads a mongod binary, which can take a few minutes.
    hookTimeout: 600_000,
    env: {
      NODE_ENV: 'test',
      MONGODB_URI: 'provided-by-global-setup',
      JWT_SECRET: 'test-only-jwt-secret-0123456789',
      WEBHOOK_SECRET: 'test-only-webhook-secret-0123456789',
      BCRYPT_ROUNDS: '4',
      WORKER_ENABLED: 'false',
      WORKER_MAX_ATTEMPTS: '5',
    },
  },
});
