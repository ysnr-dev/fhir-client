import { useState } from "react";
import {
  useBedWardIndex,
  useDpcRecodingDueTasks,
  useSelfDepartments,
  useUpdateEncounter,
  useWardGrid,
} from "../api/queries";
import { departmentDisplayName } from "../fhir/departmentHelpers";
import { dpcTransferRecodingDueEntry } from "../fhir/dpcRecodingDueHelpers";
import {
  buildTransferExecutedEncounter,
  encounterBedId,
  encounterBedLabel,
  encounterPatientId,
  validateTransferExecute,
  type TransferPlan,
} from "../fhir/encounterHelpers";
import { displayName } from "../fhir/patientHelpers";
import { bedDisplayName, resolveBedSelection, type BedRoomIds } from "../fhir/wardHelpers";
import { today } from "../lib/dates";
import { BedRoomSelects } from "./BedRoomSelects";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

// 転科・転棟の実施。予定の内容を初期値にするが、床は実施時点で空いているものから
// 選び直す(予定していた床が埋まっていることがある)。病棟は予定で決まっているので
// 選ばせず、その病棟の病室・ベッドだけを出す。
// 病棟が変わるときは、DPC の診断群分類を転棟時で決め直す督促を主治医あてに出す
// (その入院に未対応の督促が既にあれば重ねない)。

export function TransferExecuteModal({
  encounter,
  patient,
  plan,
  occupiedBedIds,
  onClose,
}: {
  encounter: fhir4.Encounter;
  patient?: fhir4.Patient;
  plan: TransferPlan;
  /** いま入院中の患者が居るベッドの id。空床のみ選ばせるのに使う。 */
  occupiedBedIds: Set<string>;
  onClose: () => void;
}) {
  const [date, setDate] = useState(today);
  const [place, setPlace] = useState<BedRoomIds>({
    wardId: plan.wardId,
    roomId: plan.roomId,
    bedId: plan.bedId,
  });
  const [departmentId, setDepartmentId] = useState(plan.departmentId);
  const [validationError, setValidationError] = useState<string | null>(null);

  const grid = useWardGrid(plan.wardId || undefined);
  const departments = useSelfDepartments();
  const execute = useUpdateEncounter();
  const bedWardIndex = useBedWardIndex();
  const { bedWards } = bedWardIndex;
  const recodingDue = useDpcRecodingDueTasks(encounter.id);

  function handleSubmit() {
    const selection = resolveBedSelection([], grid, place, occupiedBedIds);
    const error = validateTransferExecute(encounter, date, selection.bedId);
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError(null);

    const department = departments.departments.find((d) => d.id === departmentId);
    const bedLabel = selection.bed
      ? bedDisplayName(selection.bed, selection.roomName)
      : selection.bedName;
    const transferred = buildTransferExecutedEncounter(
      encounter,
      {
        bedId: selection.bedId,
        bedLabel,
        departmentId,
        departmentName: department ? departmentDisplayName(department) : "",
      },
      date,
    );
    const fromWard = bedWards.get(encounterBedId(encounter) ?? "");
    const patientId = encounterPatientId(encounter);
    const recodingEntry =
      fromWard && fromWard.wardId !== plan.wardId && patientId && !(recodingDue.data ?? []).length
        ? dpcTransferRecodingDueEntry(transferred, patientId, {
            date,
            fromWard: fromWard.wardName,
            toWard: plan.wardName,
          })
        : null;
    execute.mutate(
      { encounter: transferred, extraEntries: recodingEntry ? [recodingEntry] : [] },
      { onSuccess: onClose },
    );
  }

  return (
    <Modal title="転科・転棟実施" onClose={onClose}>
      <ErrorBanner error={grid.error ?? departments.error ?? bedWardIndex.error ?? recodingDue.error} />
      <ErrorBanner error={execute.error} />
      {validationError && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}

      <div className="walk-in">
        <div className="walk-in__patient">
          <span>{patient ? displayName(patient) : "(患者不明)"}</span>
          <span>
            {encounterBedLabel(encounter)} → {plan.wardName}
          </span>
        </div>

        <div className="walk-in__fields">
          <label>
            転科・転棟日(必須)
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label>
            移動先の病棟
            <input type="text" value={plan.wardName} readOnly />
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
          <label>
            診療科
            <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              <option value="">変更しない</option>
              {departments.departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {departmentDisplayName(department)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="walk-in__actions">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={execute.isPending || bedWardIndex.isPending || recodingDue.isPending}
          >
            {execute.isPending ? "登録中..." : "転科・転棟実施"}
          </button>
          <button type="button" onClick={onClose} disabled={execute.isPending}>
            キャンセル
          </button>
        </div>
      </div>
    </Modal>
  );
}
