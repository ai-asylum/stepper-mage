import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { host: true, port: 5199 },
  build: { target: 'es2022', assetsInlineLimit: 0, chunkSizeWarningLimit: 2000 },
});
