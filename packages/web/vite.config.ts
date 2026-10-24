import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { cspMetaPlugin } from './src/csp.js'
import { securityHeaders } from './src/headers.js'

// CMP-1 build (AD-1, AD-6). Tailwind 4 via its Vite plugin; the built bundle is served
// by CMP-3 in the deployed image. The CSP <meta> keeps every request on the page's origin (AC-7).
export default defineConfig({
  plugins: [react(), tailwindcss(), cspMetaPlugin()],
  // One page and nothing else (AC-3): no SPA fallback, so /admin or any other path is a 404.
  appType: 'mpa',
  // `vite preview` serves the built screen with its own security headers, the CSP among them (AC-7).
  preview: { headers: { ...securityHeaders } },
  // Bundle the shared rules from source, so the screen builds without a prior `tsc -b`.
  resolve: {
    alias: {
      '@app/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },
})
