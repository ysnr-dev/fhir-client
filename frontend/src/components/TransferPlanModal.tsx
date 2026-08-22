import { useState } from "react";
import {
  useSelfDepartments,
  useUpdateEncounter,
  useWardGrid,
  useWardOptions,
} from "../api/queries";
import { departmentDisplayName } from "../fhir/departmentHelpers";
import {
  buildTransferPlanEncounter,
  encounterTransferPlan,
  validateTransferPlan,
} from "../fhir/encounterHelpers";
import { displayName } from "../fhir/patientHelpers";
import { today } from "../lib/dates";
import { resolveBedSelection, type BedRoomIds } from "../fhir/wardHelpers";
import { BedRoomSelects } from "./BedRoomSelects";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

// 転科・転棟予定。「いつ・どの病棟(病室・ベッド)へ・どの科で移るか」の予定を
// 入院(Encounter)にメモする。予定は 1 件だけで、登録し直すと置き換わる。
// ベッドの空きは実施のときに確かめるものなので、ここでは空床に絞らない。

export function TransferPlanModal({
  encounter,
  patient,
  onClose,
}: {
  encounter: fhir4.Encounter;
  patient?: fhir4.Patient;
  onClose: () => void;
}) {
  const existing = encounterTransferPlan(encounter);
  const [date, setDate] = useState(existing?.date || today());
  const [place, setPlace] = useState<BedRoomIds>({
    wardId: existing?.wardId ?? "",
    roomId: existing?.roomId ?? "",
    bedId: existing?.bedId ?? "",
  });
  const [departmentId, setDepartmentId] = useState(existing?.departmentId ?? "");
  const [validationError, setValidationError] = useState<string | null>(null);

  const wardOptions = useWardOptions();
  const grid = useWardGrid(place.wardId || undefined);
  const departments = useSelfDepartments();
  const save = useUpdateEncounter();

  function handleSubmit() {
    const selection = resolveBedSelection(wardOptions.wards, grid, place);
    const department = departments.departments.find((d) => d.id === departmentId);
    const plan = {
      date,
      wardId: selection.wardId,
      wardName: selection.wardName,
      roomId: selection.roomId,
      roomName: selection.roomName,
      bedId: selection.bedId,
      bedName: selection.bedName,
      departmentId,
      departmentName: department ? departmentDisplayName(department) : "",
    };
    const error = validateTransferPlan(plan);
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError(null);
    save.mutate(buildTransferPlanEncounter(encounter, plan), { onSuccess: onClose });
  }

  function handleClear() {
    if (!window.confirm("転科・転棟予定を取り消します。よろしいですか?")) return;
    save.mutate(buildTransferPlanEncounter(encounter, null), { onSuccess: onClose });
  }

  return (
    <Modal title="転科・転棟予定" onClose={onClose}>
      <ErrorBanner error={wardOptions.error ?? grid.error ?? departments.error} />
      <ErrorBanner error={save.error} />
      {validationError && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}

      <div className="walk-in">
        <div className="walk-in__patient">
          <span>{patient ? displayName(patient) : "(患者不明)"}</span>
        </div>

        <div className="walk-in__fields">
          <label>
            転科・転棟予定日(必須)
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <BedRoomSelects
            wards={wardOptions.wards}
            grid={grid}
            value={place}
            onChange={setPlace}
            wardLabel="移動先の病棟(必須)"
            roomLabel="移動先の病室"
            bedLabel="移動先のベッド"
          />
          <label>
            診療科
            <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              <option value="">未指定</option>
              {departments.departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {departmentDisplayName(department)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="walk-in__actions">
          <button type="button" onClick={handleSubmit} disabled={save.isPending}>
            {save.isPending ? "登録中..." : existing ? "予定を更新" : "予定を登録"}
          </button>
          {existing && (
            <button type="button" onClick={handleClear} disabled={save.isPending}>
              予定を取消
            </button>
          )}
          <button type="button" onClick={onClose} disabled={save.isPending}>
            キャンセル
          </button>
        </div>
      </div>
    </Modal>
  );
}
