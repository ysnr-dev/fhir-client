// Render 無料枠のスピンダウンから明示的に起こすための API。
// backend の GET /wakeup は「backend は起きている」ことと、上流 FHIR サーバーの
// その瞬間の可否を返す(上流の起動待ちはしない)。
const WAKEUP_URL = "/wakeup";

export type UpstreamState = "ready" | "waking";

export interface WakeupStatus {
  backend: "ready";
  upstream: UpstreamState;
}

// backend 自体が休眠中だと、ゲートウェイは起動が終わるまでリクエストを保留する。
// 打ち切りが早すぎると起きかけを取りこぼすので、1 回の待ちを長めに取る。
export async function fetchWakeup(timeoutMs: number): Promise<WakeupStatus> {
  const res = await fetch(WAKEUP_URL, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) throw new Error(`wakeup failed with status ${res.status}`);

  return (await res.json()) as WakeupStatus;
}
