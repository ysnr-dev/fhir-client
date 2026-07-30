import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      '/fhir': {
        target: process.env.VITE_BACKEND_PROXY_TARGET ?? 'http://localhost:3001',
        changeOrigin: true,
      },
      '/master': {
        target: process.env.VITE_BACKEND_PROXY_TARGET ?? 'http://localhost:3001',
        changeOrigin: true,
      },
      '/wakeup': {
        target: process.env.VITE_BACKEND_PROXY_TARGET ?? 'http://localhost:3001',
        changeOrigin: true,
      },
      '/admin': {
        target: process.env.VITE_BACKEND_PROXY_TARGET ?? 'http://localhost:3001',
        changeOrigin: true,
      },
      '/reports': {
        target: process.env.VITE_BACKEND_PROXY_TARGET ?? 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
