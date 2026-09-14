import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useCurrentPractitioner } from "../api/authQueries";
import {
  useBedWardIndex,
  useInpatientEncounters,
  usePathwayWardTasks,
  useRecordPathwayEvaluation,
} from "../api/queries";
import { encounterBedId, encounterBedLabel, encounterPatientId } from "../fhir/encounterHelpers";
import { buildPathwayTaskBundle } from "../fhir/pathwayEvaluationHelpers";
import { taskCategoryLabel } from "../fhir/pathwayHelpers";
import type { PathwayWardTask } from "../fhir/pathwayWorklistHelpers";
import { displayName } from "../fhir/patientHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { nowFhirDateTime, toFhirDateTime, today } from "../lib/dates";
import type { useReturnLinkState } from "../returnTo";
import { ErrorBanner } from "./ErrorBanner";
import { PatientKana } from "./PatientRowCells";

// 病棟の指示簿の「パスのタスク」。その病棟に入院している患者の、基準日の病日に置かれた
// オーダーを持たないタスク(観察・説明・文書など)を患者ごとに並べ、その場で実施にする。
// オーダー雛形から出したタスクは、看護指示なら上の表に、その他は各部門の画面に出るので含めない。
// 設計は docs/clinical-pathway-design.md §6(看護の指示簿)。

interface PathwayWardTasksProps {
  date: string;
  wardId: string;
  /** 実施予定のビューでは未実施のタスクだけを出す。 */
  onlyUndone: boolean;
  returnLinkState: ReturnType<typeof useReturnLinkState>;
}

interface PatientTasks {
  patientId: string;
  patient?: fhir4.Patient;
  roomLabel: string;
  bedLabel: string;
  tasks: PathwayWardTask[];
}

export function PathwayWardTasks({ date, wardId, onlyUndone, returnLinkState }: PathwayWardTasksProps) {
  const inpatients = useInpatientEncounters(date);
  const { bedWards, error: bedWardError } = useBedWardIndex();
  const record = useRecordPathwayEvaluation();
  const { practitionerId, practitioner } = useCurrentPractitioner();

  // その日にこの病棟のベッドにいた患者(入院のベッドから病棟を引く)。
  const bedByPatientId = useMemo(() => {
    const map = new Map<string, string>();
    for (const encounter of inpatients.data?.encounters ?? []) {
      const patientId = encounterPatientId(encounter);
      const bedId = encounterBedId(encounter);
      if (!patientId || !bedId || bedWards.get(bedId)?.wardId !== wardId || map.has(patientId)) continue;
      map.set(patientId, encounterBedLabel(encounter));
    }
    return map;
  }, [inpatients.data, bedWards, wardId]);
  const tasks = usePathwayWardTasks(date, [...bedByPatientId.keys()]);

  const groups = useMemo<PatientTasks[]>(() => {
    const byPatient = new Map<string, PatientTasks>();
    for (const task of tasks.data ?? []) {
      if (onlyUndone && task.done) continue;
      const bedLabel = bedByPatientId.get(task.patientId) ?? "";
      let group = byPatient.get(task.patientId);
      if (!group) {
        group = {
          patientId: task.patientId,
          patient: inpatients.data?.patientsById.get(task.patientId),
          bedLabel,
          roomLabel: bedLabel.split(" ")[0] ?? "",
          tasks: [],
        };
        byPatient.set(task.patientId, group);
      }
      group.tasks.push(task);
    }
    return [...byPatient.values()].sort((a, b) => a.bedLabel.localeCompare(b.bedLabel, "ja"));
  }, [tasks.data, onlyUndone, bedByPatientId, inpatients.data]);

  const total = groups.reduce((n, g) => n + g.tasks.length, 0);
  const undone = (tasks.data ?? []).filter((t) => !t.done).length;

  function toggle(task: PathwayWardTask) {
    const performer =
      practitionerId && practitioner ? { practitionerId, display: practitionerDisplayName(practitioner) } : null;
    // 今日なら今の時刻、別の日を開いているならその日の今の時刻で記録する(指示簿の実施入力と同じ)。
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const recordedAt = date === today() ? nowFhirDateTime() : toFhirDateTime(`${date}T${time}`);
    record.mutate(buildPathwayTaskBundle(task.procedure, !task.done, recordedAt, performer));
  }

  return (
    <section className="nursing-worklist__pathway">
      <div className="lab-order-item__section-head">
        <h3>パスのタスク</h3>
        {undone > 0 && <span className="nursing-worklist__pending">未実施 {undone} 件</span>}
      </div>
      <ErrorBanner error={record.error ?? tasks.error ?? bedWardError ?? inpatients.error} />

      {tasks.isLoading || inpatients.isLoading ? (
        <p>読み込み中...</p>
      ) : (
        <div className="lab-worklist-wrap sticky-table-wrap">
          <table className="lab-worklist sticky-table">
            <thead>
              <tr>
                <th className="nursing-worklist__check">実施</th>
                <th className="lab-worklist__compact">分類</th>
                <th>タスク</th>
                <th>アウトカム</th>
                <th className="lab-worklist__compact">病日</th>
                <th className="lab-worklist__compact">実施者</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <PatientTaskGroup
                  key={group.patientId}
                  group={group}
                  pending={record.isPending}
                  returnLinkState={returnLinkState}
                  onToggle={toggle}
                />
              ))}
              {groups.length === 0 && (
                <tr>
                  <td colSpan={6} className="master-search__empty">
                    {(tasks.data ?? []).length === 0
                      ? "この日のパスのタスクはありません。"
                      : "未実施のパスのタスクはありません。"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {groups.length > 0 && (
        <p className="order-select__muted lab-worklist__count">
          {groups.length} 人 / {total} 件
        </p>
      )}
    </section>
  );
}

function PatientTaskGroup({
  group,
  pending,
  returnLinkState,
  onToggle,
}: {
  group: PatientTasks;
  pending: boolean;
  returnLinkState: ReturnType<typeof useReturnLinkState>;
  onToggle: (task: PathwayWardTask) => void;
}) {
  const first = group.tasks[0];
  // 患者の名前から、カルテのパスタブをその病日の日めくりで開く。
  const karteLink = first
    ? `/patients/${group.patientId}/karte?tab=pathway&view=${encodeURIComponent(`${first.applyId}~day@${first.eventId}`)}`
    : `/patients/${group.patientId}/karte?tab=pathway`;
  const titles = [...new Set(group.tasks.map((t) => t.applyTitle))];

  return (
    <>
      <tr className="nursing-worklist__patient">
        <th className="nursing-worklist__check" />
        <th colSpan={5}>
          <span className="nursing-worklist__room">{group.roomLabel || "-"}</span>
          {group.patient ? (
            <>
              <Link className="nursing-worklist__name" to={karteLink} state={returnLinkState}>
                {displayName(group.patient)}
              </Link>
              <PatientKana patient={group.patient} />
            </>
          ) : (
            <Link className="nursing-worklist__name" to={karteLink} state={returnLinkState}>
              {group.patientId}
            </Link>
          )}
          <span className="nursing-worklist__pathway-name">{titles.join(" / ")}</span>
        </th>
      </tr>
      {group.tasks.map((task) => (
        <tr key={task.procedure.id} className={task.done ? "nursing-worklist__pathway-done" : undefined}>
          <td className="nursing-worklist__check">
            <input
              type="checkbox"
              checked={task.done}
              disabled={pending}
              onChange={() => onToggle(task)}
              aria-label={`${task.name} を${task.done ? "未実施に戻す" : "実施にする"}`}
            />
          </td>
          <td className="lab-worklist__compact">
            <span className="pathway-task__template-label">{taskCategoryLabel(task.categoryLv1, task.categoryLv2)}</span>
          </td>
          <td>{task.name}</td>
          <td>{task.unitName}</td>
          <td className="lab-worklist__compact">{task.eventLabel}</td>
          <td className="lab-worklist__compact">
            {task.done ? `${task.performerName}${task.performedDateTime ? ` ${task.performedDateTime.slice(11, 16)}` : ""}` : ""}
          </td>
        </tr>
      ))}
    </>
  );
}
