import { today } from "../lib/dates";
import { toFhirDateTime } from "./clinicalNoteHelpers";
import { ORDER_TYPE_SYSTEM } from "./prescriptionHelpers";
import {
  REHAB_ORDER_TYPE,
  REHAB_UNIT_LABEL,
  THERAPY_TYPE_SYSTEM,
  therapyTypeDisplay,
  therapyTypeShort,
  type RehabTherapyType,
} from "./rehabOrderHelpers";

// リハビリの実施記録。1 回の実施 = Procedure 1 件で、期間中に何件も積み上がる。
//
//   ServiceRequest(オーダー)
//    └ basedOn ← Procedure (1 回の実施。日々増えていく)
//         code       = 実施した療法種別(PT/OT/ST)
//         performedDateTime = 実施日時
//         performer  = 担当療法士
//         extension[rehab-performed-units] = 実施単位数
//         note       = 訓練内容
//
// **他部門との唯一の違い: 実施しても進捗 Task を動かさない**
// (docs/rehab-order-design.md §4)。
//
// 他部門の buildXxxPerformBundle は「実施記録 + Task を completed に」を 1 つの
// transaction にする。リハビリで同じにすると、初日の実施でオーダーが終了扱いになり
// 2 日目以降が実施できなくなる。リハビリの Task は「部門の受け入れ状態」なので、
// 期間中は accepted のままにしておき、実施は Procedure を足すだけにする。
// 終了は部門一覧の「終了」操作(Task completed + オーダーに終了日)の担当。
//
// この形にした結果、実施の取消も Procedure を消すだけで済む(Task を戻す必要がない)。
// 放射線・処置と同じく entered-in-error では残さず DELETE する(会計連携のため)。
//
// 器材・薬剤・データセットは持たない。リハビリの実施で個別算定する器材や薬剤は無く、
// 算定は単位数で決まるため。訓練内容の定型化(テンプレート)は申し送り。

/** JP Core の Procedure プロファイル。上流の登録先。 */
const PROCEDURE_PROFILE = "http://jpfhir.jp/fhir/core/StructureDefinition/JP_Procedure";

/**
 * 実施単位数。Procedure に数量を持つ標準要素が無いのでローカル拡張にする
 * (オーダー側の「1 回あたりの単位数」は ServiceRequest.quantityQuantity)。
 * 算定は実際に行った単位数で決まるので、予定と別に実績を持つ。
 */
const PERFORMED_UNITS_EXT_URL =
  "http://fhir-client.local/StructureDefinition/rehab-performed-units";

// ---- 実施入力フォームの値 ----

export interface RehabPerformFormValues {
  /** 実施日。 */
  performedDate: string;
  /** 実施時刻(HH:mm)。空なら日付だけの実施記録にする。 */
  performedTime: string;
  /** 実施した療法種別。オーダーに載っている種別から 1 つ選ぶ。 */
  therapyType: RehabTherapyType | "";
  /** 実施単位数。入力欄で扱うので文字列で持つ。 */
  units: string;
  /** 担当療法士。 */
  performerId: string;
  performerName: string;
  /** 訓練内容。 */
  note: string;
}

export function emptyRehabPerformForm(
  therapyType: RehabTherapyType | "" = "",
  units = "",
): RehabPerformFormValues {
  return {
    performedDate: today(),
    performedTime: "",
    therapyType,
    units,
    performerId: "",
    performerName: "",
    note: "",
  };
}

/** 入力の検証。空文字なら妥当。 */
export function validateRehabPerformForm(values: RehabPerformFormValues): string {
  if (!values.performedDate) return "実施日を入れてください。";
  if (!values.therapyType) return "療法種別を選んでください。";

  const units = Number(values.units);
  if (!values.units) return "実施単位数を入れてください。";
  if (!Number.isInteger(units) || units < 1 || units > 24) {
    return "実施単位数は 1〜24 の整数で入れてください。";
  }
  if (!values.performerId) return "担当療法士を選んでください。";
  return "";
}

// ---- 組み立て ----

function buildRehabProcedure(
  values: RehabPerformFormValues,
  order: fhir4.ServiceRequest,
  orderReference: string,
): fhir4.Procedure {
  const procedure: fhir4.Procedure = {
    resourceType: "Procedure",
    meta: { profile: [PROCEDURE_PROFILE] },
    status: "completed",
    // 他オーダーの実施記録と振り分けるための区分(生理検査・処置と同じ持たせ方)。
    category: { coding: [{ system: ORDER_TYPE_SYSTEM, ...REHAB_ORDER_TYPE }] },
    code: {
      coding: [
        {
          system: THERAPY_TYPE_SYSTEM,
          code: values.therapyType,
          display: therapyTypeDisplay(values.therapyType),
        },
      ],
      text: therapyTypeDisplay(values.therapyType),
    },
    subject: order.subject ?? {},
    basedOn: [{ reference: orderReference }],
    // 時刻を入れたときだけ時刻まで持つ(FHIR の dateTime は時刻を持つならタイム
    // ゾーンが必須なので、実行環境のオフセットを付ける)。
    performedDateTime: values.performedTime
      ? toFhirDateTime(`${values.performedDate}T${values.performedTime}`)
      : values.performedDate,
  };

  if (values.performerId) {
    procedure.performer = [
      {
        actor: {
          reference: `Practitioner/${values.performerId}`,
          display: values.performerName || undefined,
        },
      },
    ];
  }

  const units = Number(values.units);
  if (Number.isInteger(units) && units > 0) {
    procedure.extension = [{ url: PERFORMED_UNITS_EXT_URL, valueInteger: units }];
  }

  if (values.note.trim()) procedure.note = [{ text: values.note.trim() }];

  return procedure;
}

/**
 * 1 回ぶんの実施登録。**Procedure を 1 件 POST するだけで、Task は動かさない**
 * (このファイル冒頭のコメントを参照)。他部門の buildXxxPerformBundle に合わせて
 * Task の完了エントリを足してはいけない。
 */
export function buildRehabPerformBundle(
  values: RehabPerformFormValues,
  order: fhir4.ServiceRequest,
): fhir4.Bundle {
  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: [
      {
        resource: buildRehabProcedure(values, order, `ServiceRequest/${order.id ?? ""}`),
        request: { method: "POST", url: "Procedure" },
      },
    ],
  };
}

// ---- カルテ・一覧への表示 ----

export interface RehabPerformDisplay {
  /** Procedure id。表示のキー・削除の対象。 */
  id: string;
  /** 実施日 "YYYY-MM-DD"。並べ替えにも使う。 */
  performedDate: string;
  /** 実施日時 "YYYY-MM-DD HH:mm"。時刻を持たない実施記録では日付だけ。 */
  performedAt: string;
  /** 療法種別の短い表示("PT")。 */
  therapyTypeShort: string;
  therapyType: string;
  /** 実施単位数。 */
  units?: number;
  performerName: string;
  /** 訓練内容。 */
  note: string;
  /** 「8/29 PT 2単位 山田」の 1 行表示。カードの実施履歴で使う。 */
  label: string;
}

/** リハビリの実施記録か。他オーダーの Procedure と振り分ける。 */
export function isRehabProcedure(procedure: fhir4.Procedure): boolean {
  return Boolean(
    procedure.category?.coding?.some(
      (c) => c.system === ORDER_TYPE_SYSTEM && c.code === REHAB_ORDER_TYPE.code,
    ),
  );
}

function referenceId(reference: string | undefined, resourceType: string): string {
  return reference?.match(new RegExp(`^${resourceType}/(.+)$`))?.[1] ?? "";
}

export function rehabPerformedUnits(procedure: fhir4.Procedure): number | undefined {
  return procedure.extension?.find((e) => e.url === PERFORMED_UNITS_EXT_URL)?.valueInteger;
}

/** 「8/29」形式の短い日付。 */
function shortDate(date: string): string {
  const [, month, day] = date.split("-");
  return month && day ? `${Number(month)}/${Number(day)}` : date;
}

function toDisplay(procedure: fhir4.Procedure): RehabPerformDisplay {
  const performed = procedure.performedDateTime ?? "";
  const performedDate = performed.slice(0, 10);
  const therapyType =
    procedure.code?.coding?.find((c) => c.system === THERAPY_TYPE_SYSTEM)?.code ?? "";
  const units = rehabPerformedUnits(procedure);
  const performerName = procedure.performer?.[0]?.actor?.display ?? "";

  return {
    id: procedure.id ?? "",
    performedDate,
    performedAt:
      performed.length > 10 ? `${performedDate} ${performed.slice(11, 16)}` : performedDate,
    therapyTypeShort: therapyType ? therapyTypeShort(therapyType) : "",
    therapyType,
    units,
    performerName,
    note: procedure.note?.[0]?.text ?? "",
    label: [
      shortDate(performedDate),
      therapyType ? therapyTypeShort(therapyType) : "",
      units ? `${units}${REHAB_UNIT_LABEL}` : "",
      performerName,
    ]
      .filter(Boolean)
      .join(" "),
  };
}

/**
 * オーダーの id → その実施記録(新しい順)。1 オーダーに何十件も積み上がるので、
 * カード側は先頭数件だけを出して件数を添える。
 */
export function rehabPerformsByOrderId(
  procedures: fhir4.Procedure[],
): Map<string, RehabPerformDisplay[]> {
  const byOrderId = new Map<string, RehabPerformDisplay[]>();

  for (const procedure of procedures) {
    // 誤登録として取り消されたものは実施していないのと同じなので出さない。
    if (!isRehabProcedure(procedure) || procedure.status === "entered-in-error") continue;
    const orderId = referenceId(procedure.basedOn?.[0]?.reference, "ServiceRequest");
    if (!orderId) continue;

    const list = byOrderId.get(orderId);
    if (list) list.push(toDisplay(procedure));
    else byOrderId.set(orderId, [toDisplay(procedure)]);
  }

  // 新しい順。同じ日の複数回は時刻で並ぶ。
  for (const list of byOrderId.values()) {
    list.sort((a, b) => b.performedAt.localeCompare(a.performedAt));
  }
  return byOrderId;
}

/** 実施記録を消すエントリ。子リソースを持たないので Procedure 1 件だけ。 */
export function buildRehabPerformDeleteEntries(procedureIds: string[]): fhir4.BundleEntry[] {
  return procedureIds.map((id) => ({
    request: { method: "DELETE" as const, url: `Procedure/${id}` },
  }));
}
