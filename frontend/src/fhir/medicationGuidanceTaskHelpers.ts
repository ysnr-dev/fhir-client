import { createTaskHelpers } from "./taskHelpers";

// 服薬指導の進捗(docs/medication-guidance-order-design.md)。意味は栄養指導・リハビリと同じで、
// 「部門の受け入れ状態」を表す(他部門の「1 回の作業の進捗」とは違う):
//
//   requested … 依頼済(薬剤部がまだ受けていない)
//   accepted  … 受付済(受けた = 実施中。期間中ずっとこの状態で、指導が積み上がる)
//   completed … 終了
//   cancelled … 中止
//
// 日々の指導は Task を動かさず Procedure を足すだけ。担当薬剤師は Task.owner に持つ
// (誰がこの患者を受け持つか。実施した人は Procedure.performer で、別人のこともある)。

export const MEDICATION_GUIDANCE_TASK_CODE = { code: "medication-guidance", display: "服薬指導" };

export type MedicationGuidanceTaskStatus = "requested" | "accepted" | "completed" | "cancelled";

export const MEDICATION_GUIDANCE_TASK_STATUS_OPTIONS: { code: MedicationGuidanceTaskStatus; display: string }[] = [
  { code: "requested", display: "依頼済" },
  // 期間中ずっとこの状態で指導が積み上がるので、待ち行列と誤解されないよう「実施中」と出す。
  { code: "accepted", display: "実施中" },
  { code: "completed", display: "終了" },
  { code: "cancelled", display: "中止" },
];

const helpers = createTaskHelpers<MedicationGuidanceTaskStatus>({
  taskCode: MEDICATION_GUIDANCE_TASK_CODE,
  statusOptions: MEDICATION_GUIDANCE_TASK_STATUS_OPTIONS,
});

export const medicationGuidanceTaskStatusDisplay = helpers.statusDisplay;
export const medicationGuidanceTaskStatus = helpers.taskStatus;
export const medicationGuidanceTasksByOrderId = helpers.tasksByOrderId;
export const buildMedicationGuidanceTaskUpdate = helpers.buildTaskUpdate;

export interface MedicationGuidanceTaskAction {
  label: string;
  next: MedicationGuidanceTaskStatus;
  /** 日常の流れではない操作。ケバブメニューに畳む。 */
  secondary?: true;
}

/** 今のステータスから移れる先(栄養指導と同じ)。終了はオーダーにも終了日を書く。 */
export function medicationGuidanceTaskActions(status: MedicationGuidanceTaskStatus): MedicationGuidanceTaskAction[] {
  switch (status) {
    case "requested":
      return [
        { label: "受付", next: "accepted" },
        { label: "中止", next: "cancelled", secondary: true },
      ];
    case "accepted":
      return [
        { label: "終了", next: "completed", secondary: true },
        { label: "受付取消", next: "requested", secondary: true },
        { label: "中止", next: "cancelled", secondary: true },
      ];
    case "completed":
      return [{ label: "終了取消", next: "accepted", secondary: true }];
    case "cancelled":
      return [{ label: "中止取消", next: "requested", secondary: true }];
  }
}

/** 担当薬剤師。未登録なら null。 */
export function medicationGuidanceAssignee(task: fhir4.Task | undefined): { id: string; name: string } | null {
  const owner = task?.owner;
  const id = owner?.reference?.match(/^Practitioner\/(.+)$/)?.[1];
  return id ? { id, name: owner?.display ?? "" } : null;
}

/**
 * 担当薬剤師を変えた Task。Task がまだ無ければ今の状態のまま作る。null で担当を外す。
 * 状態の変更(buildTaskUpdate)は元の Task を引き継ぐので、担当はそのまま残る。
 */
export function buildMedicationGuidanceAssignment(
  task: fhir4.Task | undefined,
  order: fhir4.ServiceRequest,
  pharmacist: { id: string; name: string } | null,
): fhir4.Task {
  const next = task ?? buildMedicationGuidanceTaskUpdate(undefined, order, "requested");
  if (pharmacist) {
    return { ...next, owner: { reference: `Practitioner/${pharmacist.id}`, display: pharmacist.name || undefined } };
  }
  const cleared = { ...next };
  delete cleared.owner;
  return cleared;
}
