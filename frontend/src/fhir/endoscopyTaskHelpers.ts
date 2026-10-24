import {
  createExamTaskHelpers,
  EXAM_TASK_STATUS_OPTIONS,
  examTaskActions,
  type ExamTaskAction,
  type ExamTaskStatus,
} from "./examTaskHelpers";

// 内視鏡の進捗(受付・実施)。状態と遷移は examTaskHelpers の共通のもので、Task.code だけが部門ごと。

export const ENDOSCOPY_TASK_CODE = { code: "endoscopy-exam", display: "内視鏡" };

export type EndoscopyTaskStatus = ExamTaskStatus;
export type EndoscopyTaskAction = ExamTaskAction;
export const ENDOSCOPY_TASK_STATUS_OPTIONS = EXAM_TASK_STATUS_OPTIONS;
export const endoscopyTaskActions = examTaskActions;

const helpers = createExamTaskHelpers(ENDOSCOPY_TASK_CODE);

export const endoscopyTaskStatusDisplay = helpers.statusDisplay;

/** 進捗。Task がまだ無いオーダー(部門が触っていない)は依頼済。 */
export const endoscopyTaskStatus = helpers.taskStatus;

/** ServiceRequest の id → その進捗。焦点(focus)で突き合わせる。 */
export const endoscopyTasksByOrderId = helpers.tasksByOrderId;

/** ステータスを変えた Task。まだ無ければ作る(組み立ては taskHelpers を参照)。 */
export const buildEndoscopyTaskUpdate = helpers.buildTaskUpdate;
