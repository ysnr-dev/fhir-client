import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useCurrentPractitioner } from "../api/authQueries";
import { useReviewNursingSummary, useWardNursingSummaries, useWardOptions } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { Modal } from "../components/Modal";
import { TruncatedNotice } from "../components/TruncatedNotice";
import { locationDisplayName } from "../fhir/locationHelpers";
import {
  NURSING_SUMMARY_KIND_OPTIONS,
  NURSING_SUMMARY_STATE_LABELS,
  buildApprovedNursingSummary,
  buildReturnedNursingSummary,
  nursingSummaryApprover,
  canApproveNursingSummary,
  nursingSummaryKindLabel,
  nursingSummaryKindOf,
  nursingSummaryStateOf,
  type NursingSummaryKind,
  type NursingSummaryState,
} from "../fhir/nursingSummaryHelpers";
import { buildNursingSummaryReturnedEntry } from "../fhir/nursingSummaryTaskHelpers";
import { displayName } from "../fhir/patientHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { formatKarteOpen, KARTE_OPEN_PARAM } from "../karteUrl";
import { useIsNursingLogin } from "../hooks/useIsNursingLogin";
import { addDays, today } from "../lib/dates";
import { useReturnLinkState } from "../returnTo";

// 看護サマリ承認。病棟の看護サマリを作成状態・承認状態とともに並べ、承認・却下する。
// 修正して承認するときはカルテの看護サマリを開いて「修正承認」する。承認できるのは看護職で作成者以外。

interface Row {
  composition: fhir4.Composition;
  patientId: string;
  patientName: string;
  kind: NursingSummaryKind;
  state: NursingSummaryState;
  authorName: string;
  approverName: string;
  date: string;
  period: string;
}

export function NursingSummaryApprovalPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const wardId = searchParams.get("ward") ?? "";
  const from = searchParams.get("from") || addDays(today(), -30);
  const to = searchParams.get("to") || today();
  const kind = (searchParams.get("kind") ?? "") as NursingSummaryKind | "";
  // 既定は承認待ちだけ。「すべて」は all で持つ(未指定と区別するため)。
  const stateParam = searchParams.get("state");
  const stateFilter = (stateParam === null ? "pending" : stateParam === "all" ? "" : stateParam) as
    | NursingSummaryState
    | "";
  const [rejecting, setRejecting] = useState<Row | null>(null);

  const wardOptions = useWardOptions();
  const list = useWardNursingSummaries(wardId, from, to);
  const review = useReviewNursingSummary();
  const { practitionerId, practitioner } = useCurrentPractitioner();
  const nursing = useIsNursingLogin();
  const returnLinkState = useReturnLinkState();

  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  function setParams(next: Record<string, string>, replace = false) {
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    setSearchParams(params, { replace });
  }

  // 病棟が未指定なら先頭の病棟を開く(指示簿と同じ)。
  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current || wardId) return;
    const first = wardOptions.wards[0];
    if (!first?.id) return;
    initialized.current = true;
    setParams({ ward: first.id }, true);
    // 初回に一度だけ動けばよい。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wardId, wardOptions.wards]);

  const rows = useMemo<Row[]>(() => {
    const data = list.data?.value;
    if (!data) return [];
    const returnedIds = new Set(
      data.returnedTasks.map((t) => t.focus?.reference?.match(/^Composition\/(.+)$/)?.[1] ?? ""),
    );
    return data.summaries.map((composition) => {
      const patientId = composition.subject?.reference?.split("/").pop() ?? "";
      const patient = data.patients.get(patientId);
      const period = composition.event?.[0]?.period;
      return {
        composition,
        patientId,
        patientName: patient ? displayName(patient) : "",
        kind: nursingSummaryKindOf(composition),
        state: nursingSummaryStateOf(composition, returnedIds.has(composition.id ?? "")),
        authorName: composition.author?.[0]?.display ?? "",
        approverName: nursingSummaryApprover(composition)?.name ?? "",
        date: (composition.date ?? "").slice(0, 10),
        period: period ? `${period.start ?? ""} 〜 ${period.end ?? ""}` : "",
      };
    });
  }, [list.data]);

  // 種別・状態は 1 病棟・期間内の件数の中での見方の切り替えなので画面側で絞る。
  const visible = rows.filter((row) => (!kind || row.kind === kind) && (!stateFilter || row.state === stateFilter));

  function canApprove(row: Row): boolean {
    return row.state === "pending" && canApproveNursingSummary(row.composition, practitionerId, nursing.isNursing);
  }

  function approve(row: Row) {
    if (!practitioner) return;
    review.mutate({ original: row.composition, next: buildApprovedNursingSummary(row.composition, practitioner) });
  }

  function karteLink(row: Row): string {
    const params = new URLSearchParams();
    params.set(KARTE_OPEN_PARAM, formatKarteOpen({ kind: "nursing-summary", compositionId: row.composition.id ?? "" }));
    return `/patients/${row.patientId}/karte?${params}`;
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>看護サマリ承認</h1>
        <div className="page__header-actions">
          <button type="button" onClick={() => void list.refetch()}>
            更新
          </button>
        </div>
      </div>

      <form className="patient-search-form" onSubmit={(e: FormEvent) => e.preventDefault()}>
        <label>
          病棟
          <select value={wardId} onChange={(e) => setParams({ ward: e.target.value })}>
            {wardOptions.wards.map((ward) => (
              <option key={ward.id} value={ward.id}>
                {locationDisplayName(ward)}
              </option>
            ))}
          </select>
        </label>
        <label>
          作成日
          <input type="date" value={from} onChange={(e) => setParams({ from: e.target.value })} />
        </label>
        <label>
          〜
          <input type="date" value={to} onChange={(e) => setParams({ to: e.target.value })} />
        </label>
        <label>
          種別
          <select value={kind} onChange={(e) => setParams({ kind: e.target.value })}>
            <option value="">すべて</option>
            {NURSING_SUMMARY_KIND_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.display}
              </option>
            ))}
          </select>
        </label>
        <label>
          状態
          <select value={stateFilter || "all"} onChange={(e) => setParams({ state: e.target.value })}>
            <option value="all">すべて</option>
            {(Object.keys(NURSING_SUMMARY_STATE_LABELS) as NursingSummaryState[]).map((s) => (
              <option key={s} value={s}>
                {NURSING_SUMMARY_STATE_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
      </form>

      <ErrorBanner error={list.error ?? wardOptions.error ?? review.error} />
      <TruncatedNotice show={list.data?.truncated} />

      {!wardId ? (
        <p className="patient-table__empty">病棟を選んでください。</p>
      ) : list.isPending ? (
        <p>読み込み中...</p>
      ) : (
        <div className="lab-worklist-wrap sticky-table-wrap">
          <table className="lab-worklist sticky-table">
            <thead>
              <tr>
                <th>患者</th>
                <th className="lab-worklist__compact">種別</th>
                <th className="lab-worklist__compact">期間</th>
                <th className="lab-worklist__compact">作成日</th>
                <th className="lab-worklist__compact">作成者</th>
                <th className="lab-worklist__compact">状態</th>
                <th className="lab-worklist__compact">承認者</th>
                <th className="lab-worklist__actions sticky-table__fix-actions"></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.composition.id}>
                  <td>{row.patientName}</td>
                  <td className="lab-worklist__compact">{nursingSummaryKindLabel(row.kind)}</td>
                  <td className="lab-worklist__compact">{row.period}</td>
                  <td className="lab-worklist__compact">{row.date}</td>
                  <td className="lab-worklist__compact">{row.authorName}</td>
                  <td className="lab-worklist__compact">
                    <span className={`nursing-summary__state nursing-summary__state--${row.state}`}>
                      {NURSING_SUMMARY_STATE_LABELS[row.state]}
                    </span>
                  </td>
                  <td className="lab-worklist__compact">{row.approverName}</td>
                  <td className="lab-worklist__actions sticky-table__fix-actions">
                    <Link className="button" to={karteLink(row)} state={returnLinkState}>
                      開く
                    </Link>
                    {canApprove(row) && (
                      <>
                        <button type="button" onClick={() => approve(row)} disabled={review.isPending}>
                          承認
                        </button>
                        <button type="button" onClick={() => setRejecting(row)} disabled={review.isPending}>
                          却下
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={8} className="master-search__empty">
                    {rows.length === 0 ? "この期間の看護サマリはありません。" : "絞り込みに一致する看護サマリがありません。"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {rejecting && practitioner && practitionerId && (
        <RejectModal
          row={rejecting}
          submitting={review.isPending}
          onSubmit={(reason) =>
            review.mutate(
              {
                original: rejecting.composition,
                next: buildReturnedNursingSummary(rejecting.composition),
                extraEntries: [
                  buildNursingSummaryReturnedEntry(
                    rejecting.composition,
                    rejecting.patientId,
                    reason,
                    `看護サマリ(${nursingSummaryKindLabel(rejecting.kind)})`,
                    { practitionerId, display: practitionerDisplayName(practitioner) },
                  ),
                ],
              },
              { onSuccess: () => setRejecting(null) },
            )
          }
          onClose={() => setRejecting(null)}
        />
      )}
    </div>
  );
}

// 却下の理由。Modal はポータルではないので <form> は書かない。
function RejectModal({
  row,
  submitting,
  onSubmit,
  onClose,
}: {
  row: Row;
  submitting: boolean;
  onSubmit: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <Modal title={`${row.patientName} 看護サマリ(${nursingSummaryKindLabel(row.kind)})`} onClose={onClose}>
      <div className="prescription-form">
        <label>
          理由
          <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <div className="lab-order-item__actions">
          <button type="button" disabled={!reason.trim() || submitting} onClick={() => onSubmit(reason.trim())}>
            却下
          </button>
        </div>
      </div>
    </Modal>
  );
}
