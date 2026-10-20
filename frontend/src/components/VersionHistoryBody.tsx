import { useEffect, useState, type ReactNode } from "react";
import { useRenderedDiff } from "../hooks/useRenderedDiff";
import { VersionDiffRows } from "./VersionDiffView";

// 変更履歴の右側。選んだ版の内容と、1 つ前の版との差分を切り替えて出す。
// 切り替え(差分・変更箇所のみ)は版を選び直しても保つ(版を順に送りながら差分を追えるように)。
// 差分では変わった箇所を「前へ」「次へ」で順に送る。

const CHANGE_CONTEXT = 2;

interface VersionHistoryBodyProps {
  versionNo: number | string | undefined;
  previousVersionNo: number | string | undefined;
  current: ReactNode;
  /** 1 つ前の版の内容。最初の版では無い。 */
  previous: ReactNode | undefined;
}

export function VersionHistoryBody({ versionNo, previousVersionNo, current, previous }: VersionHistoryBodyProps) {
  const [diffMode, setDiffMode] = useState(false);
  const [changesOnly, setChangesOnly] = useState(true);
  const showDiff = diffMode && previous !== undefined;

  return (
    <div className="note-history__body">
      {showDiff ? (
        <VersionDiff
          before={previous}
          after={current}
          label={`第${previousVersionNo}版 → 第${versionNo}版`}
          changesOnly={changesOnly}
          onToggleChangesOnly={() => setChangesOnly((on) => !on)}
          onLeave={() => setDiffMode(false)}
        />
      ) : (
        <>
          <div className="note-history__toolbar">
            <button
              type="button"
              aria-pressed={false}
              disabled={previous === undefined}
              title={previous === undefined ? "前の版がありません" : undefined}
              onClick={() => setDiffMode(true)}
            >
              差分
            </button>
          </div>
          {current}
        </>
      )}
    </div>
  );
}

interface VersionDiffProps {
  before: ReactNode;
  after: ReactNode;
  label: string;
  changesOnly: boolean;
  onToggleChangesOnly: () => void;
  onLeave: () => void;
}

function VersionDiff({ before, after, label, changesOnly, onToggleChangesOnly, onLeave }: VersionDiffProps) {
  const diff = useRenderedDiff(before, after);
  const [focused, setFocused] = useState(0);
  // 版を選び直して差分が変わったら、最初の変更から送り直す。
  useEffect(() => setFocused(0), [diff.rows]);
  const count = diff.changes.length;

  return (
    <>
      <div className="note-history__toolbar">
        <button type="button" aria-pressed onClick={onLeave}>
          差分
        </button>
        <span className="note-history__compare">{label}</span>
        {count > 0 && (
          <span className="note-history__changes">
            <span className="note-history__compare">{`変更 ${focused + 1}/${count}`}</span>
            <button
              type="button"
              className="rp-card__compact-button"
              disabled={focused <= 0}
              onClick={() => setFocused((n) => Math.max(0, n - 1))}
            >
              前へ
            </button>
            <button
              type="button"
              className="rp-card__compact-button"
              disabled={focused >= count - 1}
              onClick={() => setFocused((n) => Math.min(count - 1, n + 1))}
            >
              次へ
            </button>
            <button
              type="button"
              className="rp-card__compact-button"
              aria-pressed={changesOnly}
              onClick={onToggleChangesOnly}
            >
              変更箇所のみ
            </button>
          </span>
        )}
      </div>
      {diff.sources}
      {diff.pending ? null : count === 0 ? (
        <p className="patient-table__empty">表示上の差分はありません。</p>
      ) : (
        <VersionDiffRows
          rows={diff.rows}
          changes={diff.changes}
          context={changesOnly ? CHANGE_CONTEXT : undefined}
          focusedChange={Math.min(focused, count - 1)}
        />
      )}
    </>
  );
}
