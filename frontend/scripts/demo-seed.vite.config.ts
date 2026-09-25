// デモ用サンプル患者の投入スクリプト(scripts/demo-seed.ts)を、Node で動く 1 ファイルにまとめる。
// アプリのビルド(vite.config.ts)とは別。依存もすべて取り込むので、出力だけで動く。
//
//   docker compose exec frontend npx vite build --config scripts/demo-seed.vite.config.ts
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    ssr: "scripts/demo-seed.ts",
    outDir: "scripts/dist",
    emptyOutDir: true,
    target: "node20",
    minify: false,
    rollupOptions: { output: { entryFileNames: "demo-seed.mjs", format: "es" } },
  },
  ssr: { noExternal: true, target: "node" },
  publicDir: false,
});
