import { useState, type ReactNode } from "react";
import { VersionDiffView } from "./VersionDiffView";

// 変更履歴の右側。選んだ版の内容と、1 つ前の版との差分を切り替えて出す。
// 切り替えは版を選び直しても保つ(版を順に送りながら差分を追えるように)。

interface VersionHistoryBodyProps {
  versionNo: number | string | undefined;
  previousVersionNo: number | string | undefined;
  current: ReactNode;
  /** 1 つ前の版の内容。最初の版では無い。 */
  previous: ReactNode | undefined;
}

export function VersionHistoryBody({ versionNo, previousVersionNo, current, previous }: VersionHistoryBodyProps) {
  const [diffMode, setDiffMode] = useState(false);
  const showDiff = diffMode && previous !== undefined;

  return (
    <div className="note-history__body">
      <div className="note-history__toolbar">
        <button
          type="button"
          aria-pressed={showDiff}
          disabled={previous === undefined}
          title={previous === undefined ? "前の版がありません" : undefined}
          onClick={() => setDiffMode((on) => !on)}
        >
          差分
        </button>
        {showDiff && (
          <span className="note-history__compare">{`第${previousVersionNo}版 → 第${versionNo}版`}</span>
        )}
      </div>
      {showDiff ? <VersionDiffView before={previous} after={current} /> : current}
    </div>
  );
}
