import { useState } from "react";
import { useAddUnplannedUnit, usePathwayApplicationTree } from "../api/queries";
import {
  PATHWAY_EVENT_ID_SYSTEM,
  buildUnplannedUnitBundle,
} from "../fhir/pathwayApplyHelpers";
import { TASK_CATEGORY_LV1_OPTIONS, eventDayLabel, taskCategoryLv2Options } from "../fhir/pathwayHelpers";
import { useValidationError } from "../hooks/useValidationError";
import { ErrorBanner } from "./ErrorBanner";

// 予定外のアウトカム(OAT ユニット)の追加。パスシートの見出しから開き、選んだ病日に
// アウトカム 1 件と、任意で観察項目・タスクを足す。設計は docs/clinical-pathway-design.md §7.6。

interface PathwayUnplannedPanelProps {
  patientId: string;
  applyId: string;
  /** 既定で選ぶ病日(今日の病日)。無ければ最初の病日。 */
  defaultEventId?: string;
  onSaved: () => void;
}

interface TaskRow {
  name: string;
  categoryLv1: string;
  categoryLv2: string;
}

export function PathwayUnplannedPanel({ patientId, applyId, defaultEventId, onSaved }: PathwayUnplannedPanelProps) {
  const tree = usePathwayApplicationTree(applyId);
  const add = useAddUnplannedUnit();
  const [validationError, setValidationError, validationErrorRef] = useValidationError();
  const [eventId, setEventId] = useState(defaultEventId ?? "");
  const [name, setName] = useState("");
  const [critical, setCritical] = useState(false);
  const [assessments, setAssessments] = useState<string[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);

  if (tree.isPending) return <p>読み込み中...</p>;
  if (tree.error || !tree.data?.application) return <ErrorBanner error={tree.error} />;
  const application = tree.data.application;
  const events = application.events;
  const selected = events.find((e) => e.id === eventId) ?? events[0];

  function updateTask(index: number, patch: Partial<TaskRow>) {
    setTasks((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function handleSave() {
    if (!selected) return;
    if (!name.trim()) {
      setValidationError("アウトカムを入力してください");
      return;
    }
    const emptyTask = tasks.find((t) => !t.name.trim());
    if (emptyTask) {
      setValidationError("タスクの名称を入力してください");
      return;
    }
    setValidationError(null);
    const eventCarePlan = tree.data?.carePlans.get(selected.id);
    const eventIdentifier =
      eventCarePlan?.identifier?.find((i) => i.system === PATHWAY_EVENT_ID_SYSTEM)?.value ?? "";
    const bundle = buildUnplannedUnitBundle({
      patientId,
      encounterId: application.encounterId || undefined,
      applyCarePlanId: application.id,
      eventCarePlanId: selected.id,
      eventId: eventIdentifier,
      date: selected.date,
      name: name.trim(),
      critical,
      assessments: assessments.map((a) => a.trim()).filter(Boolean),
      tasks: tasks.map((t) => ({ ...t, name: t.name.trim() })),
      existingUnitCount: selected.units.length,
    });
    add.mutate(bundle, { onSuccess: onSaved });
  }

  return (
    <div className="pathway-evaluate">
      {validationError && (
        <div className="error-banner" role="alert" ref={validationErrorRef}>
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}
      <ErrorBanner error={add.error} />

      <div className="chemo-calendar__summary pathway-evaluate__head">
        <span className="pathway-sheet__name">{application.title}</span>
        <span>入院 {application.periodStart}</span>
      </div>

      <fieldset className="regimen-apply__fields">
        <legend>アウトカム</legend>
        <div className="lab-order-item__fields">
          <label>
            病日
            <select value={selected?.id ?? ""} onChange={(e) => setEventId(e.target.value)}>
              {events.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.elapsedDays} {eventDayLabel(event.elapsedDays, event.title)} {event.date}
                </option>
              ))}
            </select>
          </label>
          <label className="pathway-apply__check">
            <input type="checkbox" checked={critical} onChange={(e) => setCritical(e.target.checked)} />
            重要アウトカム
          </label>
        </div>
        <input
          type="text"
          className="pathway-unplanned__name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="アウトカム"
        />
      </fieldset>

      <fieldset className="regimen-apply__fields">
        <legend>観察項目</legend>
        <table className="master-search__table pathway-evaluate__rows">
          <tbody>
            {assessments.map((value, index) => (
              <tr key={index}>
                <td>
                  <input
                    type="text"
                    value={value}
                    onChange={(e) =>
                      setAssessments((rows) => rows.map((row, i) => (i === index ? e.target.value : row)))
                    }
                    aria-label={`観察項目 ${index + 1}`}
                  />
                </td>
                <td className="pathway-rows__tools">
                  <button
                    type="button"
                    onClick={() => setAssessments((rows) => rows.filter((_, i) => i !== index))}
                  >
                    外す
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="lab-order-item__actions">
          <button type="button" onClick={() => setAssessments((rows) => [...rows, ""])}>
            ＋ 観察項目
          </button>
        </div>
      </fieldset>

      <fieldset className="regimen-apply__fields">
        <legend>タスク</legend>
        <table className="master-search__table pathway-evaluate__rows pathway-unplanned__tasks">
          <tbody>
            {tasks.map((task, index) => (
              <tr key={index}>
                <td>
                  <select
                    value={task.categoryLv1}
                    onChange={(e) => updateTask(index, { categoryLv1: e.target.value, categoryLv2: "" })}
                    aria-label={`タスク ${index + 1} の分類`}
                  >
                    {TASK_CATEGORY_LV1_OPTIONS.map((option) => (
                      <option key={option.code} value={option.code}>
                        {option.display}
                      </option>
                    ))}
                  </select>
                  <select
                    value={task.categoryLv2}
                    onChange={(e) => updateTask(index, { categoryLv2: e.target.value })}
                    aria-label={`タスク ${index + 1} の中分類`}
                  >
                    <option value="">(未指定)</option>
                    {taskCategoryLv2Options(task.categoryLv1 as never).map((option) => (
                      <option key={option.code} value={option.code}>
                        {option.display}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    type="text"
                    value={task.name}
                    onChange={(e) => updateTask(index, { name: e.target.value })}
                    aria-label={`タスク ${index + 1} の名称`}
                  />
                </td>
                <td className="pathway-rows__tools">
                  <button type="button" onClick={() => setTasks((rows) => rows.filter((_, i) => i !== index))}>
                    外す
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="lab-order-item__actions">
          <button
            type="button"
            onClick={() => setTasks((rows) => [...rows, { name: "", categoryLv1: "TP", categoryLv2: "" }])}
          >
            ＋ タスク
          </button>
        </div>
      </fieldset>

      <div className="lab-order-item__actions">
        <button type="button" onClick={handleSave} disabled={add.isPending}>
          {add.isPending ? "追加中..." : "追加する"}
        </button>
      </div>
    </div>
  );
}
