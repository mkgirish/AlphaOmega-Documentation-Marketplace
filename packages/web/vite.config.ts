import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { contentSecurityPolicy, cspMetaPlugin } from './src/csp.js'

// CMP-1 build (AD-1, AD-6). Tailwind 4 via its Vite plugin; the built bundle is served
// by CMP-3 in the deployed image. The CSP <meta> keeps every request on the page's origin (AC-7).
export default defineConfig({
  plugins: [react(), tailwindcss(), cspMetaPlugin()],
  // One screen and nothing else (ST-1 AC-3): no SPA fallback, so /admin, /login or a GET
  // to /api/registrations answer 404 rather than the registration page.
  appType: 'mpa',
  // `vite preview` serves the bundle as the image does: the policy as a header too (ST-1 AC-7).
  preview: {
    headers: { 'Content-Security-Policy': contentSecurityPolicy },
  },
  // Bundle the shared rules from source, so the screen builds without a prior `tsc -b`.
  resolve: {
    alias: {
      '@app/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },
})
