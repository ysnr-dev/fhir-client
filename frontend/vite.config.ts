import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // cornerstone(DICOM ビューア)の画像ローダーは、復号用の Web Worker と wasm を
  // 自分のファイルからの相対 URL で読む。依存の事前バンドルにかけるとその URL が
  // 壊れるので対象から外す。外すとその依存も素通しになるので、次の 2 種類は名指しで
  // 事前バンドルに戻す。
  // - dicom-parser と復号の codec(emscripten の出力): CommonJS で、ブラウザはそのまま読めない
  // - @cornerstonejs/metadata: core も使う。素通しだと core 側(事前バンドル内)と別の実体に
  //   なり、ローダーが登録した画像の属性を core が引けなくなる
  optimizeDeps: {
    exclude: ['@cornerstonejs/dicom-image-loader'],
    include: [
      'dicom-parser',
      '@cornerstonejs/core',
      '@cornerstonejs/tools',
      '@cornerstonejs/core > @cornerstonejs/metadata',
      '@cornerstonejs/dicom-image-loader > @cornerstonejs/codec-charls/decodewasmjs',
      '@cornerstonejs/dicom-image-loader > @cornerstonejs/codec-libjpeg-turbo-8bit/decodewasmjs',
      '@cornerstonejs/dicom-image-loader > @cornerstonejs/codec-openjpeg/decodewasmjs',
      '@cornerstonejs/dicom-image-loader > @cornerstonejs/codec-openjph/wasmjs',
      '@cornerstonejs/dicom-image-loader > pako',
      '@cornerstonejs/dicom-image-loader > comlink',
    ],
  },
  worker: {
    format: 'es',
  },
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
      // 取り込んだ DICOM の保存・配信。SPA 側に /imaging で始まるルートは無い。
      '/imaging': {
        target: process.env.VITE_BACKEND_PROXY_TARGET ?? 'http://localhost:3001',
        changeOrigin: true,
      },
      '/reports': {
        target: process.env.VITE_BACKEND_PROXY_TARGET ?? 'http://localhost:3001',
        changeOrigin: true,
      },
      // レセコン連携。SPA ルートとぶつからないよう /integrations/ 配下に限定する。
      '^/integrations/': {
        target: process.env.VITE_BACKEND_PROXY_TARGET ?? 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
