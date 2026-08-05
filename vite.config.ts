import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  server: {
    // Sensor features need HTTPS (§11) — dev-server host-check would otherwise
    // reject requests tunneled in through a random *.trycloudflare.com host.
    allowedHosts: true,
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: false, // we ship public/manifest.webmanifest directly
      includeAssets: ['icons/*.png'],
      workbox: {
        // PMTiles are served with HTTP range requests; only precache the app shell here.
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        runtimeCaching: [
          {
            urlPattern: /\/tiles\/.*\.pmtiles$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'pmtiles',
              rangeRequests: true,
              cacheableResponse: { statuses: [0, 200, 206] },
            },
          },
        ],
      },
    }),
  ],
  test: {
    environment: 'node',
  },
});
