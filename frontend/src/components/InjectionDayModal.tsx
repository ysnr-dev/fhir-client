import { useState } from "react";
import { useCancelInjectionPerforms, useInjectionDayOrders } from "../api/queries";
import {
  injectionComparison,
  injectionContentDiff,
} from "../fhir/injectionCalendarHelpers";
import {
  injectionDayOf,
  injectionSeriesLabel,
  summarizeInjectionServiceRequest,
} from "../fhir/injectionHelpers";
import { injectionPerformsByOrderId } from "../fhir/injectionPerformHelpers";
import {
  canCancelInjection,
  canRestoreInjection,
  injectionTaskStatus,
  injectionTaskStatusDisplay,
  injectionTasksByOrderId,
} from "../fhir/injectionTaskHelpers";
import { regimenOrderLabel, regimenOrderOf } from "../fhir/regimenOrderHelpers";
import { referenceId } from "../fhir/shared";
import { addDays } from "../lib/dates";
import { ErrorBanner } from "./ErrorBanner";
import { InjectionCancelModal } from "./InjectionCancelModal";
import { InjectionDeleteModal } from "./InjectionDeleteModal";
import { InjectionPerformModal } from "./InjectionPerformModal";
import { Modal } from "./Modal";

// 注射カレンダーの 1 マスを押したときのモーダル。その日の注射の指示内容を、予定(指示量)と
// 実施(実施量)を並べて見せ、カルテのカードと同じ操作(実施・実施取消・変更・中止・削除)と
// 複写を置く。前の日から内容が変わった日は変更点も出す。
//
// 表を見たまま開いて閉じる用途なので、右ペインではなくモーダルにする。
// 実施・中止・削除のモーダルは、重ねずにこのモーダルと入れ替えて出し、閉じたら戻る。
// 変更・複写は入力が長いので、右ペインの注射フォームを開く(このモーダルは閉じる)。
//
// 化学療法の日オーダーは、変更・中止・削除・複写をレジメン側(化学療法タブ)で行うので
// 実施と実施取消だけを置く。

interface InjectionDayModalProps {
  patientId: string;
  srId: string;
  /** 内容を比べる前の日のオーダー。 */
  compareSrId?: string;
  onEdit: (srId: string) => void;
  /** 複写。開始日を初期値にした登録を開く。 */
  onCopy: (sourceSrId: string, startDate: string) => void;
  onClose: () => void;
}

export function InjectionDayModal({
  patientId,
  srId,
  compareSrId,
  onEdit,
  onCopy,
  onClose,
}: InjectionDayModalProps) {
  const day = useInjectionDayOrders([srId, compareSrId ?? ""]);
  const cancelPerforms = useCancelInjectionPerforms();
  const [performOpen, setPerformOpen] = useState(false);
  const [cancelMode, setCancelMode] = useState<"cancel" | "restore" | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const data = day.data;
  const order = data?.orders.find((sr) => sr.id === srId);
  const mrsOf = (id: string) =>
    (data?.medicationRequests ?? []).filter((mr) => referenceId(mr.basedOn?.[0]?.reference) === id);
  const mrs = mrsOf(srId);
  const task = injectionTasksByOrderId(data?.tasks ?? []).get(srId);
  const ownProcedures = (data?.procedures ?? []).filter(
    (p) => referenceId(p.basedOn?.[0]?.reference) === srId,
  );
  const performs = injectionPerformsByOrderId(ownProcedures, data?.administrations ?? []).get(srId) ?? [];
  const comparison = injectionComparison(mrs, ownProcedures, data?.administrations ?? []);
  const diff = compareSrId ? injectionContentDiff(mrsOf(compareSrId), mrs) : [];
  const compareOrder = data?.orders.find((sr) => sr.id === compareSrId);

  if (day.isPending || !order || referenceId(order.subject?.reference) !== patientId) {
    return (
      <Modal title="注射" onClose={onClose}>
        {day.isPending ? (
          <p>読み込み中...</p>
        ) : (
          <ErrorBanner
            error={
              day.error ??
              new Error(order ? "指定された注射は別の患者のものです。" : "注射オーダーが見つかりません")
            }
          />
        )}
      </Modal>
    );
  }

  const date = injectionDayOf(order);
  const status = injectionTaskStatus(task);
  const regimen = regimenOrderOf(order) !== null;
  const summary = summarizeInjectionServiceRequest(order);
  const note = regimen ? regimenOrderLabel(order) : injectionSeriesLabel(order);

  if (performOpen) {
    return (
      <InjectionPerformModal
        order={order}
        medicationRequests={mrs}
        task={task}
        performs={performs}
        onClose={() => setPerformOpen(false)}
      />
    );
  }
  if (cancelMode) {
    return (
      <InjectionCancelModal
        serviceRequest={order}
        task={task}
        mode={cancelMode}
        onClose={() => setCancelMode(null)}
        onDone={() => setCancelMode(null)}
      />
    );
  }
  if (deleteOpen) {
    return (
      <InjectionDeleteModal
        serviceRequest={order}
        onClose={() => setDeleteOpen(false)}
        onDeleted={onClose}
      />
    );
  }

  return (
    <Modal title="注射" onClose={onClose} className="modal--wide injection-day">
      <ErrorBanner error={day.error ?? cancelPerforms.error} />
      <p className="injection-day__title">
        <span className="injection-day__date">{date}</span>
        <span className={`injection-day__status injection-day__status--${status}`}>
          {injectionTaskStatusDisplay(status)}
        </span>
        {[summary.settingDisplay, summary.categoryDisplay, note].filter(Boolean).join(" ")}
      </p>

      {diff.length > 0 && (
        <section className="injection-day__diff">
          <h4>{`変更(${compareOrder ? injectionDayOf(compareOrder) : "前の日"}から)`}</h4>
          <ul>
            {diff.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      )}

      {comparison.rps.map((rp) => (
        <section key={rp.rpNumber} className="injection-day__rp">
          <div className="injection-day__rp-head">
            <span className="karte-rp__number">{`RP${rp.rpNumber}`}</span>
            <span>{rp.usage}</span>
            {rp.times && <span className="injection-day__times">{rp.times}</span>}
          </div>
          <table className="injection-day__table">
            <thead>
              <tr>
                <th>薬剤</th>
                <th>指示</th>
                {comparison.performs.map((label, i) => (
                  <th key={i}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rp.lines.map((line, i) => (
                <tr key={`${line.name}-${i}`}>
                  <td>{line.name}</td>
                  <td>{line.ordered || "-"}</td>
                  {line.performed.map((amount, j) => (
                    <td
                      key={j}
                      className={
                        comparison.performKinds[j] === "completed" && amount !== line.ordered
                          ? "injection-day__amount--differs"
                          : undefined
                      }
                    >
                      {amount || "-"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      <div className="lab-order-item__actions">
        {status !== "cancelled" && (
          <button type="button" onClick={() => setPerformOpen(true)}>
            実施
          </button>
        )}
        {performs.length > 0 && (
          <button
            type="button"
            disabled={cancelPerforms.isPending}
            onClick={() => {
              if (!window.confirm("この注射の実施記録をすべて取り消します。よろしいですか?")) return;
              cancelPerforms.mutate({ order, task, performs });
            }}
          >
            実施取消
          </button>
        )}
        {!regimen && (
          <>
            <button type="button" onClick={() => onEdit(srId)}>
              変更
            </button>
            <button type="button" onClick={() => onCopy(srId, addDays(date, 1))}>
              複写
            </button>
            {canCancelInjection(status) && (
              <button type="button" onClick={() => setCancelMode("cancel")}>
                中止
              </button>
            )}
            {canRestoreInjection(status) && (
              <button type="button" onClick={() => setCancelMode("restore")}>
                中止取消
              </button>
            )}
            <button type="button" onClick={() => setDeleteOpen(true)}>
              削除
            </button>
          </>
        )}
      </div>

    </Modal>
  );
}
