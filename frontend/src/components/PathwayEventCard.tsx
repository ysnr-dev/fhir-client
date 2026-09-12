import type { PathwayCodeSystem, PathwayOutcomeCategory, PathwayTaskCategoryLv1 } from "../api/masterClient";
import {
  ASSESSMENT_CATEGORY_SUGGESTIONS,
  CODE_SYSTEM_OPTIONS,
  OUTCOME_CATEGORY_OPTIONS,
  TASK_CATEGORY_LV1_OPTIONS,
  defaultDayLabel,
  emptyAssessmentDraft,
  emptyTaskDraft,
  emptyOatUnitDraft,
  eventDayOf,
  taskCategoryLv2Options,
  templateSummary,
  type PathwayAssessmentDraft,
  type PathwayEventDraft,
  type PathwayOatUnitDraft,
  type PathwayTaskDraft,
} from "../fhir/pathwayHelpers";
import { ORDER_SET_TYPE_LABELS } from "./orderSetRegistry";
import { isOrderSetOrderType } from "../fhir/orderSetHelpers";
import { RowMenu } from "./RowMenu";

// パス定義の病日カードと、その中の OAT ユニットカード。1 病日 = 1 カードで、OAT ユニット
// (アウトカム + 観察項目 + タスク)を縦に積む。検索モーダルと雛形モーダルはページが開くので、
// ここは「どの行で押されたか」を返すだけ。

export function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9L12 4M6.5 6.5v5M9.5 6.5v5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function moveItem<T>(items: T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (target < 0 || target >= items.length) return items;
  const next = items.slice();
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

interface EventCardProps {
  event: PathwayEventDraft;
  onChange: (patch: Partial<PathwayEventDraft>) => void;
  /** 病日の入力を確定したとき(ページが病日順に並べ直す)。 */
  onDayCommit: () => void;
  onCopy: () => void;
  onRemove: () => void;
  onPickNursingObservation: (unitKey: number, assessmentKey: number) => void;
  onEditTemplate: (unitKey: number, taskKey: number) => void;
}

export function PathwayEventCard({
  event,
  onChange,
  onDayCommit,
  onCopy,
  onRemove,
  onPickNursingObservation,
  onEditTemplate,
}: EventCardProps) {
  const day = eventDayOf(event);

  function updateUnit(unitKey: number, patch: Partial<PathwayOatUnitDraft>) {
    onChange({ oatUnits: event.oatUnits.map((u) => (u.key === unitKey ? { ...u, ...patch } : u)) });
  }

  return (
    <section className="pathway-event">
      <div className="pathway-event__head">
        <label className="pathway-event__day">
          病日
          <input
            type="number"
            step={1}
            value={event.elapsedDays}
            onChange={(e) => onChange({ elapsedDays: e.target.value })}
            onBlur={onDayCommit}
          />
        </label>
        <label className="pathway-event__title">
          見出し
          <input
            type="text"
            value={event.title}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder={day !== null && day !== 0 ? defaultDayLabel(day) : undefined}
          />
        </label>
        <label className="pathway-event__note">
          備考
          <input type="text" value={event.note} onChange={(e) => onChange({ note: e.target.value })} />
        </label>
        <div className="pathway-event__tools">
          <RowMenu label={`病日 ${event.elapsedDays} の操作`}>
            <button type="button" className="row-menu__item" onClick={onCopy}>
              この日を複製
            </button>
            <button type="button" className="row-menu__item row-menu__item--danger" onClick={onRemove}>
              この日を削除
            </button>
          </RowMenu>
        </div>
      </div>

      {event.oatUnits.map((unit, index) => (
        <PathwayOatUnitCard
          key={unit.key}
          unit={unit}
          index={index}
          count={event.oatUnits.length}
          onChange={(patch) => updateUnit(unit.key, patch)}
          onMove={(delta) => onChange({ oatUnits: moveItem(event.oatUnits, index, delta) })}
          onRemove={() => onChange({ oatUnits: event.oatUnits.filter((u) => u.key !== unit.key) })}
          onPickNursingObservation={(assessmentKey) => onPickNursingObservation(unit.key, assessmentKey)}
          onEditTemplate={(taskKey) => onEditTemplate(unit.key, taskKey)}
        />
      ))}
      <div className="lab-order-item__actions">
        <button type="button" onClick={() => onChange({ oatUnits: [...event.oatUnits, emptyOatUnitDraft()] })}>
          ＋ OAT ユニット
        </button>
      </div>
    </section>
  );
}

interface UnitCardProps {
  unit: PathwayOatUnitDraft;
  index: number;
  count: number;
  onChange: (patch: Partial<PathwayOatUnitDraft>) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
  onPickNursingObservation: (assessmentKey: number) => void;
  onEditTemplate: (taskKey: number) => void;
}

function PathwayOatUnitCard({
  unit,
  index,
  count,
  onChange,
  onMove,
  onRemove,
  onPickNursingObservation,
  onEditTemplate,
}: UnitCardProps) {
  function updateAssessment(key: number, patch: Partial<PathwayAssessmentDraft>) {
    onChange({ assessments: unit.assessments.map((a) => (a.key === key ? { ...a, ...patch } : a)) });
  }

  function removeAssessment(assessment: PathwayAssessmentDraft) {
    onChange({
      assessments: unit.assessments.filter((a) => a.key !== assessment.key),
      // 消した観察項目に結んでいたタスクは結びを外す。
      tasks: unit.tasks.map((t) =>
        t.assessmentKey === assessment.assessmentKey ? { ...t, assessmentKey: "" } : t,
      ),
    });
  }

  function updateTask(key: number, patch: Partial<PathwayTaskDraft>) {
    onChange({ tasks: unit.tasks.map((t) => (t.key === key ? { ...t, ...patch } : t)) });
  }

  return (
    <div className={`pathway-unit${unit.critical ? " pathway-unit--critical" : ""}`}>
      <div className="pathway-unit__head">
        <span className="pathway-unit__index">{index + 1}</span>
        <label className="pathway-unit__name">
          アウトカム
          <input type="text" value={unit.name} onChange={(e) => onChange({ name: e.target.value })} />
        </label>
        <label>
          区分
          <select
            value={unit.category}
            onChange={(e) => onChange({ category: e.target.value as PathwayOutcomeCategory | "" })}
          >
            <option value="">未指定</option>
            {OUTCOME_CATEGORY_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.display}
              </option>
            ))}
          </select>
        </label>
        <label className="pathway-unit__check">
          <input type="checkbox" checked={unit.critical} onChange={(e) => onChange({ critical: e.target.checked })} />
          重要
        </label>
        <label>
          コード
          <span className="pathway-unit__code">
            <select
              value={unit.codeSystem}
              onChange={(e) => onChange({ codeSystem: e.target.value as PathwayCodeSystem | "" })}
            >
              <option value="">なし</option>
              {CODE_SYSTEM_OPTIONS.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.display}
                </option>
              ))}
            </select>
            <input
              type="text"
              className="regimen-editor__code-input"
              value={unit.code}
              onChange={(e) => onChange({ code: e.target.value })}
              disabled={!unit.codeSystem}
            />
          </span>
        </label>
        <div className="pathway-unit__tools">
          <button type="button" className="rp-card__icon-button" onClick={() => onMove(-1)} disabled={index === 0} aria-label="上へ">
            ↑
          </button>
          <button
            type="button"
            className="rp-card__icon-button"
            onClick={() => onMove(1)}
            disabled={index === count - 1}
            aria-label="下へ"
          >
            ↓
          </button>
          <button type="button" className="rp-card__icon-button" onClick={onRemove} aria-label="OAT ユニットを削除">
            <TrashIcon />
          </button>
        </div>
      </div>

      <div className="pathway-unit__body">
        <div className="pathway-unit__block">
          <h4>観察項目</h4>
          {unit.assessments.length > 0 && (
            <table className="master-search__table regimen-editor__rows pathway-rows">
              <thead>
                <tr>
                  <th>名称</th>
                  <th>分類</th>
                  <th>コード</th>
                  <th>適正値</th>
                  <th>看護観察</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {unit.assessments.map((a, i) => (
                  <tr key={a.key}>
                    <td>
                      <input
                        type="text"
                        className="pathway-rows__name"
                        value={a.name}
                        onChange={(e) => updateAssessment(a.key, { name: e.target.value })}
                      />
                    </td>
                    <td>
                      <span className="pathway-unit__code">
                        <input
                          type="text"
                          className="pathway-rows__short"
                          list="pathway-assessment-categories"
                          value={a.categoryCode}
                          onChange={(e) => {
                            const code = e.target.value;
                            const known = ASSESSMENT_CATEGORY_SUGGESTIONS.find((s) => s.code === code);
                            updateAssessment(a.key, {
                              categoryCode: code,
                              categoryName: known ? known.display : a.categoryName,
                            });
                          }}
                        />
                        <input
                          type="text"
                          value={a.categoryName}
                          onChange={(e) => updateAssessment(a.key, { categoryName: e.target.value })}
                        />
                      </span>
                    </td>
                    <td>
                      <span className="pathway-unit__code">
                        <select
                          value={a.codeSystem}
                          onChange={(e) =>
                            updateAssessment(a.key, { codeSystem: e.target.value as PathwayCodeSystem | "" })
                          }
                        >
                          <option value="">なし</option>
                          {CODE_SYSTEM_OPTIONS.map((o) => (
                            <option key={o.code} value={o.code}>
                              {o.display}
                            </option>
                          ))}
                        </select>
                        <input
                          type="text"
                          className="regimen-editor__code-input"
                          value={a.code}
                          onChange={(e) => updateAssessment(a.key, { code: e.target.value })}
                          disabled={!a.codeSystem}
                        />
                      </span>
                    </td>
                    <td>
                      <input
                        type="text"
                        value={a.properValue}
                        onChange={(e) => updateAssessment(a.key, { properValue: e.target.value })}
                      />
                    </td>
                    <td>
                      <span className="pathway-unit__code">
                        {a.nursingObservationManageNo && (
                          <span className="lab-order-item__code">{a.nursingObservationManageNo}</span>
                        )}
                        <button type="button" onClick={() => onPickNursingObservation(a.key)}>
                          {a.nursingObservationManageNo ? "変更" : "選択"}
                        </button>
                        {a.nursingObservationManageNo && (
                          <button
                            type="button"
                            onClick={() => updateAssessment(a.key, { nursingObservationManageNo: "" })}
                          >
                            外す
                          </button>
                        )}
                      </span>
                    </td>
                    <td className="pathway-rows__tools">
                      <button
                        type="button"
                        className="rp-card__icon-button"
                        onClick={() => onChange({ assessments: moveItem(unit.assessments, i, -1) })}
                        disabled={i === 0}
                        aria-label="上へ"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="rp-card__icon-button"
                        onClick={() => onChange({ assessments: moveItem(unit.assessments, i, 1) })}
                        disabled={i === unit.assessments.length - 1}
                        aria-label="下へ"
                      >
                        ↓
                      </button>
                      <button type="button" className="rp-card__icon-button" onClick={() => removeAssessment(a)} aria-label="削除">
                        <TrashIcon />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="lab-order-item__actions">
            <button
              type="button"
              onClick={() => onChange({ assessments: [...unit.assessments, emptyAssessmentDraft()] })}
            >
              ＋ 観察項目
            </button>
          </div>
        </div>

        <div className="pathway-unit__block">
          <h4>タスク</h4>
          {unit.tasks.length > 0 && (
            <table className="master-search__table regimen-editor__rows pathway-rows">
              <thead>
                <tr>
                  <th>分類</th>
                  <th>名称</th>
                  {unit.assessments.length > 0 && <th>観察項目</th>}
                  <th>オーダー雛形</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {unit.tasks.map((t, i) => (
                  <tr key={t.key}>
                    <td>
                      <span className="pathway-unit__code">
                        <select
                          value={t.categoryLv1}
                          onChange={(e) =>
                            updateTask(t.key, {
                              categoryLv1: e.target.value as PathwayTaskCategoryLv1,
                              categoryLv2: "",
                            })
                          }
                        >
                          {TASK_CATEGORY_LV1_OPTIONS.map((o) => (
                            <option key={o.code} value={o.code}>
                              {o.display}
                            </option>
                          ))}
                        </select>
                        {taskCategoryLv2Options(t.categoryLv1).length > 0 && (
                          <select
                            value={t.categoryLv2}
                            onChange={(e) => updateTask(t.key, { categoryLv2: e.target.value })}
                          >
                            <option value="">—</option>
                            {taskCategoryLv2Options(t.categoryLv1).map((o) => (
                              <option key={o.code} value={o.code}>
                                {o.display}
                              </option>
                            ))}
                          </select>
                        )}
                      </span>
                    </td>
                    <td>
                      <input
                        type="text"
                        className="pathway-rows__name"
                        value={t.name}
                        onChange={(e) => updateTask(t.key, { name: e.target.value })}
                      />
                    </td>
                    {unit.assessments.length > 0 && (
                      <td>
                        <select
                          value={t.assessmentKey}
                          onChange={(e) => updateTask(t.key, { assessmentKey: e.target.value })}
                        >
                          <option value="">—</option>
                          {unit.assessments.map((a) => (
                            <option key={a.assessmentKey} value={a.assessmentKey}>
                              {a.name || "(名称未入力)"}
                            </option>
                          ))}
                        </select>
                      </td>
                    )}
                    <td className="pathway-task__template">
                      {t.template ? (
                        <>
                          <span className="pathway-task__template-label">
                            {isOrderSetOrderType(t.template.orderType)
                              ? ORDER_SET_TYPE_LABELS[t.template.orderType]
                              : t.template.orderType}
                          </span>
                          <span className="pathway-task__template-summary">{templateSummary(t.template)}</span>
                          {!t.template.unsupported && (
                            <button type="button" onClick={() => onEditTemplate(t.key)}>
                              編集
                            </button>
                          )}
                          <button type="button" onClick={() => updateTask(t.key, { template: null })}>
                            外す
                          </button>
                        </>
                      ) : (
                        <button type="button" onClick={() => onEditTemplate(t.key)}>
                          ＋ オーダー
                        </button>
                      )}
                    </td>
                    <td className="pathway-rows__tools">
                      <button
                        type="button"
                        className="rp-card__icon-button"
                        onClick={() => onChange({ tasks: moveItem(unit.tasks, i, -1) })}
                        disabled={i === 0}
                        aria-label="上へ"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="rp-card__icon-button"
                        onClick={() => onChange({ tasks: moveItem(unit.tasks, i, 1) })}
                        disabled={i === unit.tasks.length - 1}
                        aria-label="下へ"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="rp-card__icon-button"
                        onClick={() => onChange({ tasks: unit.tasks.filter((x) => x.key !== t.key) })}
                        aria-label="削除"
                      >
                        <TrashIcon />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="lab-order-item__actions">
            <button type="button" onClick={() => onChange({ tasks: [...unit.tasks, emptyTaskDraft()] })}>
              ＋ タスク
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
