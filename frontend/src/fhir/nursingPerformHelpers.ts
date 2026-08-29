import type { NursingObservation } from "../api/masterClient";
import { toFhirDateTime } from "./clinicalNoteHelpers";
import { NURSING_ORDER_TYPE, nursingOrderItem, summarizeNursingOrder } from "./nursingOrderHelpers";
import { ORDER_TYPE_SYSTEM } from "./prescriptionHelpers";
import { referenceId } from "./shared";
import {
  VITAL_MEASURES,
  bloodPressureCodeableConcept,
  buildBloodPressureComponents,
} from "./vitalHelpers";

// 看護指示の実施記録。
//
//   ServiceRequest(観察の指示) ← basedOn ── Observation(観察した値。日々増える)
//   ServiceRequest(行為の指示) ← basedOn ── Procedure(実施した記録。日々増える)
//
// 指示は入院中ずっと有効で、実施は 1 日に何度も積み上がる。**実施しても指示受けの
// Task は動かさない**(リハビリの実施と同じ理由。docs/rehab-order-design.md §4)。
// 取消は Observation / Procedure を消すだけ。
//
// 1 回の記録(ラウンドで 1 患者ぶんをまとめて入れる)は identifier で束ねる。バイタルの
// vital-entry とは別の system にしてあるのは、カルテのバイタルカードに混ぜないため
// (groupVitalEntries は vital-entry を持つものだけを拾う)。
//
// Observation の category は order-type の nursing **だけ**。上流は category の先頭の
// concept しか索引しないので vital-signs を足しても検索には効かず、カルテのバイタル
// 検索に混ざる害しかない。経過表は category を `vital-signs,nursing` で引く
// (api/queries.ts の VITAL_FLOWSHEET_CATEGORY)。
//
// 真のバイタル(SpO2・体温など)は LOINC を第 2 coding に併記する。経過表の行キーは
// LOINC 優先なので、看護観察として記録した SpO2 が手入力のバイタルと同じ行に並ぶ。

/** 1 回の記録(ラウンド)を束ねる identifier の system。 */
export const NURSING_PERFORM_ENTRY_SYSTEM = "http://fhir-client.local/nursing-perform-entry";

/** 列挙型の観察結果のコード。MEDIS の観察結果グループ + 選択肢の順番。 */
export const NURSING_OBSERVATION_RESULT_SYSTEM =
  "http://fhir-client.local/CodeSystem/nursing-observation-result";

const LOINC = "http://loinc.org";
const UCUM = "http://unitsofmeasure.org";
const PROCEDURE_PROFILE = "http://jpfhir.jp/fhir/core/StructureDefinition/JP_Procedure";

/**
 * MEDIS 看護観察の管理番号 → LOINC(バイタル)。ここにある観察は経過表でバイタルの
 * 既定行に合流する。収縮期・拡張期の単独項目(31001848 / 31001849)は入れない
 * (血圧行とは別行になり、グラフの系列キーが血圧の内訳と衝突する)。
 */
type LoincMapEntry = { kind: "measure"; code: string; display: string; unit: string; ucum: string } | { kind: "bp" };

function measureEntry(key: (typeof VITAL_MEASURES)[number]["key"]): LoincMapEntry {
  const measure = VITAL_MEASURES.find((m) => m.key === key);
  if (!measure) throw new Error(`unknown vital measure: ${key}`);
  return { kind: "measure", code: measure.code, display: measure.display, unit: measure.unit, ucum: measure.ucum };
}

const NURSING_LOINC_MAP: Record<string, LoincMapEntry> = {
  "31000001": measureEntry("spo2"), // 経皮的動脈血酸素飽和度(SpO2)
  "31001368": measureEntry("temperature"), // 体温
  "31001390": measureEntry("pulse"), // 脈拍数
  "31001369": measureEntry("respiration"), // 呼吸数
  "31000296": measureEntry("weight"), // 体重(kg)
  "31000298": measureEntry("height"), // 身長(cm)
  "31002365": { kind: "bp" }, // 血圧(血圧型)
};

// ---- マスタ → 入力欄の仕様 ----

/** 列挙型の選択肢。結果 1〜18 の空でないものを並べる。 */
export function nursingObservationResults(obs: NursingObservation): string[] {
  const values: string[] = [];
  for (let i = 1; i <= 18; i++) {
    const v = obs[`result_${i}`];
    if (v) values.push(v);
  }
  return values;
}

export interface NumberMaskFormat {
  /** input の step。"99.9" なら "0.1"。桁が読めなければ "any"。 */
  step: string;
  /** 桁マスクから読める最大値。読めなければ undefined。 */
  max?: number;
}

/**
 * MEDIS の桁マスク("999" "99.9" "999.9")から入力欄の刻みと上限を読む。
 * 9 以外の文字や符号を含むもの(体重減少率 "-999.9" など)は刻みだけ any にする。
 */
export function numberMaskFormat(mask: string | null | undefined): NumberMaskFormat {
  const m = (mask ?? "").trim();
  if (!/^9+(\.9+)?$/.test(m)) return { step: "any" };
  const [whole, fraction = ""] = m.split(".");
  return {
    step: fraction ? `0.${"0".repeat(fraction.length - 1)}1` : "1",
    max: Number(`${"9".repeat(whole.length)}${fraction ? `.${"9".repeat(fraction.length)}` : ""}`),
  };
}

export type NursingObservationInputSpec =
  | { kind: "number"; unit: string; mask: NumberMaskFormat }
  | { kind: "enum"; options: string[]; resultGroupCode: string }
  | { kind: "text" }
  | {
      kind: "pair";
      labels: [string, string];
      units: [string, string];
      masks: [NumberMaskFormat, NumberMaskFormat];
    }
  | { kind: "bp" };

/** "縦cm:横cm" → 名前と単位に分ける。分けられなければ名前そのまま・単位なし。 */
function splitPairUnit(unit: string): { labels: [string, string]; units: [string, string] } {
  const [a = "", b = ""] = unit.split(":");
  const split = (part: string): [string, string] => {
    const m = part.match(/^(.*?)([A-Za-z%/]+)$/);
    return m && m[1] ? [m[1], m[2]] : [part, ""];
  };
  const [la, ua] = split(a);
  const [lb, ub] = split(b);
  return { labels: [la, lb], units: [ua, ub] };
}

/**
 * 観察マスタの表現タイプから入力欄の形を決める。マスタが引けない(自由記載や削除済み)
 * ときは文字入力。表現タイプは MEDIS の配布どおり 5 種(血圧型は仕様書に無いが実在する)。
 */
export function nursingObservationInputSpec(
  obs: NursingObservation | undefined,
): NursingObservationInputSpec {
  if (!obs) return { kind: "text" };
  const type = obs.expression_type ?? "";
  if (type.includes("列挙")) {
    return {
      kind: "enum",
      options: nursingObservationResults(obs),
      resultGroupCode: obs.result_group_code ?? "",
    };
  }
  if (type.includes("血圧")) return { kind: "bp" };
  if (type.includes("２数値") || type.includes("2数値")) {
    const { labels, units } = splitPairUnit(obs.unit ?? "");
    return {
      kind: "pair",
      labels,
      units,
      masks: [numberMaskFormat(obs.result_1), numberMaskFormat(obs.result_2)],
    };
  }
  if (type.includes("数値")) {
    return { kind: "number", unit: obs.unit ?? "", mask: numberMaskFormat(obs.result_1) };
  }
  return { kind: "text" };
}

// ---- フォームの値 ----

export interface NursingObservationInput {
  /** 数値・文字・列挙は [値, ""]、2 値と血圧は [1 つ目, 2 つ目]。 */
  values: [string, string];
  note: string;
}

export interface NursingActInput {
  done: boolean;
  note: string;
}

export interface NursingPerformFormValues {
  /** datetime-local の値。 */
  recordedAt: string;
  performerId: string;
  performerName: string;
  /** 指示(ServiceRequest)の id → 入力。 */
  observations: Record<string, NursingObservationInput>;
  acts: Record<string, NursingActInput>;
}

/** 指示が観察か行為か。マスタ外の自由記載は観察(文字入力)として扱う。 */
export function isObservationOrder(order: fhir4.ServiceRequest): boolean {
  return nursingOrderItem(order)?.kind !== "act";
}

export function emptyNursingPerformForm(
  orders: fhir4.ServiceRequest[],
  recordedAt: string,
): NursingPerformFormValues {
  const observations: Record<string, NursingObservationInput> = {};
  const acts: Record<string, NursingActInput> = {};
  for (const order of orders) {
    const id = order.id ?? "";
    if (isObservationOrder(order)) observations[id] = { values: ["", ""], note: "" };
    else acts[id] = { done: false, note: "" };
  }
  return { recordedAt, performerId: "", performerName: "", observations, acts };
}

function observationHasValue(input: NursingObservationInput): boolean {
  return input.values.some((v) => v.trim() !== "");
}

/** 何か 1 つでも記録する値があるか(全部空の記録は作らない)。 */
export function hasAnyNursingPerformValue(values: NursingPerformFormValues): boolean {
  return (
    Object.values(values.observations).some(observationHasValue) ||
    Object.values(values.acts).some((a) => a.done)
  );
}

function numberOf(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** 入力チェック。問題なければ空文字。 */
export function validateNursingPerformForm(
  values: NursingPerformFormValues,
  orders: fhir4.ServiceRequest[],
  specs: Map<string, NursingObservationInputSpec>,
): string {
  if (!values.recordedAt) return "記録日時を入れてください。";
  if (!hasAnyNursingPerformValue(values)) return "記録する値を 1 つ以上入れてください。";

  for (const order of orders) {
    const id = order.id ?? "";
    const input = values.observations[id];
    if (!input || !observationHasValue(input)) continue;
    const label = summarizeNursingOrder(order).text;
    const spec = specs.get(id) ?? { kind: "text" };
    const [a, b] = input.values;

    if (spec.kind === "number") {
      const n = numberOf(a);
      if (n === null) return `${label}: 数値を入れてください。`;
      if (spec.mask.max !== undefined && n > spec.mask.max) {
        return `${label}: ${spec.mask.max} 以下で入れてください。`;
      }
    } else if (spec.kind === "pair" || spec.kind === "bp") {
      const na = numberOf(a);
      const nb = numberOf(b);
      if (na === null || nb === null) return `${label}: 2 つの値を両方入れてください。`;
    }
  }
  return "";
}

// ---- 組み立て ----

interface BuildContext {
  entryId: string;
  effectiveDateTime: string;
  performer: { id: string; name: string } | null;
}

function performerReference(performer: BuildContext["performer"]): fhir4.Reference | null {
  if (!performer?.id) return null;
  return {
    reference: `Practitioner/${performer.id}`,
    ...(performer.name ? { display: performer.name } : {}),
  };
}

/** 指示の code に、対応表にあれば LOINC を併記した code。 */
function observationCode(order: fhir4.ServiceRequest): fhir4.CodeableConcept {
  const item = nursingOrderItem(order);
  const codings: fhir4.Coding[] = [...(order.code?.coding ?? [])];
  const mapped = item?.kind === "observation" ? NURSING_LOINC_MAP[item.manageNo] : undefined;
  if (mapped?.kind === "measure") {
    codings.push({ system: LOINC, code: mapped.code, display: mapped.display });
  } else if (mapped?.kind === "bp") {
    codings.push(...(bloodPressureCodeableConcept().coding ?? []));
  }
  return { ...(codings.length > 0 ? { coding: codings } : {}), text: summarizeNursingOrder(order).text };
}

function observationValue(
  order: fhir4.ServiceRequest,
  spec: NursingObservationInputSpec,
  input: NursingObservationInput,
): Partial<fhir4.Observation> {
  const [a, b] = input.values;
  const item = nursingOrderItem(order);
  const mapped = item?.kind === "observation" ? NURSING_LOINC_MAP[item.manageNo] : undefined;

  switch (spec.kind) {
    case "number": {
      const value = numberOf(a);
      if (value === null) return {};
      const unit = mapped?.kind === "measure" ? mapped.unit : spec.unit;
      const ucum = mapped?.kind === "measure" ? mapped.ucum : undefined;
      return {
        valueQuantity: {
          value,
          ...(unit ? { unit } : {}),
          ...(ucum ? { system: UCUM, code: ucum } : {}),
        },
      };
    }
    case "enum": {
      const index = spec.options.indexOf(a);
      const concept: fhir4.CodeableConcept = { text: a };
      if (spec.resultGroupCode && index >= 0) {
        concept.coding = [
          {
            system: NURSING_OBSERVATION_RESULT_SYSTEM,
            code: `${spec.resultGroupCode}-${String(index + 1).padStart(2, "0")}`,
            display: a,
          },
        ];
      }
      return { valueCodeableConcept: concept };
    }
    case "pair": {
      const na = numberOf(a);
      const nb = numberOf(b);
      if (na === null || nb === null) return {};
      return {
        component: [
          {
            code: { text: spec.labels[0] },
            valueQuantity: { value: na, ...(spec.units[0] ? { unit: spec.units[0] } : {}) },
          },
          {
            code: { text: spec.labels[1] },
            valueQuantity: { value: nb, ...(spec.units[1] ? { unit: spec.units[1] } : {}) },
          },
        ],
      };
    }
    case "bp": {
      const na = numberOf(a);
      const nb = numberOf(b);
      if (na === null || nb === null) return {};
      return { component: buildBloodPressureComponents(na, nb) };
    }
    default:
      return { valueString: a.trim() };
  }
}

function buildNursingObservation(
  order: fhir4.ServiceRequest,
  spec: NursingObservationInputSpec,
  input: NursingObservationInput,
  ctx: BuildContext,
): fhir4.Observation {
  const observation: fhir4.Observation = {
    resourceType: "Observation",
    status: "final",
    identifier: [{ system: NURSING_PERFORM_ENTRY_SYSTEM, value: ctx.entryId }],
    // 他オーダーの Observation と振り分ける区分。上流は先頭の concept しか索引しない
    // ので、これ以外の category は付けない(ファイル冒頭のコメント)。
    category: [{ coding: [{ system: ORDER_TYPE_SYSTEM, ...NURSING_ORDER_TYPE }] }],
    code: observationCode(order),
    subject: order.subject ?? {},
    ...(order.encounter ? { encounter: order.encounter } : {}),
    basedOn: [{ reference: `ServiceRequest/${order.id}` }],
    effectiveDateTime: ctx.effectiveDateTime,
    ...observationValue(order, spec, input),
  };
  const performer = performerReference(ctx.performer);
  if (performer) observation.performer = [performer];
  if (input.note.trim()) observation.note = [{ text: input.note.trim() }];
  return observation;
}

function buildNursingProcedure(
  order: fhir4.ServiceRequest,
  input: NursingActInput,
  ctx: BuildContext,
): fhir4.Procedure {
  const procedure: fhir4.Procedure = {
    resourceType: "Procedure",
    meta: { profile: [PROCEDURE_PROFILE] },
    identifier: [{ system: NURSING_PERFORM_ENTRY_SYSTEM, value: ctx.entryId }],
    status: "completed",
    category: { coding: [{ system: ORDER_TYPE_SYSTEM, ...NURSING_ORDER_TYPE }] },
    code: order.code ?? { text: summarizeNursingOrder(order).text },
    subject: order.subject ?? {},
    ...(order.encounter ? { encounter: order.encounter } : {}),
    basedOn: [{ reference: `ServiceRequest/${order.id}` }],
    performedDateTime: ctx.effectiveDateTime,
  };
  const performer = performerReference(ctx.performer);
  if (performer) procedure.performer = [{ actor: performer }];
  if (input.note.trim()) procedure.note = [{ text: input.note.trim() }];
  return procedure;
}

/**
 * 1 回の記録を 1 transaction にする。値の入った観察と、チェックした行為だけを作る。
 * 指示受けの Task は触らない(ファイル冒頭のコメント)。
 */
export function buildNursingPerformBundle(
  values: NursingPerformFormValues,
  orders: fhir4.ServiceRequest[],
  specs: Map<string, NursingObservationInputSpec>,
): fhir4.Bundle {
  const ctx: BuildContext = {
    entryId: crypto.randomUUID(),
    effectiveDateTime: toFhirDateTime(values.recordedAt),
    performer: values.performerId ? { id: values.performerId, name: values.performerName } : null,
  };

  const entry: fhir4.BundleEntry[] = [];
  for (const order of orders) {
    const id = order.id ?? "";
    if (isObservationOrder(order)) {
      const input = values.observations[id];
      if (!input || !observationHasValue(input)) continue;
      entry.push({
        resource: buildNursingObservation(order, specs.get(id) ?? { kind: "text" }, input, ctx),
        request: { method: "POST", url: "Observation" },
      });
    } else {
      const input = values.acts[id];
      if (!input?.done) continue;
      entry.push({
        resource: buildNursingProcedure(order, input, ctx),
        request: { method: "POST", url: "Procedure" },
      });
    }
  }
  return { resourceType: "Bundle", type: "transaction", entry };
}

// ---- 表示 ----

export interface NursingPerformDisplay {
  id: string;
  resourceType: "Observation" | "Procedure";
  orderId: string;
  /** 記録日時(FHIR の dateTime)。並べ替えに使う。 */
  at: string;
  /** "8/29 14:00"。 */
  atLabel: string;
  /** 観察は値(単位付き)、行為は「実施」。 */
  value: string;
  performerName: string;
  note: string;
  entryId: string;
}

function isNursingCategory(category: fhir4.CodeableConcept | undefined): boolean {
  return Boolean(
    category?.coding?.some(
      (c) => c.system === ORDER_TYPE_SYSTEM && c.code === NURSING_ORDER_TYPE.code,
    ),
  );
}

/** 看護観察の結果か。他オーダーの Observation と振り分ける。 */
export function isNursingPerformObservation(observation: fhir4.Observation): boolean {
  return (observation.category ?? []).some(isNursingCategory);
}

/** 看護行為の実施記録か。 */
export function isNursingProcedure(procedure: fhir4.Procedure): boolean {
  return isNursingCategory(procedure.category);
}

/** 観察結果の表示値(単位付き)。2 値は "12.5/8 cm"。 */
export function nursingObservationValueLabel(observation: fhir4.Observation): string {
  const quantity = observation.valueQuantity;
  if (quantity?.value !== undefined) return `${quantity.value}${quantity.unit ? ` ${quantity.unit}` : ""}`;
  if (observation.valueString) return observation.valueString;
  const concept = observation.valueCodeableConcept;
  if (concept?.text || concept?.coding?.[0]?.display) {
    return concept.text ?? concept.coding?.[0]?.display ?? "";
  }
  const components = (observation.component ?? []).filter((c) => c.valueQuantity?.value !== undefined);
  if (components.length > 0) {
    const unit = components[0].valueQuantity?.unit;
    return `${components.map((c) => c.valueQuantity?.value).join("/")}${unit ? ` ${unit}` : ""}`;
  }
  return "";
}

function atLabelOf(at: string): string {
  const [date, time] = at.split("T");
  const [, month, day] = (date ?? "").split("-");
  const md = month && day ? `${Number(month)}/${Number(day)}` : date;
  return time ? `${md} ${time.slice(0, 5)}` : md;
}

function entryIdOf(identifiers: fhir4.Identifier[] | undefined): string {
  return identifiers?.find((i) => i.system === NURSING_PERFORM_ENTRY_SYSTEM)?.value ?? "";
}

function observationDisplay(observation: fhir4.Observation): NursingPerformDisplay | null {
  const orderId = referenceId(observation.basedOn?.[0]?.reference);
  if (!orderId) return null;
  const at = observation.effectiveDateTime ?? "";
  return {
    id: observation.id ?? "",
    resourceType: "Observation",
    orderId,
    at,
    atLabel: atLabelOf(at),
    value: nursingObservationValueLabel(observation),
    performerName: observation.performer?.[0]?.display ?? "",
    note: observation.note?.[0]?.text ?? "",
    entryId: entryIdOf(observation.identifier),
  };
}

function procedureDisplay(procedure: fhir4.Procedure): NursingPerformDisplay | null {
  const orderId = referenceId(procedure.basedOn?.[0]?.reference);
  if (!orderId) return null;
  const at = procedure.performedDateTime ?? "";
  return {
    id: procedure.id ?? "",
    resourceType: "Procedure",
    orderId,
    at,
    atLabel: atLabelOf(at),
    value: "実施",
    performerName: procedure.performer?.[0]?.actor?.display ?? "",
    note: procedure.note?.[0]?.text ?? "",
    entryId: entryIdOf(procedure.identifier),
  };
}

/** 指示の id → その実施記録(新しい順)。誤登録として取り消したものは出さない。 */
export function nursingPerformsByOrderId(
  observations: fhir4.Observation[],
  procedures: fhir4.Procedure[],
): Map<string, NursingPerformDisplay[]> {
  const byOrderId = new Map<string, NursingPerformDisplay[]>();
  const push = (display: NursingPerformDisplay | null) => {
    if (!display) return;
    const list = byOrderId.get(display.orderId);
    if (list) list.push(display);
    else byOrderId.set(display.orderId, [display]);
  };
  for (const observation of observations) {
    if (!isNursingPerformObservation(observation) || observation.status === "entered-in-error") continue;
    push(observationDisplay(observation));
  }
  for (const procedure of procedures) {
    if (!isNursingProcedure(procedure) || procedure.status === "entered-in-error") continue;
    push(procedureDisplay(procedure));
  }
  for (const list of byOrderId.values()) {
    list.sort((a, b) => b.at.localeCompare(a.at));
  }
  return byOrderId;
}

/** 実施記録を消すエントリ。子リソースを持たないので 1 件ずつ。 */
export function buildNursingPerformDeleteEntries(
  items: { resourceType: "Observation" | "Procedure"; id: string }[],
): fhir4.BundleEntry[] {
  return items.map((item) => ({
    request: { method: "DELETE" as const, url: `${item.resourceType}/${item.id}` },
  }));
}
