import { csvBlob } from "../lib/csv";
import { dateTimeLabel } from "../lib/dates";
import {
  isChoiceItem,
  localDateTimeOf,
  observationAt,
  type ChartItem,
} from "./chartDefinitionHelpers";
import {
  patientCell,
  patientColumnLabel,
  patientColumnsOf,
  patientRowOf,
  type ExtractOutput,
  type ExtractPatientRow,
} from "./extractQueryHelpers";
import { RESULT_ITEM_SYSTEM, interpretationCodeOf } from "./labResultHelpers";
import { vitalInterpretationOf, type VitalThresholdSettings } from "./vitalHelpers";

// 検査結果の抽出(docs/data-extract-design.md §9)。選んだ項目(チャートの項目と同じ形)の
// Observation を「行 = 測定日時 / 日 / 患者、列 = 項目」の表にする。患者ごとの行は
// 最初・最新・最大・最小・平均・件数から選んだ集計を項目ごとに列にする。

export type LabExtractRowMode = "time" | "day" | "patient";

export const LAB_EXTRACT_ROW_MODES: { value: LabExtractRowMode; label: string }[] = [
  { value: "time", label: "測定日時ごと" },
  { value: "day", label: "日ごと" },
  { value: "patient", label: "患者ごと" },
];

export type LabExtractAggregate = "first" | "latest" | "max" | "min" | "mean" | "count";

export const LAB_EXTRACT_AGGREGATES: { value: LabExtractAggregate; label: string }[] = [
  { value: "first", label: "最初" },
  { value: "latest", label: "最新" },
  { value: "max", label: "最大" },
  { value: "min", label: "最小" },
  { value: "mean", label: "平均" },
  { value: "count", label: "件数" },
];

/** 選べる項目の上限。 */
export const LAB_EXTRACT_MAX_ITEMS = 50;

export interface LabExtractOptions {
  mode: LabExtractRowMode;
  /** 患者ごとの行で出す集計(並びは LAB_EXTRACT_AGGREGATES の順にそろえる)。 */
  aggregates: LabExtractAggregate[];
  /** 値の隣に H / L(判定)の列を出す。 */
  interpretation: boolean;
  vitalThresholds: VitalThresholdSettings;
}

export interface LabExtractColumn {
  key: string;
  header: string;
}

export interface LabExtractRow extends ExtractPatientRow {
  rowKey: string;
  /** 測定日時(測定日時ごと)か日付(日ごと)。患者ごとの行は空。 */
  at: string;
  values: Map<string, string>;
}

/** 1 項目の中の 1 つの値の列(血圧は収縮期・拡張期の 2 つ)。 */
interface ValueSpec {
  key: string;
  name: string;
  item: ChartItem;
  componentCode: string;
}

interface LabPoint {
  patientId: string;
  /** タイムゾーンを持たないローカルの日時。 */
  at: string;
  text: string;
  number: number | undefined;
  unit: string;
  flag: string;
  lastUpdated: string;
}

function specsOf(items: ChartItem[]): ValueSpec[] {
  return items.flatMap((item) =>
    item.components?.length
      ? item.components.map((component) => ({
          key: `${item.key}#${component.code}`,
          name: `${item.name} ${component.name}`,
          item,
          componentCode: component.code,
        }))
      : [{ key: item.key, name: item.name, item, componentCode: "" }],
  );
}

/**
 * 結果が項目に当たるか。施設の結果項目コードを持つ結果はそのコードだけで突き合わせる
 * (JLAC11 が同じ別の結果項目、定量と定性など、に入らないように)。持たない結果は coding のどれかで。
 */
function matchesItem(observation: fhir4.Observation, item: ChartItem): boolean {
  const codings = observation.code?.coding ?? [];
  const resultItem = codings.find((coding) => coding.system === RESULT_ITEM_SYSTEM);
  const candidates = resultItem ? [resultItem] : codings;
  return candidates.some((coding) =>
    item.codings.some((want) => want.system === coding.system && want.code === coding.code),
  );
}

function valueOf(
  source: Pick<fhir4.Observation, "valueQuantity" | "valueInteger" | "valueCodeableConcept" | "valueString" | "valueBoolean">,
): { text: string; number: number | undefined; unit: string } {
  if (source.valueQuantity) {
    const value = source.valueQuantity.value;
    return {
      text: typeof value === "number" ? String(value) : "",
      number: typeof value === "number" ? value : undefined,
      unit: source.valueQuantity.unit ?? source.valueQuantity.code ?? "",
    };
  }
  if (typeof source.valueInteger === "number") {
    return { text: String(source.valueInteger), number: source.valueInteger, unit: "" };
  }
  if (source.valueCodeableConcept) {
    const concept = source.valueCodeableConcept;
    return { text: concept.coding?.[0]?.display ?? concept.text ?? concept.coding?.[0]?.code ?? "", number: undefined, unit: "" };
  }
  if (typeof source.valueBoolean === "boolean") {
    return { text: source.valueBoolean ? "はい" : "いいえ", number: undefined, unit: "" };
  }
  return { text: source.valueString ?? "", number: undefined, unit: "" };
}

function pointOf(
  spec: ValueSpec,
  observation: fhir4.Observation,
  vitalThresholds: VitalThresholdSettings,
): LabPoint | null {
  const at = localDateTimeOf(observationAt(observation));
  if (!at) return null;
  const component = spec.componentCode
    ? (observation.component ?? []).find((c) => c.code?.coding?.some((coding) => coding.code === spec.componentCode))
    : undefined;
  if (spec.componentCode && !component) return null;
  const value = valueOf(component ?? observation);
  if (!value.text) return null;
  let flag = "";
  if (spec.item.source === "vital") {
    const code = spec.componentCode || (spec.item.codings[0]?.code ?? "");
    flag = value.number === undefined ? "" : vitalInterpretationOf(code, value.number, vitalThresholds);
  } else {
    flag = interpretationCodeOf(observation);
    if (flag === "N") flag = "";
  }
  return {
    patientId: observation.subject?.reference?.split("/").pop() ?? "",
    at: at.slice(0, 16),
    text: value.text,
    number: value.number,
    // バイタルとテンプレートは項目の単位にそろえる(書き方の揺れで単位の列が出ないように)。
    unit: spec.item.source === "lab" ? value.unit || spec.item.unit : spec.item.unit,
    flag,
    lastUpdated: observation.meta?.lastUpdated ?? "",
  };
}

/** 新しい方。同じ日時なら後から書かれた方(訂正)。 */
function isNewer(a: LabPoint, b: LabPoint): boolean {
  if (a.at !== b.at) return a.at > b.at;
  return a.lastUpdated > b.lastUpdated;
}

function roundMean(values: number[]): string {
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  return String(Math.round(mean * 100) / 100);
}

const AGGREGATE_LABELS = new Map(LAB_EXTRACT_AGGREGATES.map((a) => [a.value, a.label]));

/** 値の列ごとの見出しの部品(単位が 1 つにそろうなら見出しに付け、ばらつくなら単位の列を出す)。 */
function unitPlanOf(spec: ValueSpec, points: LabPoint[]): { headerUnit: string; unitColumn: boolean } {
  const units = new Set(points.map((p) => p.unit).filter(Boolean));
  if (units.size > 1) return { headerUnit: "", unitColumn: true };
  const unit = [...units][0] ?? spec.item.unit;
  return { headerUnit: unit, unitColumn: false };
}

function withUnit(name: string, unit: string): string {
  return unit ? `${name}(${unit})` : name;
}

/** 判定の列を出せる値か(選択肢の項目は判定を持たない)。 */
function hasFlag(spec: ValueSpec): boolean {
  return !isChoiceItem(spec.item);
}

/** Observation を表の行と列にする。 */
export function labExtractTable(
  items: ChartItem[],
  observations: fhir4.Observation[],
  patients: Map<string, fhir4.Patient>,
  options: LabExtractOptions,
): { columns: LabExtractColumn[]; rows: LabExtractRow[] } {
  const specs = specsOf(items);
  const pointsBySpec = new Map<string, LabPoint[]>();
  for (const spec of specs) {
    const points: LabPoint[] = [];
    for (const observation of observations) {
      if (!matchesItem(observation, spec.item)) continue;
      const point = pointOf(spec, observation, options.vitalThresholds);
      if (point) points.push(point);
    }
    pointsBySpec.set(spec.key, points);
  }

  const columns: LabExtractColumn[] = [];
  const rows = new Map<string, LabExtractRow>();
  const rowFor = (rowKey: string, patientId: string, at: string): LabExtractRow => {
    let row = rows.get(rowKey);
    if (!row) {
      row = { ...patientRowOf(patientId, patients.get(patientId)), rowKey, at, values: new Map() };
      rows.set(rowKey, row);
    }
    return row;
  };

  if (options.mode === "patient") {
    const aggregates = LAB_EXTRACT_AGGREGATES.map((a) => a.value).filter((a) => options.aggregates.includes(a));
    for (const spec of specs) {
      const points = pointsBySpec.get(spec.key) ?? [];
      const { headerUnit, unitColumn } = unitPlanOf(spec, points);
      const base = withUnit(spec.name, headerUnit);
      for (const aggregate of aggregates) {
        const label = AGGREGATE_LABELS.get(aggregate) ?? aggregate;
        columns.push({ key: `${spec.key}|${aggregate}`, header: `${aggregate === "count" ? spec.name : base} ${label}` });
        if (aggregate === "first" || aggregate === "latest") {
          columns.push({ key: `${spec.key}|${aggregate}|at`, header: `${spec.name} ${label}の日時` });
        }
        if (options.interpretation && hasFlag(spec) && aggregate !== "mean" && aggregate !== "count") {
          columns.push({ key: `${spec.key}|${aggregate}|flag`, header: `${spec.name} ${label}のH/L` });
        }
      }
      if (unitColumn) columns.push({ key: `${spec.key}|unit`, header: `${spec.name} 単位` });

      const byPatient = new Map<string, LabPoint[]>();
      for (const point of points) byPatient.set(point.patientId, [...(byPatient.get(point.patientId) ?? []), point]);
      for (const [patientId, list] of byPatient) {
        const row = rowFor(patientId, patientId, "");
        const sorted = [...list].sort((a, b) => (isNewer(a, b) ? 1 : isNewer(b, a) ? -1 : 0));
        const numeric = sorted.filter((p) => p.number !== undefined);
        const picks: Partial<Record<LabExtractAggregate, LabPoint>> = {
          first: sorted[0],
          latest: sorted[sorted.length - 1],
          max: numeric.reduce<LabPoint | undefined>((best, p) => (!best || p.number! > best.number! ? p : best), undefined),
          min: numeric.reduce<LabPoint | undefined>((best, p) => (!best || p.number! < best.number! ? p : best), undefined),
        };
        for (const aggregate of aggregates) {
          const key = `${spec.key}|${aggregate}`;
          if (aggregate === "count") {
            row.values.set(key, String(sorted.length));
            continue;
          }
          if (aggregate === "mean") {
            if (numeric.length) row.values.set(key, roundMean(numeric.map((p) => p.number!)));
            continue;
          }
          const point = picks[aggregate];
          if (!point) continue;
          row.values.set(key, point.text);
          if (aggregate === "first" || aggregate === "latest") row.values.set(`${key}|at`, dateTimeLabel(point.at));
          if (point.flag) row.values.set(`${key}|flag`, point.flag);
        }
        if (unitColumn) row.values.set(`${spec.key}|unit`, [...new Set(sorted.map((p) => p.unit))].join("、"));
      }
    }
    const list = [...rows.values()].sort((a, b) =>
      a.patientNumber.localeCompare(b.patientNumber, undefined, { numeric: true }),
    );
    return { columns, rows: list };
  }

  const atOf = (point: LabPoint) => (options.mode === "day" ? point.at.slice(0, 10) : point.at);
  for (const spec of specs) {
    const points = pointsBySpec.get(spec.key) ?? [];
    const { headerUnit, unitColumn } = unitPlanOf(spec, points);
    columns.push({ key: spec.key, header: withUnit(spec.name, headerUnit) });
    if (unitColumn) columns.push({ key: `${spec.key}|unit`, header: `${spec.name} 単位` });
    if (options.interpretation && hasFlag(spec)) columns.push({ key: `${spec.key}|flag`, header: `${spec.name} H/L` });

    // 同じ行に同じ値が 2 件あれば新しい方(日ごとなら遅い時刻、同じ日時なら訂正)を採る。
    const chosen = new Map<string, LabPoint>();
    for (const point of points) {
      const rowKey = `${point.patientId}|${atOf(point)}`;
      const current = chosen.get(rowKey);
      if (!current || isNewer(point, current)) chosen.set(rowKey, point);
    }
    for (const [rowKey, point] of chosen) {
      const row = rowFor(rowKey, point.patientId, atOf(point));
      row.values.set(spec.key, point.text);
      if (unitColumn) row.values.set(`${spec.key}|unit`, point.unit);
      if (point.flag) row.values.set(`${spec.key}|flag`, point.flag);
    }
  }
  const list = [...rows.values()].sort(
    (a, b) =>
      b.at.localeCompare(a.at) || a.patientNumber.localeCompare(b.patientNumber, undefined, { numeric: true }),
  );
  return { columns, rows: list };
}

function fixedHeaders(mode: LabExtractRowMode): string[] {
  if (mode === "time") return ["測定日時"];
  if (mode === "day") return ["日付"];
  return [];
}

export function labFixedCells(row: LabExtractRow, mode: LabExtractRowMode): string[] {
  if (mode === "time") return [dateTimeLabel(row.at)];
  if (mode === "day") return [row.at];
  return [];
}

export function labExtractHeader(
  columns: LabExtractColumn[],
  mode: LabExtractRowMode,
  output: ExtractOutput | undefined,
): string[] {
  return [
    "患者番号",
    "氏名",
    ...patientColumnsOf(output).map(patientColumnLabel),
    ...fixedHeaders(mode),
    ...columns.map((c) => c.header),
  ];
}

export function labExtractCsv(
  columns: LabExtractColumn[],
  rows: LabExtractRow[],
  mode: LabExtractRowMode,
  output: ExtractOutput | undefined,
): Blob {
  const patientColumns = patientColumnsOf(output);
  return csvBlob(
    labExtractHeader(columns, mode, output),
    rows.map((row) => [
      row.patientNumber,
      row.name,
      ...patientColumns.map((column) => patientCell(row, column)),
      ...labFixedCells(row, mode),
      ...columns.map((column) => row.values.get(column.key) ?? ""),
    ]),
  );
}
