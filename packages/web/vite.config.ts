import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// CMP-1 build (AD-1, AD-6). Tailwind 4 via its Vite plugin; the built bundle is served
// by CMP-3 in the deployed image.
export default defineConfig({
  plugins: [react(), tailwindcss()],
})
