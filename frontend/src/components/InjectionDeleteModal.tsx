import { useState } from "react";
import { useDeleteInjectionSeries, useInjectionSeriesLater } from "../api/queries";
import { clearDeleteReason, DELETE_REASON_SUGGESTIONS, stageDeleteReason } from "../lib/deleteReasonStage";
import { injectionDayOf, injectionSeriesLabel } from "../fhir/injectionHelpers";
import { cycleDayLabel, regimenOrderOf } from "../fhir/regimenOrderHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

// 注射オーダーの削除確認。連日オーダー(期間展開したもの)は後続日があるので、
// 「この日のみ」か「この日以降すべて」かを選ばせる。後続日が無ければ処方と同じ
// 1 件の削除確認になる(window.confirm ではなくこのモーダルに統一)。理由は削除の来歴に残す
// (docs/features/karte.md「削除の記録」)。

interface InjectionDeleteModalProps {
  serviceRequest: fhir4.ServiceRequest;
  onClose: () => void;
  onDeleted: () => void;
}

export function InjectionDeleteModal({ serviceRequest, onClose, onDeleted }: InjectionDeleteModalProps) {
  const later = useInjectionSeriesLater(serviceRequest);
  const remove = useDeleteInjectionSeries();
  const laterTargets = later.data ?? [];
  const date = injectionDayOf(serviceRequest);
  const last = laterTargets[laterTargets.length - 1]?.serviceRequest;
  const lastDate = last ? injectionDayOf(last) : "";
  const seriesLabel = injectionSeriesLabel(serviceRequest);
  const regimenDay = regimenOrderOf(serviceRequest);
  const [reason, setReason] = useState("");
  const ready = Boolean(reason.trim()) && !remove.isPending;

  function handleDelete(ids: string[]) {
    stageDeleteReason(
      ids.map((id) => `ServiceRequest/${id}`),
      reason,
    );
    remove.mutate(ids, { onSuccess: onDeleted, onSettled: clearDeleteReason });
  }

  const ownId = serviceRequest.id ?? "";
  const laterIds = laterTargets
    .map((t) => t.serviceRequest.id)
    .filter((id): id is string => Boolean(id));

  return (
    <Modal title="注射の削除" onClose={onClose}>
      <ErrorBanner error={later.error ?? remove.error} />
      {later.isLoading ? (
        <p>読み込み中...</p>
      ) : (
        <>
          <p>
            {`${date} の注射を削除します。`}
            {seriesLabel && <span className="injection-series-label">{seriesLabel}</span>}
          </p>
          {laterTargets.length > 0 && (
            <p className="injection-scope__note">
              {`この後に ${laterTargets.length} 日分(〜${lastDate})の同じオーダーがあります。`}
            </p>
          )}
          {/* 化学療法の日オーダーは、消すとクールが歯抜けになり予約も残る(§8.14 N-13)。 */}
          {regimenDay && (
            <p className="injection-scope__note">
              {`${regimenDay.name} ${cycleDayLabel(regimenDay)} の投与日です。削除するとクールから抜けます(外来化学療法室の予約は一緒に取り消します)。投与を止めるだけなら化学療法タブの投与日パネルで中止、クールごと消すならレジメン詳細の「取消」を使ってください。`}
            </p>
          )}
          <div className="walk-in__fields karte-delete-form">
            <label className="karte-delete-form__reason">
              理由
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={200}
                list="karte-delete-reasons"
                autoFocus
              />
              <datalist id="karte-delete-reasons">
                {DELETE_REASON_SUGGESTIONS.map((suggestion) => (
                  <option key={suggestion} value={suggestion} />
                ))}
              </datalist>
            </label>
          </div>
          <div className="plain-text-modal__actions">
            <button type="button" onClick={onClose} disabled={remove.isPending}>
              キャンセル
            </button>
            <button type="button" onClick={() => handleDelete([ownId])} disabled={!ready}>
              {laterTargets.length > 0 ? "この日のみ削除" : "削除"}
            </button>
            {laterTargets.length > 0 && (
              <button
                type="button"
                onClick={() => handleDelete([ownId, ...laterIds])}
                disabled={!ready}
              >
                {`この日以降 ${laterTargets.length + 1} 日分削除`}
              </button>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
