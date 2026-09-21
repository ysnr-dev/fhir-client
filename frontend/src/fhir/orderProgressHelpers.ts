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
import {
  radiotherapyTaskStatus,
  radiotherapyTaskStatusDisplay,
  radiotherapyTasksByOrderId,
} from "./radiotherapyTaskHelpers";
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
// リハビリ・栄養指導は 1 つのオーダーの期間中に実施を何度も積み上げ、Task は受付済のまま動かないので、
// 実施記録(オーダーを basedOn で指す Procedure)の日付も持つ。React に依存しない。

export interface OrderProgress {
  /** 画面に出す名前(「依頼済」「実施済」「中止」など。種別ごとの Task の表示名)。 */
  label: string;
  /** 状態のコード(進捗の Task の状態。Task を持たない種別は ServiceRequest の status)。 */
  status: string;
  /** 実施済みか(進捗の Task が completed。Task を持たない種別は ServiceRequest が completed)。 */
  completed: boolean;
  /** 実施を積み上げる種別(リハビリ・栄養指導)だけ: 実施記録のある日("YYYY-MM-DD")。 */
  performedDates?: Set<string>;
}

/** 実施を積み上げる種別。オーダー 1 件に実施記録が日ごとに付く。 */
const SESSION_KINDS = new Set(["rehab-order", "nutrition-guidance-order"]);

/** その日に実施したか。積み上げる種別はその日の実施記録、その他はオーダーが実施済みか。 */
export function orderPerformedOn(progress: OrderProgress, date: string): boolean {
  return progress.performedDates ? progress.performedDates.has(date) : progress.completed;
}

/** 実施の記録が 1 件でもあるか(日程の変更・取り消しを止める判定)。 */
export function orderHasPerformed(progress: OrderProgress): boolean {
  return progress.completed || (progress.performedDates?.size ?? 0) > 0;
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
  "radiotherapy-order": taskKind(
    radiotherapyTasksByOrderId,
    radiotherapyTaskStatus,
    radiotherapyTaskStatusDisplay,
  ),
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
    status: order.status,
    completed: order.status === "completed",
  };
}

/** オーダーの id → 実施記録のある日。取り消した(entered-in-error)記録は数えない。 */
function performedDatesByOrderId(performs: fhir4.Procedure[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const procedure of performs) {
    if (procedure.status === "entered-in-error") continue;
    const date = (procedure.performedDateTime ?? procedure.performedPeriod?.start ?? "").slice(0, 10);
    if (!date) continue;
    for (const ref of procedure.basedOn ?? []) {
      const id = ref.reference?.match(/^ServiceRequest\/(.+)$/)?.[1];
      if (!id) continue;
      const dates = map.get(id) ?? new Set<string>();
      dates.add(date);
      map.set(id, dates);
    }
  }
  return map;
}

/**
 * オーダー(ヘッダ)の id → 進み具合。tasks は患者・適用ぶんの Task をまとめて渡してよい
 * (種別ごとの束ね方が Task の code で自分の種別だけを拾う)。performs はオーダーを basedOn で指す実施記録。
 * ［決定］オーダーを取り下げた(revoked)・誤登録にしたときは、Task より ServiceRequest の状態を優先する。
 */
export function orderProgressByOrderId(
  orders: Iterable<fhir4.ServiceRequest>,
  tasks: fhir4.Task[],
  performs: fhir4.Procedure[] = [],
): Map<string, OrderProgress> {
  const taskMaps = new Map<TaskKind, Map<string, fhir4.Task>>();
  const performedDates = performedDatesByOrderId(performs);
  const result = new Map<string, OrderProgress>();
  for (const order of orders) {
    if (!order.id) continue;
    if (order.status === "revoked" || order.status === "entered-in-error") {
      result.set(order.id, serviceRequestProgress(order));
      continue;
    }
    const kindCode = orderKindOf(order) ?? "";
    const kind = TASK_KINDS[kindCode];
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
    result.set(order.id, {
      label: kind.display(status),
      status,
      completed: status === "completed",
      ...(SESSION_KINDS.has(kindCode) ? { performedDates: performedDates.get(order.id) ?? new Set<string>() } : {}),
    });
  }
  return result;
}
