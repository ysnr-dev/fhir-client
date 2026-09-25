// デモ用サンプル患者の投入(ターミナルから実行する入口)。生成の中身は src/demo-seed/ にあり、
// 画面と同じ組み立て関数で作ったリソースを backend(/fhir・/master)へ書き込む。
//
//   node scripts/dist/demo-seed.mjs --target dev            開発(http://localhost:3001)
//   node scripts/dist/demo-seed.mjs --target prod           本番(Render)
//   node scripts/dist/demo-seed.mjs --target dev --check    ログインと前提の確認だけ(書き込まない)
//   node scripts/dist/demo-seed.mjs --target dev --only diabetes,rectal
//   node scripts/dist/demo-seed.mjs --target dev --name-suffix テスト   試し流し(名に「テスト」を足す)
//
// ログイン ID とパスワードは実行時に聞く(パスワードは画面に出さない)。環境変数
// DEMO_SEED_LOGIN / DEMO_SEED_PASSWORD があればそれを使う。ビルドは docs/demo-seed.md。

import { createInterface } from "node:readline";
import { login } from "../src/api/authClient";
import { loadEnv } from "../src/demo-seed/base";
import { preflight, run, SCENARIOS, type ScenarioName } from "../src/demo-seed/index";

const TARGETS: Record<string, string> = {
  dev: "http://localhost:3001",
  prod: "https://ysnr-fhir-client-api.onrender.com",
};

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

/** 画面の相対パス(/fhir/...)を backend の URL に向け、セッションの Cookie を持ち回る。 */
function installFetch(base: string): void {
  const realFetch = globalThis.fetch.bind(globalThis);
  const cookies = new Map<string, string>();
  globalThis.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === "string" && input.startsWith("/") ? `${base}${input}` : input;
    const headers = new Headers(init.headers);
    if (cookies.size) headers.set("Cookie", [...cookies].map(([k, v]) => `${k}=${v}`).join("; "));
    const response = await realFetch(url, { ...init, headers });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";");
      const at = pair.indexOf("=");
      if (at > 0) cookies.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
    }
    return response;
  };
}

function ask(question: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      const write = (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput.bind(rl);
      (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
        if (s.startsWith(question)) write(question);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer);
    });
  });
}

async function main(): Promise<void> {
  const target = option("target") ?? "dev";
  const base = option("base-url") ?? TARGETS[target];
  if (!base) throw new Error(`--target は ${Object.keys(TARGETS).join(" / ")} のどちらか(または --base-url)`);
  const only = option("only")?.split(",").map((s) => s.trim()).filter(Boolean) as ScenarioName[] | undefined;
  for (const name of only ?? []) {
    if (!(name in SCENARIOS)) throw new Error(`シナリオ ${name} はありません(${Object.keys(SCENARIOS).join(", ")})`);
  }

  installFetch(base);
  console.log(`接続先: ${base}`);
  const loginId = process.env.DEMO_SEED_LOGIN || (await ask("ログイン ID: "));
  const password = process.env.DEMO_SEED_PASSWORD || (await ask("パスワード: ", true));
  const session = await login(loginId, password);
  if (!session.authenticated) throw new Error("ログインできませんでした");

  if (process.argv.includes("--check")) {
    const env = await loadEnv((message) => console.log(message));
    console.log(`ログイン OK: ${env.practitioner.name}`);
    console.log(`診療科: ${env.departments.map((d) => d.name).join("、")}`);
    console.log(`ベッド ${env.beds.length} 床 / 手術室: ${env.locations.filter((l) => l.name.includes("手術室")).map((l) => l.name).join("、") || "なし"}`);
    const missing = await preflight();
    console.log(missing.length ? `足りないマスタ:\n  ${missing.join("\n  ")}` : "必要なマスタはすべて揃っています");
    return;
  }

  await run(only, option("name-suffix") ?? "");
  console.log("完了しました");
}

main().catch((error: unknown) => {
  const outcome = (error as { outcome?: unknown }).outcome;
  console.error(`失敗しました: ${error instanceof Error ? error.message : String(error)}`);
  if (outcome) console.error(JSON.stringify(outcome, null, 2));
  process.exit(1);
});
