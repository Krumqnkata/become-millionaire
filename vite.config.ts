import { defineConfig } from 'vitest/config';

// The site lives on Firebase Hosting at the domain root (`vite build --mode firebase`).
// Other builds keep the old GitHub Pages path /<repo-name>/; BASE_PATH overrides both.
export default defineConfig(({ mode }) => ({
  base: process.env.BASE_PATH ?? (mode === 'firebase' ? '/' : '/become-millionaire/'),
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
}));
