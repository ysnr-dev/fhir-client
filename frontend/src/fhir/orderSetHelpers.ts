import { conditionDisplayName, type ConditionFormValues } from "./conditionHelpers";
import type { InjectionFormValues } from "./injectionHelpers";
import type { LabOrderFormValues } from "./labOrderHelpers";
import type { PhysioOrderFormValues } from "./physioOrderHelpers";
import type { PrescriptionFormValues } from "./prescriptionHelpers";
import { isHeaderEntry } from "./provenanceHelpers";
import type { RadOrderFormValues } from "./radOrderHelpers";
import type { TreatmentOrderFormValues } from "./treatmentOrderHelpers";

// オーダーセット(よく出すオーダーのひとまとめ)の共通ロジック。React には依存しない。
//
// セットは患者を持たない「フォーム値の雛形」で、backend の DB に jsonb で保存する
// (docs/order-set-design.md)。ここで扱うのは
//   1. 保存前に患者への参照と日付を落とすこと(sanitizeValuesForSet)
//   2. 適用時に種別ごとの transaction Bundle を 1 本にまとめること(mergeTransactionBundles)
//   3. 登録したオーダーに「どのセットから出したか」の印を焼くこと(stampOrderSetInstance)
// の 3 つ。種別ごとのフォーム・builder との対応表は components/orderSetRegistry.tsx。

/**
 * セットに含められるエントリの種別。オーダーは KartePaneState の種別接頭辞と同じ綴り。
 * condition は病名(Condition)で、オーダーではないがエントリとして同列に扱う。
 */
export type OrderSetOrderType =
  | "condition"
  | "prescription"
  | "injection"
  | "lab-order"
  | "micro-order"
  | "patho-order"
  | "rad-order"
  | "physio-order"
  | "endoscopy-order"
  | "treatment-order"
  | "surgery-order"
  | "meal-order"
  | "transfusion-order"
  | "rehab-order"
  | "nutrition-guidance-order"
  | "consult-order"
  | "nursing-order";

export const ORDER_SET_ORDER_TYPES: readonly OrderSetOrderType[] = [
  "condition",
  "prescription",
  "injection",
  "lab-order",
  "micro-order",
  "patho-order",
  "rad-order",
  "physio-order",
  "endoscopy-order",
  "treatment-order",
  "surgery-order",
  "meal-order",
  "transfusion-order",
  "rehab-order",
  "nutrition-guidance-order",
  "consult-order",
  "nursing-order",
];

export function isOrderSetOrderType(value: string): value is OrderSetOrderType {
  return (ORDER_SET_ORDER_TYPES as readonly string[]).includes(value);
}

/**
 * 病名はオーダーより上にまとめて出す(「この病名でこのオーダー」と読める並び)。
 * 保存順は保ったまま病名を先頭に寄せるだけで、病名同士・オーダー同士の順は変えない。
 * 登録画面はこの並びのまま保存するので、DB の display_order も次の保存で同じ並びになる。
 */
export function sortConditionsFirst<T extends { orderType: OrderSetOrderType }>(entries: T[]): T[] {
  return [
    ...entries.filter((e) => e.orderType === "condition"),
    ...entries.filter((e) => e.orderType !== "condition"),
  ];
}

/**
 * 保存しているフォーム値の版。フォーム値の項目を削除・改名したら上げて
 * migrateEntryValues に分岐を足す(項目の追加だけなら既定値で埋まるので上げない)。
 */
export const ORDER_SET_SCHEMA_VERSION = 1;

/** 1 回の適用で登録したオーダー群を束ねる識別子(ヘッダ ServiceRequest.identifier)。 */
export const ORDER_SET_INSTANCE_SYSTEM = "http://fhir-client.local/Identifier/order-set-instance";
/** どのセットから出したか(ヘッダ ServiceRequest の拡張、valueCoding.code = セットの code)。 */
export const ORDER_SET_CODE_SYSTEM = "http://fhir-client.local/CodeSystem/order-set";
export const ORDER_SET_EXT_URL = "http://fhir-client.local/StructureDefinition/order-set";

// ---- Bundle のマージと印 --------------------------------------------------------

/**
 * 各種別の builder が返す transaction Bundle を 1 本にまとめる(適用は全部登録か
 * 全部失敗かのどちらかにする)。fullUrl は builder が呼び出しごとに urn:uuid を採る
 * ので衝突しない。
 */
export function mergeTransactionBundles(bundles: fhir4.Bundle[]): fhir4.Bundle {
  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: bundles.flatMap((bundle) => bundle.entry ?? []),
  };
}

/**
 * 登録するオーダーのヘッダ(basedOn を持たない ServiceRequest)に、どのセットから
 * 出したかの印を焼く。入力の Bundle は変えず、対象の entry だけ浅く写して返す。
 *
 * 印は identifier(適用 1 回ぶんの uuid)と order-set 拡張(セットの code と名前)。
 * requisition は 0..1 で、注射の連日展開(injection-series)と看護指示の同時発行が
 * 先に使っているため、**空いているときだけ**入れる(上書きすると注射の束ねを壊す)。
 */
export function stampOrderSetInstance(
  bundle: fhir4.Bundle,
  set: { code: string; name: string },
  instanceId: string = crypto.randomUUID(),
): fhir4.Bundle {
  const identifier: fhir4.Identifier = { system: ORDER_SET_INSTANCE_SYSTEM, value: instanceId };
  const extension: fhir4.Extension = {
    url: ORDER_SET_EXT_URL,
    valueCoding: { system: ORDER_SET_CODE_SYSTEM, code: set.code, display: set.name },
  };
  return {
    ...bundle,
    entry: (bundle.entry ?? []).map((entry) => {
      if (!isHeaderEntry(entry)) return entry;
      const sr = entry.resource;
      return {
        ...entry,
        resource: {
          ...sr,
          identifier: [...(sr.identifier ?? []), identifier],
          extension: [...(sr.extension ?? []), extension],
          requisition: sr.requisition ?? identifier,
        },
      };
    }),
  };
}

/** オーダーがセットから出たものなら、そのセットの code と名前。 */
export function orderSetOf(sr: fhir4.ServiceRequest): { code: string; name: string } | null {
  const coding = sr.extension?.find((e) => e.url === ORDER_SET_EXT_URL)?.valueCoding;
  if (!coding?.code) return null;
  return { code: coding.code, name: coding.display ?? "" };
}

/** 同じ適用で登録したオーダー群を束ねる uuid。セットから出ていなければ空。 */
export function orderSetInstanceOf(sr: fhir4.ServiceRequest): string {
  return sr.identifier?.find((i) => i.system === ORDER_SET_INSTANCE_SYSTEM)?.value ?? "";
}

// ---- 保存前の正規化 -------------------------------------------------------------

/**
 * セットに保存する前に、患者に紐づく値と日付を落とす。
 *
 * ・対象プロブレム、依頼病名(Condition)、テンプレート回答、明細の id は別の患者へ
 *   持ち越せないので必ず落とす(DB に患者への参照を残さない)。
 * ・日付・時刻は空にする。読み込み時に buildDoXxxForm が当日で埋めるので、空のまま
 *   画面に出て検証に落ちることはない。
 * ・入外区分・処方区分は残す(「外来の院外処方セット」は種類として意味がある)。
 * ・病名は開始日・終了日・転帰・親プロブレム・引き継ぎ先を落とす(経過と関連は患者のもの)。
 * ・未対応の種別は対象プロブレムだけ落とす(Phase 2 で種別ごとに足す)。
 */
export function sanitizeValuesForSet(orderType: OrderSetOrderType, values: unknown): unknown {
  switch (orderType) {
    case "condition": {
      const v = values as ConditionFormValues;
      return {
        ...v,
        startDate: "",
        endDate: "",
        outcome: "active",
        parentId: "",
        succeededByIds: [],
      } satisfies ConditionFormValues;
    }
    case "prescription": {
      const v = values as PrescriptionFormValues;
      return {
        ...v,
        problem: null,
        startDate: "",
        rps: v.rps.map((rp) => ({
          ...rp,
          medicines: rp.medicines.map(({ id: _id, ...rest }) => rest),
        })),
      } satisfies PrescriptionFormValues;
    }
    case "injection": {
      const v = values as InjectionFormValues;
      return {
        ...v,
        problem: null,
        startDate: "",
        endDate: "",
        series: null,
        rps: v.rps.map((rp) => ({
          ...rp,
          medicines: rp.medicines.map(({ id: _id, ...rest }) => rest),
        })),
      } satisfies InjectionFormValues;
    }
    case "lab-order": {
      const v = values as LabOrderFormValues;
      return {
        ...v,
        problem: null,
        startDate: "",
        items: v.items.map((item) => ({ ...item, id: "" })),
      } satisfies LabOrderFormValues;
    }
    case "rad-order":
    case "physio-order": {
      const v = values as RadOrderFormValues | PhysioOrderFormValues;
      return {
        ...v,
        problem: null,
        startDate: "",
        startTime: "",
        items: v.items.map((item) => ({
          ...item,
          id: "",
          reasonConditionId: "",
          reasonName: "",
          purposeTemplate: null,
          remarksTemplate: null,
          date: "",
          time: "",
        })),
      };
    }
    case "treatment-order": {
      const v = values as TreatmentOrderFormValues;
      return {
        ...v,
        problem: null,
        startDate: "",
        startTime: "",
        items: v.items.map((item) => ({ ...item, id: "", date: "", time: "" })),
      } satisfies TreatmentOrderFormValues;
    }
    default: {
      const v = values as { problem?: unknown };
      return { ...v, problem: null };
    }
  }
}

/**
 * 保存時の版が今と違うエントリを、いまのフォーム値の形に寄せる。v1 は恒等。
 * 新しい版で作られたエントリ(このクライアントより新しい)は解釈できないので
 * unsupported を立て、画面は読み取り専用にする。
 */
export function migrateEntryValues(
  _orderType: OrderSetOrderType,
  schemaVersion: number,
  values: unknown,
): { values: unknown; unsupported: boolean } {
  if (schemaVersion > ORDER_SET_SCHEMA_VERSION) return { values, unsupported: true };
  return { values, unsupported: false };
}

// ---- 要約 ------------------------------------------------------------------------

function joinNames(names: string[], max = 4): string {
  const filtered = names.filter(Boolean);
  if (filtered.length === 0) return "";
  const head = filtered.slice(0, max).join("、");
  return filtered.length > max ? `${head} ほか${filtered.length - max}件` : head;
}

/** 一覧に出す 1 行の要約(保存時に label へ入れる)。 */
export function summarizeOrderSetValues(orderType: OrderSetOrderType, values: unknown): string {
  switch (orderType) {
    case "condition":
      return conditionDisplayName(values as ConditionFormValues);
    case "prescription":
    case "injection": {
      const v = values as PrescriptionFormValues | InjectionFormValues;
      return joinNames(v.rps.flatMap((rp) => rp.medicines.map((m) => m.medicine?.name ?? "")));
    }
    case "lab-order":
    case "rad-order":
    case "physio-order":
    case "treatment-order": {
      const v = values as { items: { name: string; shortName: string; parentCode: string }[] };
      // セット(パネル)の構成項目は親の名前で代表させる。
      return joinNames(v.items.filter((i) => !i.parentCode).map((i) => i.shortName || i.name));
    }
    default:
      return "";
  }
}
