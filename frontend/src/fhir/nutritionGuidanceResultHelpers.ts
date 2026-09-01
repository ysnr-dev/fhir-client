import { today } from "../lib/dates";
import { toFhirDateTime } from "./clinicalNoteHelpers";
import { ORDER_TYPE_SYSTEM } from "./prescriptionHelpers";
import { displayOf } from "./shared";
import type { TemplateBinding } from "./questionnaireResponseHelpers";
import {
  NUTRITION_GUIDANCE_ORDER_TYPE,
  nutritionGuidanceFormat,
} from "./nutritionGuidanceOrderHelpers";

// 栄養指導の実施記録。1 回の指導 = Procedure 1 件で、期間中に何件も積み上がる。
//
//   ServiceRequest(オーダー)
//    └ basedOn ← Procedure (1 回の指導。初回・継続と増えていく)
//         code       = 指導種別(初回 / 2 回目以降 / 集団)
//         performedDateTime = 実施日時
//         performer  = 担当管理栄養士
//         extension[nutrition-guidance-performed-minutes] = 実施時間(分)
//         extension[nutrition-guidance-record] = 指導記録テンプレートの回答
//         note       = 指導内容
//
// **リハビリと同じく、実施しても進捗 Task を動かさない**
// (docs/nutrition-guidance-order-design.md §3)。初回の指導でオーダーが終了扱いに
// なると 2 回目以降が実施できなくなるため。終了は部門一覧の「終了」操作の担当。
//
// リハビリと違うのは指導記録のテンプレート(QuestionnaireResponse)を持つところ
// (同 §4.2)。放射線の特別指示・病理の臨床経過・他科依頼の依頼目的と同じ機構で、
// 平文は Procedure.note に入れ、回答本体はローカル拡張から参照する。
// 実施を取り消すときは回答も道連れで DELETE する。

/** JP Core の Procedure プロファイル。上流の登録先。 */
const PROCEDURE_PROFILE = "http://jpfhir.jp/fhir/core/StructureDefinition/JP_Procedure";

/**
 * 指導種別。算定区分そのもの(初回はおおむね 30 分以上、2 回目以降はおおむね 20 分
 * 以上)で施設ごとに増減しないため、DB マスタを持たずここに置く。
 */
export const GUIDANCE_SESSION_TYPE_SYSTEM =
  "http://fhir-client.local/CodeSystem/nutrition-guidance-session-type";

/**
 * 実施時間(分)。Procedure に所要時間を持つ標準要素が無いのでローカル拡張にする。
 * 算定要件が時間で決まるので、リハビリの「単位数」に相当する位置づけ。
 */
const PERFORMED_MINUTES_EXT_URL =
  "http://fhir-client.local/StructureDefinition/nutrition-guidance-performed-minutes";

/**
 * 指導記録テンプレートの回答への参照。平文は note に入れてあるので、これは
 * 「どのテンプレートにどう記入したか」を後から開くための参照。
 */
const RECORD_TEMPLATE_EXT_URL =
  "http://fhir-client.local/StructureDefinition/nutrition-guidance-record";

// ---- 固定の分類 ----

export type NutritionGuidanceSessionType = "initial" | "follow-up" | "group";

export const SESSION_TYPE_OPTIONS: {
  code: NutritionGuidanceSessionType;
  display: string;
}[] = [
  { code: "initial", display: "初回指導" },
  { code: "follow-up", display: "2 回目以降" },
  { code: "group", display: "集団指導" },
];

export function sessionTypeDisplay(code: string): string {
  return displayOf(SESSION_TYPE_OPTIONS, code);
}

/** 一覧・カードの狭い場所で使う短い表示(「初回」「継続」)。 */
export const SESSION_TYPE_SHORT: Record<NutritionGuidanceSessionType, string> = {
  initial: "初回",
  "follow-up": "継続",
  group: "集団",
};

export function sessionTypeShort(code: string): string {
  return SESSION_TYPE_SHORT[code as NutritionGuidanceSessionType] ?? sessionTypeDisplay(code);
}

/**
 * そのオーダーで選べる指導種別。オーダーの指導形態と食い違う指導種別を選ばせない
 * (集団指導のオーダーに「初回指導」を入れると算定区分が食い違う)。
 * リハビリの「オーダーで指示された療法種別だけ出す」と同じ考え方。
 */
export function sessionTypesForOrder(
  order: fhir4.ServiceRequest,
): { code: NutritionGuidanceSessionType; display: string }[] {
  return nutritionGuidanceFormat(order) === "group"
    ? SESSION_TYPE_OPTIONS.filter((o) => o.code === "group")
    : SESSION_TYPE_OPTIONS.filter((o) => o.code !== "group");
}

// ---- 実施入力フォームの値 ----

export interface NutritionGuidancePerformFormValues {
  /** 実施日。 */
  performedDate: string;
  /** 実施時刻(HH:mm)。空なら日付だけの実施記録にする。 */
  performedTime: string;
  /** 指導種別。オーダーの指導形態から選べる範囲が決まる。 */
  sessionType: NutritionGuidanceSessionType | "";
  /** 実施時間(分)。入力欄で扱うので文字列で持つ。 */
  minutes: string;
  /** 担当管理栄養士。 */
  performerId: string;
  performerName: string;
  /** 指導内容。テンプレートから書いた場合も平文はここに入る。 */
  note: string;
  /** 指導記録テンプレートの記入内容。 */
  recordTemplate: TemplateBinding | null;
}

export function emptyNutritionGuidancePerformForm(
  sessionType: NutritionGuidanceSessionType | "" = "",
): NutritionGuidancePerformFormValues {
  return {
    performedDate: today(),
    performedTime: "",
    sessionType,
    minutes: "",
    performerId: "",
    performerName: "",
    note: "",
    recordTemplate: null,
  };
}

/** 入力の検証。空文字なら妥当。 */
export function validateNutritionGuidancePerformForm(
  values: NutritionGuidancePerformFormValues,
): string {
  if (!values.performedDate) return "実施日を入れてください。";
  if (!values.sessionType) return "指導種別を選んでください。";

  const minutes = Number(values.minutes);
  if (!values.minutes) return "実施時間(分)を入れてください。";
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 600) {
    return "実施時間は 1〜600 分の整数で入れてください。";
  }
  if (!values.performerId) return "担当管理栄養士を選んでください。";
  return "";
}

// ---- 組み立て ----

function buildNutritionGuidanceProcedure(
  values: NutritionGuidancePerformFormValues,
  order: fhir4.ServiceRequest,
  orderReference: string,
  recordTemplateRef: string,
): fhir4.Procedure {
  const procedure: fhir4.Procedure = {
    resourceType: "Procedure",
    meta: { profile: [PROCEDURE_PROFILE] },
    status: "completed",
    // 他オーダーの実施記録と振り分けるための区分(リハビリ・処置と同じ持たせ方)。
    category: { coding: [{ system: ORDER_TYPE_SYSTEM, ...NUTRITION_GUIDANCE_ORDER_TYPE }] },
    code: {
      coding: [
        {
          system: GUIDANCE_SESSION_TYPE_SYSTEM,
          code: values.sessionType,
          display: sessionTypeDisplay(values.sessionType),
        },
      ],
      text: sessionTypeDisplay(values.sessionType),
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

  const extension: fhir4.Extension[] = [];
  const minutes = Number(values.minutes);
  if (Number.isInteger(minutes) && minutes > 0) {
    extension.push({ url: PERFORMED_MINUTES_EXT_URL, valueInteger: minutes });
  }
  if (recordTemplateRef) {
    extension.push({
      url: RECORD_TEMPLATE_EXT_URL,
      valueReference: { reference: recordTemplateRef },
    });
  }
  if (extension.length > 0) procedure.extension = extension;

  if (values.note.trim()) procedure.note = [{ text: values.note.trim() }];

  return procedure;
}

/**
 * 指導記録のテンプレート記入内容を Bundle に積み、実施記録から指す参照を返す。
 *
 * 実施記録と同じ transaction に載せるのは、先に単独で保存すると「実施を保存しなかった
 * ときに回答だけが残る」ため(他科依頼の pushPurposeTemplateEntry と同じ)。
 */
function pushRecordTemplateEntry(
  entries: fhir4.BundleEntry[],
  binding: TemplateBinding | null,
): string {
  if (!binding) return "";
  const { responseId, draft } = binding;
  if (!draft) {
    // 再編集していない保存済みの回答 → 参照だけ引き継ぐ。
    return responseId ? `QuestionnaireResponse/${responseId}` : "";
  }
  // 保存済みの再編集は同じ id へ PUT、新規記入は urn:uuid で POST し、
  // 実 ID への解決は上流の transaction 処理に任せる。
  const reference = responseId
    ? `QuestionnaireResponse/${responseId}`
    : `urn:uuid:${crypto.randomUUID()}`;
  if (responseId) {
    entries.push({
      resource: { ...draft.response, id: responseId },
      request: { method: "PUT", url: reference },
    });
  } else {
    entries.push({
      fullUrl: reference,
      resource: draft.response,
      request: { method: "POST", url: "QuestionnaireResponse" },
    });
  }
  entries.push(...draft.imageEntries);
  return reference;
}

/**
 * 1 回ぶんの実施登録。**Procedure(+ テンプレート回答)を POST するだけで、Task は
 * 動かさない**(このファイル冒頭のコメントを参照)。他部門の buildXxxPerformBundle に
 * 合わせて Task の完了エントリを足してはいけない。
 */
export function buildNutritionGuidancePerformBundle(
  values: NutritionGuidancePerformFormValues,
  order: fhir4.ServiceRequest,
): fhir4.Bundle {
  // 記入内容は実施記録より先に置く(実施記録がプレースホルダで指すため)。
  const entries: fhir4.BundleEntry[] = [];
  const recordRef = pushRecordTemplateEntry(entries, values.recordTemplate);
  entries.push({
    resource: buildNutritionGuidanceProcedure(
      values,
      order,
      `ServiceRequest/${order.id ?? ""}`,
      recordRef,
    ),
    request: { method: "POST", url: "Procedure" },
  });
  return { resourceType: "Bundle", type: "transaction", entry: entries };
}

// ---- カルテ・一覧への表示 ----

export interface NutritionGuidancePerformDisplay {
  /** Procedure id。表示のキー・削除の対象。 */
  id: string;
  /** 実施日 "YYYY-MM-DD"。並べ替えにも使う。 */
  performedDate: string;
  /** 実施日時 "YYYY-MM-DD HH:mm"。時刻を持たない実施記録では日付だけ。 */
  performedAt: string;
  /** 指導種別の短い表示("初回")。 */
  sessionTypeShort: string;
  sessionType: string;
  /** 実施時間(分)。 */
  minutes?: number;
  performerName: string;
  /** 指導内容。 */
  note: string;
  /** 指導記録テンプレートの回答 id。実施を消すとき道連れにする。 */
  recordResponseId: string;
  /** 「9/1 初回 30分 山田」の 1 行表示。カードの実施履歴で使う。 */
  label: string;
}

/** 栄養指導の実施記録か。他オーダーの Procedure と振り分ける。 */
export function isNutritionGuidanceProcedure(procedure: fhir4.Procedure): boolean {
  return Boolean(
    procedure.category?.coding?.some(
      (c) => c.system === ORDER_TYPE_SYSTEM && c.code === NUTRITION_GUIDANCE_ORDER_TYPE.code,
    ),
  );
}

function referenceId(reference: string | undefined, resourceType: string): string {
  return reference?.match(new RegExp(`^${resourceType}/(.+)$`))?.[1] ?? "";
}

export function nutritionGuidancePerformedMinutes(
  procedure: fhir4.Procedure,
): number | undefined {
  return procedure.extension?.find((e) => e.url === PERFORMED_MINUTES_EXT_URL)?.valueInteger;
}

export function nutritionGuidanceRecordResponseId(procedure: fhir4.Procedure): string {
  const reference = procedure.extension?.find((e) => e.url === RECORD_TEMPLATE_EXT_URL)
    ?.valueReference?.reference;
  return referenceId(reference, "QuestionnaireResponse");
}

/** 「9/1」形式の短い日付。 */
function shortDate(date: string): string {
  const [, month, day] = date.split("-");
  return month && day ? `${Number(month)}/${Number(day)}` : date;
}

function toDisplay(procedure: fhir4.Procedure): NutritionGuidancePerformDisplay {
  const performed = procedure.performedDateTime ?? "";
  const performedDate = performed.slice(0, 10);
  const sessionType =
    procedure.code?.coding?.find((c) => c.system === GUIDANCE_SESSION_TYPE_SYSTEM)?.code ?? "";
  const minutes = nutritionGuidancePerformedMinutes(procedure);
  const performerName = procedure.performer?.[0]?.actor?.display ?? "";

  return {
    id: procedure.id ?? "",
    performedDate,
    performedAt:
      performed.length > 10 ? `${performedDate} ${performed.slice(11, 16)}` : performedDate,
    sessionTypeShort: sessionType ? sessionTypeShort(sessionType) : "",
    sessionType,
    minutes,
    performerName,
    note: procedure.note?.[0]?.text ?? "",
    recordResponseId: nutritionGuidanceRecordResponseId(procedure),
    label: [
      shortDate(performedDate),
      sessionType ? sessionTypeShort(sessionType) : "",
      minutes ? `${minutes}分` : "",
      performerName,
    ]
      .filter(Boolean)
      .join(" "),
  };
}

/**
 * オーダーの id → その実施記録(新しい順)。1 オーダーに複数回積み上がるので、
 * カード側は先頭数件だけを出して件数を添える。
 */
export function nutritionGuidancePerformsByOrderId(
  procedures: fhir4.Procedure[],
): Map<string, NutritionGuidancePerformDisplay[]> {
  const byOrderId = new Map<string, NutritionGuidancePerformDisplay[]>();

  for (const procedure of procedures) {
    // 誤登録として取り消されたものは実施していないのと同じなので出さない。
    if (!isNutritionGuidanceProcedure(procedure) || procedure.status === "entered-in-error") {
      continue;
    }
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

/**
 * 実施記録を消すエントリ。指導記録テンプレートの回答も道連れにする(参照元が消えると
 * どこからも開けない回答が残るため)。放射線・処置と同じく entered-in-error では
 * 残さず DELETE する(会計連携で除外条件を増やさないため)。
 */
export function buildNutritionGuidancePerformDeleteEntries(
  performs: { id: string; recordResponseId?: string }[],
): fhir4.BundleEntry[] {
  const entries: fhir4.BundleEntry[] = [];
  for (const perform of performs) {
    entries.push({ request: { method: "DELETE", url: `Procedure/${perform.id}` } });
    if (perform.recordResponseId) {
      entries.push({
        request: {
          method: "DELETE",
          url: `QuestionnaireResponse/${perform.recordResponseId}`,
        },
      });
    }
  }
  return entries;
}
