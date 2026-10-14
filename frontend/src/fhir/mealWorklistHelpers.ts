/**
 * 給食部門の食事一覧と食数集計(docs/meal-order-design.md §5.2)。
 *
 * 行の元はその日の入院(Encounter)で、食事オーダーはその患者の分を当てる。オーダーから
 * 行を作らないのは、退院済み患者に終了の無いオーダーが残っていても出さないためと、
 * 入院中なのに食事オーダーが無い患者を「オーダーなし」として見せるため。
 */

import {
  encounterBedId,
  encounterBedLabel,
  encounterDischargeDate,
  encounterAdmissionDate,
  encounterPatientId,
} from "./encounterHelpers";
import {
  MEAL_SKIPPED,
  MEAL_TIMING_OPTIONS,
  mealFastingReasonLabel,
  mealOrderAt,
  mealOrderDietRef,
  mealOrderDietName,
  mealPointKey,
  mealPointKeyOf,
  mealSaltLimitLabel,
  mealSideDishForm,
  mealOrderAllergies,
  parseMealStaples,
  type MealTiming,
} from "./mealOrderHelpers";
import { orderComment, referenceId } from "./shared";

/** ベッド id から引く病棟・病室(useBedWardIndex の値のうち、一覧に要るところ)。 */
export interface MealWorklistBedWard {
  wardId: string;
  wardName: string;
}

/** 1 食ぶんの中身。オーダーの無い食事は null。 */
export interface MealWorklistCell {
  order: fhir4.ServiceRequest;
  dietCode: string;
  dietName: string;
  /** 主食の名称。指定が無ければ空。 */
  stapleName: string;
  stapleCode: string;
  /** その食事だけ出さない(欠食)。 */
  skipped: boolean;
  /** その食事からオーダーが始まった(食事が変わった)。 */
  changed: boolean;
}

export interface MealWorklistRow {
  encounter: fhir4.Encounter;
  patientId: string;
  patient?: fhir4.Patient;
  wardId: string;
  wardName: string;
  bedLabel: string;
  cells: Record<MealTiming, MealWorklistCell | null>;
  /** その日に入院した / 退院した。 */
  admittedToday: boolean;
  dischargedToday: boolean;
  /** その日のどの食事にもオーダーが無い。 */
  noOrder: boolean;
  /** 副食形態・塩分制限・アレルギー・欠食理由・コメント。その日のオーダーの値を重複なく並べる。 */
  sideDishForm: string;
  saltLimit: string;
  allergy: string;
  fastingReason: string;
  comment: string;
}

/** 文字列を重複なく「、」でつなぐ(1 日の途中で食事が変わり、値が 2 つになる日のため)。 */
function joinDistinct(values: string[]): string {
  return [...new Set(values.filter(Boolean))].join("、");
}

function cellOf(
  orders: fhir4.ServiceRequest[],
  date: string,
  timing: MealTiming,
): MealWorklistCell | null {
  const order = mealOrderAt(orders, date, timing);
  if (!order) return null;
  const staple = parseMealStaples(order)[timing];
  return {
    order,
    dietCode: mealOrderDietRef(order)?.code ?? "",
    dietName: mealOrderDietName(order),
    stapleName: staple && staple !== MEAL_SKIPPED ? staple.name : "",
    stapleCode: staple && staple !== MEAL_SKIPPED ? staple.code : "",
    skipped: staple === MEAL_SKIPPED,
    changed: mealPointKeyOf(order.occurrenceDateTime ?? "") === mealPointKey(date, timing),
  };
}

/**
 * 病棟・病室・ベッド順の行。同じ患者の入院が 2 つ重なる日(転棟の付け替えなど)は
 * 後に始まった入院を採る。
 */
export function buildMealWorklist(input: {
  date: string;
  encounters: fhir4.Encounter[];
  patientsById: Map<string, fhir4.Patient>;
  orders: fhir4.ServiceRequest[];
  bedWards: Map<string, MealWorklistBedWard>;
}): MealWorklistRow[] {
  const { date, encounters, patientsById, orders, bedWards } = input;

  const ordersByPatient = new Map<string, fhir4.ServiceRequest[]>();
  for (const order of orders) {
    const patientId = referenceId(order.subject?.reference);
    if (!patientId) continue;
    const list = ordersByPatient.get(patientId);
    if (list) list.push(order);
    else ordersByPatient.set(patientId, [order]);
  }

  const encounterByPatient = new Map<string, fhir4.Encounter>();
  for (const encounter of encounters) {
    const patientId = encounterPatientId(encounter);
    if (!patientId) continue;
    const current = encounterByPatient.get(patientId);
    if (!current || (encounter.period?.start ?? "") > (current.period?.start ?? "")) {
      encounterByPatient.set(patientId, encounter);
    }
  }

  const rows: MealWorklistRow[] = [];
  for (const [patientId, encounter] of encounterByPatient) {
    const patientOrders = ordersByPatient.get(patientId) ?? [];
    const cells = {} as Record<MealTiming, MealWorklistCell | null>;
    for (const timing of MEAL_TIMING_OPTIONS) {
      cells[timing.code] = cellOf(patientOrders, date, timing.code);
    }
    const dayOrders = [
      ...new Set(
        MEAL_TIMING_OPTIONS.map((t) => cells[t.code]?.order).filter(
          (o): o is fhir4.ServiceRequest => Boolean(o),
        ),
      ),
    ];
    const bedId = encounterBedId(encounter);
    const ward = bedId ? bedWards.get(bedId) : undefined;

    rows.push({
      encounter,
      patientId,
      patient: patientsById.get(patientId),
      wardId: ward?.wardId ?? "",
      wardName: ward?.wardName ?? "",
      bedLabel: encounterBedLabel(encounter),
      cells,
      admittedToday: encounterAdmissionDate(encounter) === date,
      dischargedToday: encounterDischargeDate(encounter) === date,
      noOrder: dayOrders.length === 0,
      sideDishForm: joinDistinct(dayOrders.map((o) => mealSideDishForm(o)?.name ?? "")),
      saltLimit: joinDistinct(dayOrders.map(mealSaltLimitLabel)),
      allergy: joinDistinct(
        dayOrders.flatMap((o) => mealOrderAllergies(o).map((allergy) => allergy.name)),
      ),
      fastingReason: joinDistinct(dayOrders.map(mealFastingReasonLabel)),
      comment: joinDistinct(dayOrders.map(orderComment)),
    });
  }

  return rows.sort(
    (a, b) =>
      a.wardName.localeCompare(b.wardName, "ja") ||
      a.bedLabel.localeCompare(b.bedLabel, "ja", { numeric: true }),
  );
}

// ---- 食数集計 ----

/** 集計の 1 行(食種または主食)。食事ごとの食数。 */
export interface MealCountRow {
  key: string;
  label: string;
  counts: Record<MealTiming, number>;
  total: number;
}

function emptyCounts(): Record<MealTiming, number> {
  return { breakfast: 0, lunch: 0, dinner: 0 };
}

function addCount(
  rows: Map<string, MealCountRow>,
  key: string,
  label: string,
  timing: MealTiming,
): void {
  let row = rows.get(key);
  if (!row) {
    row = { key, label, counts: emptyCounts(), total: 0 };
    rows.set(key, row);
  }
  row.counts[timing] += 1;
  row.total += 1;
}

export interface MealCountSummary {
  /** 食種ごと。欠食は食種に数えず skipped に入れる。 */
  diets: MealCountRow[];
  /** 主食ごと。主食を指定していない食事は数えない。 */
  staples: MealCountRow[];
  /** 出す食事の数(欠食・オーダーなしを除く)。食止めは食種として数えるのでここに入る。 */
  served: Record<MealTiming, number>;
  skipped: Record<MealTiming, number>;
  /** 入院中なのにその食事のオーダーが無い。 */
  noOrder: Record<MealTiming, number>;
}

/** 食種・主食ごとの食数。並びはマスタの表示順に合わせられるよう、呼び出し側の順序表で並べ替える。 */
export function countMeals(
  rows: MealWorklistRow[],
  dietOrder: Map<string, number> = new Map(),
  stapleOrder: Map<string, number> = new Map(),
): MealCountSummary {
  const diets = new Map<string, MealCountRow>();
  const staples = new Map<string, MealCountRow>();
  const served = emptyCounts();
  const skipped = emptyCounts();
  const noOrder = emptyCounts();

  for (const row of rows) {
    for (const timing of MEAL_TIMING_OPTIONS) {
      const cell = row.cells[timing.code];
      if (!cell) {
        noOrder[timing.code] += 1;
        continue;
      }
      if (cell.skipped) {
        skipped[timing.code] += 1;
        continue;
      }
      served[timing.code] += 1;
      addCount(diets, cell.dietCode || cell.dietName, cell.dietName, timing.code);
      if (cell.stapleName) {
        addCount(staples, cell.stapleCode || cell.stapleName, cell.stapleName, timing.code);
      }
    }
  }

  const sortBy = (order: Map<string, number>) => (a: MealCountRow, b: MealCountRow) =>
    (order.get(a.key) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.key) ?? Number.MAX_SAFE_INTEGER) ||
    a.label.localeCompare(b.label, "ja");

  return {
    diets: [...diets.values()].sort(sortBy(dietOrder)),
    staples: [...staples.values()].sort(sortBy(stapleOrder)),
    served,
    skipped,
    noOrder,
  };
}
