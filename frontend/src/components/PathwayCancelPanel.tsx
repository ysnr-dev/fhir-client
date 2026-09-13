import { useMemo, useState } from "react";
import {
  useCancelPathwayApplication,
  useNursingPerformsOf,
  usePathwayApplicationTree,
  usePathwayObservations,
  usePatientTasks,
} from "../api/queries";
import { orderKindOf } from "../fhir/karteTimeline";
import type { OrderSetOrderType } from "../fhir/orderSetHelpers";
import { buildEvaluationState } from "../fhir/pathwayEvaluationHelpers";
import {
  buildPathwayTreeDeleteBundle,
  planPathwayCancel,
  type PathwayRecordContext,
} from "../fhir/pathwayScheduleHelpers";
import { nursingPerformDates } from "../fhir/pathwaySheetHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { ORDER_SET_TYPE_LABELS } from "./orderSetRegistry";

// 誤って適用したパスの取り消し。パスシートの見出しのメニューから開く。何も記録していない進行中の
// 適用だけが対象で、雛形から出したオーダーをカルテのカードの削除と同じ種別ごとの処理で消し
// (明細・予約・部門の Task の後始末は各種別に任せる)、最後に計画の木を消す(useCancelPathwayApplication)。
// 設計は docs/clinical-pathway-design.md §7.9。

interface PathwayCancelPanelProps {
  patientId: string;
  applyId: string;
  onCancelled: () => void;
}

export function PathwayCancelPanel({ patientId, applyId, onCancelled }: PathwayCancelPanelProps) {
  const tree = usePathwayApplicationTree(applyId);
  const observations = usePathwayObservations(patientId);
  const performs = useNursingPerformsOf(patientId);
  const tasks = usePatientTasks(patientId);
  const cancel = useCancelPathwayApplication();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const ctx = useMemo<PathwayRecordContext | null>(() => {
    const application = tree.data?.application;
    if (!tree.data || !application || !observations.data) return null;
    return {
      application,
      carePlans: tree.data.carePlans,
      procedures: tree.data.procedures,
      goals: tree.data.goals,
      orders: tree.data.orders,
      evaluation: buildEvaluationState(observations.data, tree.data.goals, [...tree.data.carePlans.values()]),
      performDates: nursingPerformDates(performs.data),
    };
  }, [tree.data, observations.data, performs.data]);
  const plan = ctx && tasks.data ? planPathwayCancel(ctx, tasks.data) : null;

  if (tree.isPending || observations.isPending || performs.isPending || tasks.isPending) return <p>読み込み中...</p>;
  if (!ctx || !plan) return <ErrorBanner error={tree.error ?? observations.error ?? performs.error ?? tasks.error} />;
  const application = ctx.application;
  const running = progress !== null;
  const days = new Set(application.events.map((e) => e.elapsedDays)).size;
  const units = application.events.reduce((n, e) => n + e.units.length, 0);

  function handleCancel() {
    if (!plan || plan.blockers.length > 0) return;
    const total = plan.orders.length;
    setProgress({ done: 0, total });
    cancel.mutate(
      {
        orders: plan.orders.map(({ order }) => ({ order, kind: orderKindOf(order) })),
        tasks: tasks.data ?? [],
        treeBundle: buildPathwayTreeDeleteBundle(plan),
        onProgress: (done) => setProgress({ done, total }),
      },
      { onSuccess: onCancelled, onError: () => setProgress(null) },
    );
  }

  return (
    <div className="pathway-evaluate">
      <ErrorBanner error={cancel.error} />

      <div className="chemo-calendar__summary pathway-evaluate__head">
        <span className="pathway-sheet__name">{application.title}</span>
        <span>入院 {application.periodStart}</span>
      </div>

      <fieldset className="regimen-apply__fields">
        <legend>取り消すもの</legend>
        <div className="lab-order-item__fields">
          <div className="regimen-editor__derived">
            病日
            <strong>{days} 日分</strong>
          </div>
          <div className="regimen-editor__derived">
            アウトカム
            <strong>{units}</strong>
          </div>
          <div className="regimen-editor__derived">
            タスク
            <strong>{plan.procedureIds.length}</strong>
          </div>
          <div className="regimen-editor__derived">
            オーダー
            <strong>{plan.orders.length}</strong>
          </div>
        </div>
        {plan.orders.length > 0 && (
          <ul className="pathway-apply__conditions pathway-schedule__list">
            {plan.orders.map(({ order, taskName }) => {
              const kind = orderKindOf(order);
              return (
                <li key={order.id}>
                  {kind && (
                    <span className="pathway-task__template-label">
                      {kind === "nursing-order" ? "看護指示" : (ORDER_SET_TYPE_LABELS[kind as OrderSetOrderType] ?? "")}
                    </span>
                  )}
                  {taskName}
                </li>
              );
            })}
          </ul>
        )}
      </fieldset>

      {plan.blockers.length > 0 && (
        <div className="error-banner" role="status">
          {plan.blockers.map((message) => (
            <p key={message} className="error-banner__line error-banner__line--error">
              {message}
            </p>
          ))}
        </div>
      )}

      <div className="lab-order-item__actions">
        <button
          type="button"
          className="pathway-cancel__button"
          onClick={handleCancel}
          disabled={running || plan.blockers.length > 0}
        >
          {running && progress ? `取り消し中...(オーダー ${progress.done} / ${progress.total})` : "取り消す"}
        </button>
      </div>
    </div>
  );
}
