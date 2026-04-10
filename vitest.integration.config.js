import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['integration/**/*.test.js'],
    environment: 'node',
    globals: true,
    testTimeout: 30_000,
    maxWorkers: 1,
  },
});
