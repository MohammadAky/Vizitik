import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  // بارگذاری متغیرهای محیطی از .env (با VITE_ prefixed) تا هم منیفست و هم کد اپ از آن بخوانند
  const env = loadEnv(mode, process.cwd(), '');
  const nameFa = env.VITE_APP_NAME_FA || 'ویزیتیک';
  const nameEn = env.VITE_APP_NAME_EN || 'Vizitik';

  return {
    define: {
      __APP_NAME_FA__: JSON.stringify(nameFa),
      __APP_NAME_EN__: JSON.stringify(nameEn)
    },
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'],
        manifest: {
          name: `${nameFa} — اپلیکیشن ویزیتور`,
          short_name: nameFa,
          description: 'ثبت سفارش، فاکتور و مدیریت بار برای ویزیتورهای پخش (آفلاین‌محور)',
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
          runtimeCaching: [
            {
              // برنامه هرگز نباید وابسته به شبکه برای شِل باشد؛ داده از IndexedDB می‌آید.
              urlPattern: /\/api\//,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'vizitik-api',
                networkTimeoutSeconds: 5
              }
            }
          ]
        }
      })
    ],
    server: {
      host: true,
      port: 5173,
      allowedHosts: ['.e2b.app', '.githubpreview.dev', 'localhost']
    }
  };
});
