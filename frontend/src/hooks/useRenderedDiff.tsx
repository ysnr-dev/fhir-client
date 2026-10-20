import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { renderedLines, type RenderedLine } from "../lib/renderedLines";
import { changeStarts, diffLines, type DiffRow } from "../lib/textDiff";

// 変更履歴の差分。版の中身は種類ごとに描き方が違う(診療記録の本文、処方の RP、
// テンプレートの平文…)ので、比べる 2 つの版をいつもの描き方で画面外に描き、
// 描かれた行(renderedLines)どうしを比べる。描き方を種類ごとに文字へ直す処理を
// 別に持たずに済み、画面で見える内容とずれない。
//
// 中身の一部は描いた後に読み込まれる(シェーマ画像・マスタの名称など)ので、
// 画面外の描画が変わるたびに読み直す。画面外の描画は操作できないよう inert にする。

function useRenderedLines() {
  const ref = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<RenderedLine[]>([]);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const read = () => setLines(renderedLines(element));
    read();
    const observer = new MutationObserver(read);
    observer.observe(element, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);
  return { ref, lines };
}

export interface RenderedDiff {
  /** 画面外に描く 2 つの版。差分を出す場所の近くに置く。 */
  sources: ReactNode;
  rows: DiffRow[];
  /** 変わった行のかたまりごとの先頭の行番号。空なら表示上の差分が無い。 */
  changes: number[];
  /** 2 つの版の文字がまだ読めていない(描画前)。 */
  pending: boolean;
}

/** 2 つの版を画面外に描いて差分を取る。 */
export function useRenderedDiff(before: ReactNode, after: ReactNode): RenderedDiff {
  const beforeSource = useRenderedLines();
  const afterSource = useRenderedLines();
  const rows = useMemo(
    () => diffLines(beforeSource.lines, afterSource.lines),
    [beforeSource.lines, afterSource.lines],
  );
  const changes = useMemo(() => changeStarts(rows), [rows]);
  const sources = (
    <div className="version-diff__sources" inert>
      <div ref={beforeSource.ref}>{before}</div>
      <div ref={afterSource.ref}>{after}</div>
    </div>
  );
  return {
    sources,
    rows,
    changes,
    pending: beforeSource.lines.length === 0 && afterSource.lines.length === 0,
  };
}

