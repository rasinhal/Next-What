import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Relative base so the build works from any host path and inside the Android app.
// Every game is its own page; index.html is the game menu.
const pages = ['index', 'bubble-pop', 'runner', 'cricket', 'table-tennis'];

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
    rollupOptions: {
      input: Object.fromEntries(pages.map((p) => [p, fileURLToPath(new URL(`./${p}.html`, import.meta.url))])),
    },
  },
});
