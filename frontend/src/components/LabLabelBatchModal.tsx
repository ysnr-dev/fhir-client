import { useMemo, useState } from "react";
import { useIssueLabLabels, type LabWorklistRow } from "../api/queries";
import { groupBySpecimen, labOrderItems } from "../fhir/labOrderHelpers";
import { hasLabLabelTarget, type LabLabelScope } from "../fhir/labSpecimenHelpers";
import { labTaskStatus } from "../fhir/labTaskHelpers";
import { wardOf } from "../fhir/orderHeader";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

// 検体検査一覧の「ラベル一括発行」。検査日の病棟ごとに未発行・発行済の件数を見せ、選んだ病棟の
// ラベルを 1 つの PDF にまとめて刷る。件数は 1 日ぶんの行から数え、一覧の絞り込みは効かせない。

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
  reloadRows,
  onClose,
}: {
  date: string;
  wards: { id: string; name: string }[];
  rows: LabWorklistRow[];
  /** 最新の 1 日ぶんを読み直す。 */
  reloadRows: () => Promise<LabWorklistRow[]>;
  onClose: () => void;
}) {
  const issueLabels = useIssueLabLabels();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const counts = useMemo(
    () =>
      wards.map((ward) => ({
        ...ward,
        unissued: labelTargets(rows, [ward.id], "unissued").length,
        issued: labelTargets(rows, [ward.id], "issued").length,
      })),
    [wards, rows],
  );
  const selected = counts.filter((ward) => selectedIds.includes(ward.id));

  function toggle(wardId: string, checked: boolean) {
    setSelectedIds((ids) => (checked ? [...ids, wardId] : ids.filter((id) => id !== wardId)));
  }

  async function issue(scope: LabLabelScope) {
    // 読み込みを待ってから開くとポップアップとして止められるので、先に空のタブを開いておく。
    const tab = window.open("", "_blank");
    setPending(true);
    setError(null);
    try {
      // 開いている間に別の端末が発行・中止していることがあるので、対象は読み直して決める。
      const targets = labelTargets(await reloadRows(), selectedIds, scope);
      if (targets.length === 0) {
        tab?.close();
        return;
      }
      const pdf = await issueLabels.mutateAsync({ rows: targets, scope });
      const url = URL.createObjectURL(new Blob([pdf], { type: "application/pdf" }));
      if (tab) tab.location.href = url;
      else window.open(url, "_blank");
      // 開いたタブが読み込み終えるまで URL を生かしておく。
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      onClose();
    } catch (err) {
      tab?.close();
      setError(err);
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal title="ラベル一括発行" onClose={onClose}>
      <ErrorBanner error={error} />
      <p>{`検査日 ${date}`}</p>
      <table className="patient-table lab-label-batch__table">
        <thead>
          <tr>
            <th>病棟</th>
            <th>未発行</th>
            <th>発行済</th>
          </tr>
        </thead>
        <tbody>
          {counts.map((ward) => (
            <tr key={ward.id}>
              <td>
                <label className="lab-label-batch__ward">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(ward.id)}
                    disabled={ward.unissued === 0 && ward.issued === 0}
                    onChange={(e) => toggle(ward.id, e.target.checked)}
                  />
                  {ward.name}
                </label>
              </td>
              <td>{`${ward.unissued} 件`}</td>
              <td>{`${ward.issued} 件`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="plain-text-modal__actions">
        <button type="button" onClick={onClose} disabled={pending}>
          キャンセル
        </button>
        <button
          type="button"
          onClick={() => issue("unissued")}
          disabled={pending || !selected.some((ward) => ward.unissued > 0)}
        >
          発行
        </button>
        <button
          type="button"
          onClick={() => issue("issued")}
          disabled={pending || !selected.some((ward) => ward.issued > 0)}
        >
          再発行
        </button>
      </div>
    </Modal>
  );
}
