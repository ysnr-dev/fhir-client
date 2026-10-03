// DPC 様式1 の値の検証と、保存形(QuestionnaireResponse)との相互変換。
//
// 様式1 は入院 1 件につき 1 つの QuestionnaireResponse に保存する(encounter で入院を指す)。
// item は提出ファイルの行と 1 対 1 に対応させる:
//
//   header                    : ヘッダ部(施設コード・データ識別番号・入院年月日・回数管理番号・
//                               統括診療情報番号)と、使った定義表の年度
//   <コード>(A000010 など)   : 1 レコード。子は .ver(バージョン)/ .seq(連番)/
//                               .p1〜.p9(ペイロード)/ .ref(値の元になったリソース)
//
// 連番のあるレコードは同じ linkId のグループを行の数だけ並べる。提出ファイルの出力
// (backend)はこの item を機械的に行へ展開するだけで、項目の意味は知らない。必須の
// 検証はここ(画面側)だけが持つので、「確定」で保存したもの = 検証を通ったものとする。

import { nowFhirDateTime } from "../lib/dates";
import { DIAGNOSIS_CODES } from "./dpcForm1/rules";
import type {
  Dpc1Context,
  Dpc1FieldDef,
  Dpc1Header,
  Dpc1PayloadNo,
  Dpc1RecordDef,
  Dpc1Requirement,
  Dpc1Row,
  Dpc1Values,
} from "./dpcForm1/types";
import {
  DEFAULT_INSTITUTION_NUMBER,
  JASPEHR_QUESTIONNAIRE_RESPONSE_PROFILE_URL,
} from "./questionnaireResponseHelpers";
import { referenceId } from "./shared";

export const DPC_FORM1_QUESTIONNAIRE = "http://fhir-client.local/Questionnaire/dpc-form1";

export type DpcForm1Status = "in-progress" | "completed" | "amended";

const PAYLOADS: Dpc1PayloadNo[] = [1, 2, 3, 4, 5, 6, 7, 8, 9];

export function emptyDpc1Row(): Dpc1Row {
  return { p: {} };
}

export function isEmptyDpc1Row(row: Dpc1Row): boolean {
  return PAYLOADS.every((n) => !row.p[n]);
}

// ---- 条件の評価 ----

export interface Dpc1ContextSource {
  values: Dpc1Values;
  /** 入院時の年齢。 */
  age: number | null;
  /** ICD-10 → 診断群分類の上 6 桁(対応表マスタから引いたもの)。 */
  mdc6ByIcd: Record<string, string[]>;
}

export function buildDpc1Context(source: Dpc1ContextSource): Dpc1Context {
  const rows = (code: string) => source.values.records[code] ?? [];
  return {
    age: source.age,
    get: (code, payload, index = 0) => rows(code)[index]?.p[payload] ?? "",
    rows,
    mdc6: (icd10) => source.mdc6ByIcd[icd10] ?? [],
  };
}

/**
 * 連番のあるレコードの 1 行を見るための文脈。同じレコードの値を行番号なしで読むと
 * その行の値になる(「同じ行の麻酔が全身麻酔なら必須」のような条件を書けるように)。
 */
function contextForRow(ctx: Dpc1Context, code: string, index: number): Dpc1Context {
  return {
    ...ctx,
    get: (c, payload, i) => ctx.get(c, payload, i ?? (c === code ? index : 0)),
  };
}

/** あるレコードの行だけを差し替えた文脈(空行を除いた並びで条件を評価するため)。 */
function contextWithRows(ctx: Dpc1Context, code: string, rows: Dpc1Row[]): Dpc1Context {
  const rowsOf = (c: string) => (c === code ? rows : ctx.rows(c));
  return {
    ...ctx,
    rows: rowsOf,
    get: (c, payload, index = 0) => rowsOf(c)[index]?.p[payload] ?? "",
  };
}

function requirementMet(requirement: Dpc1Requirement | undefined, ctx: Dpc1Context): boolean {
  if (requirement === undefined || requirement === "always") return true;
  if (requirement === "optional") return false;
  return requirement(ctx);
}

/** いまの入力内容で、このレコードが必須か。 */
export function dpc1RecordRequired(def: Dpc1RecordDef, ctx: Dpc1Context): boolean {
  return requirementMet(def.required, ctx);
}

export function dpc1FieldVisible(
  def: Dpc1RecordDef,
  field: Dpc1FieldDef,
  ctx: Dpc1Context,
  index: number,
): boolean {
  return field.visible ? field.visible(contextForRow(ctx, def.code, index)) : true;
}

export function dpc1FieldRequired(
  def: Dpc1RecordDef,
  field: Dpc1FieldDef,
  ctx: Dpc1Context,
  index: number,
): boolean {
  return requirementMet(field.required, contextForRow(ctx, def.code, index));
}

/** 診断情報に入力されている ICD-10(重複なし)。対応表マスタを引くのに使う。 */
export function dpc1DiagnosisIcds(values: Dpc1Values): string[] {
  const icds = DIAGNOSIS_CODES.flatMap((code) =>
    (values.records[code] ?? []).map((row) => row.p[2] ?? ""),
  ).filter(Boolean);
  return Array.from(new Set(icds)).sort();
}

// ---- 検証 ----

function isValidDate(value: string): boolean {
  if (!/^\d{8}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

/** composite の値を部品ごとの code に分ける。桁が合わなければ null。 */
export function splitDpc1Composite(field: Dpc1FieldDef, value: string): string[] | null {
  const parts = field.parts ?? [];
  const codes: string[] = [];
  let offset = 0;
  for (const part of parts) {
    const length = part.options[0]?.code.length ?? 1;
    codes.push(value.slice(offset, offset + length));
    offset += length;
  }
  return offset === value.length ? codes : null;
}

function fieldFormatError(field: Dpc1FieldDef, value: string): string | null {
  if (field.specials?.some((s) => s.code === value)) return null;
  switch (field.kind) {
    case "date":
      return isValidDate(value) ? null : "日付が正しくありません";
    case "select":
      return field.options?.some((o) => o.code === value) ? null : "選択肢にない値です";
    case "digits":
      if (!/^\d+$/.test(value)) return "数字で入力してください";
      if (field.digits && value.length !== field.digits) return `${field.digits} 桁で入力してください`;
      if (field.maxLength && value.length > field.maxLength) {
        return `${field.maxLength} 桁以内で入力してください`;
      }
      return null;
    case "number": {
      if (!/^\d+$/.test(value)) return "整数で入力してください";
      const n = Number(value);
      if (field.min !== undefined && n < field.min) return `${field.min} 以上で入力してください`;
      if (field.max !== undefined && n > field.max) return `${field.max} 以下で入力してください`;
      return null;
    }
    case "decimal1": {
      if (!/^\d+(\.\d)?$/.test(value)) return "小数点第一位までの数値で入力してください";
      const n = Number(value);
      if (field.min !== undefined && n < field.min) return `${field.min} 以上で入力してください`;
      if (field.max !== undefined && n > field.max) return `${field.max} 以下で入力してください`;
      return null;
    }
    case "text":
      if (field.maxLength && Array.from(value).length > field.maxLength) {
        return `${field.maxLength} 文字以内で入力してください`;
      }
      if (field.pattern && !new RegExp(`^(?:${field.pattern})$`).test(value)) {
        return "書式が正しくありません";
      }
      return null;
    case "composite": {
      const codes = splitDpc1Composite(field, value);
      const parts = field.parts ?? [];
      if (!codes || codes.some((code, i) => !parts[i].options.some((o) => o.code === code))) {
        return "すべての項目を選択してください";
      }
      return null;
    }
  }
}

/**
 * 確定するときの検証。エラーの文言を、画面の並び(定義表の順)で返す。空なら通過。
 * 下書きでは呼ばない(途中まで入れて保存できるように)。
 */
export function validateDpcForm1(
  values: Dpc1Values,
  defs: Dpc1RecordDef[],
  ctx: Dpc1Context,
): string[] {
  const errors: string[] = [];

  if (!/^\d{9}$/.test(values.header.facility)) {
    errors.push("施設コードが 9 桁の数字ではありません(自院の保険医療機関番号を確認してください)。");
  }
  if (!/^\d{10}$/.test(values.header.dataId)) {
    errors.push("データ識別番号が 10 桁の数字ではありません(患者番号は数字 10 桁以内にしてください)。");
  }

  for (const def of defs) {
    const rows = (values.records[def.code] ?? []).filter((row) => !isEmptyDpc1Row(row));
    if (!rows.length) {
      if (dpc1RecordRequired(def, ctx)) errors.push(`${def.name}: 入力してください。`);
      continue;
    }
    rows.forEach((row, index) => {
      const at = def.repeat ? `${def.name} ${index + 1}` : def.name;
      // 行番号は空行を除いたあとの並びで数える(保存される連番と同じ)。
      const rowCtx = contextWithRows(ctx, def.code, rows);
      for (const field of def.fields) {
        if (!dpc1FieldVisible(def, field, rowCtx, index)) continue;
        const value = row.p[field.payload] ?? "";
        if (!value) {
          if (dpc1FieldRequired(def, field, rowCtx, index)) {
            errors.push(`${at}: ${field.label}を入力してください。`);
          }
          continue;
        }
        const error = fieldFormatError(field, value);
        if (error) errors.push(`${at}: ${field.label} — ${error}。`);
      }
    });
    if (def.repeat && rows.length > def.repeat.max) {
      errors.push(`${def.name}: ${def.repeat.max} 件までです。`);
    }
  }
  return errors;
}

// ---- 保存する内容の整理 ----

/**
 * 保存・提出に回す内容。出していない欄(visible が偽)の値と空行を落とし、
 * 定義表に無いコードも落とす。
 */
export function normalizeDpc1Values(
  values: Dpc1Values,
  defs: Dpc1RecordDef[],
  ctx: Dpc1Context,
): Dpc1Values {
  const records: Record<string, Dpc1Row[]> = {};
  for (const def of defs) {
    const rows = (values.records[def.code] ?? []).filter((row) => !isEmptyDpc1Row(row));
    const rowCtx = contextWithRows(ctx, def.code, rows);
    const cleaned = rows
      .map((row, index) => {
        const p: Dpc1Row["p"] = {};
        for (const field of def.fields) {
          const value = row.p[field.payload];
          if (value && dpc1FieldVisible(def, field, rowCtx, index)) p[field.payload] = value;
        }
        return { p, ref: row.ref };
      })
      .filter((row) => !isEmptyDpc1Row(row));
    if (cleaned.length) records[def.code] = cleaned;
  }
  return { header: values.header, records };
}

// ---- QuestionnaireResponse ----

const HEADER_LINK_ID = "header";
const HEADER_KEYS: (keyof Dpc1Header)[] = [
  "facility",
  "dataId",
  "admitDate",
  "count",
  "summaryNo",
  "fiscalYear",
];
const CONTAINED_PRACTITIONER_ID = "practitioner";

function stringItem(linkId: string, value: string): fhir4.QuestionnaireResponseItem {
  return { linkId, answer: [{ valueString: value }] };
}

function itemsOf(values: Dpc1Values, defs: Dpc1RecordDef[]): fhir4.QuestionnaireResponseItem[] {
  const items: fhir4.QuestionnaireResponseItem[] = [
    {
      linkId: HEADER_LINK_ID,
      item: HEADER_KEYS.filter((key) => values.header[key] !== "").map((key) =>
        stringItem(`${HEADER_LINK_ID}.${key}`, values.header[key]),
      ),
    },
  ];
  for (const def of defs) {
    (values.records[def.code] ?? []).forEach((row, index) => {
      const children = [
        stringItem(`${def.code}.ver`, def.version),
        stringItem(`${def.code}.seq`, String(def.repeat ? index + 1 : 0)),
        ...PAYLOADS.filter((n) => row.p[n]).map((n) =>
          stringItem(`${def.code}.p${n}`, row.p[n] as string),
        ),
      ];
      if (row.ref) {
        children.push({ linkId: `${def.code}.ref`, answer: [{ valueReference: { reference: row.ref } }] });
      }
      items.push({ linkId: def.code, text: def.name, item: children });
    });
  }
  return items;
}

export interface BuildDpcForm1Args {
  /** 整理済み(normalizeDpc1Values)の値。 */
  values: Dpc1Values;
  defs: Dpc1RecordDef[];
  status: DpcForm1Status;
  patient: fhir4.Patient;
  encounterId: string;
  authorName: string;
  /** 自院の保険医療機関番号(10 桁)。identifier の先頭に入れる。 */
  institutionNumber: string;
  /** 更新時は id と identifier(報告単位ID)を引き継ぐ。 */
  existing?: fhir4.QuestionnaireResponse;
}

export function buildDpcForm1Response(args: BuildDpcForm1Args): fhir4.QuestionnaireResponse {
  const { values, defs, status, patient, encounterId, authorName, institutionNumber, existing } = args;
  const author: fhir4.Practitioner = {
    resourceType: "Practitioner",
    id: CONTAINED_PRACTITIONER_ID,
    name: [{ text: authorName }],
  };
  const patientKey = patient.identifier?.[0]?.value ?? patient.id ?? "";
  const response: fhir4.QuestionnaireResponse = {
    resourceType: "QuestionnaireResponse",
    meta: { profile: [JASPEHR_QUESTIONNAIRE_RESPONSE_PROFILE_URL] },
    contained: [author],
    identifier: {
      value:
        existing?.identifier?.value ??
        `${institutionNumber || DEFAULT_INSTITUTION_NUMBER}^${patientKey}^${crypto.randomUUID()}`,
    },
    questionnaire: DPC_FORM1_QUESTIONNAIRE,
    status,
    subject: { reference: `Patient/${patient.id}` },
    encounter: { reference: `Encounter/${encounterId}` },
    authored: nowFhirDateTime(),
    author: { reference: `#${CONTAINED_PRACTITIONER_ID}` },
    item: itemsOf(values, defs),
  };
  if (existing?.id) response.id = existing.id;
  return response;
}

function answerString(item: fhir4.QuestionnaireResponseItem | undefined): string {
  return item?.answer?.[0]?.valueString ?? "";
}

export function parseDpcForm1Form(response: fhir4.QuestionnaireResponse): Dpc1Values {
  const headerItems = response.item?.find((i) => i.linkId === HEADER_LINK_ID)?.item ?? [];
  const header = Object.fromEntries(
    HEADER_KEYS.map((key) => [
      key,
      answerString(headerItems.find((i) => i.linkId === `${HEADER_LINK_ID}.${key}`)),
    ]),
  ) as unknown as Dpc1Header;

  const records: Record<string, Dpc1Row[]> = {};
  for (const group of response.item ?? []) {
    if (group.linkId === HEADER_LINK_ID) continue;
    const row: Dpc1Row = { p: {} };
    for (const child of group.item ?? []) {
      const suffix = child.linkId.slice(group.linkId.length + 1);
      const payload = /^p([1-9])$/.exec(suffix);
      if (payload) row.p[Number(payload[1]) as Dpc1PayloadNo] = answerString(child);
      else if (suffix === "ref") row.ref = child.answer?.[0]?.valueReference?.reference;
    }
    (records[group.linkId] ??= []).push(row);
  }
  return { header, records };
}

export function dpcForm1EncounterId(response: fhir4.QuestionnaireResponse | undefined): string {
  return referenceId(response?.encounter?.reference) ?? "";
}

/** 保存するときの状態。確定済みを保存し直すと修正済みになる。 */
export function nextDpcForm1Status(
  existing: fhir4.QuestionnaireResponse | undefined,
  finalize: boolean,
): DpcForm1Status {
  if (existing && existing.status !== "in-progress") return "amended";
  return finalize ? "completed" : "in-progress";
}
