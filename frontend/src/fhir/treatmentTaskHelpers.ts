import {
  createExamTaskHelpers,
  EXAM_TASK_STATUS_OPTIONS,
  examTaskActions,
  type ExamTaskAction,
  type ExamTaskStatus,
} from "./examTaskHelpers";

// 処置の進捗(受付・実施)。状態と遷移は examTaskHelpers の共通のもので、Task.code だけが部門ごと。

export const TREATMENT_TASK_CODE = { code: "treatment", display: "処置" };

export type TreatmentTaskStatus = ExamTaskStatus;
export type TreatmentTaskAction = ExamTaskAction;
export const TREATMENT_TASK_STATUS_OPTIONS = EXAM_TASK_STATUS_OPTIONS;
export const treatmentTaskActions = examTaskActions;

const helpers = createExamTaskHelpers(TREATMENT_TASK_CODE);

export const treatmentTaskStatusDisplay = helpers.statusDisplay;

/** 進捗。Task がまだ無いオーダー(部門が触っていない)は依頼済。 */
export const treatmentTaskStatus = helpers.taskStatus;

/** ServiceRequest の id → その進捗。焦点(focus)で突き合わせる。 */
export const treatmentTasksByOrderId = helpers.tasksByOrderId;

/** ステータスを変えた Task。まだ無ければ作る(組み立ては taskHelpers を参照)。 */
export const buildTreatmentTaskUpdate = helpers.buildTaskUpdate;
