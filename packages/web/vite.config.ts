import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'

// AD-7 / AC-7: the built page may load only what the container serves. Added at build time
// only, because the dev server's React refresh preamble is an inline script.
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ')

function cspMeta(): Plugin {
  return {
    name: 'scr-1-csp-meta',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: contentSecurityPolicy }, injectTo: 'head' },
    ],
  }
}

// A production build is a production bundle even when the caller's NODE_ENV says otherwise
// (vitest sets NODE_ENV=test); vite reads NODE_ENV only after config hooks run.
function productionNodeEnv(): Plugin {
  return {
    name: 'scr-1-production-node-env',
    apply: 'build',
    config(_config, { mode }) {
      if (mode === 'production') process.env.NODE_ENV = 'production'
    },
  }
}

// CMP-1 build (AD-1, AD-6). Tailwind 4 via its Vite plugin; the built bundle is served
// by CMP-3 in the deployed image. @app/shared resolves from source, as under vitest.
export default defineConfig({
  plugins: [productionNodeEnv(), react(), tailwindcss(), cspMeta()],
  resolve: {
    alias: {
      '@app/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },
})
