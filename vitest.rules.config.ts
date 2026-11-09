import { defineConfig } from 'vitest/config';

// Security rules tests need the Firestore emulator: run them with `npm run test:rules`.
export default defineConfig({
  test: {
    include: ['tests/rules/**/*.spec.ts'],
    environment: 'node',
    testTimeout: 20_000,
    fileParallelism: false,
  },
});
