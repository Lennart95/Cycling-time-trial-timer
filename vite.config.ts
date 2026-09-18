import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Renderer build. `base: './'` so the production bundle loads correctly
// from a file:// URL inside Electron.
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
