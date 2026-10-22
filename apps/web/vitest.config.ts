import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const srcDir = fileURLToPath(new URL('./src', import.meta.url));
const sharedSrc = fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url));

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.spec.ts', 'src/**/*.test.ts', 'src/**/*.spec.tsx', 'src/**/*.test.tsx'],
  },
  resolve: {
    alias: {
      '@': srcDir,
      '@warung/shared': sharedSrc,
    },
  },
});