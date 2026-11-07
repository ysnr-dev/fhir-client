import { useCallback } from "react";
import { useIssuePrescriptions, type RxWorklistRow } from "../api/queries";
import { wardOf } from "../fhir/orderHeader";
import { isBroughtPrescription } from "../fhir/prescriptionHelpers";
import { regimenOrderOf } from "../fhir/regimenOrderHelpers";
import { rxPrescriptionIssueOf, rxTaskStatus } from "../fhir/rxTaskHelpers";
import { WardBatchIssueModal, type WardBatchScope } from "./WardBatchIssueModal";

// 処方一覧の「処方箋一括発行」。

/**
 * 範囲に入るオーダー。未発行・発行済は行の「処方箋発行」「処方箋再発行」と同じで、病棟を持たない
 * オーダー(外来など)は wardIds に入らないので対象にならない。持参と医薬品の無いオーダーは
 * 刷るものが無いので外す。休止中のレジメンの日オーダーは一括では印が見えないので外し、刷るなら行から刷る。
 */
function prescriptionTargets(
  rows: RxWorklistRow[],
  wardIds: string[],
  scope: WardBatchScope,
  heldRegimenIds: Set<string>,
) {
  return rows.filter((row) => {
    if (rxPrescriptionIssueOf(rxTaskStatus(row.task)) !== scope) return false;
    if (!wardIds.includes(wardOf(row.order).wardId)) return false;
    if (isBroughtPrescription(row.order) || row.medicationRequests.length === 0) return false;
    const regimen = regimenOrderOf(row.order);
    return !(regimen && heldRegimenIds.has(regimen.regimenSrId));
  });
}

export function RxBatchIssueModal({
  date,
  wards,
  rows,
  truncated,
  heldRegimenIds,
  reloadRows,
  onClose,
}: {
  date: string;
  wards: { id: string; name: string }[];
  rows: RxWorklistRow[];
  truncated: boolean | undefined;
  /** 休止中の適用ヘッダ id(§7.6 A-8)。 */
  heldRegimenIds: Set<string>;
  /** 最新の 1 日ぶんを読み直す。 */
  reloadRows: () => Promise<RxWorklistRow[]>;
  onClose: () => void;
}) {
  const issuePrescriptions = useIssuePrescriptions();
  const targetsOf = useCallback(
    (targetRows: RxWorklistRow[], wardIds: string[], scope: WardBatchScope) =>
      prescriptionTargets(targetRows, wardIds, scope, heldRegimenIds),
    [heldRegimenIds],
  );
  return (
    <WardBatchIssueModal
      title="処方箋一括発行"
      dateLabel={`処方日 ${date}`}
      wards={wards}
      rows={rows}
      truncated={truncated}
      targetsOf={targetsOf}
      reloadRows={reloadRows}
      issue={(targets) => issuePrescriptions.mutateAsync(targets)}
      onClose={onClose}
    />
  );
}
