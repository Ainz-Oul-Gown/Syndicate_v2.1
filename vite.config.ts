import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const BASE_PATH = '/Syndicate_v2.1/';

export default defineConfig(() => {
  return {
    base: BASE_PATH,

    plugins: [
      react(),
      tailwindcss(),

      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: 'auto',

        includeAssets: [
          'icon.svg',
          'icons/icon-192.png',
          'icons/icon-512.png',
          'icons/icon-maskable-512.png',
        ],

        manifest: {
          id: BASE_PATH,
          name: 'Syndicate',
          short_name: 'Syndicate',

          theme_color: '#0f172a',
          background_color: '#0f172a',

          display: 'standalone',
          display_override: ['window-controls-overlay'],

          start_url: BASE_PATH,
          scope: BASE_PATH,

          protocol_handlers: [
            {
              protocol: 'web+syndicate',
              url: `${ BASE_PATH }?url =% s`,
            },
          ],

          icons: [
            {
              src: 'icons/icon-192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: 'icons/icon-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: 'icons/icon-maskable-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },

        workbox: {
          globPatterns: [
            '**/*.{js,css,html,ico,png,svg,webmanifest}',
          ],
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: true,
        },
      }),
    ],

    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },

    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch:
        process.env.DISABLE_HMR === 'true'
          ? null
          : {},
    },
  };
});