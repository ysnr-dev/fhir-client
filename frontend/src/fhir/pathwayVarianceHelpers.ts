import {
  buildCancelledNotificationTask,
  buildNotificationTask,
  hasTaskCode,
  notificationTaskEntry,
  taskInputOf,
  taskOwnerName,
  taskPatientId,
  type NotificationRowBase,
} from "./notificationHelpers";
import type { PathwayOatUnitRecord } from "./pathwayApplyHelpers";
import type { Achievement } from "./pathwayEvaluationHelpers";

// クリニカルパスのバリアンスの通知。
//
//   評価の Observation ← focus ── Task(通知) ── owner → 主治医
//                                      └ basedOn → OAT ユニットの CarePlan
//
// ［決定］通知するのは**重要アウトカム(critical)を「未達成」と記録したときだけ**。重要でないアウトカムの
// 未達成まで届けると数が多く、主治医が見るべきものが埋もれる(パスシートの「バリアンス」の件数で見られる)。
// 強度は注意(順番を上げて見てほしいが、緊急異常値ほど急がない)。
// 同じアウトカムを未達成のまま記録し直しても出し直さない。未達成から達成・未評価に直したら、未対応の通知は取り下げる。
// 設計は docs/clinical-pathway-design.md §7.10。

export const PATHWAY_VARIANCE_TASK_CODE = { code: "pathway-variance", display: "パスのバリアンス" };

/** 確認したときに通知へ残す文。 */
export const PATHWAY_VARIANCE_NOTE = "バリアンスを確認しました。";

// 一覧に出す内容は Task.input に構造化して持つ(上流の `_include=Task:focus` は ServiceRequest しか返さない)。
const PATHWAY_INPUT = "パス名";
const APPLY_INPUT = "適用";
const EVENT_INPUT = "病日";
const EVENT_LABEL_INPUT = "病日の表示";
const DATE_INPUT = "対象日";
const UNIT_INPUT = "アウトカム";

export function isPathwayVarianceTask(task: fhir4.Task): boolean {
  return hasTaskCode(task, PATHWAY_VARIANCE_TASK_CODE.code);
}

/** 通知を作るのに要る、アウトカムの外側の情報(評価を記録する画面が組み立てる)。 */
export interface PathwayVarianceNotice {
  patientId: string;
  /** 宛先(主治医)。入院に主治医が無いときは省く。 */
  owner?: fhir4.Reference;
  /** 記録した人。 */
  requester?: fhir4.Reference;
  pathwayTitle: string;
  /** 適用(木の根)の CarePlan の id。カルテのパスタブで開くのに使う。 */
  applyId: string;
  event: { id: string; label: string; date: string };
  /** OAT ユニットの CarePlan の id → これまでの通知。 */
  tasksByUnitId: Map<string, fhir4.Task>;
}

/** 患者の通知から、OAT ユニット(basedOn の CarePlan)ごとの最新の 1 件。 */
export function varianceTasksByUnitId(tasks: fhir4.Task[]): Map<string, fhir4.Task> {
  const map = new Map<string, fhir4.Task>();
  for (const task of tasks) {
    if (!isPathwayVarianceTask(task)) continue;
    const unitId = task.basedOn?.map((ref) => ref.reference?.match(/^CarePlan\/(.+)$/)?.[1]).find(Boolean);
    if (!unitId) continue;
    const current = map.get(unitId);
    if (!current || (task.authoredOn ?? "") > (current.authoredOn ?? "")) map.set(unitId, task);
  }
  return map;
}

/**
 * 評価の transaction に足す通知の entry。
 * - 重要アウトカムが新しく未達成になった → 通知を作る(前の通知があれば書き換えて未対応に戻す)
 * - 未達成のまま記録し直した → 何もしない
 * - 未達成でなくなった(重要でないアウトカムも含む) → 未対応の通知があれば取り下げる
 * focusReference は評価の Observation(同じ transaction で作るなら urn:uuid)。
 */
export function pathwayVarianceTaskEntries(
  notice: PathwayVarianceNotice,
  unit: PathwayOatUnitRecord,
  achievement: Achievement | "",
  previousAchievement: Achievement | "",
  focusReference: string | null,
): fhir4.BundleEntry[] {
  const existing = notice.tasksByUnitId.get(unit.id);
  const variance = achievement === "2" && unit.critical;
  if (!variance) {
    return existing?.id && existing.status === "requested"
      ? [notificationTaskEntry(buildCancelledNotificationTask(existing), existing.id)]
      : [];
  }
  if (previousAchievement === "2" && existing) return [];
  if (!focusReference) return [];

  const task = buildNotificationTask(
    {
      code: PATHWAY_VARIANCE_TASK_CODE,
      severity: "caution",
      focusReference,
      patientId: notice.patientId,
      owner: notice.owner,
      requester: notice.requester,
      basedOn: [{ reference: `CarePlan/${unit.id}` }],
      description: [notice.pathwayTitle, notice.event.label, unit.name, "未達成"].filter(Boolean).join(" "),
      input: [
        { type: { text: PATHWAY_INPUT }, valueString: notice.pathwayTitle },
        { type: { text: APPLY_INPUT }, valueString: notice.applyId },
        { type: { text: EVENT_INPUT }, valueString: notice.event.id },
        { type: { text: EVENT_LABEL_INPUT }, valueString: notice.event.label },
        { type: { text: DATE_INPUT }, valueDate: notice.event.date },
        { type: { text: UNIT_INPUT }, valueString: unit.name },
      ],
    },
    existing,
  );
  return [notificationTaskEntry(task, existing?.id)];
}

export interface PathwayVarianceRow extends NotificationRowBase {
  pathwayTitle: string;
  applyId: string;
  eventId: string;
  eventLabel: string;
  date: string;
  unitName: string;
}

export function pathwayVarianceRowOf(task: fhir4.Task, patient: fhir4.Patient | undefined): PathwayVarianceRow {
  return {
    task,
    patient,
    patientId: taskPatientId(task),
    authoredOn: task.authoredOn ?? "",
    ownerName: taskOwnerName(task),
    pathwayTitle: taskInputOf(task, PATHWAY_INPUT)?.valueString ?? "",
    applyId: taskInputOf(task, APPLY_INPUT)?.valueString ?? "",
    eventId: taskInputOf(task, EVENT_INPUT)?.valueString ?? "",
    eventLabel: taskInputOf(task, EVENT_LABEL_INPUT)?.valueString ?? "",
    date: taskInputOf(task, DATE_INPUT)?.valueDate ?? "",
    unitName: taskInputOf(task, UNIT_INPUT)?.valueString ?? "",
  };
}
