import type { LabResultItem } from "../api/masterClient";
import { localDay, today } from "../lib/dates";
import { JLAC11_SYSTEM, RESULT_ITEM_SYSTEM } from "./labResultHelpers";
import {
  ABO_OPTIONS,
  ABO_SYSTEM,
  RHD_OPTIONS,
  RHD_SYSTEM,
  type AboBloodType,
  type RhdBloodType,
} from "./transfusionOrderHelpers";
import { LOINC_SYSTEM, codingBySystem, loincOf } from "./shared";

/**
 * 患者の血液型(ABO / RhD)。
 *
 * 情報は 2 つの経路から来る(感染症 `infectionHelpers.ts` と同じ作り):
 *  - 検体検査の結果(`category=laboratory`)。JLAC11 の分析物コード(K1001 = ABO、K1006 = RhD)で
 *    引き当てる。**検査確定はこちらからだけ判定する**。異なる日に採った 2 検体で同じ型が出たときに
 *    確定とし(輸血療法の実施に関する指針の 2 回検査)、1 回だけ・食い違いは未確定として印を付ける。
 *  - 手入力(LOINC 883-9 / 10331-7、`method` = 本人・家族の申告 / 他院からの情報)。プロファイル
 *    タブで登録する。製剤を出す根拠にはしない(検査で確かめるまでの参考値)。
 *
 * 両方あるときは検査結果を優先する。輸血オーダー(`transfusionOrderHelpers.ts`)の初期値に
 * 入るのは検査で確定した型だけ。オーダー側の項目は残す(何型を出すかは依頼の中身で、
 * 患者の型と食い違いうる)。
 *
 * 手入力の置き場所は `Observation`。「いつ・何を根拠に確認した型か」が要るので、状態を表す
 * Flag ではなく検査値として持つ。ABO と RhD は LOINC も別項目なので 1 件ずつ分けて作る
 * (「ABO は分かっているが RhD はこれから」がありうる)。値のコード体系は輸血オーダーと
 * 同じものを使い、2 か所に持たない。
 */

const LOINC = LOINC_SYSTEM;
const OBSERVATION_CATEGORY_SYSTEM = "http://terminology.hl7.org/CodeSystem/observation-category";

/** ABO 血液型 / RhD 血液型の LOINC。手入力分の code。 */
export const ABO_LOINC = { code: "883-9", display: "ABO group [Type] in Blood" } as const;
export const RHD_LOINC = { code: "10331-7", display: "Rh [Type] in Blood" } as const;

/**
 * 検査結果を引き当てる JLAC11 の分析物コード(先頭 5 桁)。配布マスタが決める全国共通の
 * コードで、材料・測定法の違いは分析物では分かれないので 1 つで全部拾える。
 */
export const BLOOD_TYPE_ANALYTES = { abo: "K1001", rhd: "K1006" } as const;

/**
 * 不規則抗体スクリーニングの結果項目コード(レセプト電算コード)。配布の JLAC マスタに
 * 不規則抗体の分析物が無いので、こちらは結果項目コードで引き当てる。
 */
export const ANTIBODY_SCREEN_RESULT_ITEM_CODES = ["160161410"] as const;

/** JLAC11 の分析物コードの桁数(先頭 5 桁)。 */
const ANALYTE_LENGTH = 5;

/**
 * 手入力分の情報源。`Observation.method` に入れる。
 * 検査で確定した型は検査結果から読むので、手入力で「検査確定」は選べない。
 */
export const BLOOD_TYPE_SOURCE_SYSTEM = "http://fhir-client.local/CodeSystem/blood-type-source";

export const BLOOD_TYPE_SOURCE_OPTIONS = [
  { code: "reported", display: "本人・家族の申告" },
  { code: "referred", display: "他院からの情報" },
] as const;

export type BloodTypeSource = (typeof BLOOD_TYPE_SOURCE_OPTIONS)[number]["code"];

export function bloodTypeSourceLabel(code: string | undefined): string {
  // 検査確定を手入力で登録していたころの値。検査結果からの確定とは区別して出す。
  if (code === "tested") return "検査確定(手入力)";
  return BLOOD_TYPE_SOURCE_OPTIONS.find((o) => o.code === code)?.display ?? "";
}

export interface BloodTypeFormValues {
  abo: AboBloodType | "";
  rhd: RhdBloodType | "";
  source: BloodTypeSource;
  /** 確認日(申告を受けた日・他院情報の日付)。 */
  effectiveDate: string;
  note: string;
}

export function emptyBloodTypeForm(): BloodTypeFormValues {
  return { abo: "", rhd: "", source: "reported", effectiveDate: today(), note: "" };
}

function categoryLaboratory(): fhir4.CodeableConcept[] {
  return [{ coding: [{ system: OBSERVATION_CATEGORY_SYSTEM, code: "laboratory" }] }];
}

function methodConcept(source: BloodTypeSource): fhir4.CodeableConcept {
  return {
    coding: [
      { system: BLOOD_TYPE_SOURCE_SYSTEM, code: source, display: bloodTypeSourceLabel(source) },
    ],
  };
}

/**
 * 手入力の ABO / RhD の Observation を組み立てる。入っている型の分だけ作る
 * (片方だけ分かっている状態をそのまま保存できるようにするため)。
 * 既存の id を渡すと更新用に id 付きで作る。
 */
export function buildBloodTypeObservations(
  values: BloodTypeFormValues,
  patientId: string,
  existing?: { aboId?: string; rhdId?: string },
): fhir4.Observation[] {
  const observations: fhir4.Observation[] = [];

  if (values.abo) {
    observations.push(
      buildObservation({
        id: existing?.aboId,
        patientId,
        loinc: ABO_LOINC,
        value: {
          coding: [
            {
              system: ABO_SYSTEM,
              code: values.abo,
              display: ABO_OPTIONS.find((o) => o.code === values.abo)?.display,
            },
          ],
        },
        values,
      }),
    );
  }

  if (values.rhd) {
    observations.push(
      buildObservation({
        id: existing?.rhdId,
        patientId,
        loinc: RHD_LOINC,
        value: {
          coding: [
            {
              system: RHD_SYSTEM,
              code: values.rhd,
              display: RHD_OPTIONS.find((o) => o.code === values.rhd)?.display,
            },
          ],
        },
        values,
      }),
    );
  }

  return observations;
}

function buildObservation({
  id,
  patientId,
  loinc,
  value,
  values,
}: {
  id?: string;
  patientId: string;
  loinc: { code: string; display: string };
  value: fhir4.CodeableConcept;
  values: BloodTypeFormValues;
}): fhir4.Observation {
  const observation: fhir4.Observation = {
    resourceType: "Observation",
    status: "final",
    category: categoryLaboratory(),
    code: { coding: [{ system: LOINC, code: loinc.code, display: loinc.display }] },
    subject: { reference: `Patient/${patientId}` },
    valueCodeableConcept: value,
    method: methodConcept(values.source),
  };

  if (id) observation.id = id;
  if (values.effectiveDate) observation.effectiveDateTime = values.effectiveDate;
  if (values.note.trim()) observation.note = [{ text: values.note.trim() }];

  return observation;
}

function codeOf(observation: fhir4.Observation, system: string): string {
  const coding = observation.valueCodeableConcept?.coding;
  return coding?.find((c) => c.system === system)?.code ?? coding?.[0]?.code ?? "";
}

// ---- 検査結果からの読み取り ----

/**
 * 検査結果の検索に使う `code` の値(`system|code`)。上流のコード検索は完全一致なので、
 * 施設の結果項目マスタから血液型・不規則抗体の項目を引き、その結果項目コードと JLAC11 を
 * 並べる(`useBloodTypeResultItems`)。
 */
export function bloodTypeLabSearchCodes(items: LabResultItem[]): string[] {
  const codes = new Set<string>();
  for (const item of items) {
    if (item.result_item_code) codes.add(`${RESULT_ITEM_SYSTEM}|${item.result_item_code}`);
    if (item.jlac11_code) codes.add(`${JLAC11_SYSTEM}|${item.jlac11_code}`);
  }
  for (const code of ANTIBODY_SCREEN_RESULT_ITEM_CODES) {
    codes.add(`${RESULT_ITEM_SYSTEM}|${code}`);
  }
  return [...codes].sort();
}

type LabKind = "abo" | "rhd" | "antibody";

/** 結果項目マスタから、結果項目コード → 種類の対応を作る(JLAC11 を持たない結果の引き当て用)。 */
function resultItemKinds(items: LabResultItem[]): Map<string, LabKind> {
  const kinds = new Map<string, LabKind>();
  for (const item of items) {
    const analyte = item.jlac11_code?.slice(0, ANALYTE_LENGTH);
    if (analyte === BLOOD_TYPE_ANALYTES.abo) kinds.set(item.result_item_code, "abo");
    else if (analyte === BLOOD_TYPE_ANALYTES.rhd) kinds.set(item.result_item_code, "rhd");
  }
  return kinds;
}

/** 検査結果がどの項目か。JLAC11 の分析物を先に見て、無ければ結果項目コードで決める。 */
function labKindOf(observation: fhir4.Observation, kinds: Map<string, LabKind>): LabKind | null {
  const codings = observation.code?.coding;
  const analyte = codingBySystem(codings, JLAC11_SYSTEM)?.code?.slice(0, ANALYTE_LENGTH);
  if (analyte === BLOOD_TYPE_ANALYTES.abo) return "abo";
  if (analyte === BLOOD_TYPE_ANALYTES.rhd) return "rhd";

  const itemCode = codingBySystem(codings, RESULT_ITEM_SYSTEM)?.code ?? "";
  if (!itemCode) return null;
  if (ANTIBODY_SCREEN_RESULT_ITEM_CODES.some((code) => itemCode.startsWith(code))) {
    return "antibody";
  }
  return kinds.get(itemCode) ?? null;
}

/** 検査結果の値を 1 行の文字列にする(表示用。型の読み取りもここから行う)。 */
function labValueText(observation: fhir4.Observation): string {
  const concept = observation.valueCodeableConcept;
  if (concept) {
    return (
      concept.coding?.find((c) => c.display)?.display ??
      concept.text ??
      concept.coding?.[0]?.code ??
      ""
    );
  }
  if (observation.valueString) return observation.valueString;
  if (observation.valueQuantity?.value != null) {
    return `${observation.valueQuantity.value}${observation.valueQuantity.unit ?? ""}`;
  }
  return "";
}

/** 検査結果の表記(「A」「A型」「AB」)を ABO の型に読む。読めなければ空。 */
function readAbo(text: string): AboBloodType | "" {
  const value = text.normalize("NFKC").toUpperCase().replace(/型|TYPE|\s/g, "");
  if (value === "0") return "O";
  return ABO_OPTIONS.some((o) => o.code === value) ? (value as AboBloodType) : "";
}

/** 検査結果の表記(「＋」「陽性」「D+」「(-)」)を RhD の型に読む。読めなければ空。 */
function readRhd(text: string): RhdBloodType | "" {
  const value = text.normalize("NFKC").toUpperCase().replace(/\s|RH|D|\(|\)|型/g, "");
  if (value === "+" || value === "陽性" || value === "POSITIVE" || value === "POS") return "positive";
  if (value === "-" || value === "−" || value === "陰性" || value === "NEGATIVE" || value === "NEG") {
    return "negative";
  }
  return "";
}

function labDateOf(observation: fhir4.Observation): string {
  return localDay(observation.effectiveDateTime ?? observation.issued);
}

/** 検査結果から読んだ ABO か RhD の 1 項目。 */
export interface LabBloodTypeComponent {
  /** 最新の結果の型。表記を読めなければ空。 */
  value: string;
  /** 最新の結果の生の表記(型として読めなかったときに出す)。 */
  raw: string;
  /** 検査した日(重複なし・新しい順)。 */
  dates: string[];
  /** 結果どうしで型が食い違っている。 */
  conflict: boolean;
  /** 異なる日の 2 検体以上で同じ型が出た(確定)。 */
  confirmed: boolean;
}

function summarizeLabComponent(
  observations: fhir4.Observation[],
  read: (text: string) => string,
): LabBloodTypeComponent | null {
  if (observations.length === 0) return null;

  const dates = [...new Set(observations.map(labDateOf).filter(Boolean))];
  const readable = observations
    .map((observation) => ({ value: read(labValueText(observation)), date: labDateOf(observation) }))
    .filter((r) => r.value);
  const values = new Set(readable.map((r) => r.value));
  const conflict = values.size > 1;
  const readableDates = new Set(readable.map((r) => r.date).filter(Boolean));

  return {
    value: readable[0]?.value ?? "",
    raw: labValueText(observations[0]),
    dates,
    conflict,
    confirmed: !conflict && values.size === 1 && readableDates.size >= 2,
  };
}

/** 不規則抗体スクリーニングの最新の結果。 */
export interface AntibodyScreenResult {
  value: string;
  date: string;
}

/** 手入力(申告・他院情報)の血液型。 */
export interface ManualBloodType {
  abo: string;
  rhd: string;
  source: string;
  sourceLabel: string;
  effectiveDate: string;
  note: string;
  aboId: string;
  rhdId: string;
}

/**
 * 検査結果の状態。
 * none = 検査結果が無い / single = 1 回だけ(または片方だけ) / confirmed = 2 回一致で確定 /
 * conflict = 結果が食い違っている
 */
export type BloodTypeLabStatus = "none" | "single" | "confirmed" | "conflict";

export interface BloodTypeSummary {
  /** 表示する型。検査結果があればそれ、無ければ手入力。 */
  abo: string;
  rhd: string;
  sourceLabel: string;
  /** 表示する型の確認日(検査結果なら最新の検査日)。 */
  effectiveDate: string;
  note: string;
  /** 手入力の Observation の id(編集で引き継ぐ)。 */
  aboId: string;
  rhdId: string;
  /** 検査で確定した型か(ABO・RhD とも 2 回一致)。製剤を出す判断で使うので単独で読めるようにする。 */
  tested: boolean;
  labStatus: BloodTypeLabStatus;
  lab: { abo: LabBloodTypeComponent | null; rhd: LabBloodTypeComponent | null };
  antibodyScreen: AntibodyScreenResult | null;
  manual: ManualBloodType | null;
}

function summarizeManual(observations: fhir4.Observation[]): ManualBloodType | null {
  // 同じ項目が複数あれば確認日の新しいものを採る(古い申告値が後から入っても最新が出るように)。
  const newestFirst = [...observations].sort((a, b) =>
    (b.effectiveDateTime ?? "").localeCompare(a.effectiveDateTime ?? ""),
  );
  const abo = newestFirst.find((o) => loincOf(o) === ABO_LOINC.code);
  const rhd = newestFirst.find((o) => loincOf(o) === RHD_LOINC.code);
  if (!abo && !rhd) return null;

  // 確認日・情報源は ABO を優先し、無ければ RhD のものを出す。
  const primary = abo ?? rhd;
  const source = primary?.method?.coding?.[0]?.code ?? "";

  return {
    abo: abo ? codeOf(abo, ABO_SYSTEM) : "",
    rhd: rhd ? codeOf(rhd, RHD_SYSTEM) : "",
    source,
    sourceLabel: bloodTypeSourceLabel(source),
    effectiveDate: primary?.effectiveDateTime?.slice(0, 10) ?? "",
    note: primary?.note?.[0]?.text ?? "",
    aboId: abo?.id ?? "",
    rhdId: rhd?.id ?? "",
  };
}

/**
 * 手入力と検査結果から画面用のまとめを作る。
 * `lab` は検査結果(新しい順でなくてよい)、`items` は血液型・不規則抗体の結果項目マスタ。
 */
export function summarizeBloodType(
  manualObservations: fhir4.Observation[],
  lab: fhir4.Observation[] = [],
  items: LabResultItem[] = [],
): BloodTypeSummary | null {
  const manual = summarizeManual(manualObservations);

  const kinds = resultItemKinds(items);
  const byKind: Record<LabKind, fhir4.Observation[]> = { abo: [], rhd: [], antibody: [] };
  for (const observation of [...lab].sort((a, b) => labDateOf(b).localeCompare(labDateOf(a)))) {
    const kind = labKindOf(observation, kinds);
    if (kind) byKind[kind].push(observation);
  }

  const labAbo = summarizeLabComponent(byKind.abo, readAbo);
  const labRhd = summarizeLabComponent(byKind.rhd, readRhd);
  const antibody = byKind.antibody[0];
  const antibodyScreen = antibody
    ? { value: labValueText(antibody), date: labDateOf(antibody) }
    : null;

  if (!manual && !labAbo && !labRhd && !antibodyScreen) return null;

  const labStatus: BloodTypeLabStatus =
    !labAbo && !labRhd
      ? "none"
      : labAbo?.conflict || labRhd?.conflict
        ? "conflict"
        : labAbo?.confirmed && labRhd?.confirmed
          ? "confirmed"
          : "single";

  const hasLab = Boolean(labAbo || labRhd);
  const labDate = [...(labAbo?.dates ?? []), ...(labRhd?.dates ?? [])].sort().at(-1) ?? "";

  return {
    abo: labAbo?.value || (labAbo ? "" : (manual?.abo ?? "")),
    rhd: labRhd?.value || (labRhd ? "" : (manual?.rhd ?? "")),
    sourceLabel: hasLab ? "検査結果" : (manual?.sourceLabel ?? ""),
    effectiveDate: hasLab ? labDate : (manual?.effectiveDate ?? ""),
    note: manual?.note ?? "",
    aboId: manual?.aboId ?? "",
    rhdId: manual?.rhdId ?? "",
    tested: labStatus === "confirmed",
    labStatus,
    lab: { abo: labAbo, rhd: labRhd },
    antibodyScreen,
    manual,
  };
}

/** 確定していない型に付ける印。確定していれば空。 */
export function bloodTypeUnconfirmedLabel(summary: BloodTypeSummary | null): string {
  if (!summary) return "";
  switch (summary.labStatus) {
    case "confirmed":
      return "";
    case "conflict":
      return "検査結果不一致";
    case "single":
      return "検査1回";
    default:
      return "検査未確定";
  }
}

/** 検査結果の 1 項目の表示(「A型 2026-10-20、2026-10-27」)。読めない表記は生のまま出す。 */
export function labComponentLabel(
  component: LabBloodTypeComponent | null,
  format: (value: string) => string,
): string {
  if (!component) return "";
  const value = component.value ? format(component.value) : component.raw;
  return [value, component.dates.join("、")].filter(Boolean).join(" ");
}

export function parseBloodTypeForm(observations: fhir4.Observation[]): BloodTypeFormValues {
  const manual = summarizeManual(observations);
  if (!manual) return emptyBloodTypeForm();

  const source = BLOOD_TYPE_SOURCE_OPTIONS.some((o) => o.code === manual.source)
    ? (manual.source as BloodTypeSource)
    : "reported";

  return {
    abo: (manual.abo as AboBloodType) || "",
    rhd: (manual.rhd as RhdBloodType) || "",
    source,
    effectiveDate: manual.effectiveDate || today(),
    note: manual.note,
  };
}
