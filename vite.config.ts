import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  publicDir: 'release-public',
  optimizeDeps: { exclude: ['maplibre-gl'] },
  plugins: [react(), VitePWA({
    registerType: 'autoUpdate',
    manifest: {
      name: 'НЕ ТУДА — прогулки по Омску', short_name: 'НЕ ТУДА', lang: 'ru',
      description: 'Прогулки по Омску с Умнаем', theme_color: '#161918', background_color: '#161918',
      display: 'standalone', start_url: './', scope: './',
      icons: [
        { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: 'icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
      ]
    },
    workbox: { globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'], navigateFallback: 'index.html' }
  })]
});
