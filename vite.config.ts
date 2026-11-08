import { defineConfig } from 'vitest/config';

// GitHub Pages serves the site from /<repo-name>/, so the base path must match the repo.
// Override with BASE_PATH=/ for other hosts (e.g. Netlify, a custom domain).
const base = process.env.BASE_PATH ?? '/become-millionaire/';

export default defineConfig({
  base,
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
