import { fileURLToPath, URL } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * Kept separate from vite.config.ts on purpose.
 *
 * Vitest 2 depends on its own copy of Vite, so declaring both in one file makes
 * TypeScript see two incompatible Plugin types for the same plugin.
 */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
