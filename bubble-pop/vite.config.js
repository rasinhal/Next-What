import { defineConfig } from 'vite';

// Relative base so the build works from any host path and inside the Android app.
export default defineConfig({
  base: './',
  build: { outDir: 'dist', assetsInlineLimit: 0 },
});
