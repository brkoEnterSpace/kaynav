import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/kaynav/',
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'KayNav',
        short_name: 'KayNav',
        description: 'Offline kayak GPS map with speed and approximate depth.',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/kaynav/',
        start_url: '/kaynav/',
        icons: []
      }
    })
  ]
});