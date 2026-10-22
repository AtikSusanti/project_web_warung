import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const sharedSrc = fileURLToPath(new URL('../../packages/shared/src', import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts', 'src/**/*.test.ts'],
    root: './',
  },
  resolve: {
    alias: {
      '@': '/src',
      '@warung/shared': sharedSrc,
    },
  },
});
