import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,mjs}'],
    // Isolate 50K I/O from short contracts, especially on Windows/Defender runners.
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
