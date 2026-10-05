import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API_TARGET = process.env.API_URL ?? 'http://127.0.0.1:4000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    port: Number(process.env.PORT ?? 5173),
    // The app is opened through preview proxies with arbitrary hostnames.
    allowedHosts: true,
    proxy: {
      // Browser code only ever calls relative /api URLs; the dev server forwards them (SSE included).
      '/api': { target: API_TARGET, changeOrigin: false, xfwd: true },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
    proxy: { '/api': { target: API_TARGET, xfwd: true } },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 900,
  },
});
