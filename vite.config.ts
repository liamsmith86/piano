import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [
    tailwindcss(),
  ],
  server: {
    port: 5173,
  },
  build: {
    chunkSizeWarningLimit: 1600,
  },
});
