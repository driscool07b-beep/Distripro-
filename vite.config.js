import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // injectManifest plutôt que generateSW : on écrit notre propre
      // service worker (src/sw.js) pour pouvoir y gérer les
      // notifications push (évènements 'push' / 'notificationclick'),
      // tout en gardant le pré-cache Workbox pour le fonctionnement
      // hors-ligne existant.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      registerType: 'prompt',
      includeAssets: ['icons/apple-touch-icon.png'],
      manifest: {
        name: 'DistribPro — Gestion commerciale',
        short_name: 'DistribPro',
        description: 'Plateforme de gestion commerciale pour entreprises de distribution',
        start_url: '/',
        display: 'standalone',
        background_color: '#0a1f26',
        theme_color: '#0d2830',
        orientation: 'portrait-primary',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  server: {
    port: 5173,
  },
})
