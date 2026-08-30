import { useEffect, useState } from "react";

/**
 * 現在時刻。enabled の間は intervalMs ごとに更新する(既定 1 分)。
 * 病棟の指示簿の「実施予定」のように、開きっぱなしでも時間の経過に追従したい画面で使う。
 * データを引き直すわけではなく、手元の予定と実施の突き合わせを計算し直すだけ。
 */
export function useNow(enabled: boolean, intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!enabled) return;
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(timer);
  }, [enabled, intervalMs]);

  return now;
}
