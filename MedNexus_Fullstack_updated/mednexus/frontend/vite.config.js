import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// During development every /api request is forwarded to the Express backend,
// so the browser never has to deal with CORS or a hard-coded backend address.
const target = process.env.VITE_PROXY_TARGET || 'http://localhost:5000'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target, changeOrigin: true } },
  },
  preview: {
    port: 5173,
    proxy: { '/api': { target, changeOrigin: true } },
  },
})
