import { defineConfig } from 'vite';
import vinext from 'vinext';

// Frontend-only local development in Node.js, without the Workers emulator.
// The existing vite.config.ts remains the Cloudflare build configuration.
// Cloudflare D1/R2 bindings are not available in this local mode.
export default defineConfig({
  plugins: [vinext()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
});
