import { useState, type ReactNode } from "react";
import { useKarteCardHistory } from "../api/queries";
import type { HistoryCardItem } from "../fhir/karteCardHistory";
import { dateTimeLabel } from "../lib/dates";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";
import { VersionHistoryBody } from "./VersionHistoryBody";

// 診療記録以外のカルテカードの変更履歴。編集ごとに組み直したカードを版として並べ、
// 選んだ版の中身をカードの本文と同じ描き方で出す(描き方はタイムラインから受け取る)。
// 1 つ前の版との差分にも切り替えられる。

interface KarteCardHistoryModalProps {
  item: HistoryCardItem;
  renderBody: (item: HistoryCardItem) => ReactNode;
  onClose: () => void;
}

export function KarteCardHistoryModal({ item, renderBody, onClose }: KarteCardHistoryModalProps) {
  const { versions, isLoading, error } = useKarteCardHistory(item);
  const [selectedNo, setSelectedNo] = useState<number | null>(null);
  // 既定は最新版。読み込み前は versions が空なので選択は描画時に解決する。
  const selected = versions.find((v) => v.versionNo === selectedNo) ?? versions[0];
  const previous = selected && versions[versions.indexOf(selected) + 1];

  return (
    <Modal title="変更履歴" onClose={onClose} className="modal--wide">
      <ErrorBanner error={error} />
      {isLoading ? (
        <p>読み込み中...</p>
      ) : versions.length === 0 ? (
        !error && <p className="patient-table__empty">履歴がありません。</p>
      ) : (
        <div className="note-history">
          <ul className="note-history__versions">
            {versions.map((version, index) => {
              const isSelected = version === selected;
              return (
                <li key={version.versionNo}>
                  <button
                    type="button"
                    className={`note-history__version${isSelected ? " note-history__version--selected" : ""}`}
                    aria-pressed={isSelected}
                    onClick={() => setSelectedNo(version.versionNo)}
                  >
                    <span className="note-history__version-no">
                      第{version.versionNo}版{index === 0 && "(最新)"}
                    </span>
                    <span className="note-history__version-meta">{dateTimeLabel(version.lastModified)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {selected && (
            <VersionHistoryBody
              versionNo={selected.versionNo}
              previousVersionNo={previous?.versionNo}
              current={renderBody(selected.item)}
              previous={previous && renderBody(previous.item)}
            />
          )}
        </div>
      )}
    </Modal>
  );
}
