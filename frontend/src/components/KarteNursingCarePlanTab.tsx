import { useState } from "react";
import { useNursingTermsByCode } from "../api/masterQueries";
import { useCloseNursingProblem, useNursingCarePlans, useSaveNursingProblem } from "../api/queries";
import {
  buildNursingPriorityBundle,
  buildNursingProblemCancelBundle,
  nursingDiagnosisCode,
  type NursingProblemEntry,
  type NursingProblemView,
} from "../fhir/nursingCarePlanHelpers";
import { today } from "../lib/dates";
import { ErrorBanner } from "./ErrorBanner";
import { NursingProblemTree } from "./NursingProblemTree";
import { NursingTermGuidance } from "./NursingTermGuidance";
import { NursingEvaluationPanel, NursingPlanOrderPanel } from "./NursingCarePlanPanels";
import { Modal } from "./Modal";
import { RowMenu } from "./RowMenu";
import { TruncatedNotice } from "./TruncatedNotice";

interface KarteNursingCarePlanTabProps {
  patientId: string;
  onCreate: (entry: NursingProblemEntry) => void;
  onEdit: (carePlanId: string) => void;
}

const SECTIONS: { entry: NursingProblemEntry; title: string }[] = [
  { entry: "standard_plan", title: "標準看護計画" },
  { entry: "diagnosis", title: "看護診断（NANDA）" },
];

// 看護計画。立案の入口(標準看護計画 / 看護診断)ごとの区画に看護問題を優先度順に並べ、
// 因子・目標・計画・評価をカードの中のツリーで読む。立案・編集・評価・指示への展開は右ペインで行う。
// 優先度の番号と並べ替えは区画の中で数える(保存する優先度は患者全体の並び)。
export function KarteNursingCarePlanTab({
  patientId,
  onCreate,
  onEdit,
}: KarteNursingCarePlanTabProps) {
  const at = today();
  const [showResolved, setShowResolved] = useState(false);
  const [guidance, setGuidance] = useState<NursingProblemView | null>(null);
  // 評価・指示展開はタブの中の操作なのでモーダルで開く(右ペインは右ペインの登録ボタンから始めるものだけ)。
  const [dialog, setDialog] = useState<{ kind: "evaluate" | "expand"; view: NursingProblemView } | null>(null);
  const plans = useNursingCarePlans(patientId);
  const save = useSaveNursingProblem();
  const close = useCloseNursingProblem();

  const all = plans.data?.items ?? [];
  const active = all.filter((p) => p.active);

  // 区画の中で隣の看護問題と入れ替え、患者全体の並びで優先度を振り直す。
  function move(view: NursingProblemView, delta: number) {
    const sectionActive = active.filter((p) => p.entry === view.entry);
    const neighbor = sectionActive[sectionActive.indexOf(view) + delta];
    if (!neighbor) return;
    const order = [...active];
    const i = order.indexOf(view);
    const j = order.indexOf(neighbor);
    [order[i], order[j]] = [order[j], order[i]];
    save.mutate(buildNursingPriorityBundle(order.map((p) => p.condition)));
  }

  function handleCancel(view: NursingProblemView) {
    if (!window.confirm(`「${view.name}」を取り消します。展開した看護指示も中止します。よろしいですか？`)) return;
    const orders = [...view.ordersByActivity.values()].flat();
    close.mutate(buildNursingProblemCancelBundle(view, orders));
  }

  return (
    <div className="karte-tabpanel">
      <div className="karte-tabpanel__header">
        <h3>看護計画</h3>
        <div className="nursing-tab__toolbar">
          <label className="nursing-tab__toggle">
            <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
            解決済みも表示
          </label>
          <button type="button" onClick={() => onCreate("standard_plan")}>
            標準看護計画
          </button>
          <button type="button" onClick={() => onCreate("diagnosis")}>
            看護診断（NANDA）
          </button>
        </div>
      </div>

      <ErrorBanner error={plans.error ?? save.error ?? close.error} />
      <TruncatedNotice show={plans.data?.truncated} />

      {plans.isPending ? (
        <p>読み込み中...</p>
      ) : (
        SECTIONS.map((section) => {
          const sectionActive = active.filter((p) => p.entry === section.entry);
          const shown = all.filter((p) => p.entry === section.entry && (showResolved || p.active));
          return (
            <section key={section.entry} className="nursing-plan__section">
              <h4 className="nursing-plan__section-title">{section.title}</h4>
              {shown.length === 0 ? (
                <p className="karte-tabpanel__empty">看護問題はありません。</p>
              ) : (
                <div className="nursing-plan__list">
                  {shown.map((view) => {
                    const index = sectionActive.indexOf(view);
                    const id = view.carePlan.id ?? "";
                    return (
                      <article
                        key={id}
                        className={`nursing-plan__card${view.active ? "" : " nursing-plan__card--resolved"}`}
                      >
                        <header className="nursing-plan__head">
                          <span className="nursing-plan__title">
                            {view.active ? `#${index + 1} ` : ""}
                            {view.name}
                          </span>
                          <span className="nursing-plan__dates">
                            立案 {view.onsetDate}
                            {view.abatementDate && ` / 解決 ${view.abatementDate}`}
                          </span>
                          {view.active && (
                            <span className="nursing-plan__actions">
                              <button
                                type="button"
                                className="rp-card__compact-button"
                                onClick={() => setDialog({ kind: "evaluate", view })}
                              >
                                評価
                              </button>
                              <button
                                type="button"
                                className="rp-card__compact-button"
                                onClick={() => setDialog({ kind: "expand", view })}
                              >
                                指示展開
                              </button>
                              <button
                                type="button"
                                className="rp-card__icon-button"
                                onClick={() => move(view, -1)}
                                disabled={index === 0 || save.isPending}
                                aria-label="優先度を上げる"
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                className="rp-card__icon-button"
                                onClick={() => move(view, 1)}
                                disabled={index === sectionActive.length - 1 || save.isPending}
                                aria-label="優先度を下げる"
                              >
                                ↓
                              </button>
                            </span>
                          )}
                          <RowMenu label={`${view.name} の操作`}>
                            {view.active && (
                              <>
                                <button type="button" className="row-menu__item" onClick={() => onEdit(id)}>
                                  編集
                                </button>
                              </>
                            )}
                            {nursingDiagnosisCode(view.condition) && (
                              <button type="button" className="row-menu__item" onClick={() => setGuidance(view)}>
                                ガイダンス
                              </button>
                            )}
                            {view.active && (
                              <button
                                type="button"
                                className="row-menu__item row-menu__item--danger"
                                onClick={() => handleCancel(view)}
                              >
                                取消
                              </button>
                            )}
                          </RowMenu>
                        </header>
                        <NursingProblemTree view={view} at={at} />
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })
      )}

      {guidance && <NursingGuidanceModal view={guidance} onClose={() => setGuidance(null)} />}
      {dialog && (
        <Modal
          title={dialog.kind === "evaluate" ? "評価" : "指示展開"}
          onClose={() => setDialog(null)}
          className="modal--wide"
        >
          {dialog.kind === "evaluate" ? (
            <NursingEvaluationPanel
              patientId={patientId}
              carePlanId={dialog.view.carePlan.id ?? ""}
              onSaved={() => setDialog(null)}
            />
          ) : (
            <NursingPlanOrderPanel
              patientId={patientId}
              carePlanId={dialog.view.carePlan.id ?? ""}
              onSaved={() => setDialog(null)}
            />
          )}
        </Modal>
      )}
    </div>
  );
}

function NursingGuidanceModal({ view, onClose }: { view: NursingProblemView; onClose: () => void }) {
  const code = nursingDiagnosisCode(view.condition);
  const terms = useNursingTermsByCode("diagnosis", [code]);
  const term = terms.data?.items[0];
  return (
    <Modal title={view.name} onClose={onClose}>
      <ErrorBanner error={terms.error} />
      {terms.isPending ? (
        <p>読み込み中...</p>
      ) : !term ? (
        <p>看護診断マスタに見つかりません。</p>
      ) : (
        <NursingTermGuidance term={term} />
      )}
    </Modal>
  );
}
