import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWakeup } from "../api/wakeup";

// backend も上流 FHIR サーバーも Render 無料枠で、~15 分アイドルでスピンダウンする。
// 起動には合わせて 1〜2 分かかることがあるので、ヘッダーから明示的に起こせるようにする。
const REQUEST_TIMEOUT_MS = 90_000; // backend 起動中はゲートウェイがリクエストを保留する
const POLL_INTERVAL_MS = 5_000;
const DEADLINE_MS = 180_000;
const READY_DISPLAY_MS = 8_000;

type State = "idle" | "waking" | "ready" | "failed";
// 起こす対象は 2 つ(backend → 上流 fhir-server)。どちらを待っているかを出す。
type Phase = "backend" | "upstream";

const LABELS: Record<Exclude<State, "waking">, string> = {
  idle: "サーバー起動",
  ready: "起動しました",
  failed: "起動できませんでした",
};

const WAKING_LABELS: Record<Phase, string> = {
  backend: "backend 起動中…",
  upstream: "FHIR サーバー起動中…",
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function WakeButton() {
  const [state, setState] = useState<State>("idle");
  const [phase, setPhase] = useState<Phase>("backend");
  const [elapsed, setElapsed] = useState(0);
  const runningRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // 起動待ちの経過秒。何も起きていないように見える時間が長いので出す。
  useEffect(() => {
    if (state !== "waking") return;

    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [state]);

  // 完了表示はしばらく出して自動的に元へ戻す。
  useEffect(() => {
    if (state !== "ready") return;

    const timer = window.setTimeout(() => setState("idle"), READY_DISPLAY_MS);
    return () => window.clearTimeout(timer);
  }, [state]);

  const wake = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setElapsed(0);
    setPhase("backend");
    setState("waking");

    try {
      const deadline = Date.now() + DEADLINE_MS;

      while (Date.now() < deadline) {
        // 失敗(= まだ起きていない / ゲートウェイが 502 を返した)は再試行の合図。
        const status = await fetchWakeup(REQUEST_TIMEOUT_MS).catch(() => null);
        if (!mountedRef.current) return;

        if (status?.upstream === "ready") {
          setState("ready");
          return;
        }

        // 応答が返った = backend は起きた。残りは上流 fhir-server の起動待ち。
        setPhase(status ? "upstream" : "backend");

        await sleep(POLL_INTERVAL_MS);
        if (!mountedRef.current) return;
      }

      setState("failed");
    } finally {
      runningRef.current = false;
    }
  }, []);

  const waking = state === "waking";
  const label = waking ? `${WAKING_LABELS[phase]} ${elapsed}秒` : LABELS[state];

  return (
    <button
      type="button"
      className={`wake-button wake-button--${state}`}
      onClick={wake}
      disabled={waking}
      title="Render 無料枠のサーバーは一定時間アクセスがないと休眠します。押すと backend と上流 FHIR サーバー(ysnr-fhir-server)の両方を起こします(1〜2 分かかることがあります)。"
      aria-live="polite"
    >
      <span className="wake-button__dot" aria-hidden="true" />
      {label}
    </button>
  );
}
