import { useState } from "react";
import type { KarteImportantDay, KarteImportantDaySeverity } from "../api/masterClient";
import { useKarteImportantDayMutation } from "../api/masterQueries";
import { karteDayHeadingLabel } from "../fhir/karteTimeline";
import { ErrorBanner } from "./ErrorBanner";
import { KARTE_IMPORTANT_DAY_SEVERITIES } from "./karteImportantDay";
import { Modal } from "./Modal";

// カルテの日付カードのケバブから開く重要日の設定。重要度と理由を入れて保存する。
// 設定済みの日は「解除」で外せる。

export function KarteImportantDayModal({
  patientId,
  day,
  current,
  setByName,
  onClose,
}: {
  patientId: string;
  /** 診療日(YYYY-MM-DD)。 */
  day: string;
  /** その日の現在の設定。未設定なら undefined。 */
  current: KarteImportantDay | undefined;
  /** ログイン中の医療従事者の氏名(設定者として記録する)。 */
  setByName: string | null;
  onClose: () => void;
}) {
  const [severity, setSeverity] = useState<KarteImportantDaySeverity>(current?.severity ?? "high");
  const [comment, setComment] = useState(current?.comment ?? "");
  const mutation = useKarteImportantDayMutation(patientId);

  async function handleSave() {
    await mutation.mutateAsync({ day, severity, comment, setByName });
    onClose();
  }

  async function handleClear() {
    await mutation.mutateAsync({ day, severity: null, comment: "", setByName });
    onClose();
  }

  return (
    <Modal
      title={`重要日設定 - ${karteDayHeadingLabel(day)}`}
      onClose={onClose}
      className="modal--karte-important"
    >
      <div className="walk-in__fields karte-important-form">
        <label>
          重要度
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value as KarteImportantDaySeverity)}
            autoFocus
          >
            {KARTE_IMPORTANT_DAY_SEVERITIES.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="karte-important-form__comment">
          理由
          <input
            type="text"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={200}
          />
        </label>
      </div>

      <ErrorBanner error={mutation.error} />

      <div className="chart-editor__actions">
        <button type="button" onClick={handleSave} disabled={mutation.isPending}>
          保存
        </button>
        {current && (
          <button type="button" onClick={handleClear} disabled={mutation.isPending}>
            解除
          </button>
        )}
        <button type="button" onClick={onClose}>
          取消
        </button>
      </div>
    </Modal>
  );
}
