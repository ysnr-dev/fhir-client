import type { QueryClient } from "@tanstack/react-query";
import type { ExtractQuery, PatientFolder } from "../api/masterClient";
import {
  fetchAdverseEventExtract,
  fetchClusterExtract,
  fetchConditionExtract,
  fetchEncounterExtract,
  fetchEventExtract,
  fetchIndicatorExtract,
  fetchInterventionExtract,
  fetchLabExtract,
  fetchMedicationExtract,
  fetchMicroExtract,
  fetchPathwayExtract,
  fetchPerformExtract,
  fetchSurgeryExtract,
  fetchTemplateExtract,
  type AdverseEventExtractCriteria,
  type AdverseEventExtractResult,
  type ClusterExtractCriteria,
  type ClusterExtractResult,
  type ConditionExtractCriteria,
  type ConditionExtractResult,
  type EncounterExtractCriteria,
  type EncounterExtractKind,
  type EncounterExtractResult,
  type EventExtractCriteria,
  type EventExtractResult,
  type IndicatorExtractCriteria,
  type IndicatorExtractResult,
  type InterventionExtractCriteria,
  type InterventionExtractResult,
  type LabExtractCriteria,
  type LabExtractResult,
  type MedicationExtractCriteria,
  type MedicationExtractResult,
  type MicroExtractCriteria,
  type MicroExtractResult,
  type PathwayExtractCriteria,
  type PathwayExtractResult,
  type PerformExtractCriteria,
  type PerformExtractResult,
  type SurgeryExtractCriteria,
  type SurgeryExtractResult,
  type TemplateExtractCriteria,
  type TemplateExtractResult,
} from "../api/queries";
import { today } from "../lib/dates";
import { adverseEventExtractHeader, adverseEventExtractTable } from "./adverseEventExtractHelpers";
import { metricHeader, metricName } from "./clusterExtractHelpers";
import { conditionExtractHeader, conditionExtractRows } from "./conditionExtractHelpers";
import { departmentCode } from "./departmentHelpers";
import { encounterExtractHeader, encounterExtractRows } from "./encounterExtractHelpers";
import { interventionExtractHeader, interventionExtractRows } from "./interventionExtractHelpers";
import {
  patientColumnLabel,
  patientColumnsOf,
  patientRowOf,
  type ExtractPatientRow,
} from "./extractQueryHelpers";
import type { ResolvedPeriod } from "./extractQueryModel";
import { isDeathOutcome, stratumLeaf } from "./extractRecordQuery";
import {
  EVENT_CENSORED,
  EVENT_DAYS_COLUMN,
  EVENT_DAY_COLUMN,
  EVENT_END_COLUMN,
  EVENT_INDEX_COLUMN,
  EVENT_OCCURRED,
  EVENT_OUTCOME_COLUMN,
} from "./eventExtractHelpers";
import type {
  AdverseEventExtractDefinition,
  ClusterExtractDefinition,
  ConditionExtractDefinition,
  EncounterExtractDefinition,
  EventExtractDefinition,
  ExtractRecordDefinition,
  ExtractRecordTab,
  IndicatorExtractDefinition,
  InterventionExtractDefinition,
  LabExtractDefinition,
  MedicationExtractDefinition,
  MicroExtractDefinition,
  PathwayExtractDefinition,
  PerformExtractDefinition,
  SurgeryExtractDefinition,
  TemplateExtractDefinition,
} from "./extractRecordQuery";
import {
  INDICATOR_HIT,
  INDICATOR_HIT_COLUMN,
  INDICATOR_MISS,
  INDICATOR_PERIOD_COLUMN,
  INDICATOR_PERIOD_NAME_COLUMN,
  indicatorHeadline,
  indicatorPointsOf,
} from "./indicatorExtractHelpers";
import { labExtractHeader, labExtractTable, labFixedCells, type LabExtractAggregate } from "./labExtractHelpers";
import { medicationExtractHeader, medicationExtractRows } from "./medicationExtractHelpers";
import { microExtractHeader, microExtractTable, type MicroSusceptibilityField } from "./microExtractHelpers";
import { pathwayExtractHeader, pathwayExtractRows } from "./pathwayExtractHelpers";
import {
  PERFORM_EXTRACT_KINDS,
  performExtractHeader,
  performExtractTable,
  performRowCells,
} from "./performExtractHelpers";
import { periodBuckets } from "./recordBreakdownHelpers";
import { recordTableCells, type RecordTableRow } from "./recordTableHelpers";
import { surgeryExtractHeader, surgeryExtractRows } from "./surgeryExtractHelpers";
import {
  latestPerPatient,
  templateExtractHeader,
  templateExtractTable,
  templateFixedCells,
} from "./templateExtractHelpers";
import type { VitalThresholdSettings } from "./vitalHelpers";

// データ抽出の記録を表にするタブの、保存した条件だけからの実行(docs/data-extract-design.md §17)。
// タブごとに「条件 → 読み込みの条件」「読み込みの結果 → 表」を 1 組ずつ並べ、データ抽出の画面と
// ダッシュボード(docs/dashboard-design.md)が同じ組で実行する。患者の絞り込み(患者の条件・フォルダ・
// 比較群)は hooks/useExtractPatientScope の resolvePatientScope で先に解いて patientIds で渡す。

/** 実行のたびに決まる入力(タブの期間を日付にしたものと、絞り込んだ患者)。 */
export interface ExtractRunInput {
  range: ResolvedPeriod | null;
  patientIds?: string[];
  /** 実行の中で「患者」タブの条件を評価するタブ(指標)に渡すもの。無ければそのタブは実行できない。 */
  evaluator?: {
    /** 「患者」タブに保存した条件。 */
    queries: ExtractQuery[];
    folders: PatientFolder[];
    queryClient?: QueryClient;
  };
}

/** 画面から渡す参照データ(診療科の一覧はコードに、バイタルの閾値は H/L の判定に使う)。 */
export interface ExtractRunContext {
  departments: fhir4.Organization[];
  vitalThresholds: VitalThresholdSettings;
}

/** 結果の表。見出しと行は RecordResultTable に、件数は recordCountLabel で出す。 */
export interface RecordTable {
  header: string[];
  rows: RecordTableRow[];
  /** 行の単位(件 / 行)。患者ごとに 1 行の表は「人」。 */
  unit: "件" | "行" | "人";
  /** 件数の前に添える語(入院・外来の区分、実施の種別)。 */
  prefix?: string;
  /** 読み切れなかった結果では表を出せない(患者ごとの集計など)。rows は空。 */
  incomplete: boolean;
  /** 件数の代わりに結果を 1 行で表すもの(指標の直近の割合)。ダッシュボードの「件数」のタイルに出す。 */
  headline?: string;
  /** 結果が持つ期間の並び(行の無い 0 件の期間も含む。指標)。 */
  periods?: { date: string; label: string }[];
}

export interface ExtractTabRunner<D extends ExtractRecordDefinition, C, R> {
  label: string;
  emptyLabel: string;
  /** 読み切れなかったときの注記(無ければ出さない)。 */
  truncatedMessage?: string;
  /** 読み切れず表を出せないときの注記。 */
  incompleteMessage?: string;
  /** 条件を読み込みの条件にする。足りない(テンプレート未選択など)なら null。 */
  criteria(definition: D, input: ExtractRunInput, context: ExtractRunContext): C | null;
  fetch(criteria: C, signal: AbortSignal): Promise<R>;
  /** 結果を表にする。表の見せ方(出力項目・行の単位など)は今の条件、読み込みに使った条件は結果から取る。 */
  table(result: R, definition: D, context: ExtractRunContext): RecordTable;
}

export function recordCountLabel(table: RecordTable): string {
  const count = table.rows.length;
  if (table.unit === "人") return `${count} 人`;
  const patients = new Set(table.rows.map((row) => row.patient.patientId)).size;
  return `${table.prefix ? `${table.prefix} ` : ""}${count} ${table.unit}(${patients} 人)`;
}

/** 患者の行に固定列と項目の列を持つ結果(病名・投薬など)を表の行にする。 */
function rowsOf(rows: (ExtractPatientRow & { rowKey: string; fixed: string[]; values: string[] })[]): RecordTableRow[] {
  return rows.map((row) => ({ key: row.rowKey, patient: row, fixed: row.fixed, values: row.values }));
}

const fromTo = (range: ResolvedPeriod | null) => ({ from: range?.from ?? "", to: range?.to ?? "" });

const ENCOUNTER_KIND_LABELS: Record<EncounterExtractKind, string> = {
  inpatient: "入院",
  outpatient: "外来受診",
  emergency: "救急受診",
};

export const encounterRunner: ExtractTabRunner<EncounterExtractDefinition, EncounterExtractCriteria, EncounterExtractResult> = {
  label: "入院・外来",
  emptyLabel: "該当する受診はありません",
  truncatedMessage: "件数が多いため、新しいものから一部だけを読みました。期間を絞ってください。",
  criteria(definition, { range, patientIds }, { departments }) {
    const kind = definition.kind ?? "inpatient";
    const inpatient = kind === "inpatient";
    const department = departments.find((d) => d.id === definition.department_id);
    return {
      kind,
      ...fromTo(range),
      dateMode: definition.date_mode ?? "overlap",
      departmentId: inpatient ? definition.department_id || undefined : undefined,
      departmentCode: kind === "outpatient" && department ? departmentCode(department) || undefined : undefined,
      wardId: inpatient ? definition.ward_id || undefined : undefined,
      patientIds,
    };
  },
  fetch: fetchEncounterExtract,
  table(result, definition) {
    const rows = encounterExtractRows(
      result.kind,
      result.encounters,
      result.locations,
      result.appointments,
      result.patients,
      today(),
    );
    return {
      header: encounterExtractHeader(result.kind, definition.output),
      rows: rowsOf(rows),
      unit: "件",
      prefix: ENCOUNTER_KIND_LABELS[result.kind],
      incomplete: false,
    };
  },
};

export const conditionRunner: ExtractTabRunner<ConditionExtractDefinition, ConditionExtractCriteria, ConditionExtractResult> = {
  label: "病名",
  emptyLabel: "該当する病名はありません",
  truncatedMessage: "病名が多いため、新しいものから一部だけを読みました。期間か病名を絞ってください。",
  criteria(definition, { range, patientIds }) {
    return {
      codes: definition.codes ?? [],
      clinicalStatus: definition.clinical_status ?? [],
      category: definition.category,
      suspected: definition.suspected,
      dateField: definition.date_field ?? "onset",
      ...fromTo(range),
      patientIds,
    };
  },
  fetch: fetchConditionExtract,
  table(result, definition) {
    const rows = conditionExtractRows(result.conditions, result.patients, result.dateField);
    return { header: conditionExtractHeader(definition.output), rows: rowsOf(rows), unit: "件", incomplete: false };
  },
};

export const templateRunner: ExtractTabRunner<TemplateExtractDefinition, TemplateExtractCriteria, TemplateExtractResult> = {
  label: "テンプレート",
  emptyLabel: "該当する回答はありません",
  truncatedMessage: "回答が多いため、新しいものから一部だけを読みました。期間を絞ってください。",
  criteria(definition, { range, patientIds }) {
    if (!definition.template_url) return null;
    return {
      url: definition.template_url,
      ...fromTo(range),
      departmentId: definition.department_id || undefined,
      patientIds,
    };
  },
  fetch: fetchTemplateExtract,
  table(result, definition) {
    const table = templateExtractTable(result.questionnaires, result.responses, result.patients);
    const rows = definition.latest_only ? latestPerPatient(table.rows) : table.rows;
    return {
      header: templateExtractHeader(table.columns, definition.output),
      rows: rows.map((row) => ({
        key: row.responseId,
        patient: row,
        fixed: templateFixedCells(row),
        values: table.columns.map((column) => row.values.get(column.key) ?? ""),
      })),
      unit: definition.latest_only ? "人" : "件",
      incomplete: false,
    };
  },
};

const DEFAULT_LAB_AGGREGATES: LabExtractAggregate[] = ["latest"];

export const labRunner: ExtractTabRunner<LabExtractDefinition, LabExtractCriteria, LabExtractResult> = {
  label: "検査結果",
  emptyLabel: "該当する結果はありません",
  truncatedMessage: "結果が多いため、新しいものから一部だけを読みました。期間を絞ってください。",
  incompleteMessage: "結果が多く読み切れなかったため、患者ごとの集計は出せません。期間か患者を絞ってください。",
  criteria(definition, { range, patientIds }) {
    if (!definition.items?.length) return null;
    return { items: definition.items, ...fromTo(range), departmentId: definition.department_id || undefined, patientIds };
  },
  fetch: fetchLabExtract,
  table(result, definition, { vitalThresholds }) {
    const mode = definition.mode ?? "time";
    const table = labExtractTable(result.items, result.observations, result.patients, {
      mode,
      aggregates: definition.aggregates ?? DEFAULT_LAB_AGGREGATES,
      interpretation: definition.interpretation ?? false,
      vitalThresholds,
    });
    // 患者ごとの集計(最初・件数など)は欠けた記録では嘘になるので、読み切れなかったら出さない。
    const incomplete = mode === "patient" && result.truncated;
    const rows = incomplete ? [] : table.rows;
    return {
      header: labExtractHeader(table.columns, mode, definition.output),
      rows: rows.map((row) => ({
        key: row.rowKey,
        patient: row,
        fixed: labFixedCells(row, mode),
        values: table.columns.map((column) => row.values.get(column.key) ?? ""),
      })),
      unit: mode === "patient" ? "人" : "行",
      incomplete,
    };
  },
};

export const medicationRunner: ExtractTabRunner<
  MedicationExtractDefinition,
  MedicationExtractCriteria,
  MedicationExtractResult
> = {
  label: "投薬",
  emptyLabel: "該当する投薬はありません",
  truncatedMessage: "オーダーが多いため、新しいものから一部だけを読みました。期間か薬剤を絞ってください。",
  criteria(definition, { range, patientIds }) {
    return {
      codes: definition.codes ?? [],
      drugClasses: definition.drug_classes ?? [],
      orderType: definition.order_type,
      ...fromTo(range),
      departmentId: definition.department_id || undefined,
      patientIds,
    };
  },
  fetch: fetchMedicationExtract,
  table(result, definition) {
    const rows = medicationExtractRows(result.requests, result.headers, result.patients);
    return { header: medicationExtractHeader(definition.output), rows: rowsOf(rows), unit: "件", incomplete: false };
  },
};

const DEFAULT_SUSCEPTIBILITY: MicroSusceptibilityField[] = ["sir"];
/** 細菌検査の折り返さない固定列の数(採取日〜培養)。塗抹の所見から後ろは長いので折り返す。 */
const MICRO_FIXED_COLUMNS = 6;

export const microRunner: ExtractTabRunner<MicroExtractDefinition, MicroExtractCriteria, MicroExtractResult> = {
  label: "細菌検査",
  emptyLabel: "該当する結果はありません",
  truncatedMessage: "結果が多いため、新しいものから一部だけを読みました。期間を絞ってください。",
  incompleteMessage: "結果が多く読み切れなかったため、患者・菌ごとの初回は出せません。期間か患者を絞ってください。",
  criteria(_definition, { range, patientIds }) {
    return { ...fromTo(range), patientIds };
  },
  fetch: fetchMicroExtract,
  table(result, definition) {
    const firstIsolateOnly = definition.first_isolate_only ?? false;
    const table = microExtractTable(result.reports, result.observations, result.specimens, result.patients, {
      includeNoIsolate: definition.include_no_isolate ?? false,
      firstIsolateOnly,
      susceptibility: definition.susceptibility ?? DEFAULT_SUSCEPTIBILITY,
    });
    // 「患者・菌ごとに初回」は欠けた結果だと初回を取り違えるので、読み切れなかったら出さない。
    const incomplete = firstIsolateOnly && result.truncated;
    const rows = incomplete ? [] : table.rows;
    return {
      header: microExtractHeader(table.drugColumns, definition.output),
      rows: rows.map((row) => ({
        key: row.rowKey,
        patient: row,
        fixed: row.fixed.slice(0, MICRO_FIXED_COLUMNS),
        values: [
          ...row.fixed.slice(MICRO_FIXED_COLUMNS),
          ...table.drugColumns.map((column) => row.drugs.get(column.key) ?? ""),
        ],
      })),
      unit: "行",
      incomplete,
    };
  },
};

export const surgeryRunner: ExtractTabRunner<SurgeryExtractDefinition, SurgeryExtractCriteria, SurgeryExtractResult> = {
  label: "手術",
  emptyLabel: "該当する手術はありません",
  truncatedMessage: "手術が多いため、新しいものから一部だけを読みました。期間を絞ってください。",
  criteria(definition, { range, patientIds }) {
    return {
      ...fromTo(range),
      departmentId: definition.department_id || undefined,
      procedureCodes: (definition.procedures ?? []).map((p) => p.code),
      patientIds,
    };
  },
  fetch: fetchSurgeryExtract,
  table(result, definition) {
    const rows = surgeryExtractRows(result.hubs, result.children, result.observations, result.orders, result.patients);
    return { header: surgeryExtractHeader(definition.output), rows: rowsOf(rows), unit: "件", incomplete: false };
  },
};

export const performRunner: ExtractTabRunner<PerformExtractDefinition, PerformExtractCriteria, PerformExtractResult> = {
  label: "実施",
  emptyLabel: "該当する実施はありません",
  truncatedMessage: "実施が多いため、新しいものから一部だけを読みました。期間を絞ってください。",
  criteria(definition, { range, patientIds }) {
    const orderType = definition.order_kind ?? PERFORM_EXTRACT_KINDS[0].code;
    return { orderType, ...fromTo(range), departmentId: definition.department_id || undefined, patientIds };
  },
  fetch: fetchPerformExtract,
  table(result, definition) {
    const table = performExtractTable(
      result.hubs,
      result.children,
      result.administrations,
      result.observations,
      result.serviceRequests,
      result.patients,
    );
    return {
      header: performExtractHeader(table.measureColumns, definition.output),
      rows: table.rows.map((row) => ({
        key: row.rowKey,
        patient: row,
        fixed: row.fixed,
        values: performRowCells(row, table.measureColumns),
      })),
      unit: "件",
      prefix: PERFORM_EXTRACT_KINDS.find((k) => k.code === result.orderType)?.label,
      incomplete: false,
    };
  },
};

export const adverseEventRunner: ExtractTabRunner<
  AdverseEventExtractDefinition,
  AdverseEventExtractCriteria,
  AdverseEventExtractResult
> = {
  label: "有害事象",
  emptyLabel: "該当する有害事象はありません",
  truncatedMessage: "記録が多いため、新しいものから一部だけを読みました。期間を絞ってください。",
  incompleteMessage: "記録が多く読み切れなかったため、患者・治療ごとの集計は出せません。期間か患者を絞ってください。",
  criteria(definition, { range, patientIds }) {
    return {
      ...fromTo(range),
      treatmentType: definition.treatment_type,
      terms: definition.terms ?? [],
      patientIds,
    };
  },
  fetch: fetchAdverseEventExtract,
  table(result, definition) {
    const mode = definition.mode ?? "event";
    const table = adverseEventExtractTable(result.observations, result.patients, mode);
    // 患者・治療ごとの件数・最大 Grade は欠けた記録では嘘になるので、読み切れなかったら出さない。
    const incomplete = mode === "treatment" && result.truncated;
    const rows = incomplete ? [] : table.rows;
    return {
      header: adverseEventExtractHeader(table, definition.output),
      rows: rows.map(({ key, patient, cells }) => ({
        key,
        patient,
        fixed: cells.slice(0, table.fixedCount),
        values: cells.slice(table.fixedCount),
      })),
      unit: mode === "event" ? "件" : "行",
      incomplete,
    };
  },
};

export const pathwayRunner: ExtractTabRunner<PathwayExtractDefinition, PathwayExtractCriteria, PathwayExtractResult> = {
  label: "パス",
  emptyLabel: "該当する適用はありません",
  incompleteMessage: "適用か評価が多く読み切れなかったため、表を出せません。期間かパスを絞ってください。",
  criteria(definition, { range, patientIds }) {
    return { ...fromTo(range), pathwayCode: definition.pathway_code || undefined, patientIds };
  },
  fetch: fetchPathwayExtract,
  table(result, definition) {
    const rows = pathwayExtractRows(result.applications, result.encounters, result.goals, result.patients, today());
    // 評価の件数は欠けた記録では嘘になるので、読み切れなかったら出さない。
    const incomplete = result.truncated;
    return {
      header: pathwayExtractHeader(definition.output),
      rows: incomplete ? [] : rowsOf(rows),
      unit: "件",
      incomplete,
    };
  },
};

/**
 * クラスタ(docs/data-extract-design.md §22)。クラスタ(strata)の患者は resolvePatientScope が解いた patientIds で受け取り、
 * 患者 1 人を 1 行に、指標ごとの件数・最新・最終日を列にする。
 */
export const clusterRunner: ExtractTabRunner<ClusterExtractDefinition, ClusterExtractCriteria, ClusterExtractResult> = {
  label: "クラスタ",
  emptyLabel: "クラスタに入る患者はいません",
  criteria(definition, { patientIds }) {
    if (!definition.strata?.length || !patientIds) return null;
    return {
      patientIds,
      metrics: (definition.metrics ?? []).map((metric) => {
        const name = metricName(metric);
        return { leaf: stratumLeaf(metric, definition.period, name), name };
      }),
    };
  },
  fetch: fetchClusterExtract,
  table(result, definition) {
    const header = [
      "患者番号",
      "氏名",
      ...patientColumnsOf(definition.output).map(patientColumnLabel),
      ...result.metrics.flatMap((metric) => metricHeader(metric.name, metric.unit)),
    ];
    const rows = result.patientIds
      .map((patientId) => patientRowOf(patientId, result.patients.get(patientId)))
      .sort((a, b) => a.patientNumber.localeCompare(b.patientNumber, undefined, { numeric: true }))
      .map((patient) => ({
        key: patient.patientId,
        patient,
        fixed: [],
        values: result.metrics.flatMap((metric) => {
          const hit = metric.hits.get(patient.patientId);
          if (!hit) return ["", "", ""];
          const latest = metric.values ? String(metric.values.get(patient.patientId) ?? "") : hit.latest;
          return [String(hit.count), latest, hit.last];
        }),
      }));
    return { header, rows, unit: "人", incomplete: false };
  },
};

/**
 * 指標(docs/data-extract-design.md §23)。期間の刻みごとに分母・分子の条件を評価し、分母に入った患者 × 期間を 1 行に、
 * 「期間」(刻みの最初の日)・「期間名」・「分子」(該当 / 非該当)を固定列にする。割合は行から数える(indicatorPointsOf)。
 */
export const indicatorRunner: ExtractTabRunner<IndicatorExtractDefinition, IndicatorExtractCriteria, IndicatorExtractResult> = {
  label: "指標",
  emptyLabel: "分母に入る患者はいません",
  criteria(definition, { range, patientIds, evaluator }) {
    if (!definition.denominator || !definition.numerator || !range?.from || !evaluator) return null;
    const buckets = periodBuckets({ from: range.from, to: range.to ?? today() }, definition.grain ?? "month");
    if (buckets.length === 0) return null;
    return {
      buckets,
      denominator: definition.denominator,
      numerator: definition.numerator,
      queries: evaluator.queries,
      folders: evaluator.folders,
      queryClient: evaluator.queryClient,
      patientIds,
    };
  },
  fetch: fetchIndicatorExtract,
  table(result, definition) {
    const patientColumns = patientColumnsOf(definition.output);
    const header = [
      "患者番号",
      "氏名",
      ...patientColumns.map(patientColumnLabel),
      INDICATOR_PERIOD_COLUMN,
      INDICATOR_PERIOD_NAME_COLUMN,
      INDICATOR_HIT_COLUMN,
    ];
    const rows = result.buckets.flatMap((bucket) =>
      [...bucket.denominator]
        .map((patientId) => patientRowOf(patientId, result.patients.get(patientId)))
        .sort((a, b) => a.patientNumber.localeCompare(b.patientNumber, undefined, { numeric: true }))
        .map((patient) => ({
          key: `${bucket.key}:${patient.patientId}`,
          patient,
          fixed: [bucket.from, bucket.label, bucket.numerator.has(patient.patientId) ? INDICATOR_HIT : INDICATOR_MISS],
          values: [],
        })),
    );
    const periods = result.buckets.map((bucket) => ({ date: bucket.from, label: bucket.label }));
    const { points } = indicatorPointsOf(header, recordTableCells(rows, patientColumns), rows.map((r) => r.patient.patientId), periods);
    return { header, rows, unit: "行", incomplete: false, headline: indicatorHeadline(points), periods };
  },
};

/**
 * イベントまでの日数(docs/data-extract-design.md §25)。基準イベントの最初の記録の日から、結果イベント(条件 1 件か死亡)の
 * 最初の記録の日までの日数と転帰(発生 / 打ち切り)を患者 1 人 1 行にする。累積発生率は行から数える(incidenceCurves)。
 */
export const eventRunner: ExtractTabRunner<EventExtractDefinition, EventExtractCriteria, EventExtractResult> = {
  label: "イベント",
  emptyLabel: "基準イベントのある患者はいません",
  criteria(definition, { range, patientIds }) {
    if (!definition.index || !definition.outcome || !range?.from) return null;
    const outcome = isDeathOutcome(definition.outcome) ? null : stratumLeaf(definition.outcome, null, "結果イベント");
    return {
      // 基準イベントの期間はタブの期間(条件に入れた期間は使わない)。
      index: stratumLeaf({ ...definition.index, period: null }, definition.period, "基準イベント"),
      indexAnchor: definition.index_anchor ?? "start",
      outcome,
      fromDays: definition.outcome_from_days ?? 1,
      followDays: definition.follow_days ?? undefined,
      patientIds,
    };
  },
  fetch: fetchEventExtract,
  table(result, definition) {
    const header = [
      "患者番号",
      "氏名",
      ...patientColumnsOf(definition.output).map(patientColumnLabel),
      EVENT_INDEX_COLUMN,
      EVENT_DAY_COLUMN,
      EVENT_DAYS_COLUMN,
      EVENT_OUTCOME_COLUMN,
      EVENT_END_COLUMN,
    ];
    const rows = [...result.subjects]
      .sort((a, b) => (a.indexDay > b.indexDay ? -1 : a.indexDay < b.indexDay ? 1 : 0))
      .map((subject) => ({
        key: subject.patientId,
        patient: patientRowOf(subject.patientId, result.patients.get(subject.patientId)),
        fixed: [
          subject.indexDay,
          subject.eventDay ?? "",
          String(subject.days),
          subject.eventDay ? EVENT_OCCURRED : EVENT_CENSORED,
          subject.endDay,
        ],
        values: [],
      }));
    const events = result.subjects.filter((s) => s.eventDay).length;
    return { header, rows, unit: "人", incomplete: false, headline: `${rows.length} 人(発生 ${events})` };
  },
};

export const interventionRunner: ExtractTabRunner<
  InterventionExtractDefinition,
  InterventionExtractCriteria,
  InterventionExtractResult
> = {
  label: "薬剤師介入",
  emptyLabel: "該当する監査はありません",
  truncatedMessage: "監査が多いため、新しいものから一部だけを読みました。期間を絞ってください。",
  criteria(_definition, { range, patientIds }) {
    return { ...fromTo(range), patientIds };
  },
  fetch: fetchInterventionExtract,
  table(result, definition) {
    const rows = interventionExtractRows(result.tasks, result.patients, {
      result: definition.result ?? "intervened",
      orderKind: definition.order_kind,
      types: definition.types ?? [],
      departmentId: definition.department_id,
    });
    return { header: interventionExtractHeader(definition.output), rows: rowsOf(rows), unit: "件", incomplete: false };
  },
};

/** タブ → 実行の組。タブを足すときはここに 1 行足す。 */
export const EXTRACT_TAB_RUNNERS: {
  [K in ExtractRecordTab]: ExtractTabRunner<ExtractRecordDefinition, unknown, unknown>;
} = {
  encounter: encounterRunner,
  condition: conditionRunner,
  template: templateRunner,
  lab: labRunner,
  medication: medicationRunner,
  micro: microRunner,
  surgery: surgeryRunner,
  perform: performRunner,
  adverse: adverseEventRunner,
  pathway: pathwayRunner,
  intervention: interventionRunner,
  cluster: clusterRunner,
  indicator: indicatorRunner,
  event: eventRunner,
};
