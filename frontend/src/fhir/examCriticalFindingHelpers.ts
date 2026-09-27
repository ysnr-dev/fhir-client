import type { ExamReportConfig } from "./examReportHelpers";
import {
  buildCancelledNotificationTask,
  buildNotificationTask,
  notificationTaskEntry,
  taskInputOf,
  taskOwnerName,
  taskPatientId,
  type NotificationRowBase,
} from "./notificationHelpers";

// 検査レポート(読影・生理検査・内視鏡)の重要所見の通知(docs/rad-report-design.md §6.2)。
//
//   DiagnosticReport(検査レポート) ← focus ── Task(通知) ── owner → 依頼医
//
// 記載医が「重要所見あり」として要点を書くと、依頼医あてにアラートの通知を出す。
// 気胸・大動脈解離・致死的不整脈のような所見は確定前でも伝える必要があるので、暫定報告でも出す
// (検体検査の緊急異常値が中間報告でも出るのと同じ)。確認は通知を完了にして note に
// 誰がいつを残すだけで、来歴(Provenance)は作らない。
//
// Task.code は種別ごとに分ける(ExamReportConfig.critical.taskCode)。

export const EXAM_CRITICAL_FINDING_NOTE = "重要所見を確認しました。";

// 一覧に出す内容は Task.input に持つ(上流の `_include=Task:focus` は ServiceRequest しか返さない)。
// 見出しは「撮影日」「検査日」のように種別の呼び方に合わせる。
const dateInput = (config: ExamReportConfig) => `${config.labels.exam}日`;
const examInput = (config: ExamReportConfig) => `${config.labels.exam}内容`;
const POINT_INPUT = "要点";

export interface ExamCriticalFindingTaskInput {
  /** 焦点。同じ transaction で作るレポートは urn:uuid、更新は DiagnosticReport/{id}。 */
  reportReference: string;
  patientId: string;
  /** 宛先(依頼医)。 */
  owner?: fhir4.Reference;
  /** 検査日(YYYY-MM-DD)。 */
  date: string;
  exam: string;
  /** 重要所見の要点。空なら通知を出さない。 */
  point: string;
  basedOn?: fhir4.Reference[];
}

export function buildExamCriticalFindingTask(
  config: ExamReportConfig,
  input: ExamCriticalFindingTaskInput,
  existing?: fhir4.Task,
): fhir4.Task {
  return buildNotificationTask(
    {
      code: config.critical.taskCode,
      // 伝達が遅れると患者に害が出る所見なので、緊急異常値と同じくアラートにする。
      severity: "alert",
      focusReference: input.reportReference,
      patientId: input.patientId,
      owner: input.owner,
      basedOn: input.basedOn,
      description: [input.date, input.exam, input.point].filter(Boolean).join(" "),
      input: [
        { type: { text: dateInput(config) }, valueDate: input.date },
        { type: { text: examInput(config) }, valueString: input.exam },
        { type: { text: POINT_INPUT }, valueString: input.point },
      ],
    },
    existing,
  );
}

/**
 * レポート保存の transaction に足す通知の entry。
 *
 *   要点あり・通知なし                → 作る
 *   要点あり・要点が同じ(取り下げ以外) → そのまま
 *   要点あり・要点が変わった           → 書き換えて未確認に戻す
 *   要点なし・未確認の通知あり         → 取り下げる
 *   要点なし・確認済みの通知あり       → そのまま(確認した事実は残す)
 */
export function examCriticalFindingEntries(
  config: ExamReportConfig,
  input: ExamCriticalFindingTaskInput,
  existing: fhir4.Task | undefined,
): fhir4.BundleEntry[] {
  const point = input.point.trim();
  if (!point) {
    if (existing?.status === "requested") {
      return [notificationTaskEntry(buildCancelledNotificationTask(existing), existing.id)];
    }
    return [];
  }
  if (
    existing &&
    existing.status !== "cancelled" &&
    taskInputOf(existing, POINT_INPUT)?.valueString === point
  ) {
    return [];
  }
  return [
    notificationTaskEntry(
      buildExamCriticalFindingTask(config, { ...input, point }, existing),
      existing?.id,
    ),
  ];
}

export interface ExamCriticalFindingRow extends NotificationRowBase {
  reportId: string;
  date: string;
  exam: string;
  point: string;
}

export function examCriticalFindingRowOf(
  config: ExamReportConfig,
  task: fhir4.Task,
  patient: fhir4.Patient | undefined,
): ExamCriticalFindingRow {
  return {
    task,
    patient,
    patientId: taskPatientId(task),
    authoredOn: task.authoredOn ?? "",
    ownerName: taskOwnerName(task),
    reportId: task.focus?.reference?.match(/^DiagnosticReport\/(.+)$/)?.[1] ?? "",
    date: taskInputOf(task, dateInput(config))?.valueDate ?? "",
    exam: taskInputOf(task, examInput(config))?.valueString ?? "",
    point: taskInputOf(task, POINT_INPUT)?.valueString ?? task.description ?? "",
  };
}
