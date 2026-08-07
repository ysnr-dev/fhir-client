// Render 無料枠のスピンダウンから明示的に起こすための API。
// backend の GET /wakeup は「backend は起きている」ことと、上流 FHIR サーバーの
// その瞬間の可否を返す(上流の起動待ちはしない)。
const WAKEUP_URL = "/wakeup";

export type UpstreamState = "ready" | "waking";

export interface WakeupStatus {
  backend: "ready";
  upstream: UpstreamState;
  // 上流を起こすためにブラウザから直接叩く URL(backend が設定から組み立てて返す)。
  upstreamProbeUrl: string | null;
}

interface WakeupBody {
  backend: "ready";
  upstream: UpstreamState;
  upstream_probe_url?: string | null;
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

  const body = (await res.json()) as WakeupBody;

  return {
    backend: body.backend,
    upstream: body.upstream,
    upstreamProbeUrl: body.upstream_probe_url ?? null,
  };
}

// 上流 FHIR サーバーを起こす。
//
// これをブラウザからやるのが肝心で、backend 経由では起こせない。Render 上のサービス
// から *.onrender.com を叩くと内部経路に落ちるらしく、スピンダウン中のインスタンスの
// 起動トリガーにならない(実測: 2 分叩き続けても上流は寝たまま)。外部クライアントで
// あるブラウザが直接叩くと、ゲートウェイがリクエストを保留して起動が走る。
//
// no-cors なのでレスポンスは読めない(opaque)が、目的はリクエストを届けることだけ。
// 起きたかどうかの判定は /wakeup の upstream に任せる。
// コールド中は応答が保留されたまま timeoutMs で中断されるので、失敗は想定内。
export function pokeUpstream(probeUrl: string, timeoutMs: number): Promise<void> {
  return fetch(probeUrl, {
    mode: "no-cors",
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  }).then(
    () => undefined,
    () => undefined,
  );
}
