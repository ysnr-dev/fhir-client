import { useState } from "react";
import { useUpdateEncounter, useWardGrid } from "../api/queries";
import {
  buildBedTransferEncounter,
  validateBedTransfer,
} from "../fhir/encounterHelpers";
import { displayName } from "../fhir/patientHelpers";
import { bedDisplayName, resolveBedSelection, type BedRoomIds } from "../fhir/wardHelpers";
import { today } from "../lib/dates";
import { BedRoomSelects } from "./BedRoomSelects";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

// 転室・転床。同じ病棟の空いている床へ移す(病棟をまたぐ移動は転科・転棟予定で
// 立ててから、実務上は退院・再入院ではなくこの画面の運用で移すことになるが、
// まずは病棟内の移動だけを直接の操作にする)。

export function BedTransferModal({
  encounter,
  patient,
  wardId,
  currentBedLabel,
  occupiedBedIds,
  onClose,
}: {
  encounter: fhir4.Encounter;
  patient?: fhir4.Patient;
  /** いま表示している病棟。移動先はこの病棟の中から選ぶ。 */
  wardId: string;
  currentBedLabel: string;
  /** いま入院中の患者が居るベッドの id(自分の床も含む)。空床のみ選ばせる。 */
  occupiedBedIds: Set<string>;
  onClose: () => void;
}) {
  const [date, setDate] = useState(today);
  const [place, setPlace] = useState<BedRoomIds>({ wardId, roomId: "", bedId: "" });
  const [validationError, setValidationError] = useState<string | null>(null);

  const grid = useWardGrid(wardId || undefined);
  const transfer = useUpdateEncounter();

  function handleSubmit() {
    const selection = resolveBedSelection([], grid, place, occupiedBedIds);
    const error = validateBedTransfer(encounter, {
      date,
      roomId: selection.roomId,
      bedId: selection.bedId,
    });
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError(null);

    const bedLabel = selection.bed
      ? bedDisplayName(selection.bed, selection.roomName)
      : selection.bedName;
    transfer.mutate(buildBedTransferEncounter(encounter, selection.bedId, bedLabel, date), {
      onSuccess: onClose,
    });
  }

  return (
    <Modal title="転室・転床" onClose={onClose}>
      <ErrorBanner error={grid.error} />
      <ErrorBanner error={transfer.error} />
      {validationError && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}

      <div className="walk-in">
        <div className="walk-in__patient">
          <span>{patient ? displayName(patient) : "(患者不明)"}</span>
          <span>{currentBedLabel}</span>
        </div>

        <div className="walk-in__fields">
          <label>
            転室・転床日(必須)
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <BedRoomSelects
            wards={[]}
            grid={grid}
            value={place}
            onChange={setPlace}
            showWard={false}
            roomLabel="移動先の病室(必須)"
            bedLabel="移動先のベッド(必須)"
            occupiedBedIds={occupiedBedIds}
          />
        </div>

        <div className="walk-in__actions">
          <button type="button" onClick={handleSubmit} disabled={transfer.isPending}>
            {transfer.isPending ? "登録中..." : "転室・転床"}
          </button>
          <button type="button" onClick={onClose} disabled={transfer.isPending}>
            キャンセル
          </button>
        </div>
      </div>
    </Modal>
  );
}
