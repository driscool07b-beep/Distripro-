import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
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
      workbox: {
        // Ne met en cache que les fichiers de l'app (JS/CSS/HTML/icônes) pour
        // qu'elle s'ouvre hors-ligne — jamais les appels réseau vers Supabase,
        // qui doivent toujours passer par la file d'attente de synchronisation
        // (voir src/lib/offline.js), pas par un cache HTTP générique.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: '/index.html',
        runtimeCaching: [],
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
