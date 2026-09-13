import { consultTaskStatus, consultTaskStatusDisplay, consultTasksByOrderId } from "./consultTaskHelpers";
import {
  endoscopyTaskStatus,
  endoscopyTaskStatusDisplay,
  endoscopyTasksByOrderId,
} from "./endoscopyTaskHelpers";
import { injectionTaskStatus, injectionTaskStatusDisplay, injectionTasksByOrderId } from "./injectionTaskHelpers";
import { orderKindOf } from "./karteTimeline";
import { labTaskStatus, labTaskStatusDisplay, labTasksByOrderId } from "./labTaskHelpers";
import { nursingTaskStatus, nursingTaskStatusDisplay, nursingTasksByOrderId } from "./nursingTaskHelpers";
import {
  nutritionGuidanceTaskStatus,
  nutritionGuidanceTaskStatusDisplay,
  nutritionGuidanceTasksByOrderId,
} from "./nutritionGuidanceTaskHelpers";
import { pathoTaskStatus, pathoTaskStatusDisplay, pathoTasksByOrderId } from "./pathoTaskHelpers";
import { physioTaskStatus, physioTaskStatusDisplay, physioTasksByOrderId } from "./physioTaskHelpers";
import { radTaskStatus, radTaskStatusDisplay, radTasksByOrderId } from "./radTaskHelpers";
import { rehabTaskStatus, rehabTaskStatusDisplay, rehabTasksByOrderId } from "./rehabTaskHelpers";
import { surgeryTaskStatus, surgeryTaskStatusDisplay, surgeryTasksByOrderId } from "./surgeryTaskHelpers";
import {
  transfusionTaskStatus,
  transfusionTaskStatusDisplay,
  transfusionTasksByOrderId,
} from "./transfusionTaskHelpers";
import {
  treatmentTaskStatus,
  treatmentTaskStatusDisplay,
  treatmentTasksByOrderId,
} from "./treatmentTaskHelpers";

// オーダーの進み具合(依頼済・受付済・実施済・中止 など)を、カルテのカードと同じ判定で出す。
//
// ［事実］部門が受ける種別(注射・検査・処置・手術・輸血・リハビリ・栄養指導・他科依頼)と看護指示は、
// 進み具合を ServiceRequest の status ではなく、focus でオーダーを指す進捗の Task に持つ
// (「ServiceRequest ← focus ── Task」。オーダーそのものは実施しても active のまま)。
// Task で進み具合を持たない種別(処方・食事・細菌検査・化学療法)は ServiceRequest の status で出す。
// React に依存しない。

export interface OrderProgress {
  /** 画面に出す名前(「依頼済」「実施済」「中止」など。種別ごとの Task の表示名)。 */
  label: string;
  /** 実施済みか(進捗の Task が completed。Task を持たない種別は ServiceRequest が completed)。 */
  completed: boolean;
}

/** 種別ごとの Task の束ね方・状態・表示名(どれも createTaskHelpers で作った同じ形)。 */
interface TaskKind {
  byOrderId: (tasks: fhir4.Task[]) => Map<string, fhir4.Task>;
  status: (task: fhir4.Task | undefined) => string;
  display: (status: string) => string;
}

function taskKind<S extends string>(
  byOrderId: (tasks: fhir4.Task[]) => Map<string, fhir4.Task>,
  status: (task: fhir4.Task | undefined) => S,
  display: (status: S) => string,
): TaskKind {
  return { byOrderId, status, display: (s) => display(s as S) };
}

const TASK_KINDS: Partial<Record<string, TaskKind>> = {
  injection: taskKind(injectionTasksByOrderId, injectionTaskStatus, injectionTaskStatusDisplay),
  "lab-order": taskKind(labTasksByOrderId, labTaskStatus, labTaskStatusDisplay),
  "patho-order": taskKind(pathoTasksByOrderId, pathoTaskStatus, pathoTaskStatusDisplay),
  "rad-order": taskKind(radTasksByOrderId, radTaskStatus, radTaskStatusDisplay),
  "physio-order": taskKind(physioTasksByOrderId, physioTaskStatus, physioTaskStatusDisplay),
  "endoscopy-order": taskKind(endoscopyTasksByOrderId, endoscopyTaskStatus, endoscopyTaskStatusDisplay),
  "treatment-order": taskKind(treatmentTasksByOrderId, treatmentTaskStatus, treatmentTaskStatusDisplay),
  "surgery-order": taskKind(surgeryTasksByOrderId, surgeryTaskStatus, surgeryTaskStatusDisplay),
  "transfusion-order": taskKind(transfusionTasksByOrderId, transfusionTaskStatus, transfusionTaskStatusDisplay),
  "rehab-order": taskKind(rehabTasksByOrderId, rehabTaskStatus, rehabTaskStatusDisplay),
  "nutrition-guidance-order": taskKind(
    nutritionGuidanceTasksByOrderId,
    nutritionGuidanceTaskStatus,
    nutritionGuidanceTaskStatusDisplay,
  ),
  "consult-order": taskKind(consultTasksByOrderId, consultTaskStatus, consultTaskStatusDisplay),
  "nursing-order": taskKind(nursingTasksByOrderId, nursingTaskStatus, nursingTaskStatusDisplay),
};

const SERVICE_REQUEST_STATUS_LABELS: Record<string, string> = {
  draft: "下書き",
  active: "依頼済",
  "on-hold": "保留",
  revoked: "中止",
  completed: "実施済",
  "entered-in-error": "誤登録",
};

function serviceRequestProgress(order: fhir4.ServiceRequest): OrderProgress {
  return {
    label: SERVICE_REQUEST_STATUS_LABELS[order.status] ?? order.status,
    completed: order.status === "completed",
  };
}

/**
 * オーダー(ヘッダ)の id → 進み具合。tasks は患者・適用ぶんの Task をまとめて渡してよい
 * (種別ごとの束ね方が Task の code で自分の種別だけを拾う)。
 * ［決定］オーダーを取り下げた(revoked)・誤登録にしたときは、Task より ServiceRequest の状態を優先する。
 */
export function orderProgressByOrderId(
  orders: Iterable<fhir4.ServiceRequest>,
  tasks: fhir4.Task[],
): Map<string, OrderProgress> {
  const taskMaps = new Map<TaskKind, Map<string, fhir4.Task>>();
  const result = new Map<string, OrderProgress>();
  for (const order of orders) {
    if (!order.id) continue;
    if (order.status === "revoked" || order.status === "entered-in-error") {
      result.set(order.id, serviceRequestProgress(order));
      continue;
    }
    const kind = TASK_KINDS[orderKindOf(order) ?? ""];
    if (!kind) {
      result.set(order.id, serviceRequestProgress(order));
      continue;
    }
    let byOrderId = taskMaps.get(kind);
    if (!byOrderId) {
      byOrderId = kind.byOrderId(tasks);
      taskMaps.set(kind, byOrderId);
    }
    const status = kind.status(byOrderId.get(order.id));
    result.set(order.id, { label: kind.display(status), completed: status === "completed" });
  }
  return result;
}
