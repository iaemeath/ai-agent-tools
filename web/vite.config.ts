import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// API port override — mirrors the server's own `PORT ?? 8787`, so `PORT=8788 npm run dev:server`
// pairs with `AAT_API_PORT=8788 npm run dev:web` when 8787 is taken (e.g. by a packaged build).
const apiPort = process.env.AAT_API_PORT ?? '8787';

export default defineConfig({
  plugins: [vue()],
  server: {
    host: true, // bind 0.0.0.0 so WSL2 ↔ Windows browser port-forward works
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
  },
});
