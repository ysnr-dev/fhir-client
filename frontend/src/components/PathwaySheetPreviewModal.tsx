import { useState } from "react";
import { isOrderSetOrderType } from "../fhir/orderSetHelpers";
import { pathStepLabel, phaseLabelOf, type PathwayDraft, type PathwayTaskDraft } from "../fhir/pathwayHelpers";
import { buildPathwayPreview, previewPhaseRoute } from "../fhir/pathwayPreviewHelpers";
import { buildPathwaySheet, type SheetAssessmentCell, type SheetTaskCell } from "../fhir/pathwaySheetHelpers";
import { today } from "../lib/dates";
import { Modal } from "./Modal";
import { ORDER_SET_TYPE_LABELS } from "./orderSetRegistry";
import { PathwaySeriesLink } from "./PathwaySeriesLink";
import { PathwayTaskTemplateModal } from "./PathwayTaskTemplateModal";

// パス定義のプレビュー。編集中の draft(保存前の内容も含む)を、患者に適用したときのパスシート
// (KartePathwayTab のオーバービュー)と同じ並びで見る。読むだけで、評価・実施は記録しない。
// オーダー雛形を持つタスクのセルは押せて、雛形の中身を読み取り専用のモーダルで重ねて開く。
// 実日付は入院日(次のフェーズの適用から開いたときはそのフェーズの開始日)から割り付け、フェーズを分けたパスは分岐の先を選んで経路を切り替える(既定は標準の経路)。

export function PathwaySheetPreviewModal({
  draft,
  startPhaseKey,
  initialDate,
  onClose,
}: {
  draft: PathwayDraft;
  /** 次のフェーズの適用から開くとき、経路の先頭にするフェーズ。日付はそのフェーズの開始日になる。 */
  startPhaseKey?: string;
  /** 日付の初期値。無ければ今日。 */
  initialDate?: string;
  onClose: () => void;
}) {
  const [admissionDate, setAdmissionDate] = useState(() => initialDate || today());
  const [choices, setChoices] = useState<Map<string, string>>(new Map());
  const [collapsedUnits, setCollapsedUnits] = useState<Set<string>>(new Set());
  const [templateTask, setTemplateTask] = useState<PathwayTaskDraft | null>(null);

  const route = previewPhaseRoute(draft.phases, choices, startPhaseKey);
  const { application, tasks } = buildPathwayPreview(draft, admissionDate || today(), route);
  const sheet = buildPathwaySheet(application);
  const visibleRows = sheet.rows.filter((row) => row.kind === "unit" || !collapsedUnits.has(row.unitKey));
  const branching = draft.phases.length > 1 ? route.filter((phase) => phase.branches.length > 1) : [];

  function toggleUnit(unitKey: string) {
    setCollapsedUnits((current) => {
      const next = new Set(current);
      if (next.has(unitKey)) next.delete(unitKey);
      else next.add(unitKey);
      return next;
    });
  }

  function choose(phaseKey: string, toPhaseKey: string) {
    setChoices((current) => new Map(current).set(phaseKey, toPhaseKey));
  }

  return (
    <>
      <Modal title="パスシート(プレビュー)" className="modal--pathway-preview" onClose={onClose}>
        <div className="pathway-sheet pathway-preview" style={{ ["--pathway-sheet-col-w" as string]: "96px" }}>
          <div className="chemo-calendar__summary pathway-sheet__summary">
            <span className="pathway-sheet__name">{application.title || "(名称未入力)"}</span>
            <label className="pathway-preview__field">
              {route[0] && route[0] !== draft.phases[0] ? "開始日" : "入院日"}
              <input type="date" value={admissionDate} onChange={(e) => setAdmissionDate(e.target.value)} />
            </label>
            {branching.map((phase) => (
              <label key={phase.phaseKey} className="pathway-preview__field">
                {`${phaseLabelOf(draft.phases, phase.phaseKey)} の次`}
                <select
                  value={choices.get(phase.phaseKey) ?? phase.branches[0]?.toPhaseKey ?? ""}
                  onChange={(e) => choose(phase.phaseKey, e.target.value)}
                >
                  {phase.branches.map((branch) => (
                    <option key={branch.key} value={branch.toPhaseKey}>
                      {branch.toPhaseKey ? phaseLabelOf(draft.phases, branch.toPhaseKey) : "パスを終了"}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <span>{`病日 ${sheet.dayGroups.length} 日分`}</span>
          </div>

          {sheet.days.length === 0 ? (
            <p className="order-set__empty">病日がありません。</p>
          ) : (
            <div className="lab-timeline__table-wrap pathway-sheet__wrap">
              <table className="lab-timeline__table pathway-sheet__table">
                <thead>
                  {sheet.phased && (
                    <tr>
                      <th className="pathway-sheet__label-col" />
                      {sheet.phaseGroups.map((group) => (
                        <th key={group.phaseKey} colSpan={group.span} className="pathway-sheet__day pathway-sheet__phase">
                          {group.name}
                        </th>
                      ))}
                      <th className="pathway-sheet__filler" />
                    </tr>
                  )}
                  <tr>
                    <th className="pathway-sheet__label-col" rowSpan={sheet.split ? 3 : 2} />
                    {sheet.dayGroups.map((group) => (
                      <th key={group.days[0].eventId} colSpan={group.days.length} className="pathway-sheet__day">
                        <span className="pathway-sheet__day-no">{group.elapsedDays}</span>
                        <span className="pathway-sheet__day-title">{group.title}</span>
                      </th>
                    ))}
                    <th className="pathway-sheet__filler" rowSpan={sheet.split ? 3 : 2} />
                  </tr>
                  <tr>
                    {sheet.dayGroups.map((group) => (
                      <th
                        key={group.days[0].eventId}
                        colSpan={group.days.length}
                        className="pathway-sheet__day pathway-sheet__day-date"
                      >
                        {group.date.slice(5).replace("-", "/")}
                      </th>
                    ))}
                  </tr>
                  {sheet.split && (
                    <tr>
                      {sheet.days.map((day) => {
                        const group = sheet.dayGroups.find((g) => g.days.includes(day));
                        return (
                          <th key={day.eventId} className="pathway-sheet__day pathway-sheet__day-step">
                            {group && group.days.length > 1 ? pathStepLabel(day.pathStep, day.pathStepName) : ""}
                          </th>
                        );
                      })}
                    </tr>
                  )}
                </thead>
                <tbody>
                  {visibleRows.map((row) => {
                    const collapsed = collapsedUnits.has(row.key);
                    return (
                      <tr key={row.key} className={`pathway-sheet__row pathway-sheet__row--${row.kind}`}>
                        <th scope="row" className="pathway-sheet__label-col">
                          {row.kind === "unit" && (
                            <button
                              type="button"
                              className="pathway-sheet__toggle"
                              onClick={() => toggleUnit(row.key)}
                              aria-expanded={!collapsed}
                              disabled={row.childCount === 0}
                              title={collapsed ? "観察項目とタスクを開く" : "観察項目とタスクを畳む"}
                            >
                              {row.childCount === 0 ? "" : collapsed ? "▸" : "▾"}
                            </button>
                          )}
                          {row.kind === "unit" && row.critical && (
                            <span className="pathway-sheet__critical" title="重要アウトカム">
                              ★
                            </span>
                          )}
                          {row.kind === "task" && <span className="pathway-task__template-label">{row.categoryLabel}</span>}
                          <span
                            className="pathway-sheet__label"
                            title={row.properValue ? `${row.label}（適正値: ${row.properValue}）` : row.label}
                          >
                            {row.label}
                          </span>
                          {row.properValue && <span className="pathway-sheet__proper">{row.properValue}</span>}
                        </th>
                        {sheet.days.map((day, dayIndex) => {
                          const cell = row.cells.get(day.eventId);
                          if (!cell) return <td key={day.eventId} className="pathway-sheet__cell" />;
                          const fromPrev = dayIndex > 0 && row.cells.has(sheet.days[dayIndex - 1].eventId);
                          const toNext = dayIndex < sheet.days.length - 1 && row.cells.has(sheet.days[dayIndex + 1].eventId);
                          const properValue = row.kind === "assessment" ? (cell as SheetAssessmentCell).properValue : "";
                          const task = row.kind === "task" ? tasks.get((cell as SheetTaskCell).procedureId) : undefined;
                          const template = task?.template ?? null;
                          if (task && template) {
                            return (
                              <td key={day.eventId} className="pathway-sheet__cell">
                                <button
                                  type="button"
                                  className="pathway-sheet__cell-button"
                                  title={template.label || undefined}
                                  onClick={() => setTemplateTask(task)}
                                >
                                  <PathwaySeriesLink fromPrev={fromPrev} toNext={toNext}>
                                    <span className="pathway-sheet__task">☐</span>
                                    <span className="pathway-sheet__order">
                                      {isOrderSetOrderType(template.orderType)
                                        ? ORDER_SET_TYPE_LABELS[template.orderType]
                                        : "オーダー"}
                                    </span>
                                  </PathwaySeriesLink>
                                </button>
                              </td>
                            );
                          }
                          return (
                            <td
                              key={day.eventId}
                              className={`pathway-sheet__cell${row.kind === "unit" ? " pathway-sheet__cell--unit" : ""}`}
                              title={properValue ? `適正値: ${properValue}` : undefined}
                            >
                              <span className="pathway-sheet__cell-static">
                                <PathwaySeriesLink fromPrev={fromPrev} toNext={toNext}>
                                  {row.kind === "task" ? (
                                    <span className="pathway-sheet__task">☐</span>
                                  ) : (
                                    <span className="pathway-sheet__planned">{row.kind === "unit" ? "●" : "○"}</span>
                                  )}
                                </PathwaySeriesLink>
                              </span>
                            </td>
                          );
                        })}
                        <td className="pathway-sheet__filler" />
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Modal>
      {templateTask?.template && (
        <PathwayTaskTemplateModal
          taskName={templateTask.name}
          template={templateTask.template}
          defaultOrderType={templateTask.template.orderType}
          setting={draft.setting}
          readOnly
          onClose={() => setTemplateTask(null)}
        />
      )}
    </>
  );
}
