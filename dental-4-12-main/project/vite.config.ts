import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      includeAssets: ['icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'FLORAL - Dental Health Record Management System',
        short_name: 'FLORAL',
        description: 'Dental Health Record Management System with Predictive Analytics',
        theme_color: '#1E40AF',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // Dynamic-imported heavy chunks are fetched on demand by the few
        // staff who use those features — precaching them would make every
        // visitor download them on install anyway.
        //
        // The PDF-export trio was missed when this list was first written and
        // sat in the precache for months: jspdf (382 kB), html2canvas-pro
        // (240 kB) and html2canvas (198 kB), ~820 kB that only ever loads when
        // someone exports a PDF (`utils/exportPdf.ts` imports all three
        // dynamically, and nothing imports them statically). Every device paid
        // that on service-worker install, which matters most on a phone over
        // mobile data — the case CLAUDE.md's three-device rule cares about.
        //
        // ⚠ Only add a pattern here for a chunk reached exclusively through
        // `import()`. Excluding a statically-imported chunk breaks the app
        // offline, because the SW will not have it and there is no network to
        // fall back to.
        globIgnores: [
          '**/iptrOcr-*.js',
          '**/exceljs*.js',
          '**/jspdf*.js',
          '**/html2canvas*.js',
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  assetsInclude: ['**/*.svg', '**/*.csv'],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  // Needed to locally test the production build (npm run build && vite
  // preview) — Sprint 20's service worker features (API caching, background
  // sync) only run against a real built SW, never in `vite dev`.
  preview: {
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
})
