import type { KarteDetailTarget } from "../karteUrl";
import { addDays, toDateInput } from "../lib/dates";
import type { LabResultItem } from "../api/masterClient";
import { JLAC11_SYSTEM, RESULT_ITEM_SYSTEM } from "./labResultHelpers";
import {
  BLOOD_PRESSURE,
  BMI,
  DIASTOLIC,
  LOINC_SYSTEM,
  SYSTOLIC,
  VITAL_MEASURES,
} from "./vitalHelpers";
import { questionnaireNumericItems } from "./observationExtract";
import { buildFlowsheetEvents, epochOf, localDateOf } from "./flowsheetEventHelpers";
import type { EncounterStay } from "./flowsheetEventHelpers";
import type { EncounterEvent } from "./encounterHelpers";
import type { RegimenApplication, RegimenDayOrder } from "./regimenOrderHelpers";
import type { RadiotherapyFractionDisplay } from "./radiotherapyResultHelpers";
import { summarizeRadiotherapyOrder } from "./radiotherapyOrderHelpers";
import { ORDER_TYPE_SYSTEM } from "./prescriptionHelpers";
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
}

export type ChartAxisUnit = "day" | "month" | "year";

export interface ChartAxis {
  unit: ChartAxisUnit;
  /** 列の数(基準日を含めて遡る)。 */
  columns: number;
}

export type ChartEventKind =
  | "encounter"
  | "surgery"
  | "chemo"
  | "radiotherapy"
  | "exam"
  | "injection";

export interface ChartDefinitionBody {
  schema_version: 1;
  axis: ChartAxis;
  items: ChartItem[];
  events: ChartEventKind[];
  /** true なら全項目を 1 つのグラフに重ねる。既定は項目ごとに分けて並べる。 */
  overlay: boolean;
}

export const CHART_EVENT_KINDS: ReadonlyArray<{ kind: ChartEventKind; label: string }> = [
  { kind: "encounter", label: "入退院" },
  { kind: "surgery", label: "手術" },
  { kind: "chemo", label: "化学療法" },
  { kind: "radiotherapy", label: "放射線治療" },
  { kind: "exam", label: "検査実施" },
  { kind: "injection", label: "注射実施" },
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
  return { schema_version: 1, axis: { ...DEFAULT_CHART_AXIS }, items: [], events: [], overlay: false };
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
      });
    }
  }

  if (Array.isArray(source.events)) {
    for (const kind of source.events) {
      if (isEventKind(kind) && !body.events.includes(kind)) body.events.push(kind);
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

/** テンプレートの数値項目 → チャートの項目(抽出が有効なテンプレートだけ)。 */
export function templateChartItems(questionnaire: fhir4.Questionnaire): ChartItem[] {
  const id = questionnaire.id ?? "";
  return questionnaireNumericItems(questionnaire).map((item) => ({
    key: `template:${id}:${item.linkId}`,
    source: "template" as const,
    name: item.text,
    unit: item.unit,
    codings: item.code,
  }));
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

export interface ChartPoint {
  /** 測定日時(タイムゾーンを持たないローカルの文字列)。 */
  at: string;
  t: number;
  value: number;
}

export interface ChartSeries {
  key: string;
  name: string;
  points: ChartPoint[];
}

/** 1 項目ぶんのグラフ(血圧のように系列が 2 本になることがある)。 */
export interface ChartLaneData {
  key: string;
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

function componentNumber(observation: fhir4.Observation, code: string): number | undefined {
  for (const component of observation.component ?? []) {
    const hit = component.code?.coding?.some((coding) => coding.code === code);
    if (hit && typeof component.valueQuantity?.value === "number") return component.valueQuantity.value;
  }
  return undefined;
}

function matchesItem(observation: fhir4.Observation, item: ChartItem): boolean {
  return (observation.code?.coding ?? []).some((coding) =>
    item.codings.some((want) => want.system === coding.system && want.code === coding.code),
  );
}

/**
 * 項目ごとのグラフを組み立てる。同じ日時に 2 件あれば後から来たもの(訂正)を採る。
 * 値の無い結果(コード型・文字列型)は点にならないので落ちる。
 */
export function buildChartLanes(
  items: ChartItem[],
  observations: fhir4.Observation[],
): ChartLaneData[] {
  return items.map((item) => {
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
        byTime.set(at, { at, t: epochOf(at), value });
      }
      return {
        key: `${item.key}/${spec.key}`,
        name: spec.name,
        points: [...byTime.values()].sort((a, b) => a.t - b.t),
      };
    });

    return { key: item.key, name: item.name, unit: item.unit, series };
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
  const spans = new Map<string, { cycle: number; name: string; start: string; end: string; reduction: string }>();

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
      });
      continue;
    }
    if (order.date < span.start) span.start = order.date;
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
