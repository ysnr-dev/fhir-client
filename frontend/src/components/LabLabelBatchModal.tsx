import { useIssueLabLabels, type LabWorklistRow } from "../api/queries";
import { groupBySpecimen, labOrderItems } from "../fhir/labOrderHelpers";
import { hasLabLabelTarget, type LabLabelScope } from "../fhir/labSpecimenHelpers";
import { labTaskStatus } from "../fhir/labTaskHelpers";
import { wardOf } from "../fhir/orderHeader";
import { WardBatchIssueModal } from "./WardBatchIssueModal";

// 検体検査一覧の「ラベル一括発行」。

/**
 * 範囲に入る管を持つオーダー。行の「ラベル発行」と同じく依頼済・受付済だけで、
 * 病棟を持たないオーダー(外来など)は wardIds に入らないので対象にならない。
 */
function labelTargets(rows: LabWorklistRow[], wardIds: string[], scope: LabLabelScope) {
  return rows.filter((row) => {
    const status = labTaskStatus(row.task);
    if (status !== "requested" && status !== "accepted") return false;
    if (!wardIds.includes(wardOf(row.order).wardId)) return false;
    const groups = groupBySpecimen(labOrderItems(row.order, row.itemRequests));
    return hasLabLabelTarget(groups, row.specimens, scope);
  });
}

export function LabLabelBatchModal({
  date,
  wards,
  rows,
  truncated,
  reloadRows,
  onClose,
}: {
  date: string;
  wards: { id: string; name: string }[];
  rows: LabWorklistRow[];
  truncated: boolean | undefined;
  /** 最新の 1 日ぶんを読み直す。 */
  reloadRows: () => Promise<LabWorklistRow[]>;
  onClose: () => void;
}) {
  const issueLabels = useIssueLabLabels();
  return (
    <WardBatchIssueModal
      title="ラベル一括発行"
      dateLabel={`検査日 ${date}`}
      wards={wards}
      rows={rows}
      truncated={truncated}
      targetsOf={labelTargets}
      reloadRows={reloadRows}
      issue={(targets, scope) => issueLabels.mutateAsync({ rows: targets, scope })}
      onClose={onClose}
    />
  );
}
