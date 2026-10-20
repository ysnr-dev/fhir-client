import { useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from "react";
import { useRenderedDiff } from "../hooks/useRenderedDiff";
import { visibleRows, type DiffRow, type DiffSegment } from "../lib/textDiff";

// 変更履歴の差分の行(useRenderedDiff で取った差分)を描く。変わらない行は薄く、
// 変わった行は濃く、太字の行(見出し)は太字のまま、字下げも版の描画どおりに出す。
// 変更箇所のみのときは、変わった行の前後と、そのかたまりの見出しだけを残す。

interface VersionDiffRowsProps {
  rows: DiffRow[];
  changes: number[];
  /** 指定すると、変わった行の前後この行数と見出しだけを残し、間の変わらない行は「…」に畳む。 */
  context?: number;
  /** この番号のかたまりが見える位置まで送る(印刷では送らない)。 */
  focusedChange?: number;
}

export function VersionDiffRows({ rows, changes, context, focusedChange }: VersionDiffRowsProps) {
  const focusRef = useRef<HTMLDivElement>(null);
  const visible = useMemo(() => visibleRows(rows, context), [rows, context]);
  const focusedRow = focusedChange === undefined ? undefined : changes[focusedChange];

  useEffect(() => {
    if (focusedRow !== undefined) focusRef.current?.scrollIntoView({ block: "nearest" });
  }, [rows, focusedRow]);

  const gap = (key: string) => (
    <div key={key} className="version-diff__row version-diff__row--gap">
      <span className="version-diff__mark" />
      <span className="version-diff__text">…</span>
    </div>
  );
  const elements: ReactNode[] = [];
  let hidden = false;
  rows.forEach((row, index) => {
    if (!visible[index]) {
      hidden = true;
      return;
    }
    if (hidden) {
      elements.push(gap(`gap-${index}`));
      hidden = false;
    }
    elements.push(
      <div
        key={index}
        ref={index === focusedRow ? focusRef : undefined}
        className={[
          "version-diff__row",
          `version-diff__row--${row.kind}`,
          row.whole && "version-diff__row--whole",
          row.strong && "version-diff__row--strong",
          index === focusedRow && "version-diff__row--focused",
        ]
          .filter(Boolean)
          .join(" ")}
        style={{ "--diff-indent": row.indent } as CSSProperties}
      >
        <span className="version-diff__mark" aria-label={MARK_LABELS[row.kind]}>
          {MARKS[row.kind]}
        </span>
        <span className="version-diff__text">{segmentNodes(row)}</span>
      </div>,
    );
  });
  if (hidden) elements.push(gap("gap-end"));
  return <div className="version-diff">{elements}</div>;
}

// 行の文字。変わった部分は mark、「ラベル: 値」の行のラベル部分は薄く描く。
function segmentNodes(row: DiffRow): ReactNode[] {
  const nodes: ReactNode[] = [];
  let offset = 0;
  const pushPiece = (segment: DiffSegment, text: string, label: boolean, key: string) => {
    const className = label ? "version-diff__label" : undefined;
    nodes.push(
      segment.changed ? (
        <mark key={key} className={`version-diff__changed${className ? ` ${className}` : ""}`}>
          {text}
        </mark>
      ) : (
        <span key={key} className={className}>
          {text}
        </span>
      ),
    );
  };
  row.segments.forEach((segment, index) => {
    const labelEnd = row.labelLength ?? 0;
    const start = offset;
    const end = offset + segment.text.length;
    offset = end;
    if (end <= labelEnd) {
      pushPiece(segment, segment.text, true, `${index}`);
    } else if (start >= labelEnd) {
      pushPiece(segment, segment.text, false, `${index}`);
    } else {
      pushPiece(segment, segment.text.slice(0, labelEnd - start), true, `${index}l`);
      pushPiece(segment, segment.text.slice(labelEnd - start), false, `${index}v`);
    }
  });
  return nodes;
}

const MARKS = { same: "", removed: "−", added: "+" } as const;
const MARK_LABELS = { same: undefined, removed: "削除", added: "追加" } as const;

interface VersionDiffViewProps {
  before: ReactNode;
  after: ReactNode;
  /** 変わった行の前後この行数だけを残し、間の変わらない行は畳む。 */
  context?: number;
}

/** 2 つの版の差分をそのまま出す(印刷用。送りや切り替えは持たない)。 */
export function VersionDiffView({ before, after, context }: VersionDiffViewProps) {
  const diff = useRenderedDiff(before, after);
  return (
    <>
      {diff.sources}
      {diff.pending ? null : diff.changes.length === 0 ? (
        <p className="patient-table__empty">表示上の差分はありません。</p>
      ) : (
        <VersionDiffRows rows={diff.rows} changes={diff.changes} context={context} />
      )}
    </>
  );
}
