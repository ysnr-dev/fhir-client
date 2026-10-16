import {
  buildMealIntakeBundle,
  buildMealIntakeRows,
  MEAL_INTAKE_ROWS,
  type MealIntakeKind,
  type MealIntakeSlot,
} from "./flowsheetMealHelpers";
import { mealOrderDietRef, type MealTiming } from "./mealOrderHelpers";
import { earlyWarningEntries, type EarlyWarningContext } from "./earlyWarningTaskHelpers";
import type { EarlyWarningSettings } from "./earlyWarningHelpers";
import {
  buildVitalObservations,
  DIASTOLIC,
  emptyVitalFormValues,
  JCS_MEASURE,
  SYSTOLIC,
  VITAL_MEASURES,
  vitalPostEntry,
  withFullUrls,
  type VitalMeasureKey,
} from "./vitalHelpers";

// 経過表一括入力。病棟の入院中の患者を 1 行ずつ並べ、同じ測定日時でバイタル・体重・
// 食事摂取量をまとめて入れる(1 人ずつはカルテの右ペインのバイタルと経過表の食事)。
//
// 記録の形は 1 人ずつ入れたときと同じにする。バイタルは buildVitalObservations、食事は
// buildMealIntakeBundle で作り、全員ぶんを 1 つの transaction にまとめる(上流は 1 トークン
// 300 件/分なので、患者ごとに送らない)。

/** 経過表一括入力に出せる列。施設設定(bulk_vital_entry.items)で選び、並べた順に出す。 */
export const BULK_VITAL_ITEMS = [
  "blood_pressure",
  "temperature",
  "pulse",
  "spo2",
  "oxygen_flow",
  "respiration",
  "jcs",
  "weight",
  "meal",
] as const;

export type BulkVitalItem = (typeof BULK_VITAL_ITEMS)[number];

export interface BulkVitalEntrySettings {
  items: BulkVitalItem[];
}

/** 施設設定の既定の列(backend の FacilitySettings::DEFAULT_BULK_VITAL_ENTRY と同じ)。 */
export const DEFAULT_BULK_VITAL_ENTRY: BulkVitalEntrySettings = {
  items: ["blood_pressure", "temperature", "pulse", "spo2", "respiration", "weight", "meal"],
};

/** 1 つの数値だけを入れるバイタルの列と、その測定項目(入力の欄の名前も同じ)。 */
const SINGLE_ITEM_MEASURE = {
  temperature: "temperature",
  pulse: "pulse",
  spo2: "spo2",
  oxygen_flow: "oxygenFlow",
  respiration: "respiration",
  weight: "weight",
} as const satisfies Partial<Record<BulkVitalItem, VitalMeasureKey>>;

type SingleVitalItem = keyof typeof SINGLE_ITEM_MEASURE;

function vitalMeasureOf(item: SingleVitalItem) {
  const measure = VITAL_MEASURES.find((m) => m.key === SINGLE_ITEM_MEASURE[item]);
  if (!measure) throw new Error(`unknown vital measure: ${item}`);
  return measure;
}

export const BULK_VITAL_ITEM_LABELS: Record<BulkVitalItem, string> = {
  blood_pressure: "血圧",
  temperature: vitalMeasureOf("temperature").label,
  pulse: vitalMeasureOf("pulse").label,
  spo2: vitalMeasureOf("spo2").label,
  oxygen_flow: vitalMeasureOf("oxygen_flow").label,
  respiration: vitalMeasureOf("respiration").label,
  jcs: JCS_MEASURE.label,
  weight: vitalMeasureOf("weight").label,
  meal: "食事摂取量",
};

export function isSingleVitalItem(item: BulkVitalItem): item is SingleVitalItem {
  return item in SINGLE_ITEM_MEASURE;
}

/** 単一値の列の入力の欄・単位・刻み・しきい値の LOINC。 */
export function singleVitalColumn(item: SingleVitalItem) {
  const measure = vitalMeasureOf(item);
  return { field: SINGLE_ITEM_MEASURE[item], code: measure.code, unit: measure.unit, step: measure.step };
}

export const SYSTOLIC_CODE = SYSTOLIC.code;
export const DIASTOLIC_CODE = DIASTOLIC.code;

/** 1 行の入力。空欄は「測っていない」。食事は 0〜10 割。 */
export interface BulkVitalInput {
  systolic: string;
  diastolic: string;
  temperature: string;
  pulse: string;
  spo2: string;
  oxygenFlow: string;
  respiration: string;
  /** JCS の値(JCS_OPTIONS の value)。 */
  jcs: string;
  weight: string;
  staple: string;
  side: string;
}

export type BulkVitalField = keyof BulkVitalInput;

const VITAL_FIELDS = [
  "systolic",
  "diastolic",
  "temperature",
  "pulse",
  "spo2",
  "oxygenFlow",
  "respiration",
  "jcs",
  "weight",
] as const satisfies readonly BulkVitalField[];

/** 数値で入れる欄(JCS は選択肢なので検査しない)。 */
const NUMBER_FIELDS = VITAL_FIELDS.filter((field) => field !== "jcs");

/** その時間帯の食事の枠と、記録済みの値(項目ごと)。食事の無い患者には作らない。 */
export interface BulkMealCell {
  slot: MealIntakeSlot;
  existing: Partial<Record<MealIntakeKind, { percent: number; observationId: string }>>;
}

/**
 * 患者ごとの、その日・時間帯の食事の枠。経過表と同じ判定(buildMealIntakeRows)を使うので、
 * 食事オーダーの無い日・食止め・欠食の食事には枠ができない。
 */
export function bulkMealCellsByPatient(args: {
  orders: fhir4.ServiceRequest[];
  observations: fhir4.Observation[];
  date: string;
  timing: MealTiming;
  fastingDietCodes: Set<string>;
}): Map<string, BulkMealCell> {
  const ordersByPatient = groupBySubject(args.orders);
  const observationsByPatient = groupBySubject(args.observations);
  const cells = new Map<string, BulkMealCell>();

  for (const [patientId, orders] of ordersByPatient) {
    const rows = buildMealIntakeRows({
      orders,
      observations: observationsByPatient.get(patientId) ?? [],
      days: [args.date],
      fastingDietCodes: args.fastingDietCodes,
    });
    const existing: BulkMealCell["existing"] = {};
    let slot: MealIntakeSlot | undefined;
    for (const row of rows) {
      const cell = row.cells.find((c) => c.slot.timing === args.timing);
      if (!cell) continue;
      slot = cell.slot;
      if (cell.percent !== undefined && cell.observationId) {
        existing[row.kind] = { percent: cell.percent, observationId: cell.observationId };
      }
    }
    if (slot) cells.set(patientId, { slot, existing });
  }
  return cells;
}

function groupBySubject<T extends { subject?: fhir4.Reference }>(resources: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const resource of resources) {
    const patientId = resource.subject?.reference?.match(/^Patient\/(.+)$/)?.[1];
    if (!patientId) continue;
    map.set(patientId, [...(map.get(patientId) ?? []), resource]);
  }
  return map;
}

/** 食事オーダーの食種コード(食止めの判定にマスタを引くのに使う)。 */
export function mealDietCodes(orders: fhir4.ServiceRequest[]): string[] {
  return orders.map((order) => mealOrderDietRef(order)?.code ?? "").filter(Boolean);
}

/** 記録済みの割(％ → 0〜10)。入力欄の初期値に使う。 */
export function mealExistingInput(cell: BulkMealCell | undefined, kind: MealIntakeKind): string {
  const percent = cell?.existing[kind]?.percent;
  return percent === undefined ? "" : String(percent / 10);
}

/**
 * 患者ごとの最新の身長(cm)。体重だけ入れたときの BMI に使う。
 * observations は測定日時の新しい順(`_sort=-date`)で渡す。
 */
export function latestHeightsByPatient(observations: fhir4.Observation[]): Map<string, number> {
  const heights = new Map<string, number>();
  for (const observation of observations) {
    const patientId = observation.subject?.reference?.match(/^Patient\/(.+)$/)?.[1];
    const value = observation.valueQuantity?.value;
    if (!patientId || typeof value !== "number" || heights.has(patientId)) continue;
    heights.set(patientId, value);
  }
  return heights;
}

function hasVitalValue(input: BulkVitalInput): boolean {
  return VITAL_FIELDS.some((field) => input[field].trim() !== "");
}

function mealChanged(input: BulkVitalInput, cell: BulkMealCell | undefined): boolean {
  if (!cell) return false;
  return MEAL_INTAKE_ROWS.some((row) => input[row.kind] !== mealExistingInput(cell, row.kind));
}

/** 登録の対象になる行か(バイタルを入れたか、食事を記録済みの値から変えたか)。 */
export function isBulkRowDirty(input: BulkVitalInput, cell: BulkMealCell | undefined): boolean {
  return hasVitalValue(input) || mealChanged(input, cell);
}

/** 行の入力の誤り。無ければ null。 */
export function bulkVitalRowError(input: BulkVitalInput): string | null {
  const systolic = input.systolic.trim();
  const diastolic = input.diastolic.trim();
  // 片方だけの血圧は「そのときの血圧」として読めない(1 人ずつの入力と同じ決まり)。
  if ((systolic === "") !== (diastolic === "")) return "血圧は収縮期と拡張期の両方を入力してください";
  const invalid = NUMBER_FIELDS.find((field) => {
    const raw = input[field].trim();
    return raw !== "" && !Number.isFinite(Number(raw));
  });
  return invalid ? "数値で入力してください" : null;
}

export interface BulkVitalRow {
  patientId: string;
  /** 測定時の入院。NEWS2 の通知の宛先(主治医)もここから取る。 */
  encounter?: fhir4.Encounter;
  input: BulkVitalInput;
  meal?: BulkMealCell;
  fallbackHeightCm?: number;
}

/**
 * 全員ぶんの登録を 1 つの transaction にする。バイタルは患者ごとに 1 回の測定として
 * identifier で束ね、食事は記録済みの値から変わった項目だけを書く(空にすれば消す)。
 */
export function buildBulkVitalBundle(args: {
  /** datetime-local の値。 */
  measuredAt: string;
  rows: BulkVitalRow[];
  performer: { id: string; name: string } | null;
  /** 早期警告スコア。施設設定で無効なら渡さない。 */
  earlyWarning?: {
    settings: EarlyWarningSettings;
    spo2Scale2PatientIds: Set<string>;
    /** 入院 id → 未対応の早期警告。 */
    tasksByEncounter: Map<string, fhir4.Task>;
  };
}): fhir4.Bundle {
  const performerRef = args.performer
    ? {
        reference: `Practitioner/${args.performer.id}`,
        ...(args.performer.name ? { display: args.performer.name } : {}),
      }
    : undefined;
  const entry: fhir4.BundleEntry[] = [];

  for (const row of args.rows) {
    const encounterRef = row.encounter?.id ? { reference: `Encounter/${row.encounter.id}` } : undefined;
    if (hasVitalValue(row.input)) {
      const values = { ...emptyVitalFormValues(), measuredAt: args.measuredAt };
      for (const field of VITAL_FIELDS) values[field] = row.input[field];
      const observations = buildVitalObservations({
        values,
        patientId: row.patientId,
        entryId: crypto.randomUUID(),
        problem: null,
        encounter: encounterRef,
        performer: performerRef,
        fallbackHeightCm: row.fallbackHeightCm,
      });
      const posts = withFullUrls(observations);
      entry.push(...posts.map(vitalPostEntry));
      if (args.earlyWarning) {
        const context: EarlyWarningContext = {
          settings: args.earlyWarning.settings,
          encounter: row.encounter,
          spo2Scale2: args.earlyWarning.spo2Scale2PatientIds.has(row.patientId),
          existingTask: row.encounter?.id ? args.earlyWarning.tasksByEncounter.get(row.encounter.id) : undefined,
        };
        entry.push(...earlyWarningEntries({ posts, values, patientId: row.patientId, context, requester: performerRef }));
      }
    }

    if (row.meal && mealChanged(row.input, row.meal)) {
      const meal = buildMealIntakeBundle({
        slot: row.meal.slot,
        input: { staple: row.input.staple, side: row.input.side },
        existing: {
          staple: row.meal.existing.staple?.observationId,
          side: row.meal.existing.side?.observationId,
        },
        subject: { reference: `Patient/${row.patientId}` },
        encounter: encounterRef,
        performer: args.performer,
      });
      entry.push(...(meal.entry ?? []));
    }
  }

  return { resourceType: "Bundle", type: "transaction", entry };
}

/** 測定時刻に近い食事。朝 10 時まで朝、15 時まで昼、それ以降は夕。 */
export function mealTimingAt(time: string): MealTiming {
  const hour = Number(time.slice(0, 2));
  if (hour < 10) return "breakfast";
  if (hour < 15) return "lunch";
  return "dinner";
}
