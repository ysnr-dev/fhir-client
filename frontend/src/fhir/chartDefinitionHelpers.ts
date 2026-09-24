import type { KarteDetailTarget } from "../karteUrl";
import { addDays, toDateInput } from "../lib/dates";
import type { LabResultItem, Medicine } from "../api/masterClient";
import { JLAC11_SYSTEM, RESULT_ITEM_SYSTEM, interpretationCodeOf } from "./labResultHelpers";
import {
  BLOOD_PRESSURE,
  BMI,
  DIASTOLIC,
  LOINC_SYSTEM,
  SYSTOLIC,
  VITAL_MEASURES,
  vitalInterpretationOf,
} from "./vitalHelpers";
import type { VitalThresholdSettings } from "./vitalHelpers";
import { questionnaireChoiceItems, questionnaireNumericItems } from "./observationExtract";
import { buildFlowsheetEvents, epochOf, localDateOf } from "./flowsheetEventHelpers";
import type { EncounterStay } from "./flowsheetEventHelpers";
import type { EncounterEvent } from "./encounterHelpers";
import type { RegimenApplication, RegimenDayOrder } from "./regimenOrderHelpers";
import type { RadiotherapyFractionDisplay } from "./radiotherapyResultHelpers";
import { summarizeRadiotherapyOrder } from "./radiotherapyOrderHelpers";
import {
  GENERAL_ORDER_CODE_SYSTEM,
  MEDICINE_CODE_SYSTEM,
  ORDER_TYPE_SYSTEM,
  YJ_CODE_SYSTEM,
  groupByRp,
  hasDoseDays,
} from "./prescriptionHelpers";
import type { MedicineLineDisplay } from "./prescriptionHelpers";
import { orderDay } from "./shared";
import {
  conditionCategoryOf,
  outcomeDisplay,
  problemLabel,
  problemSucceededByIds,
} from "./conditionHelpers";
import { INJECTION_ORDER_TYPE } from "./injectionHelpers";
import { RAD_ORDER_TYPE } from "./radOrderHelpers";
import { ENDOSCOPY_ORDER_TYPE } from "./endoscopyOrderHelpers";
import { PHYSIO_ORDER_TYPE } from "./physioOrderHelpers";
import { TREATMENT_ORDER_TYPE } from "./treatmentOrderHelpers";

// チャート(数値の推移と治療イベントを同じ時間軸で読む画面)の定義と、
// FHIR リソースからグラフの系列・イベントへの変換。
//
// 定義は患者を持たない(どの項目を並べるかだけ)ので、同じ定義をどの患者にも当てられる。
// 保存は backend の chart_definitions(jsonb)で、backend は codings の中身を解釈しない。
// 設計は docs/patient-chart-design.md。

// ---- 定義 ----

export type ChartItemSource = "lab" | "vital" | "template";

/** 1 つの Observation の中に複数の数値が入るもの(血圧の収縮期・拡張期)。 */
export interface ChartItemComponent {
  /** component.code の coding の code(system は項目の codings と同じ)。 */
  code: string;
  name: string;
}

export interface ChartItem {
  /** 定義の中で一意。`lab:<結果項目コード>` / `vital:<LOINC>` / `template:<id>:<linkId>`。 */
  key: string;
  source: ChartItemSource;
  name: string;
  unit: string;
  /** Observation.code との突き合わせと、検索の code= に使う。どれか 1 つ当たればよい。 */
  codings: fhir4.Coding[];
  components?: ChartItemComponent[];
  /**
   * 選択肢(テンプレートの choice 項目)。あればグラフではなく帯の 1 行に並べる定性的な項目で、
   * 並び順を程度の順(「なし」→「高度」)とみなして色の濃さを決める。
   */
  options?: ChartItemOption[];
}

export interface ChartItemOption {
  system?: string;
  code: string;
  display: string;
}

/** 選択肢を持つ(帯の行に並べる)項目かどうか。 */
export function isChoiceItem(item: ChartItem): boolean {
  return Boolean(item.options?.length);
}

export type ChartAxisUnit = "day" | "month" | "year";

export interface ChartAxis {
  unit: ChartAxisUnit;
  /** 列の数(基準日を含めて遡る)。 */
  columns: number;
}

export type ChartEventKind =
  | "condition"
  | "encounter"
  | "surgery"
  | "chemo"
  | "radiotherapy"
  | "exam"
  | "injection"
  | "prescription";

/**
 * 追う薬剤。処方・注射の薬剤ごとに 1 行を帯に出す。
 *
 * YJ コード(一般名処方コードも同じ体系)の先頭 7 桁 = 薬効分類 4 桁 + 成分・投与経路 3 桁で
 * まとめるので、規格(1mg / 0.5mg)・銘柄・一般名処方の違いは同じ行に入る。
 * Do 処方は毎回別オーダーになるため、オーダーではなく薬剤で突き合わせる。
 */
export interface ChartDrug {
  /** 定義の中で一意。`yj7:<先頭 7 桁>` / `code:<レセ電コード>`。 */
  key: string;
  name: string;
  yj7?: string;
  /** レセ電コード。YJ コードを持たない薬剤の突き合わせに使う。 */
  codes: string[];
}

export interface ChartDefinitionBody {
  schema_version: 1;
  axis: ChartAxis;
  items: ChartItem[];
  events: ChartEventKind[];
  drugs: ChartDrug[];
  /** true なら全項目を 1 つのグラフに重ねる。既定は項目ごとに分けて並べる。 */
  overlay: boolean;
}

export const CHART_EVENT_KINDS: ReadonlyArray<{ kind: ChartEventKind; label: string }> = [
  { kind: "condition", label: "病名" },
  { kind: "encounter", label: "入退院" },
  { kind: "surgery", label: "手術" },
  { kind: "chemo", label: "化学療法" },
  { kind: "radiotherapy", label: "放射線治療" },
  { kind: "exam", label: "検査実施" },
  { kind: "injection", label: "注射実施" },
  { kind: "prescription", label: "処方" },
];

export const DEFAULT_CHART_AXIS: ChartAxis = { unit: "month", columns: 12 };

/** 単位を切り替えたときの列数の既定値。 */
export const DEFAULT_CHART_COLUMNS: Record<ChartAxisUnit, number> = {
  day: 14,
  month: 12,
  year: 5,
};

/** 単位ごとに選べる列数。読める密度の範囲に絞る(backend は 1〜120 の整数だけ見る)。 */
export const CHART_COLUMN_CHOICES: Record<ChartAxisUnit, readonly number[]> = {
  day: [7, 14, 30, 60, 92],
  month: [3, 6, 12, 24, 36],
  year: [2, 3, 5, 10],
};

export const CHART_AXIS_UNIT_LABELS: Record<ChartAxisUnit, string> = {
  day: "日",
  month: "月",
  year: "年",
};

/** 項目ごとに分けるか、1 つのグラフに重ねるか。定義に持ち、ツールバーで一時的に変えられる。 */
export const CHART_LAYOUT_OPTIONS: ReadonlyArray<{ overlay: boolean; label: string }> = [
  { overlay: false, label: "項目ごと" },
  { overlay: true, label: "まとめて 1 つ" },
];

export const CHART_ITEM_SOURCE_LABELS: Record<ChartItemSource, string> = {
  lab: "検査",
  vital: "バイタル",
  template: "テンプレート",
};

/** 持ち主(スコープ + 持ち主 id)を 1 つの値にする。画面の select の値に使う。 */
export function ownerKeyOf(scope: string, ownerId: string | null): string {
  return `${scope}:${ownerId ?? ""}`;
}

export function emptyChartDefinitionBody(): ChartDefinitionBody {
  return {
    schema_version: 1,
    axis: { ...DEFAULT_CHART_AXIS },
    items: [],
    events: [],
    drugs: [],
    overlay: false,
  };
}

function isAxisUnit(value: unknown): value is ChartAxisUnit {
  return value === "day" || value === "month" || value === "year";
}

function isItemSource(value: unknown): value is ChartItemSource {
  return value === "lab" || value === "vital" || value === "template";
}

function isEventKind(value: unknown): value is ChartEventKind {
  return CHART_EVENT_KINDS.some((entry) => entry.kind === value);
}

/** backend から来た JSON を型に寄せる(欠けていれば既定値)。 */
export function normalizeChartDefinitionBody(raw: unknown): ChartDefinitionBody {
  const body = emptyChartDefinitionBody();
  if (!raw || typeof raw !== "object") return body;
  const source = raw as Record<string, unknown>;

  const axis = source.axis as Record<string, unknown> | undefined;
  if (axis && typeof axis === "object") {
    if (isAxisUnit(axis.unit)) body.axis.unit = axis.unit;
    if (typeof axis.columns === "number" && Number.isInteger(axis.columns) && axis.columns > 0) {
      body.axis.columns = axis.columns;
    }
  }

  if (Array.isArray(source.items)) {
    for (const entry of source.items) {
      if (!entry || typeof entry !== "object") continue;
      const item = entry as Record<string, unknown>;
      if (typeof item.key !== "string" || !item.key) continue;
      if (!isItemSource(item.source)) continue;
      if (!Array.isArray(item.codings) || item.codings.length === 0) continue;
      body.items.push({
        key: item.key,
        source: item.source,
        name: typeof item.name === "string" ? item.name : item.key,
        unit: typeof item.unit === "string" ? item.unit : "",
        codings: item.codings as fhir4.Coding[],
        ...(Array.isArray(item.components) && item.components.length
          ? { components: item.components as ChartItemComponent[] }
          : {}),
        ...(Array.isArray(item.options) && item.options.length
          ? { options: item.options as ChartItemOption[] }
          : {}),
      });
    }
  }

  if (Array.isArray(source.events)) {
    for (const kind of source.events) {
      if (isEventKind(kind) && !body.events.includes(kind)) body.events.push(kind);
    }
  }

  if (Array.isArray(source.drugs)) {
    for (const entry of source.drugs) {
      if (!entry || typeof entry !== "object") continue;
      const drug = entry as Record<string, unknown>;
      if (typeof drug.key !== "string" || !drug.key) continue;
      const yj7 = typeof drug.yj7 === "string" && drug.yj7 ? drug.yj7 : undefined;
      const codes = Array.isArray(drug.codes)
        ? drug.codes.filter((code): code is string => typeof code === "string" && code !== "")
        : [];
      if (!yj7 && codes.length === 0) continue;
      body.drugs.push({
        key: drug.key,
        name: typeof drug.name === "string" ? drug.name : drug.key,
        ...(yj7 ? { yj7 } : {}),
        codes,
      });
    }
  }

  if (typeof source.overlay === "boolean") body.overlay = source.overlay;

  return body;
}

// ---- 横軸 ----

export interface ChartColumn {
  /** 列の始まり(YYYY-MM-DD)。 */
  start: string;
  /** 列の終わり(YYYY-MM-DD、この日を含む)。 */
  end: string;
  label: string;
}

export interface ChartRange {
  rangeStart: string;
  /** 基準日(右端)。 */
  rangeEnd: string;
  columns: ChartColumn[];
  /** 横軸の左端(rangeStart の 0 時)。 */
  tMin: number;
  /** 横軸の右端(rangeEnd の終わり)。 */
  tMax: number;
}

const DAY_MS = 86_400_000;

function partsOf(date: string): { year: number; month: number; day: number } {
  const [year, month, day] = date.split("-").map(Number);
  return { year, month, day };
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function dateString(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** その月の最終日。 */
function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/**
 * 基準日(右端)から単位 × 列数だけ遡った期間と、その列。
 * 月・年は暦の区切りで割る(月なら 1 日から月末まで)。最終列だけは基準日で切る
 * (途中の月・年を「まだ来ていない日まで」描かない)。
 */
export function chartRangeOf(baseDate: string, axis: ChartAxis): ChartRange {
  const columns: ChartColumn[] = [];
  const { year, month } = partsOf(baseDate);

  if (axis.unit === "day") {
    const start = addDays(baseDate, -(axis.columns - 1));
    for (let i = 0; i < axis.columns; i += 1) {
      const day = addDays(start, i);
      columns.push({ start: day, end: day, label: chartColumnLabel(day, "day", i === 0) });
    }
  } else if (axis.unit === "month") {
    for (let i = axis.columns - 1; i >= 0; i -= 1) {
      const target = new Date(year, month - 1 - i, 1);
      const y = target.getFullYear();
      const m = target.getMonth() + 1;
      const start = dateString(y, m, 1);
      const end = i === 0 ? baseDate : dateString(y, m, lastDayOfMonth(y, m));
      columns.push({ start, end, label: chartColumnLabel(start, "month", i === axis.columns - 1) });
    }
  } else {
    for (let i = axis.columns - 1; i >= 0; i -= 1) {
      const y = year - i;
      const start = dateString(y, 1, 1);
      const end = i === 0 ? baseDate : dateString(y, 12, 31);
      columns.push({ start, end, label: chartColumnLabel(start, "year", true) });
    }
  }

  const rangeStart = columns[0]?.start ?? baseDate;
  return {
    rangeStart,
    rangeEnd: baseDate,
    columns,
    tMin: epochOf(rangeStart),
    // 基準日の終わり(翌日の 0 時)。その日の測定が右端の内側に入る。
    tMax: epochOf(baseDate) + DAY_MS,
  };
}

/** 列の見出し。年をまたぐ先頭の列だけ年を添える。 */
export function chartColumnLabel(start: string, unit: ChartAxisUnit, withYear: boolean): string {
  const { year, month, day } = partsOf(start);
  if (unit === "year") return String(year);
  if (unit === "month") return withYear ? `${year}/${month}` : `${month}月`;
  return withYear ? `${year}/${month}/${day}` : `${month}/${day}`;
}

/**
 * `anchor` の日が期間の真ん中あたりに来る基準日(右端)。イベントを基準に前後を見るのに使う。
 * 月・年は暦の区切りで割るので、右端はその月末・年末にする。
 */
export function centeredBaseDate(anchor: string, axis: ChartAxis): string {
  const after = Math.floor(axis.columns / 2);
  const { year, month } = partsOf(anchor);
  if (axis.unit === "day") return addDays(anchor, after);
  if (axis.unit === "month") {
    const target = new Date(year, month - 1 + after, 1);
    const y = target.getFullYear();
    const m = target.getMonth() + 1;
    return dateString(y, m, lastDayOfMonth(y, m));
  }
  return dateString(year + after, 12, 31);
}

/** 基準日からの日数(「基準+14日」)。基準が無ければ空。 */
export function relativeDayLabel(at: string, anchor: string | undefined): string {
  if (!anchor) return "";
  const days = Math.round((epochOf(at.slice(0, 10)) - epochOf(anchor)) / DAY_MS);
  if (days === 0) return "基準日";
  return days > 0 ? `基準+${days}日` : `基準−${-days}日`;
}

/** 単位を切り替えたときの列数(前の列数が新しい単位でも選べるならそのまま)。 */
export function chartColumnsFor(unit: ChartAxisUnit, previous: number): number {
  return CHART_COLUMN_CHOICES[unit].includes(previous) ? previous : DEFAULT_CHART_COLUMNS[unit];
}

// ---- 項目の生成 ----

/**
 * 検査結果項目マスタ 1 件 → チャートの項目。結果の Observation.code は
 * 施設コード → JLAC11 の順に並ぶ(labResultHelpers の buildCodeCodings)ので、両方を持つ。
 */
export function labChartItem(item: LabResultItem): ChartItem {
  const codings: fhir4.Coding[] = [
    { system: RESULT_ITEM_SYSTEM, code: item.result_item_code, display: item.name },
  ];
  if (item.jlac11_code) codings.push({ system: JLAC11_SYSTEM, code: item.jlac11_code });
  return {
    key: `lab:${item.result_item_code}`,
    source: "lab",
    name: item.short_name || item.name,
    unit: item.display_unit ?? "",
    codings,
  };
}

/** バイタルの項目(固定)。血圧だけは 1 つの Observation に 2 つの値が入る。 */
export function vitalChartItems(): ChartItem[] {
  const items: ChartItem[] = VITAL_MEASURES.map((measure) => ({
    key: `vital:${measure.code}`,
    source: "vital" as const,
    name: measure.label,
    unit: measure.unit,
    codings: [{ system: LOINC_SYSTEM, code: measure.code, display: measure.display }],
  }));
  items.push({
    key: `vital:${BLOOD_PRESSURE.code}`,
    source: "vital",
    name: "血圧",
    unit: "mmHg",
    codings: [{ system: LOINC_SYSTEM, code: BLOOD_PRESSURE.code, display: BLOOD_PRESSURE.display }],
    components: [
      { code: SYSTOLIC.code, name: "収縮期" },
      { code: DIASTOLIC.code, name: "拡張期" },
    ],
  });
  items.push({
    key: `vital:${BMI.code}`,
    source: "vital",
    name: "BMI",
    unit: BMI.unit,
    codings: [{ system: LOINC_SYSTEM, code: BMI.code, display: BMI.display }],
  });
  return items;
}

/** テンプレートの数値項目・選択肢項目 → チャートの項目(抽出が有効なテンプレートだけ)。 */
export function templateChartItems(questionnaire: fhir4.Questionnaire): ChartItem[] {
  const id = questionnaire.id ?? "";
  const numeric = questionnaireNumericItems(questionnaire).map((item) => ({
    key: `template:${id}:${item.linkId}`,
    source: "template" as const,
    name: item.text,
    unit: item.unit,
    codings: item.code,
  }));
  const choice = questionnaireChoiceItems(questionnaire).map((item) => ({
    key: `template:${id}:${item.linkId}`,
    source: "template" as const,
    name: item.text,
    unit: "",
    codings: item.code,
    options: item.options,
  }));
  return [...numeric, ...choice];
}

/** 項目すべての coding を重複なく集める(検索の code= に渡す)。 */
export function chartItemCodings(items: ChartItem[]): fhir4.Coding[] {
  const seen = new Set<string>();
  const codings: fhir4.Coding[] = [];
  for (const item of items) {
    for (const coding of item.codings) {
      if (!coding.system || !coding.code) continue;
      const key = `${coding.system}|${coding.code}`;
      if (seen.has(key)) continue;
      seen.add(key);
      codings.push(coding);
    }
  }
  return codings;
}

// ---- Observation → 系列 ----

/** 点の判定。検査は Observation.interpretation、バイタルは施設のしきい値による。 */
export type ChartPointFlag = "HH" | "H" | "L" | "LL" | "";

export interface ChartPoint {
  /** 測定日時(タイムゾーンを持たないローカルの文字列)。 */
  at: string;
  t: number;
  value: number;
  flag: ChartPointFlag;
  /** 基準範囲(検査の referenceRange の先頭)。片側だけのこともある。 */
  low?: number;
  high?: number;
  /** 結果に書かれた単位(項目の表示単位と違うことがある)。 */
  unit: string;
  /** 測定法(Observation.method.text)。 */
  method: string;
  /** 結果の JLAC11 コード。 */
  jlac11: string;
  /** 元の Observation。点から記録を開くのに使う。 */
  observationId: string;
  /** テンプレート抽出なら元の QuestionnaireResponse の id。 */
  responseId?: string;
}

/** 前の点と比べて単位・測定法・JLAC11 のどれかが変わった点。そこで線を切る。 */
export interface ChartSegmentBreak {
  t: number;
  at: string;
  /** 何が変わったか(「単位 mg/dL → g/L」など)。 */
  changes: string[];
}

/** 系列の中の変わり目。同じ値で比べてよい区間の区切り。 */
export function chartSegmentBreaks(points: ChartPoint[]): ChartSegmentBreak[] {
  const breaks: ChartSegmentBreak[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const before = points[i - 1];
    const after = points[i];
    const changes: string[] = [];
    if (before.unit !== after.unit) changes.push(`単位 ${before.unit || "なし"} → ${after.unit || "なし"}`);
    if (before.method !== after.method) {
      changes.push(`測定法 ${before.method || "なし"} → ${after.method || "なし"}`);
    }
    if (before.jlac11 !== after.jlac11) {
      changes.push(`JLAC11 ${before.jlac11 || "なし"} → ${after.jlac11 || "なし"}`);
    }
    if (changes.length) breaks.push({ t: after.t, at: after.at, changes });
  }
  return breaks;
}

export interface ChartSeries {
  key: string;
  name: string;
  points: ChartPoint[];
}

/** 1 項目ぶんのグラフ(血圧のように系列が 2 本になることがある)。 */
export interface ChartLaneData {
  key: string;
  source: ChartItemSource;
  name: string;
  unit: string;
  series: ChartSeries[];
}

function observationAt(observation: fhir4.Observation): string {
  return observation.effectiveDateTime ?? observation.effectivePeriod?.start ?? observation.issued ?? "";
}

/**
 * 点の日時を、タイムゾーンを持たないローカルの文字列にする。
 *
 * テンプレート抽出の Observation は UTC("...Z")で書かれることがあり、文字列を
 * そのまま切り出すと時刻が時差のぶんずれて見える(横軸の位置は絶対時刻なので合う)。
 */
function localDateTimeOf(value: string): string {
  if (!/(?:Z|[+-]\d\d:\d\d)$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${toDateInput(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * 数値。valueQuantity が基本で、テンプレート抽出は単位の無い integer を valueInteger で
 * 持つことがある(observationExtract の observationValue と対)。
 */
function observationNumber(observation: fhir4.Observation): number | undefined {
  if (typeof observation.valueQuantity?.value === "number") return observation.valueQuantity.value;
  if (typeof observation.valueInteger === "number") return observation.valueInteger;
  return undefined;
}

function componentOf(
  observation: fhir4.Observation,
  code: string,
): fhir4.ObservationComponent | undefined {
  return (observation.component ?? []).find((component) =>
    component.code?.coding?.some((coding) => coding.code === code),
  );
}

function componentNumber(observation: fhir4.Observation, code: string): number | undefined {
  const value = componentOf(observation, code)?.valueQuantity?.value;
  return typeof value === "number" ? value : undefined;
}

function quantityUnit(quantity: fhir4.Quantity | undefined): string {
  return quantity?.unit ?? quantity?.code ?? "";
}

function labFlag(observation: fhir4.Observation): ChartPointFlag {
  const code = interpretationCodeOf(observation);
  return code === "HH" || code === "H" || code === "L" || code === "LL" ? code : "";
}

function matchesItem(observation: fhir4.Observation, item: ChartItem): boolean {
  return (observation.code?.coding ?? []).some((coding) =>
    item.codings.some((want) => want.system === coding.system && want.code === coding.code),
  );
}

function pointSource(observation: fhir4.Observation): Pick<ChartPoint, "observationId" | "responseId"> {
  const response = observation.derivedFrom
    ?.map((reference) => reference.reference ?? "")
    .find((reference) => reference.startsWith("QuestionnaireResponse/"));
  return {
    observationId: observation.id ?? "",
    ...(response ? { responseId: response.split("/")[1] } : {}),
  };
}

/**
 * 点の判定・基準範囲・単位など。単位・測定法・JLAC11 の変わり目を見るのは検査だけで、
 * バイタルとテンプレートは項目の単位で揃える(書き方の揺れで線が切れないように)。
 */
function pointDetails(
  item: ChartItem,
  componentCode: string,
  observation: fhir4.Observation,
  value: number,
  vitalThresholds: VitalThresholdSettings,
): Omit<ChartPoint, "at" | "t" | "value" | "observationId" | "responseId"> {
  if (item.source === "lab") {
    const range = observation.referenceRange?.[0];
    return {
      flag: labFlag(observation),
      ...(typeof range?.low?.value === "number" ? { low: range.low.value } : {}),
      ...(typeof range?.high?.value === "number" ? { high: range.high.value } : {}),
      unit: quantityUnit(observation.valueQuantity) || item.unit,
      method: observation.method?.text ?? observation.method?.coding?.[0]?.display ?? "",
      jlac11: observation.code?.coding?.find((coding) => coding.system === JLAC11_SYSTEM)?.code ?? "",
    };
  }
  const flag =
    item.source === "vital"
      ? vitalInterpretationOf(
          item.components?.length ? componentCode : (item.codings[0]?.code ?? ""),
          value,
          vitalThresholds,
        )
      : "";
  return { flag, unit: item.unit, method: "", jlac11: "" };
}

/**
 * 項目ごとのグラフを組み立てる。同じ日時に 2 件あれば後から来たもの(訂正)を採る。
 * 値の無い結果(コード型・文字列型)は点にならないので落ちる。
 * 判定は検査なら結果に書かれたもの、バイタルなら施設のしきい値で付ける。
 */
export function buildChartLanes(
  items: ChartItem[],
  observations: fhir4.Observation[],
  vitalThresholds: VitalThresholdSettings = {},
): ChartLaneData[] {
  return items.filter((item) => !isChoiceItem(item)).map((item) => {
    const matched = observations.filter((observation) => matchesItem(observation, item));
    const specs = item.components?.length
      ? item.components.map((component) => ({ key: component.code, name: component.name }))
      : [{ key: item.key, name: item.name }];

    const series = specs.map((spec) => {
      const byTime = new Map<string, ChartPoint>();
      for (const observation of matched) {
        const at = localDateTimeOf(observationAt(observation));
        if (!at) continue;
        const value = item.components?.length
          ? componentNumber(observation, spec.key)
          : observationNumber(observation);
        if (typeof value !== "number" || Number.isNaN(value)) continue;
        byTime.set(at, {
          at,
          t: epochOf(at),
          value,
          ...pointDetails(item, spec.key, observation, value, vitalThresholds),
          ...pointSource(observation),
        });
      }
      return {
        key: `${item.key}/${spec.key}`,
        name: spec.name,
        points: [...byTime.values()].sort((a, b) => a.t - b.t),
      };
    });

    return { key: item.key, source: item.source, name: item.name, unit: item.unit, series };
  });
}

// ---- 選択肢の項目(定性的な記録) ----

/** 選択肢の項目の 1 回の記録。 */
export interface ChartChoiceMark {
  at: string;
  /** 選んだ選択肢の名前(複数選択は「、」でつなぐ)。 */
  label: string;
  /** 程度(0〜4)。選択肢の並び順から決める。複数選択なら重い方。 */
  level: number;
  /** 元の QuestionnaireResponse の id。 */
  responseId?: string;
}

export interface ChartChoiceTrack {
  key: string;
  name: string;
  marks: ChartChoiceMark[];
}

/** 色の濃さの段数。CSS の .patient-chart__level--0〜4 と対。 */
const CHOICE_LEVELS = 5;

/**
 * 選択肢の項目ごとの行。Observation の valueCodeableConcept を選択肢と突き合わせ、
 * 同じ日時の記録(複数選択は回答 1 つにつき 1 件の Observation になる)は 1 つにまとめる。
 * 選択肢に無いコード(テンプレートを後から直した等)は名前だけ出して一番薄くする。
 */
export function buildChoiceTracks(
  items: ChartItem[],
  observations: fhir4.Observation[],
): ChartChoiceTrack[] {
  return items.filter(isChoiceItem).map((item) => {
    const options = item.options ?? [];
    const byTime = new Map<string, { labels: string[]; index: number; responseId?: string }>();
    for (const observation of observations) {
      if (!matchesItem(observation, item)) continue;
      const at = localDateTimeOf(observationAt(observation));
      if (!at) continue;
      const coding = observation.valueCodeableConcept?.coding?.[0];
      if (!coding?.code) continue;
      const index = options.findIndex(
        (option) =>
          option.code === coding.code &&
          (!option.system || !coding.system || option.system === coding.system),
      );
      const label =
        index >= 0
          ? options[index].display
          : (coding.display ?? observation.valueCodeableConcept?.text ?? coding.code);
      const entry = byTime.get(at) ?? { labels: [], index: -1, ...pointSource(observation) };
      if (!entry.labels.includes(label)) entry.labels.push(label);
      entry.index = Math.max(entry.index, index);
      byTime.set(at, entry);
    }
    const steps = Math.max(1, options.length - 1);
    const marks = [...byTime.entries()]
      .map(([at, entry]) => ({
        at,
        label: entry.labels.join("、"),
        level: entry.index < 0 ? 0 : Math.round((entry.index / steps) * (CHOICE_LEVELS - 1)),
        ...(entry.responseId ? { responseId: entry.responseId } : {}),
      }))
      .sort((a, b) => a.at.localeCompare(b.at));
    return { key: item.key, name: item.name, marks };
  });
}

// ---- イベント ----

export interface ChartEvent {
  /** 起きた日時(時刻を持たない登録は YYYY-MM-DD)。 */
  at: string;
  /** 続いているものの終わり。あれば帯にバーで出す。 */
  end?: string;
  kind: ChartEventKind;
  /** 帯に出す短い名前。 */
  label: string;
  /** ホバー・一覧に出す補足。 */
  detail: string;
  /** カルテのオーダー詳細モーダルを開く先。持たないイベント(入退院)もある。 */
  target?: KarteDetailTarget;
  /** 点の印の横に出す短い名前(病名の「確定」など)。無ければ印だけ。 */
  mark?: string;
}

export function chartEventKindLabel(kind: ChartEventKind): string {
  return CHART_EVENT_KINDS.find((entry) => entry.kind === kind)?.label ?? kind;
}

/**
 * 実施記録のハブ Procedure から引く種別。検査(放射線・内視鏡・生理・処置)は
 * 1 本の行にまとめ、注射は別の行にする(イベント種別の ON/OFF の単位と揃える)。
 */
export const CHART_EXAM_PROCEDURE_TYPES = [
  { code: RAD_ORDER_TYPE.code, label: RAD_ORDER_TYPE.display, detailKind: "rad-order" },
  { code: ENDOSCOPY_ORDER_TYPE.code, label: ENDOSCOPY_ORDER_TYPE.display, detailKind: "endoscopy-order" },
  { code: PHYSIO_ORDER_TYPE.code, label: PHYSIO_ORDER_TYPE.display, detailKind: "physio-order" },
  { code: TREATMENT_ORDER_TYPE.code, label: TREATMENT_ORDER_TYPE.display, detailKind: "treatment-order" },
] as const;

export const CHART_INJECTION_PROCEDURE_TYPE = {
  code: INJECTION_ORDER_TYPE.code,
  label: INJECTION_ORDER_TYPE.display,
  detailKind: "injection",
} as const;

/** イベント種別 → ハブ Procedure を引くときの order-type コード。 */
export function chartProcedureTypeCodes(kinds: ChartEventKind[]): string[] {
  const codes: string[] = [];
  if (kinds.includes("exam")) codes.push(...CHART_EXAM_PROCEDURE_TYPES.map((type) => type.code));
  if (kinds.includes("injection")) codes.push(CHART_INJECTION_PROCEDURE_TYPE.code);
  return codes;
}

/**
 * 入退院。入院そのものは期間バー(退院していなければ基準日まで)で、
 * 転棟・外出泊などの出来事は印にする。未来のものは出さない(起きたことを読む画面なので)。
 */
export function buildEncounterChartEvents(
  events: EncounterEvent[],
  stays: EncounterStay[],
  rangeEnd: string,
  now: Date = new Date(),
): ChartEvent[] {
  const limit = now.getTime();
  const result: ChartEvent[] = [];

  for (const stay of stays) {
    if (epochOf(stay.start) > limit) continue;
    result.push({
      at: stay.start,
      end: stay.end ?? rangeEnd,
      kind: "encounter",
      label: "入院",
      detail: stay.end ? `${stay.start} 〜 ${stay.end}` : `${stay.start} 〜 入院中`,
    });
  }

  for (const event of events) {
    if (!event.at || epochOf(event.at) > limit) continue;
    // 入院・退院は期間バーの両端そのものなので、印を重ねない(同じことを 2 回描かない)。
    if (event.kind === "admission" || event.kind === "discharge") continue;
    result.push({
      at: event.at,
      kind: "encounter",
      label: event.label,
      detail: event.detail,
    });
  }

  return result;
}

/** 手術。実施記録のハブ Procedure の入室時刻に置く(経過表の帯と同じ)。 */
export function buildSurgeryChartEvents(
  surgeries: fhir4.Procedure[],
  now: Date = new Date(),
): ChartEvent[] {
  return buildFlowsheetEvents([], surgeries, now).map((event) => ({
    at: event.at,
    kind: "surgery" as const,
    label: event.label,
    detail: event.detail,
    target: event.target,
  }));
}

/**
 * 化学療法。適用 × クールで 1 本のバーにする(そのクールの日オーダーの最初から最後まで)。
 * 中止した日オーダーは期間に数えない。レジメンはカルテのカードにならないので target は持たない。
 */
export function buildChemoChartEvents(
  applications: RegimenApplication[],
  dayOrders: RegimenDayOrder[],
): ChartEvent[] {
  const nameOf = new Map(applications.map((application) => [application.instanceId, application.name]));
  const spans = new Map<
    string,
    {
      cycle: number;
      name: string;
      start: string;
      end: string;
      reduction: string;
      /** クールの最初の日オーダー。クリックで開く先。 */
      first: RegimenDayOrder;
    }
  >();

  for (const order of dayOrders) {
    if (!order.date || order.status === "cancelled") continue;
    const key = `${order.ref.instanceId}/${order.ref.cycle}`;
    const name = nameOf.get(order.ref.instanceId) ?? order.ref.name;
    const span = spans.get(key);
    if (!span) {
      spans.set(key, {
        cycle: order.ref.cycle,
        name,
        start: order.date,
        end: order.date,
        reduction: order.ref.reduction,
        first: order,
      });
      continue;
    }
    if (order.date < span.start) {
      span.start = order.date;
      span.first = order;
    }
    if (order.date > span.end) span.end = order.date;
    if (!span.reduction && order.ref.reduction) span.reduction = order.ref.reduction;
  }

  return [...spans.values()].map((span) => ({
    at: span.start,
    end: span.end > span.start ? span.end : undefined,
    kind: "chemo" as const,
    label: `${span.name} C${span.cycle}`,
    detail: [
      `${span.name} 第 ${span.cycle} クール`,
      span.end > span.start ? `${span.start} 〜 ${span.end}` : span.start,
      span.reduction ? `減量: ${span.reduction}` : "",
    ]
      .filter(Boolean)
      .join(" / "),
    target: span.first.serviceRequest.id
      ? { kind: span.first.kind, id: span.first.serviceRequest.id }
      : undefined,
  }));
}

/** 放射線治療。コース(オーダー)ごとに、照射した最初の日から最後の日まで 1 本のバー。 */
export function buildRadiotherapyChartEvents(
  orders: fhir4.ServiceRequest[],
  fractionsByOrderId: Map<string, RadiotherapyFractionDisplay[]>,
): ChartEvent[] {
  const events: ChartEvent[] = [];

  for (const order of orders) {
    const id = order.id ?? "";
    const delivered = (fractionsByOrderId.get(id) ?? [])
      .filter((fraction) => !fraction.planned && !fraction.notDone && fraction.performedDate)
      .map((fraction) => fraction.performedDate)
      .sort();
    if (delivered.length === 0) continue;

    const start = delivered[0];
    const end = delivered[delivered.length - 1];
    const summary = summarizeRadiotherapyOrder(order);
    events.push({
      at: start,
      end: end > start ? end : undefined,
      kind: "radiotherapy",
      label: summary.siteLabel ? `放射線治療(${summary.siteLabel})` : "放射線治療",
      detail: [summary.doseLabel, `${delivered.length} 回照射`, start === end ? start : `${start} 〜 ${end}`]
        .filter(Boolean)
        .join(" / "),
      target: id ? { kind: "radiotherapy-order", id } : undefined,
    });
  }

  return events;
}

/**
 * 検査・注射の実施。実施記録のハブ Procedure 1 件が印 1 つ。
 * ハブの code は 1 件目の手技(検査名)なので、名前はハブだけで出せる。
 */
export function buildProcedureChartEvents(procedures: fhir4.Procedure[]): ChartEvent[] {
  const events: ChartEvent[] = [];

  for (const procedure of procedures) {
    const at = procedure.performedDateTime ?? procedure.performedPeriod?.start;
    if (!at) continue;
    const code = (procedure.category?.coding ?? []).find(
      (coding) => coding.system === ORDER_TYPE_SYSTEM,
    )?.code;
    if (!code) continue;

    const exam = CHART_EXAM_PROCEDURE_TYPES.find((type) => type.code === code);
    const type = exam ?? (code === CHART_INJECTION_PROCEDURE_TYPE.code ? CHART_INJECTION_PROCEDURE_TYPE : null);
    if (!type) continue;

    const orderId = procedure.basedOn?.[0]?.reference?.split("/")[1] ?? "";
    const coding = procedure.code?.coding?.find((c) => c.display) ?? procedure.code?.coding?.[0];
    const name = procedure.code?.text ?? coding?.display ?? "";
    events.push({
      at,
      kind: exam ? "exam" : "injection",
      label: type.label,
      // 検査名が種別と同じ(注射など)なら、同じ語を 2 度出さない。
      detail: name === type.label ? "" : name,
      target: orderId ? { kind: type.detailKind, id: orderId } : undefined,
    });
  }

  return events;
}

/**
 * 処方。**飲んでいた期間**をバーにする(検査値や血圧との前後関係を読むのが目的なので、
 * オーダーを出した日の印だけでは足りない)。
 *
 * 期間は Rp ごとの投与日数(`dispenseRequest.expectedSupplyDuration`)の最大で、
 * 開始日はオーダーの occurrence。日数を持たない処方(頓用・外用)は印にする。
 */
export function buildPrescriptionChartEvents(
  orders: fhir4.ServiceRequest[],
  medicationRequests: fhir4.MedicationRequest[],
  tasks: fhir4.Task[] = [],
): ChartEvent[] {
  const byOrderId = medicationRequestsByOrderId(medicationRequests);

  const events: ChartEvent[] = [];
  for (const order of activeOrders(orders, tasks)) {
    const id = order.id ?? "";
    const start = orderDay(order);
    if (!start) continue;

    const groups = groupByRp(byOrderId.get(id) ?? []);
    const days = Math.max(0, ...groups.map((group) => group.doseDays ?? 0));
    const names = groups.flatMap((group) => group.medicines.map((medicine) => medicine.name));
    const label = names[0] ?? "処方";

    events.push({
      at: start,
      // 1 日ぶんは点で足りる。2 日以上のときだけバーにする(最終日は start + days - 1)。
      end: days > 1 ? addDays(start, days - 1) : undefined,
      kind: "prescription",
      label: names.length > 1 ? `${label} ほか` : label,
      detail: [names.join("、"), days > 0 ? `${days} 日分` : ""].filter(Boolean).join(" / "),
      target: id ? { kind: "prescription", id } : undefined,
    });
  }

  return events;
}

function medicationRequestsByOrderId(
  medicationRequests: fhir4.MedicationRequest[],
): Map<string, fhir4.MedicationRequest[]> {
  const byOrderId = new Map<string, fhir4.MedicationRequest[]>();
  for (const request of medicationRequests) {
    const orderId = request.basedOn?.[0]?.reference?.split("/")[1];
    if (!orderId) continue;
    const list = byOrderId.get(orderId);
    if (list) list.push(request);
    else byOrderId.set(orderId, [request]);
  }
  return byOrderId;
}

/**
 * 中止していないオーダー。中止は進捗の Task(cancelled)で持つ(オーダー自体の status は
 * active のまま)ので、Task の focus で突き合わせて外す。
 */
function activeOrders(orders: fhir4.ServiceRequest[], tasks: fhir4.Task[]): fhir4.ServiceRequest[] {
  const cancelled = new Set(
    tasks
      .filter((task) => task.status === "cancelled")
      .map((task) => task.focus?.reference?.split("/")[1])
      .filter((id): id is string => Boolean(id)),
  );
  return orders.filter((order) => !cancelled.has(order.id ?? ""));
}

// ---- 薬剤の行 ----

/** 処方と処方の間がこの日数までなら、飲み続けていたとみなしてつなぐ(外来の受診間隔のずれ)。 */
export const CHART_DRUG_GAP_DAYS = 7;

/** YJ コード・一般名処方コードの先頭 7 桁(薬効分類 + 成分・投与経路)。形が違えば空。 */
function yj7Of(code: string | null | undefined): string {
  return code && /^\d{7}/.test(code) ? code.slice(0, 7) : "";
}

/**
 * 行の表示名。成分でまとめる行に「1mg」のような規格や「「F」」のような屋号が残ると
 * その銘柄だけの行に見えるので落とす。
 */
function drugDisplayName(name: string): string {
  const normalized = name.normalize("NFKC").trim();
  const stripped = normalized
    .replace(/「[^」]*」$/, "")
    .replace(/\s*\d+(?:\.\d+)?[千万]?\s*(?:mg|μg|µg|g|mL|%|単位)(?:\/\d*(?:\.\d+)?\s*mL)?$/, "")
    .trim();
  return stripped || normalized;
}

/** マスタの薬剤 → 追う薬剤。YJ コードが無ければ薬価基準コード、それも無ければレセ電コードだけで引く。 */
export function chartDrugOf(medicine: Medicine): ChartDrug {
  // 一般名処方は medicine_code に一般名処方コード(YJ と同じ体系)が入る。
  const yj7 =
    yj7Of(medicine.yj_code) ||
    yj7Of(medicine.yakka_code) ||
    (medicine.generic ? yj7Of(medicine.medicine_code) : "");
  const name = drugDisplayName(medicine.generic_name_description || medicine.name);
  const codes = medicine.generic ? [] : [medicine.medicine_code];
  if (yj7) return { key: `yj7:${yj7}`, name, yj7, codes };
  return { key: `code:${medicine.medicine_code}`, name, codes };
}

function codingsMatchDrug(codings: fhir4.Coding[] | undefined, drug: ChartDrug): boolean {
  return (codings ?? []).some((coding) => {
    const yjLike = coding.system === YJ_CODE_SYSTEM || coding.system === GENERAL_ORDER_CODE_SYSTEM;
    if (drug.yj7 && yjLike && yj7Of(coding.code) === drug.yj7) return true;
    return coding.system === MEDICINE_CODE_SYSTEM && drug.codes.includes(coding.code ?? "");
  });
}

function lineMatchesDrug(line: MedicineLineDisplay, drug: ChartDrug): boolean {
  if (drug.yj7) {
    if (yj7Of(line.yjCode) === drug.yj7) return true;
    if (line.generic && yj7Of(line.code) === drug.yj7) return true;
  }
  return !line.generic && drug.codes.includes(line.code);
}

/** 薬剤名から 1 錠あたりの含量(「ワーファリン錠1mg」→ 1 mg)。錠・カプセルだけ。 */
function strengthOf(name: string, unit: string | undefined): { value: number; unit: string } | null {
  if (unit !== "錠" && unit !== "カプセル") return null;
  const match = name.normalize("NFKC").match(/(\d+(?:\.\d+)?)\s*(mg|μg|µg|g|単位)/);
  return match ? { value: Number(match[1]), unit: match[2].replace("µ", "μ") } : null;
}

function formatAmount(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

/** 1 日ぶんの内容(同じ成分の規格違いを同時に出すこともある)。 */
interface DailyDose {
  /** 同じ内容かどうかの比較に使う。 */
  key: string;
  text: string;
  /** 含量で足し上げた 1 日量(求められるときだけ)。増量・減量の判定に使う。 */
  total?: { value: number; unit: string };
  orderId: string;
}

function dailyDoseOf(lines: MedicineLineDisplay[], orderId: string): DailyDose {
  const parts = lines.map((line) => ({
    name: line.name.normalize("NFKC"),
    dose: line.dose ?? 0,
    unit: (line.unit ?? "").normalize("NFKC"),
    strength: strengthOf(line.name, line.unit),
  }));
  const strengthUnits = new Set(parts.map((part) => part.strength?.unit ?? ""));
  const total =
    parts.every((part) => part.strength) && strengthUnits.size === 1
      ? {
          value: parts.reduce((sum, part) => sum + part.dose * (part.strength?.value ?? 0), 0),
          unit: [...strengthUnits][0],
        }
      : parts.length === 1
        ? { value: parts[0].dose, unit: parts[0].unit }
        : undefined;
  const text = parts.map((part) => `${part.name} ${formatAmount(part.dose)}${part.unit}`).join(" + ");
  return {
    key: parts
      .map((part) => `${part.name}|${part.dose}|${part.unit}`)
      .sort()
      .join("/"),
    text:
      total && parts.some((part) => part.strength)
        ? `${text}(1日 ${formatAmount(total.value)}${total.unit})`
        : text,
    total,
    orderId,
  };
}

export type ChartDrugChange = "start" | "increase" | "decrease" | "change";

export const CHART_DRUG_CHANGE_LABELS: Record<ChartDrugChange, string> = {
  start: "開始",
  increase: "増量",
  decrease: "減量",
  change: "変更",
};

/** 同じ用量で飲み続けた期間。 */
export interface ChartDrugSegment {
  start: string;
  /** 最終日(この日を含む)。 */
  end: string;
  /** 帯に出す短い用量(「3錠」「1日 2.5mg」)。 */
  label: string;
  detail: string;
  /** 前の区間からの変わり方。前が無い(または間が空いた)ときは開始。 */
  change: ChartDrugChange;
  /** この区間の後に途切れる(中止・終了)かどうか。 */
  stops: boolean;
  target?: KarteDetailTarget;
}

/** 期間を持たない投与(頓用・外用・注射)。 */
export interface ChartDrugMark {
  at: string;
  label: string;
  detail: string;
  target?: KarteDetailTarget;
}

export interface ChartDrugTrack {
  key: string;
  name: string;
  segments: ChartDrugSegment[];
  marks: ChartDrugMark[];
}

export interface ChartMedicationOrders {
  orders: fhir4.ServiceRequest[];
  medicationRequests: fhir4.MedicationRequest[];
  tasks: fhir4.Task[];
}

function changeBetween(before: DailyDose, after: DailyDose): ChartDrugChange {
  if (before.total && after.total && before.total.unit === after.total.unit) {
    if (after.total.value > before.total.value) return "increase";
    if (after.total.value < before.total.value) return "decrease";
  }
  return "change";
}

function doseLabel(dose: DailyDose): string {
  return dose.total ? `${formatAmount(dose.total.value)}${dose.total.unit}/日` : dose.text;
}

/**
 * 処方から、薬剤ごとの「飲んでいた期間」を用量の変わり目で区切って作る。
 *
 * 日ごとに「その日の用量」を置き、同じ日に重なる処方は後から始まったものが勝つ
 * (前の処方の残りを新しい処方で置き換えた、とみなす)。続く日が同じ用量なら 1 区間にし、
 * 間が CHART_DRUG_GAP_DAYS 日以内なら続けて飲んでいたとみなしてつなぐ。
 */
function buildDrugSegments(
  drug: ChartDrug,
  orders: fhir4.ServiceRequest[],
  byOrderId: Map<string, fhir4.MedicationRequest[]>,
  marks: ChartDrugMark[],
  baseDate: string,
): ChartDrugSegment[] {
  const byDay = new Map<string, DailyDose>();
  const sorted = [...orders].sort((a, b) => orderDay(a).localeCompare(orderDay(b)));

  for (const order of sorted) {
    const id = order.id ?? "";
    const start = orderDay(order);
    if (!start) continue;
    const continuous: MedicineLineDisplay[] = [];
    let days = 0;
    for (const group of groupByRp(byOrderId.get(id) ?? [])) {
      const lines = group.medicines.filter((line) => lineMatchesDrug(line, drug));
      if (lines.length === 0) continue;
      if (hasDoseDays(group.usageCode, group.basicCategory) && (group.doseDays ?? 0) > 0) {
        continuous.push(...lines);
        days = Math.max(days, group.doseDays ?? 0);
        continue;
      }
      // 頓用・外用は期間を持たないので印にする。
      for (const line of lines) {
        const amount = `${formatAmount(line.dose ?? 0)}${(line.unit ?? "").normalize("NFKC")}`;
        marks.push({
          at: start,
          label: amount,
          detail: [line.name, amount, group.usageName, group.doseCount ? `${group.doseCount} 回分` : ""]
            .filter(Boolean)
            .join(" "),
          target: id ? { kind: "prescription", id } : undefined,
        });
      }
    }
    if (continuous.length === 0) continue;
    const dose = dailyDoseOf(continuous, id);
    for (let i = 0; i < days; i += 1) byDay.set(addDays(start, i), dose);
  }

  const days = [...byDay.keys()].sort();
  const segments: ChartDrugSegment[] = [];
  let current: { start: string; end: string; dose: DailyDose; change: ChartDrugChange } | null = null;
  const close = (stops: boolean) => {
    if (!current) return;
    const { start, end, dose, change } = current;
    segments.push({
      start,
      end,
      label: doseLabel(dose),
      detail: `${CHART_DRUG_CHANGE_LABELS[change]} ${start}〜${end} ${dose.text}${stops ? "(ここで途切れる)" : ""}`,
      change,
      stops,
      target: dose.orderId ? { kind: "prescription", id: dose.orderId } : undefined,
    });
  };

  for (const day of days) {
    const dose = byDay.get(day);
    if (!dose) continue;
    if (!current) {
      current = { start: day, end: day, dose, change: "start" };
      continue;
    }
    const gap = (epochOf(day) - epochOf(current.end)) / DAY_MS - 1;
    if (gap > CHART_DRUG_GAP_DAYS) {
      close(true);
      current = { start: day, end: day, dose, change: "start" };
    } else if (dose.key === current.dose.key) {
      current.end = day;
    } else {
      // 間が空いていても用量が変わった所は変わり目とする(前の区間は前日まで伸ばす)。
      current.end = addDays(day, -1);
      close(false);
      current = { start: day, end: day, dose, change: changeBetween(current.dose, dose) };
    }
  }
  // 基準日を越えて続く最後の区間は、まだ飲んでいる途中なので途切れにしない。
  close(Boolean(current && current.end < baseDate));
  return segments;
}

/** 注射は 1 日 1 オーダーなので、施行日ごとの印にする。 */
function buildInjectionDrugMarks(
  drug: ChartDrug,
  orders: fhir4.ServiceRequest[],
  byOrderId: Map<string, fhir4.MedicationRequest[]>,
): ChartDrugMark[] {
  const marks: ChartDrugMark[] = [];
  for (const order of orders) {
    const id = order.id ?? "";
    const at = orderDay(order);
    if (!at) continue;
    const matched = (byOrderId.get(id) ?? []).filter((request) =>
      codingsMatchDrug(request.medicationCodeableConcept?.coding, drug),
    );
    if (matched.length === 0) continue;
    const parts = matched.map((request) => {
      const quantity = request.dosageInstruction?.[0]?.doseAndRate?.[0]?.doseQuantity;
      const name = (
        request.medicationCodeableConcept?.coding?.find((coding) => coding.display)?.display ??
        request.medicationCodeableConcept?.text ??
        ""
      ).normalize("NFKC");
      const unit = (quantity?.unit ?? "").normalize("NFKC");
      return { name, amount: `${formatAmount(quantity?.value ?? 0)}${unit}` };
    });
    marks.push({
      at,
      label: parts.map((part) => part.amount).join("+"),
      detail: `注射 ${parts.map((part) => `${part.name} ${part.amount}`).join(" + ")}`,
      target: id ? { kind: "injection", id } : undefined,
    });
  }
  return marks;
}

/** 追う薬剤ごとの行。範囲に掛からない区間・印は落とす。 */
export function buildDrugTracks(
  drugs: ChartDrug[],
  prescriptions: ChartMedicationOrders | undefined,
  injections: ChartMedicationOrders | undefined,
  range: ChartRange,
): ChartDrugTrack[] {
  const rxOrders = prescriptions ? activeOrders(prescriptions.orders, prescriptions.tasks) : [];
  const rxByOrder = medicationRequestsByOrderId(prescriptions?.medicationRequests ?? []);
  const injOrders = injections ? activeOrders(injections.orders, injections.tasks) : [];
  const injByOrder = medicationRequestsByOrderId(injections?.medicationRequests ?? []);
  const inRange = (start: string, end: string) =>
    epochOf(end) + DAY_MS > range.tMin && epochOf(start) < range.tMax;

  return drugs.map((drug) => {
    const marks: ChartDrugMark[] = [];
    const segments = buildDrugSegments(drug, rxOrders, rxByOrder, marks, range.rangeEnd);
    marks.push(...buildInjectionDrugMarks(drug, injOrders, injByOrder));
    return {
      key: drug.key,
      name: drug.name,
      segments: segments.filter((segment) => inRange(segment.start, segment.end)),
      marks: marks
        .filter((mark) => inRange(mark.at, mark.at))
        .sort((a, b) => a.at.localeCompare(b.at)),
    };
  });
}

/**
 * 病名(プロブレムのみ)。開始日と転帰日を点にする。保険病名は数が多く節目を埋もれさせる
 * ので出さない。
 *
 * - 開始日: 「の疑い」なら「疑い」、疑いのプロブレムから引き継がれた(problem-succeeded-by)
 *   ものなら「確定」、それ以外は「開始」。
 * - 転帰日: 転帰(治癒・軽快・中止)。疑いが確定に引き継がれて閉じたものは、確定の印と
 *   同じことを 2 度描かないので出さない。
 */
export function buildConditionChartEvents(conditions: fhir4.Condition[]): ChartEvent[] {
  const problems = conditions.filter((condition) => conditionCategoryOf(condition) === "problem");
  const isSuspected = (condition: fhir4.Condition) =>
    condition.verificationStatus?.coding?.some((coding) => coding.code === "provisional") ?? false;
  const confirmedFromSuspected = new Set(
    problems.filter(isSuspected).flatMap((condition) => problemSucceededByIds(condition)),
  );

  const events: ChartEvent[] = [];
  for (const condition of problems) {
    const name = problemLabel(condition);
    const suspected = isSuspected(condition);
    const onset = condition.onsetDateTime?.slice(0, 10);
    if (onset) {
      const mark = suspected ? "疑い" : confirmedFromSuspected.has(condition.id ?? "") ? "確定" : "開始";
      events.push({ at: onset, kind: "condition", label: `${mark} ${name}`, detail: onset, mark });
    }
    const end = condition.abatementDateTime?.slice(0, 10);
    const handedOver = suspected && problemSucceededByIds(condition).length > 0;
    if (end && !handedOver) {
      const mark = outcomeDisplay(condition.clinicalStatus?.coding?.[0]?.code) || "終了";
      events.push({ at: end, kind: "condition", label: `${mark} ${name}`, detail: end, mark });
    }
  }
  return events;
}

/** 範囲に掛かるイベントだけ(期間バーは端が外でも中に入っていれば残す)。 */
export function filterChartEvents(events: ChartEvent[], range: ChartRange): ChartEvent[] {
  return events
    .filter((event) => {
      const start = epochOf(event.at);
      const end = event.end ? epochOf(event.end) + DAY_MS : start;
      return end >= range.tMin && start <= range.tMax;
    })
    .sort((a, b) => epochOf(a.at) - epochOf(b.at));
}

export { localDateOf };
