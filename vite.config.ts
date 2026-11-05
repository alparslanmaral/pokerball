import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { adminPlugin } from './vite/admin-plugin.ts';

// `base` is relative by default so the build works on any GitHub Pages path.
// Override with BASE_PATH=/repo-name/ if you prefer absolute paths.
export default defineConfig({
  base: process.env.BASE_PATH ?? './',
  plugins: [react(), adminPlugin()],
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
