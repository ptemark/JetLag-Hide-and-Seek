import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Forward /api/* requests to the local Vercel function runner (vercel dev).
      // Start `vercel dev` on port 3000 before running `npm run dev`.
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.js'],
    globals: true,
    // smoke.test.js imports scripts/smoke.js which has a #!/usr/bin/env node
    // shebang that Vitest cannot parse. Smoke tests run separately via
    // `npm run smoke` against a live deployment URL, not during unit test runs.
    exclude: ['**/node_modules/**', 'scripts/smoke.test.js'],
  },
});
