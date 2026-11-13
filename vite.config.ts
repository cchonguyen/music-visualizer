import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    target: 'es2022',
    rollupOptions: {
      // Paths are relative to the project root (no node:path: @types/node is not installed, so tsc would fail).
      input: {
        main: 'index.html',
        popout: 'popout.html',
      },
    },
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
