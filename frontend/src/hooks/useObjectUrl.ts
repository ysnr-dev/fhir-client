import { useEffect, useState } from "react";

// Blob を <img> や <a download> に渡せる URL にする。dataURL にしないのは、
// 大きなファイルで文字列が肥大するため。blob が変わったときと画面から外れたときに
// 取り消して、URL を抱えたままにしない。
//
// URL の生成を useMemo ではなく effect の中で行うのは、StrictMode が effect を
// 「実行 → 後始末 → 実行」と 2 度回すため。useMemo で作った 1 つの URL を返して
// いると、最初の後始末でそれが取り消され、描画に使う URL が死んだまま残る
// (キャッシュ済みの blob で初回から値がある場合に必ず起きる)。
export function useObjectUrl(blob: Blob | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);

  return url;
}
