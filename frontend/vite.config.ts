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
      // 前方一致だと SPA ルート /master-import まで転送されるため、API の /master/ 配下に限定する
      '^/master/': {
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
      '/auth': {
        target: process.env.VITE_BACKEND_PROXY_TARGET ?? 'http://localhost:3001',
        changeOrigin: true,
      },
      // 自院設定の参照 API。SPA ルートの /facility-settings(ハイフン)とは
      // 別パスなので、アンダースコアちょうどに限定して転送する。
      '^/facility_settings$': {
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
