import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { diffText, type DiffRow } from "../lib/textDiff";

// 変更履歴の差分表示。版の中身は種類ごとに描き方が違う(診療記録の本文、処方の RP、
// テンプレートの平文…)ので、比べる 2 つの版をいつもの描き方で画面外に描き、
// 表示された文字(innerText)どうしを行で比べる。描き方を種類ごとに文字へ直す処理を
// 別に持たずに済み、画面で見える内容とずれない。
//
// 中身の一部は描いた後に読み込まれる(シェーマ画像・マスタの名称など)ので、
// 画面外の描画が変わるたびに読み直す。画面外の描画は操作できないよう inert にする。

interface VersionDiffViewProps {
  before: ReactNode;
  after: ReactNode;
  /** 版を選び直したら最初の変更まで送る(印刷では送らない)。 */
  autoScroll?: boolean;
  /** 指定すると、変わった行の前後この行数だけを残し、間の変わらない行は「…」に畳む。 */
  context?: number;
}

function useRenderedText() {
  const ref = useRef<HTMLDivElement>(null);
  const [text, setText] = useState("");
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const read = () => setText(element.innerText);
    read();
    const observer = new MutationObserver(read);
    observer.observe(element, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);
  return { ref, text };
}

export function VersionDiffView({ before, after, autoScroll = true, context }: VersionDiffViewProps) {
  const beforeSource = useRenderedText();
  const afterSource = useRenderedText();
  const rows = useMemo(
    () => diffText(beforeSource.text, afterSource.text),
    [beforeSource.text, afterSource.text],
  );
  const firstChangeRef = useRef<HTMLDivElement>(null);
  const firstChange = rows.findIndex((row) => row.kind !== "same");
  const visible = useMemo(() => visibleRows(rows, context), [rows, context]);

  // 版を選び直したら、最初の変更が見える位置まで送る。
  useEffect(() => {
    if (autoScroll) firstChangeRef.current?.scrollIntoView({ block: "nearest" });
  }, [rows, firstChange, autoScroll]);

  return (
    <>
      <div className="version-diff__sources" inert>
        <div ref={beforeSource.ref}>{before}</div>
        <div ref={afterSource.ref}>{after}</div>
      </div>
      {!beforeSource.text && !afterSource.text ? null : firstChange < 0 ? (
        <p className="patient-table__empty">表示上の差分はありません。</p>
      ) : (
        <div className="version-diff">
          {rows.map((row, index) =>
            !visible[index] ? (
              visible[index - 1] !== false && (
                <div key={index} className="version-diff__row version-diff__row--gap">
                  <span className="version-diff__mark" />
                  <span className="version-diff__text">…</span>
                </div>
              )
            ) : (
              <div
                key={index}
                ref={index === firstChange ? firstChangeRef : undefined}
                className={`version-diff__row version-diff__row--${row.kind}`}
              >
                <span className="version-diff__mark" aria-label={MARK_LABELS[row.kind]}>
                  {MARKS[row.kind]}
                </span>
                <span className="version-diff__text">
                  {row.segments.map((segment, segmentIndex) =>
                    segment.changed ? (
                      <mark key={segmentIndex} className="version-diff__changed">
                        {segment.text}
                      </mark>
                    ) : (
                      <span key={segmentIndex}>{segment.text}</span>
                    ),
                  )}
                </span>
              </div>
            ),
          )}
        </div>
      )}
    </>
  );
}

// 行ごとに出すかどうか。context が無ければすべて出す。
function visibleRows(rows: DiffRow[], context: number | undefined): boolean[] {
  if (context === undefined) return rows.map(() => true);
  const visible = rows.map(() => false);
  rows.forEach((row, index) => {
    if (row.kind === "same") return;
    for (let near = Math.max(0, index - context); near <= Math.min(rows.length - 1, index + context); near += 1) {
      visible[near] = true;
    }
  });
  return visible;
}

const MARKS = { same: "", removed: "−", added: "+" } as const;
const MARK_LABELS = { same: undefined, removed: "削除", added: "追加" } as const;
