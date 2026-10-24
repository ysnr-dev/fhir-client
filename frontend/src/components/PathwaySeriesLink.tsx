import type { ReactNode } from "react";

/**
 * 複数の病日に続く行(日をまたぐアウトカム・続く観察項目やタスク)のセルの中身。前の列から続いていれば左に、
 * 次の列へ続いていれば右に線を引き、続きの最後のセルは矢印で終える(紙のパスシートで日をまたいで引く矢印)。
 * 線はセルの余白まで伸ばして隣のセルとつなげる。続いていないセルは中身だけ。
 */
export function PathwaySeriesLink({ fromPrev, toNext, children }: { fromPrev: boolean; toNext: boolean; children: ReactNode }) {
  if (!fromPrev && !toNext) return <>{children}</>;
  return (
    <span className="pathway-sheet__series">
      <span
        className={
          fromPrev
            ? `pathway-sheet__link pathway-sheet__link--in${toNext ? "" : " pathway-sheet__link--end"}`
            : "pathway-sheet__link-spacer"
        }
        aria-hidden="true"
      />
      <span className="pathway-sheet__series-content">{children}</span>
      <span className={toNext ? "pathway-sheet__link pathway-sheet__link--out" : "pathway-sheet__link-spacer"} aria-hidden="true" />
    </span>
  );
}
