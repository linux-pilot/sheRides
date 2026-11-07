import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Polling so file changes on the host bind mount reach the container.
    watch: { usePolling: true },
    // OrbStack's HTTPS addresses (https://client.sherides.orb.local).
    allowedHosts: ['.orb.local'],
    // The browser talks to the API through this same address (/api → API container, WebSocket included), so the
    // site works unchanged on localhost, a phone on the Wi-Fi or OrbStack HTTPS: one origin,
    // no CORS, and an https page never calls an http API.
    proxy: {
      '/api': { target: 'http://server:5000', ws: true, rewrite: (path) => path.replace(/^\/api/, '') },
    },
  },
});
