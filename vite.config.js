import { defineConfig } from 'vite';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Multi-page site: the landing page, the in-browser benchmark and one page per demo.
const root = import.meta.dirname;
const pages = { main: 'index.html', bench: 'bench.html' };
for (const engine of ['three', 'babylon', 'playcanvas', 'raw', 'pet']) {
  if (existsSync(resolve(root, `demos/${engine}/index.html`))) pages[engine] = `demos/${engine}/index.html`;
}

export default defineConfig({
  base: './', // relative asset URLs, so the built site works from any folder or static host
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 6000,
    rollupOptions: {
      input: Object.fromEntries(Object.entries(pages).map(([name, file]) => [name, resolve(root, file)])),
    },
  },
});
