import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const appName = process.env.APP_NAME ?? 'MONO';
const apiTarget = `http://127.0.0.1:${process.env.PORT ?? 3000}`;

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'push-sw.js'],
      manifest: {
        name: appName,
        short_name: appName,
        description: 'Run your business in one place: tasks, checklists, processes, HR, stock and sales.',
        theme_color: '#1F1E1B',
        background_color: '#F2EFE7',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        importScripts: ['/push-sw.js'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // WEB_PORT / PORT let a second copy of the app run beside the first (several checkouts on one machine).
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    host: true,
    proxy: { '/api': { target: apiTarget, changeOrigin: false } },
  },
  preview: { port: 4173, proxy: { '/api': { target: apiTarget } } },
  build: { sourcemap: true, chunkSizeWarningLimit: 900 },
});
