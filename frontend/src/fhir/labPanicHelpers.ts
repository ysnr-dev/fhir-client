import { toDateTimeInput, toFhirDateTime } from "./clinicalNoteHelpers";
import {
  INTERPRETATION_SYSTEM,
  isPanicInterpretation,
  RESULT_ITEM_SYSTEM,
  UNITS_OF_MEASURE_SYSTEM,
  type LabInterpretation,
  type LabResultFormValues,
} from "./labResultHelpers";
import { TASK_CODE_SYSTEM } from "./taskHelpers";

// 検体検査のパニック値(緊急異常値)の通知。
//
//   DiagnosticReport(検査結果) ← focus ── Task(通知)
//
// 部門進捗の Task(labTaskHelpers)とは形が違うので共通ファクトリ(createTaskHelpers)には
// 乗せない。あちらは「オーダーを部門が処理する進捗」で焦点が ServiceRequest・宛先を持たない。
// こちらは「この結果を医師に見てもらう」通知なので、焦点が結果(DiagnosticReport)で、
// 宛先(owner = 依頼医)と未確認・確認済みを持つ。
//
// 患者帯の Flag にする案もあったが、パニック値はその結果 1 件に閉じた事象で、確認されたら
// 終わるもの。宛先と未読を持てる Task の方が実態に合う(docs/lab-backlog.md A-2)。
//
// 上流の Task 検索は code / status / owner / focus に対応している。ただし
// `_include=Task:focus` の対象は ServiceRequest だけなので、一覧に出す情報
// (患者・項目と値)は Task 自身(for / description)から読めるようにしてある。

export const LAB_PANIC_TASK_CODE = { code: "lab-panic", display: "緊急異常値" };

/** 通知の状態。requested = 未確認 / completed = 確認済み / cancelled = 取り下げ(値が直った)。 */
export type LabPanicTaskStatus = "requested" | "completed" | "cancelled";

export function isPanicTask(task: fhir4.Task): boolean {
  return Boolean(
    task.code?.coding?.some(
      (c) => c.system === TASK_CODE_SYSTEM && c.code === LAB_PANIC_TASK_CODE.code,
    ),
  );
}

/** パニック値だった行。一覧はこれを項目・値・判定に分けて出す。 */
export interface PanicItem {
  name: string;
  value: string;
  unit: string;
  interpretation: LabInterpretation;
}

export function panicItemsOf(values: LabResultFormValues): PanicItem[] {
  return values.lines
    .filter((line) => line.item && isPanicInterpretation(line.interpretation))
    .map((line) => ({
      name: line.item?.short_name || line.item?.name || "",
      value: line.value,
      unit: line.item?.display_unit ?? "",
      interpretation: line.interpretation,
    }));
}

/** 通知の本文「略称 値 単位(HH)」。一覧は構造化した input を読むので、これは
    Task をそのまま読む相手(監査・他システム)への説明として持たせる。 */
export function panicSummaryOf(values: LabResultFormValues): string {
  return panicItemsOf(values)
    .map((item) => `${item.name} ${item.value}${item.unit ? ` ${item.unit}` : ""}(${item.interpretation})`)
    .join("、");
}

export function hasPanicValue(values: LabResultFormValues): boolean {
  return values.lines.some((line) => line.item && isPanicInterpretation(line.interpretation));
}

export interface PanicTaskInput {
  /** 焦点。同じ transaction 内で作る結果は urn:uuid、更新は DiagnosticReport/{id}。 */
  reportReference: string;
  patientId: string;
  /** 宛先(依頼医)。オーダーに紐付かない結果では決まらないので任意。 */
  owner?: fhir4.Reference;
  items: PanicItem[];
  summary: string;
  specimenDate: string;
}

// 通知の中身は Task.input に構造化して持つ(一覧が項目・値・判定を別々に出せるように)。
// 検体採取日は valueDate、パニック値の行は「型 = 結果項目 + 判定、値 = 数量」で 1 件ずつ。
const SPECIMEN_DATE_INPUT = "検体採取日";

function panicTaskInputs(input: PanicTaskInput): fhir4.TaskInput[] {
  const dateInput: fhir4.TaskInput = {
    type: { text: SPECIMEN_DATE_INPUT },
    valueDate: input.specimenDate,
  };
  const items: fhir4.TaskInput[] = input.items.map((item) => ({
    type: {
      coding: [
        { system: RESULT_ITEM_SYSTEM, display: item.name },
        { system: INTERPRETATION_SYSTEM, code: item.interpretation },
      ],
      text: item.name,
    },
    valueQuantity: {
      value: Number(item.value),
      ...(item.unit ? { unit: item.unit, system: UNITS_OF_MEASURE_SYSTEM } : {}),
    },
  }));
  return [dateInput, ...items];
}

/**
 * 通知の Task。既にあるものを渡すと、本文と時刻を更新して未確認に戻す
 * (訂正で値が変わったときは、確認済みでも改めて見てもらう必要があるため)。
 */
export function buildPanicTask(input: PanicTaskInput, existing?: fhir4.Task): fhir4.Task {
  const now = toFhirDateTime(toDateTimeInput(new Date()));

  const task: fhir4.Task = {
    ...(existing ?? {}),
    resourceType: "Task",
    status: "requested",
    intent: "filler-order",
    // パニック値は連絡が遅れると患者に害が出るので、通知そのものを至急として扱う。
    priority: "stat",
    code: {
      coding: [{ system: TASK_CODE_SYSTEM, ...LAB_PANIC_TASK_CODE }],
      text: LAB_PANIC_TASK_CODE.display,
    },
    focus: { reference: input.reportReference },
    for: { reference: `Patient/${input.patientId}` },
    description: `${input.specimenDate} ${input.summary}`,
    input: panicTaskInputs(input),
    authoredOn: existing?.authoredOn ?? now,
    lastModified: now,
  };

  if (input.owner?.reference) task.owner = input.owner;
  else delete task.owner;
  // 前の確認記録は残さない(この通知は新しい内容として出し直す)。
  delete task.note;
  delete task.executionPeriod;
  return task;
}

/** 値が基準内に直ったときの取り下げ。通知そのものは履歴として残す。 */
export function buildCancelledPanicTask(task: fhir4.Task): fhir4.Task {
  return {
    ...task,
    status: "cancelled",
    lastModified: toFhirDateTime(toDateTimeInput(new Date())),
  };
}

/** 医師が確認した通知。誰がいつ確認したかを note に残す。 */
export function buildAcknowledgedPanicTask(
  task: fhir4.Task,
  practitioner: { practitionerId: string; display: string },
): fhir4.Task {
  const now = toFhirDateTime(toDateTimeInput(new Date()));
  return {
    ...task,
    status: "completed",
    lastModified: now,
    executionPeriod: { start: task.authoredOn ?? now, end: now },
    note: [
      {
        authorReference: {
          reference: `Practitioner/${practitioner.practitionerId}`,
          display: practitioner.display,
        },
        time: now,
        text: "緊急異常値を確認しました。",
      },
    ],
  };
}

export interface PanicTaskRow {
  task: fhir4.Task;
  patient?: fhir4.Patient;
  patientId: string;
  /** 検査結果(DiagnosticReport)の id。カルテの検査結果タブを開くのに使う。 */
  reportId: string;
  specimenDate: string;
  items: PanicItem[];
  /** 構造化した input を持たない古い通知のための本文。 */
  summary: string;
  authoredOn: string;
  ownerName: string;
}

function rowItemsOf(task: fhir4.Task): PanicItem[] {
  return (task.input ?? [])
    .filter((input) => input.valueQuantity)
    .map((input) => ({
      name: input.type?.text ?? "",
      value: input.valueQuantity?.value != null ? String(input.valueQuantity.value) : "",
      unit: input.valueQuantity?.unit ?? "",
      interpretation: (input.type?.coding?.find((c) => c.system === INTERPRETATION_SYSTEM)?.code ??
        "") as LabInterpretation,
    }));
}

/** Task 検索の応答(Task + _include の Patient)を一覧の行にする。 */
export function panicTaskRows(bundle: fhir4.Bundle): PanicTaskRow[] {
  const patients = new Map<string, fhir4.Patient>();
  const tasks: fhir4.Task[] = [];
  for (const entry of bundle.entry ?? []) {
    const resource = entry.resource;
    if (resource?.resourceType === "Patient" && resource.id) {
      patients.set(resource.id, resource as fhir4.Patient);
    } else if (resource?.resourceType === "Task" && isPanicTask(resource as fhir4.Task)) {
      tasks.push(resource as fhir4.Task);
    }
  }

  return tasks.map((task) => {
    const patientId = task.for?.reference?.split("/").pop() ?? "";
    return {
      task,
      patient: patients.get(patientId),
      patientId,
      reportId: task.focus?.reference?.match(/^DiagnosticReport\/(.+)$/)?.[1] ?? "",
      specimenDate:
        (task.input ?? []).find((input) => input.type?.text === SPECIMEN_DATE_INPUT)?.valueDate ?? "",
      items: rowItemsOf(task),
      summary: task.description ?? "",
      authoredOn: task.authoredOn ?? "",
      // 宛先はオーダーの依頼医の表示名を焼き付けている(この画面は Practitioner を引き直さない)。
      ownerName: task.owner?.display ?? (task.owner?.reference ? "(氏名なし)" : ""),
    };
  });
}
