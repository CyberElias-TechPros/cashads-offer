import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Each test file gets its own in-memory Postgres; run files in parallel workers.
    pool: 'forks',
    env: { NODE_ENV: 'test' },
  },
});
