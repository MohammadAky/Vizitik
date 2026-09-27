import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// نام نرم‌افزار ثابت است (ویزیتیک) — هیچ متغیر محیطی برای تعویض نام لازم نیست.
const APP_NAME_FA = 'ویزیتیک';
const APP_NAME_EN = 'Vizitik';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'],
      manifest: {
        name: APP_NAME_EN,
        short_name: APP_NAME_EN,
        description: `${APP_NAME_EN} — ثبت سفارش، فاکتور و مدیریت بار برای ویزیتورهای پخش (آفلاین‌محور)`,
        lang: 'fa',
        dir: 'rtl',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        theme_color: '#001d31',
        background_color: '#001d31',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,ttf}'],
        navigateFallback: '/index.html',
        // Offline business data lives in IndexedDB. Never cache authenticated
        // API responses across logout/login or database restores.
        navigateFallbackDenylist: [/^\/api(?:\/|$)/],
        runtimeCaching: [{ urlPattern: /\/api\//, handler: 'NetworkOnly' }]
      }
    })
  ],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: process.env.DEV_API_TARGET || 'http://127.0.0.1:3000', changeOrigin: true } },
    allowedHosts: ['.e2b.app', '.githubpreview.dev', 'localhost']
  }
});
