import { dateTimeLabel } from "../lib/dates";
import { useState } from "react";
import { useClinicalNoteHistory } from "../api/queries";
import { clinicalNoteAttestation, statusLabel } from "../fhir/clinicalNoteHelpers";
import { ClinicalNoteDetailPanel } from "./ClinicalNoteDetailPanel";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";
import { VersionHistoryBody } from "./VersionHistoryBody";

// 診療記録の変更履歴。上流の _history から版の一覧を取り、選んだ版の内容を出す
// (「以前はどう書いてあったか」を辿れるようにする)。版そのものを描くので、
// 内容の描画は現在の記録と同じ ClinicalNoteDetailPanel を使う。1 つ前の版との差分にも切り替えられる。

interface ClinicalNoteHistoryModalProps {
  noteId: string;
  onClose: () => void;
}

function versionTime(note: fhir4.Composition): string {
  return dateTimeLabel(note.meta?.lastUpdated);
}

export function ClinicalNoteHistoryModal({ noteId, onClose }: ClinicalNoteHistoryModalProps) {
  const { versions, isLoading, error } = useClinicalNoteHistory(noteId, true);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  // 既定は最新版。読み込み前は versions が空なので選択は描画時に解決する。
  const selected =
    versions.find((v) => v.meta?.versionId === selectedVersionId) ?? versions[0];
  const previous = selected && versions[versions.indexOf(selected) + 1];

  return (
    <Modal title="変更履歴" onClose={onClose} className="modal--wide">
      <ErrorBanner error={error} />
      {isLoading ? (
        <p>読み込み中...</p>
      ) : versions.length === 0 ? (
        <p className="patient-table__empty">履歴がありません。</p>
      ) : (
        <div className="note-history">
          <ul className="note-history__versions">
            {versions.map((version, index) => {
              const versionId = version.meta?.versionId ?? "";
              const isSelected = version === selected;
              const attestation = clinicalNoteAttestation(version);
              return (
                <li key={versionId || index}>
                  <button
                    type="button"
                    className={`note-history__version${isSelected ? " note-history__version--selected" : ""}`}
                    aria-pressed={isSelected}
                    onClick={() => setSelectedVersionId(versionId)}
                  >
                    <span className="note-history__version-no">
                      第{versionId || index + 1}版{index === 0 && "(最新)"}
                    </span>
                    <span className="note-history__version-meta">{versionTime(version)}</span>
                    <span className="note-history__version-meta">
                      {statusLabel(version.status)}
                      {attestation?.name && ` / ${attestation.name}`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {selected && (
            <VersionHistoryBody
              versionNo={selected.meta?.versionId}
              previousVersionNo={previous?.meta?.versionId}
              current={<ClinicalNoteDetailPanel note={selected} />}
              previous={previous && <ClinicalNoteDetailPanel note={previous} />}
            />
          )}
        </div>
      )}
    </Modal>
  );
}
