import {
  INTERPRETATION_SYSTEM,
  isPanicInterpretation,
  RESULT_ITEM_SYSTEM,
  UNITS_OF_MEASURE_SYSTEM,
  type LabInterpretation,
  type LabResultFormValues,
} from "./labResultHelpers";
import {
  buildNotificationTask,
  hasTaskCode,
  taskInputOf,
  taskOwnerName,
  taskPatientId,
  type NotificationRowBase,
} from "./notificationHelpers";

// 検体検査のパニック値(緊急異常値)の通知。
//
//   DiagnosticReport(検査結果) ← focus ── Task(通知)
//
// 通知そのものの作法(状態・宛先・対応済みの記録)は notificationHelpers に共通化してある。
// ここに残すのは「どの結果行がパニック値か」「一覧に何を出すか」という検体検査固有の部分。
//
// 患者帯の Flag にする案もあったが、パニック値はその結果 1 件に閉じた事象で、確認されたら
// 終わるもの。宛先と未読を持てる Task の方が実態に合う(docs/lab-backlog.md A-2)。

export const LAB_PANIC_TASK_CODE = { code: "lab-panic", display: "緊急異常値" };

export function isPanicTask(task: fhir4.Task): boolean {
  return hasTaskCode(task, LAB_PANIC_TASK_CODE.code);
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
  return buildNotificationTask(
    {
      code: LAB_PANIC_TASK_CODE,
      // パニック値は連絡が遅れると患者に害が出るので、通知そのものを至急として扱う。
      priority: "stat",
      focusReference: input.reportReference,
      patientId: input.patientId,
      owner: input.owner,
      description: `${input.specimenDate} ${input.summary}`,
      input: panicTaskInputs(input),
    },
    existing,
  );
}

export interface PanicTaskRow extends NotificationRowBase {
  /** 検査結果(DiagnosticReport)の id。カルテの検査結果タブを開くのに使う。 */
  reportId: string;
  specimenDate: string;
  items: PanicItem[];
  /** 構造化した input を持たない古い通知のための本文。 */
  summary: string;
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

/** 通知 1 件を一覧の行にする。患者は `_include=Task:subject` で引いたもの。 */
export function panicRowOf(task: fhir4.Task, patient: fhir4.Patient | undefined): PanicTaskRow {
  return {
    task,
    patient,
    patientId: taskPatientId(task),
    reportId: task.focus?.reference?.match(/^DiagnosticReport\/(.+)$/)?.[1] ?? "",
    specimenDate: taskInputOf(task, SPECIMEN_DATE_INPUT)?.valueDate ?? "",
    items: rowItemsOf(task),
    summary: task.description ?? "",
    authoredOn: task.authoredOn ?? "",
    ownerName: taskOwnerName(task),
  };
}
