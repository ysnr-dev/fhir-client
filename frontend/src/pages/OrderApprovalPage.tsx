import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useCurrentPractitioner } from "../api/authQueries";
import { useApproveOrderProvenances, usePendingApprovals } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import {
  PatientKana,
  PatientProfileCells,
  PatientProfileHeadCells,
} from "../components/PatientRowCells";
import { KARTE_KIND_LABELS, orderKindOf } from "../fhir/karteTimeline";
import { displayName, patientNumberOf } from "../fhir/patientHelpers";
import { orderContextSummary, prescriptionRequester } from "../fhir/prescriptionHelpers";
import type { PendingApprovalRow } from "../fhir/provenanceHelpers";
import { orderDay } from "../fhir/shared";
import { KARTE_DETAIL_PARAM, KARTE_TAB_PARAM, formatKarteDetail } from "../karteUrl";
import { dateTimeSecondsLabel } from "../lib/dates";
import { useReturnLinkState } from "../returnTo";

// オーダー承認(診療業務)。
//
// 医師以外が指示医師を選んで入力(代行入力)したオーダーを、指示医師本人が確認して承認する
// 画面。ログイン中の医師あての承認待ち(自分が author で署名の無い来歴)だけを出す。
// 行の単位はオーダーではなく **活動**(登録・編集)で、承認済みのオーダーを代行者が編集すると
// その編集ぶんがまた並ぶ(readme「代行入力の記録と承認」)。
//
// 内容の確認はカルテの詳細モーダルで行う(種別ごとの詳細表示をここに複製しない)。
// 詳細モーダルにも同じ承認ボタンがあるので、確認してそのまま承認できる。
// ここから直接承認するのは、内容を既に把握している(口頭指示を出した本人)場合の近道。

export function OrderApprovalPage() {
  const { practitionerId } = useCurrentPractitioner();
  const pending = usePendingApprovals(practitionerId);
  const approve = useApproveOrderProvenances();
  const linkState = useReturnLinkState();

  // 列が多いのでこの画面だけ幅を広げる(他科依頼一覧と同じ)。
  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  const rows = useMemo(() => pending.data?.rows ?? [], [pending.data]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // 読み直しで消えた行(承認済み)を選択から外す。
  const selected = rows.filter((row) => selectedIds.has(row.provenance.id ?? ""));

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelectedIds(
      selected.length === rows.length
        ? new Set()
        : new Set(rows.map((row) => row.provenance.id ?? "")),
    );
  }

  function approveRows(target: PendingApprovalRow[]) {
    approve.mutate(
      target.map((row) => row.provenance),
      { onSuccess: () => setSelectedIds(new Set()) },
    );
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>オーダー承認</h1>
        <button
          type="button"
          className="button"
          disabled={selected.length === 0 || approve.isPending}
          onClick={() => approveRows(selected)}
        >
          選択を承認{selected.length > 0 ? `（${selected.length} 件）` : ""}
        </button>
      </div>

      <ErrorBanner error={pending.error} />
      <ErrorBanner error={approve.error} />

      {!practitionerId ? (
        <p className="order-select__muted">医療従事者に紐付いたアカウントでログインすると、自分あての承認待ちが出ます。</p>
      ) : pending.isLoading ? (
        <p>読み込み中...</p>
      ) : (
        <>
          <div className="lab-worklist-wrap sticky-table-wrap">
            <table className="lab-worklist sticky-table">
              <thead>
                <tr>
                  <th className="lab-worklist__compact">
                    <input
                      type="checkbox"
                      aria-label="すべて選択"
                      checked={rows.length > 0 && selected.length === rows.length}
                      disabled={rows.length === 0}
                      onChange={toggleAll}
                    />
                  </th>
                  <th className="sticky-table__fix-1">患者番号</th>
                  <th className="sticky-table__fix-2">患者氏名</th>
                  <PatientProfileHeadCells />
                  <th className="lab-worklist__compact">種別</th>
                  <th className="lab-worklist__compact">開始日</th>
                  <th className="lab-worklist__compact">活動</th>
                  <th className="lab-worklist__compact">入力日時</th>
                  <th>入力者</th>
                  <th>依頼科 | 依頼医師</th>
                  <th className="lab-worklist__actions sticky-table__fix-actions"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <ApprovalRow
                    key={row.provenance.id}
                    row={row}
                    checked={selectedIds.has(row.provenance.id ?? "")}
                    pending={approve.isPending}
                    linkState={linkState}
                    onToggle={() => toggle(row.provenance.id ?? "")}
                    onApprove={() => approveRows([row])}
                  />
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={13} className="master-search__empty">
                      承認待ちのオーダーはありません
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="order-select__muted lab-worklist__count">{rows.length} 件</p>
        </>
      )}
    </div>
  );
}

interface ApprovalRowProps {
  row: PendingApprovalRow;
  checked: boolean;
  pending: boolean;
  linkState: ReturnType<typeof useReturnLinkState>;
  onToggle: () => void;
  onApprove: () => void;
}

function ApprovalRow({ row, checked, pending, linkState, onToggle, onApprove }: ApprovalRowProps) {
  const order = row.orders[0];
  const kind = orderKindOf(order);
  const patientId = order.subject?.reference?.split("/").pop() ?? "";
  // 注射の連日オーダーは 1 回の登録で日ごとのヘッダが並ぶ。開始日は最初の日〜最後の日。
  const days = row.orders.map(orderDay).filter(Boolean).sort();
  const dayLabel =
    days.length === 0 ? "-" : days.length === 1 ? days[0] : `${days[0]} 〜 ${days[days.length - 1]}`;

  return (
    <tr>
      <td className="lab-worklist__compact">
        <input type="checkbox" checked={checked} onChange={onToggle} aria-label="選択" />
      </td>
      <td className="sticky-table__fix-1">{row.patient ? patientNumberOf(row.patient) || "-" : "-"}</td>
      <td className="sticky-table__fix-2">
        {row.patient ? displayName(row.patient) : "-"}
        <PatientKana patient={row.patient} />
      </td>
      <PatientProfileCells patient={row.patient} />
      <td className="lab-worklist__compact">{kindLabel(kind)}</td>
      <td className="lab-worklist__compact">{dayLabel}</td>
      <td className="lab-worklist__compact">{row.activity === "CREATE" ? "登録" : "編集"}</td>
      <td className="lab-worklist__compact">{dateTimeSecondsLabel(row.recorded)}</td>
      <td>{row.entererName || "-"}</td>
      <td>{orderContextSummary(prescriptionRequester(order)) || "-"}</td>
      <td className="lab-worklist__actions sticky-table__fix-actions">
        {patientId && (
          <Link to={karteLink(patientId, kind, order.id)} state={linkState} className="button">
            カルテで確認
          </Link>
        )}{" "}
        <button type="button" className="button" disabled={pending} onClick={onApprove}>
          承認
        </button>
      </td>
    </tr>
  );
}

type OrderKind = ReturnType<typeof orderKindOf>;

function kindLabel(kind: OrderKind): string {
  if (!kind) return "-";
  return kind === "nursing-order" ? "看護指示" : KARTE_KIND_LABELS[kind];
}

/**
 * カルテへのリンク。種別の詳細モーダルを開いた状態で開く(承認ボタンはそこにもある)。
 * 看護指示はカルテのカードにならないので指示簿タブへ。
 */
function karteLink(patientId: string, kind: OrderKind, orderId: string | undefined): string {
  const params = new URLSearchParams();
  if (kind === "nursing-order") params.set(KARTE_TAB_PARAM, "nursing");
  else if (kind && orderId) params.set(KARTE_DETAIL_PARAM, formatKarteDetail({ kind, id: orderId }));
  const query = params.toString();
  return `/patients/${patientId}/karte${query ? `?${query}` : ""}`;
}
