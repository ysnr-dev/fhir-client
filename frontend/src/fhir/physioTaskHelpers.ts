import {
  createExamTaskHelpers,
  EXAM_TASK_STATUS_OPTIONS,
  examTaskActions,
  type ExamTaskAction,
  type ExamTaskStatus,
} from "./examTaskHelpers";

// 生理検査の進捗(受付・実施)。状態と遷移は examTaskHelpers の共通のもので、Task.code だけが部門ごと。

export const PHYSIO_TASK_CODE = { code: "physio-exam", display: "生理検査" };

export type PhysioTaskStatus = ExamTaskStatus;
export type PhysioTaskAction = ExamTaskAction;
export const PHYSIO_TASK_STATUS_OPTIONS = EXAM_TASK_STATUS_OPTIONS;
export const physioTaskActions = examTaskActions;

const helpers = createExamTaskHelpers(PHYSIO_TASK_CODE);

export const physioTaskStatusDisplay = helpers.statusDisplay;

/** 進捗。Task がまだ無いオーダー(部門が触っていない)は依頼済。 */
export const physioTaskStatus = helpers.taskStatus;

/** ServiceRequest の id → その進捗。焦点(focus)で突き合わせる。 */
export const physioTasksByOrderId = helpers.tasksByOrderId;

/** ステータスを変えた Task。まだ無ければ作る(組み立ては taskHelpers を参照)。 */
export const buildPhysioTaskUpdate = helpers.buildTaskUpdate;
