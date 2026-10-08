// DPC 様式1 の初期値。カルテに既にある情報(患者・入院・病名・手術・身体計測)から、
// 決まるものだけを埋める。判断が要る項目(病名の区分、退院時転帰、ADL など)は埋めない。
//
// 「集め直す」でも同じ処理を使う。そのときは入力済みの値を上書きせず、空欄だけを埋める。

import { epochOf, localDay } from "../lib/dates";
import type { Disease, Modifier } from "../api/masterClient";
import { admissionRouteHasDetails, admissionRoutePayloads } from "./admissionRouteHelpers";
import { HEIGHT_LOINC, WEIGHT_LOINC } from "./bodyMeasureHelpers";
import { conditionDisplayName, isSuspected, parseConditionForm } from "./conditionHelpers";
import { dpc1EditionYear } from "./dpcForm1";
import { DEPARTMENT_OPTIONS } from "./dpcForm1/records/common";
import type { Dpc1Header, Dpc1PayloadNo, Dpc1Row, Dpc1Values } from "./dpcForm1/types";
import { emptyDpc1Row, isEmptyDpc1Row } from "./dpcForm1Helpers";
import {
  DISCHARGED_STATUS,
  encounterDepartmentName,
  encounterDischargeDisposition,
} from "./encounterHelpers";
import { calculateAge, patientNumberOf } from "./patientHelpers";
import { summarizePregnancy } from "./pregnancyHelpers";
import { loincOf } from "./shared";

/** 実施した手術 1 件(術式 1 つ)。 */
export interface DpcSurgerySource {
  /** 実施記録の Procedure id。 */
  procedureId: string;
  /** 手術日(YYYY-MM-DD)。 */
  date: string;
  name: string;
  /** 点数表コード(K0821 など)。診療行為マスタで引けなければ空。 */
  kCode: string;
  /** 手術基幹コード(STEM7)。対応表で 1 つに決まるときだけ入り、候補が複数・無しなら空。 */
  stem7: string;
  /** 申込に入れた麻酔方法(手術オーダーのコード)。 */
  anesthesiaMethods: string[];
  /** 申込の術式に入れた左右(R / L / B)。指定が無ければ空。 */
  laterality: string;
}

export interface DpcForm1Sources {
  patient: fhir4.Patient;
  encounter: fhir4.Encounter;
  /** 患者の入院(入院中・退院済)。前回退院と回数管理番号に使う。 */
  admissions: fhir4.Encounter[];
  surgeries: DpcSurgerySource[];
  /** 身長・体重の Observation。 */
  bodyMeasures: fhir4.Observation[];
  /** 妊娠・授乳の Observation。 */
  pregnancy: fhir4.Observation[];
  /** 喫煙歴の有無と喫煙指数の Observation(社会歴のテンプレートから作られたもの)。 */
  smoking: fhir4.Observation[];
  /** この入院の退院時サマリーで退院時診断に選ばれた病名。サマリーが無ければ空。 */
  dischargeDiagnoses: fhir4.Condition[];
  /** 自院の保険医療機関番号(10 桁)。 */
  institutionNumber: string;
}

/** YYYY-MM-DD(時刻付きでもよい)→ YYYYMMDD。 */
export function toDpcDate(value: string | undefined): string {
  return value ? value.slice(0, 10).replaceAll("-", "") : "";
}

/** YYYYMMDD → YYYY-MM-DD。日付でなければ空。 */
export function fromDpcDate(value: string): string {
  return /^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : "";
}

/** 入院時の年齢。 */
export function dpc1AgeAtAdmission(patient: fhir4.Patient, encounter: fhir4.Encounter): number | null {
  const start = encounter.period?.start;
  if (!patient.birthDate || !start) return null;
  return calculateAge(patient.birthDate, new Date(start)) ?? null;
}

/**
 * 施設コード。保険医療機関番号(都道府県 2 桁 + 点数表 1 桁 + 医療機関コード 7 桁)から
 * 点数表の桁を除いた 9 桁。10 桁でなければ空(確定時の検証で止まる)。
 */
function facilityCode(institutionNumber: string): string {
  return /^\d{10}$/.test(institutionNumber)
    ? institutionNumber.slice(0, 2) + institutionNumber.slice(3)
    : "";
}

/** データ識別番号。患者番号を 10 桁に前ゼロ埋めする。数字でなければ空。 */
function dataIdOf(patient: fhir4.Patient): string {
  const number = patientNumberOf(patient) ?? "";
  return /^\d{1,10}$/.test(number) ? number.padStart(10, "0") : "";
}

/**
 * 回数管理番号。同日入退院でなければ 0。同日入退院は、同じ日の同日入退院のうち
 * 入院時刻の早い順に 1、2、3。
 */
function countNumber(encounter: fhir4.Encounter, admissions: fhir4.Encounter[]): string {
  const sameDay = (e: fhir4.Encounter) =>
    Boolean(e.period?.end) && e.period?.start?.slice(0, 10) === e.period?.end?.slice(0, 10);
  if (!sameDay(encounter)) return "0";
  const day = encounter.period?.start?.slice(0, 10);
  const group = admissions
    .filter((e) => sameDay(e) && e.period?.start?.slice(0, 10) === day)
    .sort((a, b) => (a.period?.start ?? "").localeCompare(b.period?.start ?? ""));
  const index = group.findIndex((e) => e.id === encounter.id);
  return String(index < 0 ? 1 : index + 1);
}

export function dpc1HeaderOf(sources: DpcForm1Sources, today: string): Dpc1Header {
  const { patient, encounter, admissions, institutionNumber } = sources;
  return {
    facility: facilityCode(institutionNumber),
    dataId: dataIdOf(patient),
    admitDate: toDpcDate(encounter.period?.start),
    count: countNumber(encounter, admissions),
    summaryNo: "0",
    fiscalYear: dpc1EditionYear(encounter.period?.end?.slice(0, 10) ?? today),
  };
}

// ---- 病名 ----

const UNCODED_DISEASE_RECEIPT_CODE = "0000999";
const MAX_MODIFIERS = 4;

function modifierCodes(prefix: Modifier[], postfix: Modifier[]): string[] {
  const codes = [...prefix, ...postfix]
    .map((m) => m.receipt_code ?? "")
    .filter(Boolean);
  // 修飾語は 4 個までしか書けない。「の疑い」は意味が変わるので、溢れるときも必ず残す。
  if (codes.length <= MAX_MODIFIERS) return codes;
  const suspected = isSuspected(postfix) ? postfix.find((m) => isSuspected([m]))?.receipt_code : null;
  const head = codes.filter((code) => code !== suspected).slice(0, suspected ? MAX_MODIFIERS - 1 : MAX_MODIFIERS);
  return suspected ? [...head, suspected] : head;
}

function diagnosisRow(
  disease: Pick<Disease, "icd10_2013" | "receipt_code"> | null,
  name: string,
  modifiers: string[],
  ref?: string,
): Dpc1Row {
  const p: Dpc1Row["p"] = {
    2: (disease?.icd10_2013 ?? "").replaceAll(".", ""),
    // レセ電算のコードが無い病名(未コード化傷病名)は決まったコードで出す。
    4: disease?.receipt_code || UNCODED_DISEASE_RECEIPT_CODE,
    9: name,
  };
  modifiers.forEach((code, index) => {
    p[(5 + index) as Dpc1PayloadNo] = code;
  });
  return { p, ref };
}

/** 患者の登録病名(Condition)から、診断情報の 1 行を作る。 */
export function dpc1DiagnosisRowOfCondition(condition: fhir4.Condition): Dpc1Row {
  const form = parseConditionForm(condition);
  return diagnosisRow(
    form.disease,
    condition.code?.text || conditionDisplayName(form),
    modifierCodes(form.prefixModifiers, form.postfixModifiers),
    condition.id ? `Condition/${condition.id}` : undefined,
  );
}

/** 病名マスタの病名から、診断情報の 1 行を作る(修飾語なし)。 */
export function dpc1DiagnosisRowOfDisease(disease: Disease): Dpc1Row {
  return diagnosisRow(disease, disease.name, []);
}

// ---- 手術 ----

/**
 * 手術オーダーの麻酔方法(複数可)から、様式1 の麻酔の区分へ。
 * 1 全身 / 2 硬膜外 / 3 脊椎 / 4 静脈 / 5 局所 / 6 全麻+硬膜外 / 7 脊椎+硬膜外 / 8 その他 / 9 無。
 * 申込に麻酔方法が無ければ決められないので空を返す。
 */
function anesthesiaCode(methods: string[]): string {
  if (!methods.length) return "";
  const has = (code: string) => methods.includes(code);
  const general = has("general-inhalation") || has("general-tiva");
  if (general && has("epidural")) return "6";
  if (general) return "1";
  if (has("spinal") && has("epidural")) return "7";
  if (has("spinal")) return "3";
  if (has("epidural")) return "2";
  if (has("iv-sedation")) return "4";
  if (has("local")) return "5";
  if (has("nerve-block")) return "8";
  // 表面麻酔だけのときは「無」にする決まり。
  return "9";
}

/** 手術側数。申込で左右を指定した術式だけ決まる(指定なしは「区別なし」とは限らない)。 */
const SURGERY_SIDE: Record<string, string> = { R: "1", L: "2", B: "3" };

function surgeryRow(surgery: DpcSurgerySource): Dpc1Row {
  return {
    p: {
      1: toDpcDate(surgery.date),
      2: surgery.kCode,
      3: surgery.stem7,
      5: SURGERY_SIDE[surgery.laterality] ?? "",
      6: anesthesiaCode(surgery.anesthesiaMethods),
      9: surgery.name,
    },
    ref: `Procedure/${surgery.procedureId}`,
  };
}

// ---- 身体計測 ----

interface Measured {
  date: string;
  value: number;
}

function measuredOf(observations: fhir4.Observation[], loinc: string): Measured[] {
  return observations
    .filter((o) => loincOf(o) === loinc && o.valueQuantity?.value !== undefined)
    .map((o) => ({
      date: localDay(o.effectiveDateTime),
      value: o.valueQuantity?.value as number,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

const weightText = (value: number) => value.toFixed(1);

// ---- 喫煙指数 ----

const SMOKING_HISTORY_CODE = "MD0012870";
const SMOKING_INDEX_CODE = "MD0012920";
const NO_SMOKING_HISTORY = "01";

/**
 * 喫煙指数。入院までの記録のうち、喫煙歴が「無」なら 0、喫煙指数の記録があればその値。
 * どちらも無ければ空(喫煙していないのか聞いていないのかが分からない)。
 */
function smokingIndex(observations: fhir4.Observation[], until: string): string {
  const latest = (code: string) =>
    observations
      .filter(
        (o) =>
          o.code?.coding?.some((c) => c.code === code) &&
          localDay(o.effectiveDateTime) <= until,
      )
      .sort((a, b) => epochOf(b.effectiveDateTime ?? "") - epochOf(a.effectiveDateTime ?? ""))[0];
  const history = latest(SMOKING_HISTORY_CODE);
  if (history?.valueCodeableConcept?.coding?.some((c) => c.code === NO_SMOKING_HISTORY)) return "0";
  const index = latest(SMOKING_INDEX_CODE);
  const value = index?.valueInteger ?? index?.valueQuantity?.value;
  return value === undefined ? "" : String(Math.round(value));
}

// ---- 妊娠週数 ----

const DAY_MS = 24 * 60 * 60 * 1000;
const FULL_TERM_DAYS = 280;

/** 入院時の妊娠週数。分娩予定日から逆算する(予定日が 40 週 0 日)。出せなければ空。 */
function gestationalWeeks(dueDate: string, admissionDay: string): string {
  if (!dueDate || !admissionDay) return "";
  const untilDue = Math.round((Date.parse(dueDate) - Date.parse(admissionDay)) / DAY_MS);
  const days = FULL_TERM_DAYS - untilDue;
  return days >= 0 && days <= 45 * 7 ? String(Math.floor(days / 7)) : "";
}

// ---- 診療科 ----

/** 入院の診療科の名称が、様式1 の診療科目と同じ名前ならそのコード。違えば空(人が近いものを選ぶ)。 */
function departmentCode(encounter: fhir4.Encounter): string {
  const name = encounterDepartmentName(encounter);
  return DEPARTMENT_OPTIONS.find((option) => option.label === name)?.code ?? "";
}

// ---- 下書き ----

/** 退院先。カルテの転帰(退院先)のうち、様式1 の区分が 1 つに決まるものだけ。 */
const DISCHARGE_DESTINATION: Record<string, string> = {
  "other-hcf": "4",
  exp: "8",
  oth: "9",
};

const HOURS_24 = 24 * 60 * 60 * 1000;

function draftRecords(sources: DpcForm1Sources): Record<string, Dpc1Row[]> {
  const { patient, encounter, admissions } = sources;
  const start = encounter.period?.start ?? "";
  const end = encounter.period?.end ?? "";
  const discharged = encounter.status === DISCHARGED_STATUS && Boolean(end);
  const records: Record<string, Dpc1Row[]> = {};
  const set = (code: string, p: Dpc1Row["p"]) => {
    records[code] = [{ p }];
  };

  set("A000010", {
    1: toDpcDate(patient.birthDate),
    2: patient.gender === "male" ? "1" : patient.gender === "female" ? "2" : "",
    3: (patient.address?.[0]?.postalCode ?? "").replace(/\D/g, ""),
  });

  const route = admissionRoutePayloads(encounter);
  const details = admissionRouteHasDetails(route.route);
  set("A000020", {
    1: toDpcDate(start),
    2: route.route,
    3: details ? route.referral : "",
    4: details ? route.fromOutpatient : "",
    5: details ? route.admissionType : "",
    6: details ? route.ambulance : "",
    7: details ? route.priorHomeCare : "",
  });

  if (discharged) {
    const disposition = encounterDischargeDisposition(encounter);
    const died = disposition === "exp";
    const within24h = new Date(end).getTime() - new Date(start).getTime() <= HOURS_24;
    set("A000030", {
      1: toDpcDate(end),
      2: DISCHARGE_DESTINATION[disposition] ?? "",
      4: died && within24h ? "1" : "0",
    });
    set("A000031", { 1: toDpcDate(start), 2: toDpcDate(end) });
  } else {
    set("A000031", { 1: toDpcDate(start) });
  }

  const department = departmentCode(encounter);
  if (department) set("A000040", { 2: department });

  // 前回退院: この入院より前に退院した入院のうち、最も新しいもの。
  const previous = admissions
    .filter((e) => e.id !== encounter.id && e.period?.end && e.period.end < start)
    .sort((a, b) => (b.period?.end ?? "").localeCompare(a.period?.end ?? ""))[0];
  if (previous) set("A000070", { 1: toDpcDate(previous.period?.end) });

  // 身長は直近、入院時体重は入院日以降で最初(無ければ入院前の直近)、退院時体重は入院中の最後。
  const startDay = start.slice(0, 10);
  const endDay = end.slice(0, 10) || "9999-12-31";
  const heights = measuredOf(sources.bodyMeasures, HEIGHT_LOINC).filter((m) => m.date <= endDay);
  const weights = measuredOf(sources.bodyMeasures, WEIGHT_LOINC).filter((m) => m.date <= endDay);
  const inStay = weights.filter((m) => m.date >= startDay);
  const admissionWeight = inStay[0] ?? weights[weights.length - 1];
  const dischargeWeight = discharged ? inStay[inStay.length - 1] : undefined;
  const height = heights[heights.length - 1];
  set("A001010", {
    2: height ? String(Math.round(height.value)) : "",
    3: admissionWeight ? weightText(admissionWeight.value) : "",
    4: dischargeWeight ? weightText(dischargeWeight.value) : "",
  });

  const smoking = smokingIndex(sources.smoking, startDay);
  if (smoking) set("A001020", { 2: smoking });

  const pregnancy = summarizePregnancy(sources.pregnancy);
  if (patient.gender === "male") {
    set("A002010", { 2: "0" });
  } else if (pregnancy?.pregnant) {
    set("A002010", { 2: "1", 3: gestationalWeeks(pregnancy.dueDate, startDay) });
  }

  // 主傷病名は「退院時サマリの主傷病欄に記入された傷病名」。サマリーの退院時診断は主・副を
  // 分けていないので、1 件だけのときに限って主傷病に入れる。
  if (sources.dischargeDiagnoses.length === 1) {
    records.A006010 = [dpc1DiagnosisRowOfCondition(sources.dischargeDiagnoses[0])];
  }

  if (sources.surgeries.length) records.A007010 = sources.surgeries.map(surgeryRow);

  // 空のペイロードは持たない(入力済みかどうかを値の有無で見分けるため)。
  for (const rows of Object.values(records)) {
    for (const row of rows) {
      for (const key of Object.keys(row.p)) {
        const n = Number(key) as Dpc1PayloadNo;
        if (!row.p[n]) delete row.p[n];
      }
    }
  }
  return records;
}

/**
 * 様式1 の下書き。existing を渡すと「集め直し」になり、入力済みの値はそのままに空欄だけを
 * 埋める。手術は、行になっている実施記録の空欄を埋め、まだ行になっていない実施記録を足す。
 * 主傷病は、何か入力されていれば触らない(別の病名のコードと混ざらないように)。
 */
export function draftDpcForm1(
  sources: DpcForm1Sources,
  today: string,
  existing?: Dpc1Values,
): Dpc1Values {
  const header = dpc1HeaderOf(sources, today);
  const drafted = draftRecords(sources);
  if (!existing) return { header, records: drafted };

  const records: Record<string, Dpc1Row[]> = { ...existing.records };
  for (const [code, rows] of Object.entries(drafted)) {
    if (code === "A007010") {
      const current = records[code] ?? [];
      const byRef = new Map(rows.map((row) => [row.ref, row]));
      const known = new Set(current.map((row) => row.ref).filter(Boolean));
      records[code] = [
        ...current.map((row) => {
          const source = row.ref ? byRef.get(row.ref) : undefined;
          return source ? { ...row, p: { ...source.p, ...row.p } } : row;
        }),
        ...rows.filter((row) => !known.has(row.ref)),
      ];
      continue;
    }
    if (code === "A006010") {
      if (!records[code]?.some((row) => !isEmptyDpc1Row(row))) records[code] = rows;
      continue;
    }
    const current = records[code]?.[0] ?? emptyDpc1Row();
    records[code] = [{ ...current, p: { ...rows[0].p, ...current.p } }];
  }
  // ヘッダ部は入力させない項目なので、いつも今の情報で作り直す。年度だけは作成時のものを保つ
  // (途中で定義表が切り替わって入力済みの項目が消えないように)。
  return { header: { ...header, fiscalYear: existing.header.fiscalYear || header.fiscalYear }, records };
}
