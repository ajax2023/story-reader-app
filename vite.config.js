import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['vite.svg'],
      workbox: {
        navigateFallbackDenylist: [/^\/api\//, /^\/upload\//],
        runtimeCaching: [
          {
            urlPattern: /^\/api\//,
            handler: 'NetworkOnly'
          },
          {
            // Match common LAN/local hostnames and RFC1918 ranges
            urlPattern: /^https?:\/\/(localhost|127\.0\.0\.1|.*\.local|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/,
            handler: 'NetworkOnly'
          }
        ]
      },
      manifest: {
        name: 'Story PWA',
        short_name: 'Story',
        description: 'Record, encode to MP3, and upload in chunks',
        start_url: '/',
        display: 'standalone',
        background_color: '#0b132b',
        theme_color: '#1c2541',
        icons: [
          { src: '/vite.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
})
