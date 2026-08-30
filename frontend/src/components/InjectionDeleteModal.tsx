import { useDeleteInjectionSeries, useInjectionSeriesLater } from "../api/queries";
import { injectionSeriesLabel } from "../fhir/injectionHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

// 注射オーダーの削除確認。連日オーダー(期間展開したもの)は後続日があるので、
// 「この日のみ」か「この日以降すべて」かを選ばせる。後続日が無ければ処方と同じ
// 1 件の削除確認になる(window.confirm ではなくこのモーダルに統一)。

interface InjectionDeleteModalProps {
  serviceRequest: fhir4.ServiceRequest;
  onClose: () => void;
  onDeleted: () => void;
}

export function InjectionDeleteModal({ serviceRequest, onClose, onDeleted }: InjectionDeleteModalProps) {
  const later = useInjectionSeriesLater(serviceRequest);
  const remove = useDeleteInjectionSeries();
  const laterTargets = later.data ?? [];
  const date = serviceRequest.authoredOn?.slice(0, 10) ?? "";
  const lastDate = laterTargets[laterTargets.length - 1]?.serviceRequest.authoredOn?.slice(0, 10) ?? "";
  const seriesLabel = injectionSeriesLabel(serviceRequest);

  function handleDelete(ids: string[]) {
    remove.mutate(ids, { onSuccess: onDeleted });
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
          <div className="plain-text-modal__actions">
            <button type="button" onClick={onClose} disabled={remove.isPending}>
              キャンセル
            </button>
            <button type="button" onClick={() => handleDelete([ownId])} disabled={remove.isPending}>
              {laterTargets.length > 0 ? "この日のみ削除" : "削除"}
            </button>
            {laterTargets.length > 0 && (
              <button
                type="button"
                onClick={() => handleDelete([ownId, ...laterIds])}
                disabled={remove.isPending}
              >
                {`この日以降 ${laterTargets.length + 1} 日分を削除`}
              </button>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
