import { problemRefFromReference, type ProblemRef } from "./conditionHelpers";
import { NURSING_OBSERVATION_CODE_SYSTEM } from "./nursingOrderHelpers";
import { codingBySystem } from "./shared";

// バイタルサイン(体温・血圧・脈拍・SpO2・呼吸数・身長・体重)の入力と表示。
//
// FHIR では 1 項目 = 1 Observation(category: vital-signs)で、コードは LOINC の
// vital signs、単位は UCUM を付ける。血圧だけは「収縮期と拡張期で 1 つの測定」なので、
// 85354-9 の Observation 1 件に component として両方を入れる(JP Core の
// JP_Observation_BloodPressure と同じ構造。別々の Observation にすると、後から
// 「そのときの血圧」として組にして読めない)。
//
// 1 回の測定はリソースが複数に分かれるので、同じ identifier を全件に付けて束ねる。
// 測定日時で束ねると、同じ時刻に別の担当者が入れた測定と混ざりうるため。

/** 1 回の測定を束ねる identifier の system。 */
export const VITAL_ENTRY_SYSTEM = "http://fhir-client.local/vital-entry";

/** 対象プロブレム。Observation には理由を表す標準要素が無いのでローカル拡張で持つ。 */
export const VITAL_PROBLEM_EXT_URL =
  "http://fhir-client.local/StructureDefinition/observation-problem";

const OBSERVATION_CATEGORY_SYSTEM = "http://terminology.hl7.org/CodeSystem/observation-category";
const LOINC = "http://loinc.org";
const UCUM = "http://unitsofmeasure.org";

/** 血圧(パネル)。値は component に入るので value[x] は持たない。 */
const BLOOD_PRESSURE = { code: "85354-9", display: "Blood pressure panel" } as const;
const SYSTOLIC = { code: "8480-6", display: "Systolic blood pressure" } as const;
const DIASTOLIC = { code: "8462-4", display: "Diastolic blood pressure" } as const;
const BP_UNIT = { unit: "mmHg", ucum: "mm[Hg]" } as const;

/** 血圧(パネル)の code。看護観察の血圧型も同じ構造で作り、経過表の血圧行に合流させる。 */
export function bloodPressureCodeableConcept(): fhir4.CodeableConcept {
  return { coding: [{ system: LOINC, code: BLOOD_PRESSURE.code, display: BLOOD_PRESSURE.display }] };
}

/** 血圧の component(収縮期・拡張期)。 */
export function buildBloodPressureComponents(
  systolic: number,
  diastolic: number,
): fhir4.ObservationComponent[] {
  return [
    {
      code: { coding: [{ system: LOINC, code: SYSTOLIC.code, display: SYSTOLIC.display }] },
      valueQuantity: { value: systolic, unit: BP_UNIT.unit, system: UCUM, code: BP_UNIT.ucum },
    },
    {
      code: { coding: [{ system: LOINC, code: DIASTOLIC.code, display: DIASTOLIC.display }] },
      valueQuantity: { value: diastolic, unit: BP_UNIT.unit, system: UCUM, code: BP_UNIT.ucum },
    },
  ];
}

/** 血圧以外の測定項目。入力欄の並びもこの順。 */
export interface VitalMeasure {
  /** フォームの値のキー。 */
  key: "temperature" | "pulse" | "spo2" | "respiration" | "height" | "weight";
  label: string;
  code: string;
  display: string;
  /** 画面と Quantity.unit に出す表示単位。 */
  unit: string;
  /** Quantity.code に入れる UCUM コード。 */
  ucum: string;
  /** 入力欄の刻み。 */
  step: string;
}

export const VITAL_MEASURES: VitalMeasure[] = [
  {
    key: "temperature",
    label: "体温",
    code: "8310-5",
    display: "Body temperature",
    unit: "℃",
    ucum: "Cel",
    step: "0.1",
  },
  { key: "pulse", label: "脈拍", code: "8867-4", display: "Heart rate", unit: "/分", ucum: "/min", step: "1" },
  {
    key: "spo2",
    label: "SpO2",
    code: "2708-6",
    display: "Oxygen saturation in Arterial blood",
    unit: "%",
    ucum: "%",
    step: "1",
  },
  {
    key: "respiration",
    label: "呼吸数",
    code: "9279-1",
    display: "Respiratory rate",
    unit: "/分",
    ucum: "/min",
    step: "1",
  },
  { key: "height", label: "身長", code: "8302-2", display: "Body height", unit: "cm", ucum: "cm", step: "0.1" },
  { key: "weight", label: "体重", code: "29463-7", display: "Body weight", unit: "kg", ucum: "kg", step: "0.1" },
];

/** 身長と体重から求める BMI。入力欄は持たず、両方が入っているときだけ作る。 */
const BMI = {
  code: "39156-5",
  display: "Body mass index (BMI) [Ratio]",
  unit: "kg/m2",
  ucum: "kg/m2",
} as const;

export type VitalMeasureKey = VitalMeasure["key"];

export interface VitalFormValues {
  /** datetime-local の値("YYYY-MM-DDTHH:mm")。 */
  measuredAt: string;
  systolic: string;
  diastolic: string;
  temperature: string;
  pulse: string;
  spo2: string;
  respiration: string;
  height: string;
  weight: string;
}

export function emptyVitalFormValues(): VitalFormValues {
  return {
    measuredAt: "",
    systolic: "",
    diastolic: "",
    temperature: "",
    pulse: "",
    spo2: "",
    respiration: "",
    height: "",
    weight: "",
  };
}

/** 数値として読める入力だけを通す(空欄は「測っていない」)。 */
function numberOf(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * BMI = 体重(kg) / 身長(m)^2。小数第 1 位まで。
 * 身長・体重のどちらかが無ければ null。
 */
export function vitalBmi(values: VitalFormValues): number | null {
  const height = numberOf(values.height);
  const weight = numberOf(values.weight);
  if (height === null || weight === null || height <= 0) return null;
  const meters = height / 100;
  return Math.round((weight / (meters * meters)) * 10) / 10;
}

/** 1 件でも値が入っているか(何も入れずに登録させないための判定)。 */
export function hasAnyVitalValue(values: VitalFormValues): boolean {
  if (numberOf(values.systolic) !== null || numberOf(values.diastolic) !== null) return true;
  return VITAL_MEASURES.some((measure) => numberOf(values[measure.key]) !== null);
}

export function validateVitalForm(values: VitalFormValues): string | null {
  if (!values.measuredAt) return "測定日時を入力してください。";
  if (!hasAnyVitalValue(values)) return "1 項目以上の測定値を入力してください。";
  // 片方だけの血圧は「そのときの血圧」として読めないので受け付けない。
  const systolic = numberOf(values.systolic);
  const diastolic = numberOf(values.diastolic);
  if ((systolic === null) !== (diastolic === null)) {
    return "血圧は収縮期と拡張期の両方を入力してください。";
  }
  return null;
}

// ---- Observation の組み立て ----

function problemExtension(problem: ProblemRef | null): fhir4.Extension[] | undefined {
  if (!problem) return undefined;
  return [
    {
      url: VITAL_PROBLEM_EXT_URL,
      valueReference: {
        reference: `Condition/${problem.conditionId}`,
        display: problem.display,
      },
    },
  ];
}

export interface BuildVitalObservationsArgs {
  values: VitalFormValues;
  patientId: string;
  /** 1 回の測定を束ねる identifier の値。編集では既存のものを使い回す。 */
  entryId: string;
  problem: ProblemRef | null;
}

/**
 * フォームの値から Observation を組み立てる。空欄の項目は作らない
 * (0 や null の Observation を残すと「測って 0 だった」と読めてしまう)。
 */
export function buildVitalObservations(args: BuildVitalObservationsArgs): fhir4.Observation[] {
  const { values, patientId, entryId, problem } = args;
  // datetime-local はタイムゾーンを持たないので、端末のオフセットを付けて確定させる。
  const effectiveDateTime = new Date(values.measuredAt).toISOString();
  const extension = problemExtension(problem);

  const base = {
    resourceType: "Observation" as const,
    status: "final" as const,
    identifier: [{ system: VITAL_ENTRY_SYSTEM, value: entryId }],
    category: [{ coding: [{ system: OBSERVATION_CATEGORY_SYSTEM, code: "vital-signs" }] }],
    subject: { reference: `Patient/${patientId}` },
    effectiveDateTime,
    ...(extension ? { extension } : {}),
  };

  const observations: fhir4.Observation[] = [];

  const systolic = numberOf(values.systolic);
  const diastolic = numberOf(values.diastolic);
  if (systolic !== null && diastolic !== null) {
    observations.push({
      ...base,
      code: bloodPressureCodeableConcept(),
      component: buildBloodPressureComponents(systolic, diastolic),
    });
  }

  for (const measure of VITAL_MEASURES) {
    const value = numberOf(values[measure.key]);
    if (value === null) continue;
    observations.push({
      ...base,
      code: { coding: [{ system: LOINC, code: measure.code, display: measure.display }] },
      valueQuantity: { value, unit: measure.unit, system: UCUM, code: measure.ucum },
    });
  }

  // BMI は入力値そのものではないが、同じ測定の身長・体重から一意に決まるので
  // 一緒に残す(経過表で身長・体重と並べて追えるようにするため)。
  const bmi = vitalBmi(values);
  if (bmi !== null) {
    observations.push({
      ...base,
      code: { coding: [{ system: LOINC, code: BMI.code, display: BMI.display }] },
      valueQuantity: { value: bmi, unit: BMI.unit, system: UCUM, code: BMI.ucum },
    });
  }

  return observations;
}

/**
 * 保存用の transaction。編集では「前回の測定を全部消して作り直す」方式にしている。
 * 項目ごとに Observation を対応付けて差分更新することもできるが、入力欄を空にした
 * 項目の削除や血圧の追加で対応が崩れるため、作り直しの方が破綻しない。
 */
export function vitalSaveBundle(
  observations: fhir4.Observation[],
  existingObservationIds: string[] = [],
): fhir4.Bundle {
  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: [
      ...existingObservationIds.map((id) => ({
        request: { method: "DELETE" as const, url: `Observation/${id}` },
      })),
      ...observations.map((observation) => ({
        resource: observation,
        request: { method: "POST" as const, url: "Observation" },
      })),
    ],
  };
}

export function vitalDeleteBundle(observationIds: string[]): fhir4.Bundle {
  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: observationIds.map((id) => ({
      request: { method: "DELETE" as const, url: `Observation/${id}` },
    })),
  };
}

// ---- 表示・編集のための読み取り ----

/** 1 回の測定。タイムラインのカード 1 枚にあたる。 */
export interface VitalEntry {
  /** identifier の値。カードの id と編集対象の指定に使う。 */
  entryId: string;
  effectiveDateTime: string;
  observations: fhir4.Observation[];
}

export function vitalEntryId(observation: fhir4.Observation): string {
  return (
    observation.identifier?.find((identifier) => identifier.system === VITAL_ENTRY_SYSTEM)?.value ?? ""
  );
}

/**
 * Observation を 1 回の測定ごとに束ねる。identifier を持たないもの(他の経路で
 * 作られたバイタル)は、この画面から編集できないので落とす。
 */
export function groupVitalEntries(observations: fhir4.Observation[]): VitalEntry[] {
  const byEntry = new Map<string, VitalEntry>();
  for (const observation of observations) {
    const entryId = vitalEntryId(observation);
    if (!entryId) continue;
    const entry = byEntry.get(entryId);
    if (entry) {
      entry.observations.push(observation);
      // 束の中で最も新しい時刻を代表にする(実際には全件同じ値が入る)。
      if ((observation.effectiveDateTime ?? "") > entry.effectiveDateTime) {
        entry.effectiveDateTime = observation.effectiveDateTime ?? "";
      }
    } else {
      byEntry.set(entryId, {
        entryId,
        effectiveDateTime: observation.effectiveDateTime ?? "",
        observations: [observation],
      });
    }
  }
  return Array.from(byEntry.values());
}

export function vitalEntryProblem(entry: VitalEntry): ProblemRef | null {
  for (const observation of entry.observations) {
    const reference = observation.extension?.find((e) => e.url === VITAL_PROBLEM_EXT_URL)
      ?.valueReference;
    const problem = problemRefFromReference(reference);
    if (problem) return problem;
  }
  return null;
}

function observationCode(observation: fhir4.Observation): string {
  return observation.code?.coding?.find((coding) => coding.system === LOINC)?.code ?? "";
}

function quantityText(quantity: fhir4.Quantity | undefined): string {
  if (quantity?.value === undefined) return "";
  return `${quantity.value}${quantity.unit ?? ""}`;
}

/** カードに出す「項目: 値」の並び。入力欄と同じ順にする。 */
export interface VitalDisplayRow {
  label: string;
  value: string;
}

export function vitalDisplayRows(entry: VitalEntry): VitalDisplayRow[] {
  const byCode = new Map<string, fhir4.Observation>();
  for (const observation of entry.observations) byCode.set(observationCode(observation), observation);

  const rows: VitalDisplayRow[] = [];

  const bp = byCode.get(BLOOD_PRESSURE.code);
  if (bp) {
    const componentValue = (code: string) =>
      bp.component?.find((c) => c.code?.coding?.some((coding) => coding.code === code))?.valueQuantity
        ?.value;
    const systolic = componentValue(SYSTOLIC.code);
    const diastolic = componentValue(DIASTOLIC.code);
    if (systolic !== undefined && diastolic !== undefined) {
      rows.push({ label: "血圧", value: `${systolic}/${diastolic}${BP_UNIT.unit}` });
    }
  }

  for (const measure of VITAL_MEASURES) {
    const observation = byCode.get(measure.code);
    const value = quantityText(observation?.valueQuantity);
    if (value) rows.push({ label: measure.label, value });
  }

  const bmi = byCode.get(BMI.code);
  const bmiValue = bmi?.valueQuantity?.value;
  if (bmiValue !== undefined) rows.push({ label: "BMI", value: String(bmiValue) });

  return rows;
}

// ---- 経過表(フローシート) ----

/**
 * 経過表の 1 行(測定項目)。列は測定 1 回ぶんなので、キーは測定日時。
 *
 * 検査結果の時系列表示(buildLabTimeline)が「日付」を列にするのに対し、こちらは
 * 測定日時そのものを列にする。同じ日の朝夕の測定を 1 列に潰すと、経過表として
 * 読めなくなるため。
 */
export interface VitalFlowsheetRow {
  /** LOINC コード。コードの無い Observation は項目名で代用する。 */
  key: string;
  name: string;
  unit: string;
  /** 測定日時 → 表示値(血圧は "128/82" のように 1 セルにまとめる)。 */
  values: Map<string, string>;
  /** 測定日時 → グラフ用の数値。系列名を分けたい血圧は含めない。 */
  numbers: Map<string, number>;
}

export interface VitalFlowsheet {
  /** 表示対象の測定日時。新しい順。 */
  columns: string[];
  rows: VitalFlowsheetRow[];
}

/** 血圧はグラフでは収縮期・拡張期の 2 系列に分ける。 */
export const BLOOD_PRESSURE_SERIES = [
  { key: SYSTOLIC.code, name: "収縮期血圧", unit: BP_UNIT.unit },
  { key: DIASTOLIC.code, name: "拡張期血圧", unit: BP_UNIT.unit },
] as const;

/** 経過表の行の並び。入力欄と同じ順を先頭に置き、それ以外は登場順で後ろへ。 */
const FLOWSHEET_ORDER = [
  BLOOD_PRESSURE.code,
  ...VITAL_MEASURES.map((measure) => measure.code),
  BMI.code,
];

const FLOWSHEET_LABELS = new Map<string, string>([
  [BLOOD_PRESSURE.code, "血圧"],
  ...VITAL_MEASURES.map((measure) => [measure.code, measure.label] as [string, string]),
  [BMI.code, "BMI"],
]);

function bloodPressureComponent(
  observation: fhir4.Observation,
  code: string,
): number | undefined {
  return observation.component?.find((component) =>
    component.code?.coding?.some((coding) => coding.code === code),
  )?.valueQuantity?.value;
}

/**
 * 「測定項目 × 測定日時」のマトリクスを組み立てる。
 *
 * 手入力のバイタルだけでなく、テンプレート回答から category を vital-signs にして
 * 抽出した Observation も同じ表に載せる(経過表は値を時系列で読む画面なので、
 * どの経路で作られたかは問わない)。identifier で束ねないのはそのため。
 *
 * 看護指示の観察結果(MEDIS 看護観察コード、nursingPerformHelpers)も同じ表に載せる。
 * 真のバイタル(SpO2・体温など)は LOINC を併記してあるので既存の行に合流し、それ以外は
 * MEDIS コードをキーにした行になる。値は数値だけでなく列挙(便量「少量」)や
 * 2 値(創の縦×横)もあるので、valueCodeableConcept と component も読む。
 */
export function buildVitalFlowsheet(
  observations: fhir4.Observation[],
  columnCount: number,
): VitalFlowsheet {
  const allColumns: string[] = [];
  for (const observation of observations) {
    const at = observation.effectiveDateTime ?? "";
    if (at && !allColumns.includes(at)) allColumns.push(at);
  }
  // 取得は -date 順だが、同じ時刻のリソースの並びは保証されないので明示的に整える。
  allColumns.sort((a, b) => b.localeCompare(a));
  const columns = allColumns.slice(0, columnCount);
  const shown = new Set(columns);

  const rows = new Map<string, VitalFlowsheetRow>();

  function rowFor(key: string, name: string, unit: string): VitalFlowsheetRow {
    const existing = rows.get(key);
    if (existing) {
      if (!existing.unit && unit) existing.unit = unit;
      return existing;
    }
    const row: VitalFlowsheetRow = { key, name, unit, values: new Map(), numbers: new Map() };
    rows.set(key, row);
    return row;
  }

  for (const observation of observations) {
    const at = observation.effectiveDateTime ?? "";
    if (!shown.has(at)) continue;

    // 行のキーは LOINC を最優先(バイタルの既定行に合流させる)、無ければ MEDIS の
    // 看護観察コード、それも無ければ先頭の coding。コードを持たない値は名前で束ねる。
    const codings = observation.code?.coding;
    const coding =
      codingBySystem(codings, LOINC) ??
      codingBySystem(codings, NURSING_OBSERVATION_CODE_SYSTEM) ??
      codings?.[0];
    const name =
      FLOWSHEET_LABELS.get(coding?.code ?? "") ??
      observation.code?.text ??
      coding?.display ??
      "";
    const key = coding?.code ?? `name:${name}`;

    if (key === BLOOD_PRESSURE.code) {
      const systolic = bloodPressureComponent(observation, SYSTOLIC.code);
      const diastolic = bloodPressureComponent(observation, DIASTOLIC.code);
      if (systolic === undefined || diastolic === undefined) continue;
      const row = rowFor(key, name, BP_UNIT.unit);
      if (row.values.has(at)) continue;
      row.values.set(at, `${systolic}/${diastolic}`);
      continue;
    }

    const cell = flowsheetCell(observation);
    if (!cell) continue;
    const row = rowFor(key, name, cell.unit);
    // 同じ時刻に同じ項目が複数あるときは、先(=新しい)の値を採る。
    if (row.values.has(at)) continue;
    row.values.set(at, cell.value);
    if (cell.number !== undefined) row.numbers.set(at, cell.number);
  }

  // 既定の項目を先に、それ以外(テンプレート抽出など)を登場順で後ろに並べる。
  const ordered = [...rows.values()].sort((a, b) => {
    const indexA = FLOWSHEET_ORDER.indexOf(a.key);
    const indexB = FLOWSHEET_ORDER.indexOf(b.key);
    if (indexA >= 0 && indexB >= 0) return indexA - indexB;
    if (indexA >= 0) return -1;
    if (indexB >= 0) return 1;
    return 0;
  });

  return { columns, rows: ordered };
}

/**
 * 経過表の 1 マスにする値。数値(グラフにも使う)/ 文字列 / 列挙(便量「少量」)/
 * 2 値の component(創の縦×横 → "12.5/8")。どれも無ければ null(行を作らない)。
 */
function flowsheetCell(
  observation: fhir4.Observation,
): { value: string; unit: string; number?: number } | null {
  const quantity = observation.valueQuantity;
  if (quantity?.value !== undefined) {
    return { value: String(quantity.value), unit: quantity.unit ?? "", number: quantity.value };
  }
  if (observation.valueString) return { value: observation.valueString, unit: "" };
  const concept = observation.valueCodeableConcept;
  const conceptText = concept?.text ?? concept?.coding?.[0]?.display;
  if (conceptText) return { value: conceptText, unit: "" };
  const components = (observation.component ?? []).filter((c) => c.valueQuantity?.value !== undefined);
  if (components.length >= 2) {
    return {
      value: components.map((c) => String(c.valueQuantity?.value)).join("/"),
      unit: components[0].valueQuantity?.unit ?? "",
    };
  }
  return null;
}

/** 血圧の行から、グラフ用に収縮期・拡張期の数値を取り出す。 */
export function bloodPressureNumbers(
  observations: fhir4.Observation[],
  code: string,
): Map<string, number> {
  const numbers = new Map<string, number>();
  for (const observation of observations) {
    const at = observation.effectiveDateTime ?? "";
    const isBp = observation.code?.coding?.some(
      (coding) => coding.system === LOINC && coding.code === BLOOD_PRESSURE.code,
    );
    if (!at || !isBp || numbers.has(at)) continue;
    const value = bloodPressureComponent(observation, code);
    if (value !== undefined) numbers.set(at, value);
  }
  return numbers;
}

/** 列ヘッダに出す "MM/DD" と "HH:mm"。 */
export function flowsheetColumnLabel(at: string): { date: string; time: string; year: string } {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(toDateTimeLocal(at));
  if (!match) return { date: at.slice(0, 10), time: "", year: at.slice(0, 4) };
  return { year: match[1], date: `${match[2]}/${match[3]}`, time: `${match[4]}:${match[5]}` };
}

/**
 * 経過表の列ヘッダで、連続する同じ値(年・日付)の列をまとめる。
 * 値が空の列は区別できないので単独グループにする。
 */
export function groupFlowsheetColumns(
  columns: string[],
  labelOf: (at: string) => string,
): { label: string; columns: string[] }[] {
  const groups: { label: string; columns: string[] }[] = [];
  for (const at of columns) {
    const label = labelOf(at);
    const last = groups[groups.length - 1];
    if (last && label && last.label === label) last.columns.push(at);
    else groups.push({ label, columns: [at] });
  }
  return groups;
}

/** ISO 日時 → datetime-local の値。端末のタイムゾーンで表示する。 */
export function toDateTimeLocal(iso: string | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

/** 既存の測定を編集フォームの値に戻す。 */
export function parseVitalEntry(entry: VitalEntry): VitalFormValues {
  const values = emptyVitalFormValues();
  values.measuredAt = toDateTimeLocal(entry.effectiveDateTime);

  for (const observation of entry.observations) {
    const code = observationCode(observation);
    if (code === BLOOD_PRESSURE.code) {
      for (const component of observation.component ?? []) {
        const componentCode = component.code?.coding?.find((c) => c.system === LOINC)?.code;
        const value = component.valueQuantity?.value;
        if (value === undefined) continue;
        if (componentCode === SYSTOLIC.code) values.systolic = String(value);
        if (componentCode === DIASTOLIC.code) values.diastolic = String(value);
      }
      continue;
    }
    const measure = VITAL_MEASURES.find((m) => m.code === code);
    const value = observation.valueQuantity?.value;
    if (measure && value !== undefined) values[measure.key] = String(value);
  }

  return values;
}
