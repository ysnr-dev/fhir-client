import { useMemo, useState } from "react";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";
import { TruncatedNotice } from "./TruncatedNotice";

// 部門一覧の「一括発行」の共通部分。1 日の病棟ごとに未発行・発行済の件数を見せ、選んだ病棟の
// 帳票を 1 つの PDF にまとめて刷る。件数は 1 日ぶんの行から数え、一覧の絞り込みは効かせない。

export type WardBatchScope = "unissued" | "issued";

export function WardBatchIssueModal<Row>({
  title,
  dateLabel,
  wards,
  rows,
  truncated,
  targetsOf,
  reloadRows,
  issue,
  onClose,
}: {
  title: string;
  dateLabel: string;
  wards: { id: string; name: string }[];
  rows: Row[];
  /** rows が上限で欠けている。 */
  truncated: boolean | undefined;
  /** 選んだ病棟のうち、範囲に入る行。 */
  targetsOf: (rows: Row[], wardIds: string[], scope: WardBatchScope) => Row[];
  /** 最新の 1 日ぶんを読み直す。 */
  reloadRows: () => Promise<Row[]>;
  /** 対象の行をまとめて発行し、PDF を返す。 */
  issue: (targets: Row[], scope: WardBatchScope) => Promise<Blob>;
  onClose: () => void;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const counts = useMemo(
    () =>
      wards.map((ward) => ({
        ...ward,
        unissued: targetsOf(rows, [ward.id], "unissued").length,
        issued: targetsOf(rows, [ward.id], "issued").length,
      })),
    [wards, rows, targetsOf],
  );
  const selected = counts.filter((ward) => selectedIds.includes(ward.id));

  function toggle(wardId: string, checked: boolean) {
    setSelectedIds((ids) => (checked ? [...ids, wardId] : ids.filter((id) => id !== wardId)));
  }

  async function handleIssue(scope: WardBatchScope) {
    // 読み込みを待ってから開くとポップアップとして止められるので、先に空のタブを開いておく。
    const tab = window.open("", "_blank");
    setPending(true);
    setError(null);
    try {
      // 開いている間に別の端末が発行・中止していることがあるので、対象は読み直して決める。
      const targets = targetsOf(await reloadRows(), selectedIds, scope);
      if (targets.length === 0) {
        tab?.close();
        return;
      }
      const pdf = await issue(targets, scope);
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
    <Modal title={title} onClose={onClose}>
      <ErrorBanner error={error} />
      <TruncatedNotice show={truncated}>件数が多いため、一部のオーダーのみ対象です。</TruncatedNotice>
      <p>{dateLabel}</p>
      <table className="patient-table ward-batch-issue__table">
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
                <label className="ward-batch-issue__ward">
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
          onClick={() => handleIssue("unissued")}
          disabled={pending || !selected.some((ward) => ward.unissued > 0)}
        >
          発行
        </button>
        <button
          type="button"
          onClick={() => handleIssue("issued")}
          disabled={pending || !selected.some((ward) => ward.issued > 0)}
        >
          再発行
        </button>
      </div>
    </Modal>
  );
}
