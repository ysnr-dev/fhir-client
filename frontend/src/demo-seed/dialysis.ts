// 維持血液透析。糖尿病性腎症から約 4 か月前に HD を導入し、火木土の午前に外来で通う。
// 導入前の外来 2 回(Cre の上昇)→ 透析オーダー(受付済)→ 毎回の実施記録(前後の体重・血圧・除水・QB/QD、
// ヘパリンと週 1 回のダルベポエチンは所定点数に含まれる薬剤としてロット番号つき)→ 浮腫が引いてドライウェイトを
// 2 回下げる → 透析中の血圧低下で 30 分短縮した回が 1 回。月初の透析前に採血し、リン吸着薬を足すと P が下がる。
// 直近 3 回と血圧低下の回には透析経過表(30 分毎のバイタル・装置の値・できごと)を付ける。
// 今日以降は 4 週ぶんを予約のまま残し(今日が透析日なら当日ボードで入室から進められる)、透析一覧・カルテの
// 実施履歴・患者帯の DW の見本にする。
//
// 透析室・ベッド・シフトは環境にあるものを使う。透析室が無ければ「透析室」とベッド 3 台を作る。
// 枠は選んだベッドの、この患者が使う日 × シフトの分だけ足す(透析室を作ったときは今日から 4 週の全シフト)。

import {
  at,
  createdOf,
  createPatient,
  createProblem,
  daysAgo,
  departmentOf,
  DrugMaster,
  findDisease,
  LabMaster,
  labResultBundle,
  post,
  prescriptionBundle,
  requesterOf,
  stampAuthoredOn,
  type RpSpec,
  type SeedEnv,
} from "./base";
import { createResource, searchResource } from "../api/fhirClient";
import { fetchFacilitySettings } from "../api/facilityClient";
import { searchBloodPurifiers } from "../api/masterClient";
import { addDays, toFhirDateTime, today } from "../lib/dates";
import { buildDialysisChartHub, DIALYSIS_CHART_SPEC } from "../fhir/dialysisChartHelpers";
import { buildChartEventObservation, buildChartPointObservations } from "../fhir/timeSeriesChartHelpers";
import {
  buildDialysisAppointmentBatchBundle,
  findDialysisSlot,
  type DialysisBooking,
} from "../fhir/dialysisAppointmentHelpers";
import {
  buildDialysisOrderBundle,
  emptyDialysisOrderForm,
  type DialysisMedicine,
  type DialysisOrderFormValues,
} from "../fhir/dialysisOrderHelpers";
import {
  buildDialysisFinishBundle,
  type DialysisPerformFormValues,
  type DialysisSession,
  initialDialysisPerformForm,
  type DialysisMedicineLine,
  type DryWeight,
} from "../fhir/dialysisResultHelpers";
import {
  DEFAULT_DIALYSIS_SHIFTS,
  dialysisPatternOccurrences,
  sortedDialysisShifts,
  type DialysisOccurrence,
  type DialysisShift,
} from "../fhir/dialysisShiftHelpers";
import { buildDialysisTaskUpdate } from "../fhir/dialysisTaskHelpers";
import {
  buildAddDialysisBedsBundle,
  buildDialysisUnit,
  DIALYSIS_LOCATION_TYPE,
  generateDialysisSlots,
  groupDialysisLocations,
  scheduleBedId,
} from "../fhir/dialysisUnitHelpers";
import { buildSlotCreateBundle, SERVICE_TYPE_SYSTEM } from "../fhir/scheduleHelpers";
import type { Medicine } from "../api/masterClient";

export const LAB = {
  cre: "160019210",
  bun: "160019010",
  k: "160021410",
  hb: "160008010-03",
  ip: "160021810",
  ca: "160021510",
  alb: "160018910",
};
export const MED = {
  heparin: "620004186",
  dialysate: "622054701",
  esa20: "622199701",
  esa30: "622199801",
  aml5: "620007818",
  lanthanum: "622552101",
};
const QD = "１日１回朝食後　服用";
const TID = "１日３回朝昼夕食後　服用";

/** 透析導入日(実行日からの日数)。 */
const INDUCTION_DAYS_AGO = 120;
/** 今日から何日先まで予約を入れるか。 */
const FUTURE_DAYS = 27;
const DAYS_OF_WEEK = ["tue", "thu", "sat"];
const DURATION_MINUTES = 240;

/** ドライウェイト(kg)。導入からの日数で下げる。 */
const DRY_WEIGHTS: [fromDay: number, kg: number][] = [
  [0, 66.0],
  [28, 65.0],
  [56, 64.5],
];
/** ダルベポエチンを 30μg から 20μg に減らす日(Hb が目標に届いた)。 */
const ESA_REDUCED_FROM = 70;
/** リン吸着薬を足す日。 */
const LANTHANUM_FROM = 30;
/** 透析中に血圧が下がって短縮した回(導入からの回数、0 始まり)。 */
const HYPOTENSION_SESSION = 21;

export const REQUIREMENTS = {
  labs: Object.values(LAB),
  medicines: Object.values(MED),
  usages: [QD, TID],
  diseases: ["２型糖尿病", "２型糖尿病性腎症", "末期腎不全", "腎性貧血", "高リン血症", "高血圧症"],
};

/** 透析前の採血。day は導入からの日数(負は導入前の外来)。 */
type Labs = [day: number, cre: number, bun: number, k: number, hb: number, ip: number, ca: number, alb: number];

const LABS: Labs[] = [
  [-56, 6.4, 68, 5.3, 9.4, 5.6, 8.6, 3.5],
  [-21, 7.9, 84, 5.8, 8.8, 6.4, 8.4, 3.3],
  // 導入後は月初の透析前。ESA で Hb が戻り、リン吸着薬で P が下がる。
  [2, 8.6, 76, 5.4, 8.9, 6.8, 8.3, 3.3],
  [30, 9.4, 70, 5.1, 9.8, 6.5, 8.5, 3.4],
  [58, 9.9, 66, 4.9, 10.6, 5.6, 8.7, 3.5],
  [86, 10.2, 64, 4.8, 11.1, 5.2, 8.8, 3.7],
  [114, 10.4, 62, 4.9, 11.0, 5.0, 8.9, 3.7],
];

/** 決まった揺らぎ(何度流しても同じ値)。-1〜1。 */
function wobble(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

function dryWeightOn(day: number): number {
  return DRY_WEIGHTS.filter(([from]) => from <= day).at(-1)?.[1] ?? DRY_WEIGHTS[0][1];
}

function dialysisMedicine(medicine: Medicine): DialysisMedicine {
  return { medicineCode: medicine.medicine_code, yjCode: medicine.yj_code ?? "", name: medicine.name };
}

// ---- 透析室・ベッド・枠 ----

interface Bed {
  bed: fhir4.Location;
  schedule: fhir4.Schedule;
}

async function searchAll<T extends fhir4.Resource>(type: string, params: Record<string, string>): Promise<T[]> {
  const { data } = await searchResource<T>(type, new URLSearchParams({ _count: "500", ...params }));
  return (data.entry ?? []).map((entry) => entry.resource).filter((r): r is T => r?.resourceType === type);
}

async function loadBeds(): Promise<{ beds: Bed[]; units: number }> {
  const [locations, schedules] = await Promise.all([
    searchAll<fhir4.Location>("Location", { type: DIALYSIS_LOCATION_TYPE.code }),
    searchAll<fhir4.Schedule>("Schedule", { "service-type": `${SERVICE_TYPE_SYSTEM}|dialysis` }),
  ]);
  const groups = groupDialysisLocations(locations).filter((group) => group.unit.status !== "inactive");
  const beds = groups.flatMap((group) =>
    group.beds.flatMap((bed) => {
      const schedule = schedules.find((s) => scheduleBedId(s) === bed.id && s.active !== false);
      return bed.status !== "inactive" && schedule ? [{ bed, schedule }] : [];
    }),
  );
  return { beds, units: groups.length };
}

async function postSlots(slots: fhir4.Slot[]): Promise<void> {
  for (let i = 0; i < slots.length; i += 200) await post(buildSlotCreateBundle(slots.slice(i, i + 200)));
}

/** 透析室が無ければ「透析室」とベッド 3 台を作り、今日から 4 週の枠を全シフトで作る。 */
async function ensureBeds(env: SeedEnv, shifts: DialysisShift[]): Promise<Bed[]> {
  const loaded = await loadBeds();
  if (loaded.beds.length > 0) return loaded.beds;
  if (loaded.units === 0) {
    const { data: unit } = await createResource(buildDialysisUnit("透析室"));
    await post(buildAddDialysisBedsBundle(unit, [], 3));
    env.log("透析室とベッド 3 台を作成");
  }
  const { beds } = await loadBeds();
  if (beds.length === 0) throw new Error("透析室に有効なベッドがありません");
  const slots = beds.flatMap(({ schedule }) =>
    generateDialysisSlots(schedule.id ?? "", shifts, today(), addDays(today(), FUTURE_DAYS), []),
  );
  await postSlots(slots);
  env.log(`透析の枠 ${slots.length} 件を作成`);
  return beds;
}

async function slotsOf(schedule: fhir4.Schedule, from: string, to: string): Promise<fhir4.Slot[]> {
  const params = new URLSearchParams({ schedule: `Schedule/${schedule.id}`, _count: "500", _sort: "start" });
  params.append("start", `ge${from}`);
  params.append("start", `lt${addDays(to, 1)}`);
  const { data } = await searchResource<fhir4.Slot>("Slot", params);
  return (data.entry ?? []).map((entry) => entry.resource).filter((r): r is fhir4.Slot => r?.resourceType === "Slot");
}

/** その回を取れないか(枠があって空いていない)。 */
function isTaken(slots: fhir4.Slot[], occurrence: DialysisOccurrence, shift: DialysisShift): boolean {
  const slot = findDialysisSlot(slots, occurrence.date, shift);
  return Boolean(slot && slot.status !== "free");
}

/** 取れない回のいちばん少ないベッド(同じ数なら並びの先)。 */
async function chooseBed(beds: Bed[], occurrences: DialysisOccurrence[], shift: DialysisShift, from: string, to: string) {
  let best: { bed: Bed; slots: fhir4.Slot[]; taken: number } | null = null;
  for (const bed of beds) {
    const slots = await slotsOf(bed.schedule, from, to);
    const taken = occurrences.filter((o) => isTaken(slots, o, shift)).length;
    if (!best || taken < best.taken) best = { bed, slots, taken };
    if (taken === 0) break;
  }
  if (!best) throw new Error("透析のベッドがありません");
  return best;
}

// ---- 実施記録 ----

interface SessionValues {
  index: number;
  day: number;
  occurrence: DialysisOccurrence;
}

function performValues(
  order: fhir4.ServiceRequest,
  appointment: fhir4.Appointment,
  dryWeight: DryWeight | null,
  drugs: DrugMaster,
  { index, day, occurrence }: SessionValues,
  shift: DialysisShift,
) {
  const values = initialDialysisPerformForm(order, undefined, appointment, dryWeight, `${today()}T23:59`);
  const dw = dryWeightOn(day);
  // 中 2 日空く火曜は体重の増えが大きい。導入直後は浮腫が残って多め。
  const gain = (occurrence.dayOfWeek === "tue" ? 2.6 : 1.8) + (day < 28 ? 0.5 : 0) + wobble(index) * 0.4;
  const pre = round1(dw + gain);
  const post = round1(dw + 0.1 + Math.abs(wobble(index + 100)) * 0.2);
  const trend = Math.max(0, 1 - day / 90);
  const preSystolic = Math.round(142 + 14 * trend + wobble(index + 200) * 6);
  const preDiastolic = Math.round(78 + 6 * trend + wobble(index + 300) * 4);
  const hypotension = index === HYPOTENSION_SESSION;
  const minutes = hypotension ? DURATION_MINUTES - 30 : DURATION_MINUTES;
  const startTime = `${occurrence.date}T${addMinutesHm(shift.start, 20)}`;

  const heparin: DialysisMedicineLine[] = values.medicines.map((line) => ({ ...line, dose: "1", unitName: "筒" }));
  const esaMedicines: DialysisMedicineLine[] =
    occurrence.dayOfWeek === "tue"
      ? [
          {
            ...dialysisMedicine(drugs.medicine(day >= ESA_REDUCED_FROM ? MED.esa20 : MED.esa30)),
            dose: "1",
            unitName: "筒",
            routeCode: "IV",
            lotNumber: day >= ESA_REDUCED_FROM ? "NE6-2609C" : "NE6-2606A",
            bundled: true,
          },
        ]
      : [];

  return {
    ...values,
    startAt: startTime,
    endAt: `${occurrence.date}T${addMinutesHm(shift.start, 20 + minutes)}`,
    preWeight: String(pre),
    preSystolic: String(preSystolic),
    preDiastolic: String(preDiastolic),
    postWeight: String(hypotension ? round1(post + 0.4) : post),
    ultrafiltration: String(round1(pre - (hypotension ? post + 0.4 : post))),
    postSystolic: String(hypotension ? 96 : preSystolic - 16 + Math.round(wobble(index + 400) * 6)),
    postDiastolic: String(hypotension ? 58 : preDiastolic - 8),
    medicines: [...heparin, ...esaMedicines],
    comment: hypotension
      ? "終了 40 分前に血圧 80 台まで低下、欠伸あり。除水を止めて生理食塩液 200mL を補液し、30 分短縮して終了。終了時の血圧は 96/58。"
      : "",
    dryWeight: String(dw),
  };
}

function addMinutesHm(hm: string, minutes: number): string {
  const [h, m] = hm.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(total / 60) % 24)}:${pad(total % 60)}`;
}

/** datetime-local に分を足す。 */
function addMinutesLocal(input: string, minutes: number): string {
  const date = new Date(`${input}:00`);
  date.setMinutes(date.getMinutes() + minutes);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * 1 回の透析経過表(ハブ + 30 分毎の打点 + できごと)を 1 transaction で作る。
 * 血圧は透析前から透析後へなだらかに下がり、血圧低下の回は 3 時間で急に下がって補液で戻る。
 */
function chartBundle(
  env: SeedEnv,
  patientId: string,
  hubId: string,
  values: DialysisPerformFormValues,
  index: number,
  hypotension: boolean,
): fhir4.Bundle {
  const session: DialysisSession = {
    hub: {
      resourceType: "Procedure",
      id: hubId,
      status: "completed",
      subject: { reference: `Patient/${patientId}` },
      performedPeriod: { start: toFhirDateTime(values.startAt), end: toFhirDateTime(values.endAt) },
    },
    observations: [],
    administrations: [],
    procedures: [],
  };
  const reference = `urn:uuid:${crypto.randomUUID()}`;
  const performer = { id: env.practitioner.id, name: env.practitioner.name };
  const minutes = Math.round((new Date(`${values.endAt}:00`).getTime() - new Date(`${values.startAt}:00`).getTime()) / 60000);
  const totalUf = Number(values.ultrafiltration);
  const pre = { s: Number(values.preSystolic), d: Number(values.preDiastolic) };
  const post = { s: Number(values.postSystolic), d: Number(values.postDiastolic) };
  const ufRate = Math.round((totalUf * 1000) / (minutes / 60));

  const point = (elapsed: number, systolic: number, diastolic: number, pulse: number, extra: Record<string, string> = {}) =>
    buildChartPointObservations(
      DIALYSIS_CHART_SPEC,
      {
        measuredAt: addMinutesLocal(values.startAt, elapsed),
        systolic: String(Math.round(systolic)),
        diastolic: String(Math.round(diastolic)),
        values: {
          pulse: String(Math.round(pulse)),
          qb: values.qb,
          qd: values.qd,
          "uf-rate": extra["uf-rate"] ?? String(ufRate),
          ultrafiltration: extra.ultrafiltration ?? String(round1(Math.min(totalUf, (totalUf * elapsed) / minutes))),
          "venous-pressure": String(Math.round(120 + wobble(index * 7 + elapsed) * 10)),
          tmp: String(Math.round(30 + elapsed / 30 + wobble(index * 11 + elapsed) * 4)),
        },
      },
      patientId,
      reference,
    );
  const event = (elapsed: number, code: string, note = "") =>
    buildChartEventObservation(DIALYSIS_CHART_SPEC, {
      patientId,
      hubReference: reference,
      code,
      occurredAt: addMinutesLocal(values.startAt, elapsed),
      note,
    });

  const observations: fhir4.Observation[] = [];
  for (let elapsed = 10; elapsed <= minutes - 10; elapsed += 30) {
    const ratio = elapsed / minutes;
    const drift = wobble(index * 13 + elapsed) * 5;
    if (hypotension && elapsed >= 180) {
      // 3 時間で血圧が落ち、除水を止めて補液し、終了まで戻りきらない。
      observations.push(...point(elapsed, 88 + drift, 50 + drift / 2, 104, { "uf-rate": "0", ultrafiltration: String(round1((totalUf * 180) / minutes)) }));
      continue;
    }
    observations.push(...point(elapsed, pre.s + (post.s - pre.s) * ratio + drift, pre.d + (post.d - pre.d) * ratio + drift / 2, 72 + wobble(index * 17 + elapsed) * 6));
  }
  observations.push(event(-8, "puncture"), event(minutes - 3, "blood-return"), event(minutes + 12, "hemostasis"));
  if (hypotension) {
    observations.push(
      event(178, "hypotension"),
      event(180, "uf-stop"),
      event(183, "fluid-bolus", "生食 200mL"),
      event(198, "uf-resume"),
    );
  }

  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: [
      {
        fullUrl: reference,
        resource: buildDialysisChartHub(session, performer, toFhirDateTime(addMinutesLocal(values.startAt, 10))),
        request: { method: "POST", url: "Procedure" },
      },
      ...observations.map((resource) => ({ resource, request: { method: "POST" as const, url: "Observation" } })),
    ],
  };
}

// ---- シナリオ ----

export async function seedDialysis(env: SeedEnv): Promise<void> {
  const patient = await createPatient(env, {
    familyKanji: "中村",
    givenKanji: "浩二",
    familyKana: "ナカムラ",
    givenKana: "コウジ",
    gender: "male",
    birthDate: "1957-04-22",
  });
  if (!patient?.id) return;
  const patientId = patient.id;
  const department = departmentOf(env, "腎臓内科", "透析", "内科");
  const requester = requesterOf(env, department);

  const labs = new LabMaster();
  await labs.load(Object.values(LAB));
  const drugs = new DrugMaster();
  await drugs.load(Object.values(MED), [QD, TID]);

  const induction = daysAgo(INDUCTION_DAYS_AGO);
  const dateOf = (day: number) => addDays(induction, day);

  // 病名
  await createProblem(patientId, 1, { disease: await findDisease("２型糖尿病"), start: addDays(induction, -5475) });
  const nephropathy = await createProblem(patientId, 2, {
    disease: await findDisease("２型糖尿病性腎症"),
    start: addDays(induction, -2190),
  });
  const esrd = await createProblem(patientId, 3, { disease: await findDisease("末期腎不全"), start: dateOf(-21) });
  await createProblem(patientId, 4, { disease: await findDisease("腎性貧血"), start: dateOf(-56) });
  const hyperphosphatemia = await createProblem(patientId, 5, {
    disease: await findDisease("高リン血症"),
    start: dateOf(LANTHANUM_FROM),
  });
  await createProblem(patientId, 6, { disease: await findDisease("高血圧症"), start: addDays(induction, -3650) });

  // 透析室・シフト・ベッド
  const settings = await fetchFacilitySettings().catch(() => null);
  const shifts = sortedDialysisShifts((settings?.dialysis_shifts ?? DEFAULT_DIALYSIS_SHIFTS).shifts);
  const shift = shifts.find((s) => s.code === "am") ?? shifts[0];
  if (!shift) throw new Error("透析のシフトがありません");
  const beds = await ensureBeds(env, shifts);
  const pattern = DAYS_OF_WEEK.map((dayOfWeek) => ({ dayOfWeek, shift: shift.code, shiftLabel: shift.label }));
  const lastDay = addDays(today(), FUTURE_DAYS);
  const occurrences = dialysisPatternOccurrences(pattern, induction, lastDay, shifts);
  const chosen = await chooseBed(beds, occurrences, shift, induction, lastDay);
  const usable = occurrences.filter((o) => !isTaken(chosen.slots, o, shift));
  if (chosen.taken > 0) env.log(`ベッド ${chosen.bed.bed.name} の ${chosen.taken} 回は枠が埋まっているので飛ばします`);
  const missing = usable.flatMap((o) =>
    findDialysisSlot(chosen.slots, o.date, shift)
      ? []
      : generateDialysisSlots(chosen.bed.schedule.id ?? "", [shift], o.date, o.date, []),
  );
  await postSlots(missing);
  const slots = missing.length > 0 ? await slotsOf(chosen.bed.schedule, induction, lastDay) : chosen.slots;

  // オーダー(導入日から継続、受付済)
  const purifier = (await searchBloodPurifiers({ kind: "dialyzer", active: true, per: 1 }).catch(() => null))?.items[0];
  const form: DialysisOrderFormValues = {
    ...emptyDialysisOrderForm("outpatient"),
    modality: "hd",
    startDate: induction,
    pattern,
    durationMinutes: String(DURATION_MINUTES),
    qb: "200",
    qd: "500",
    purifiers: [purifier ? { code: purifier.purifier_code, name: purifier.name } : { code: "", name: "ダイアライザ(PS 1.5㎡)" }],
    anticoagulant: dialysisMedicine(drugs.medicine(MED.heparin)),
    anticoagulantInitialDose: "1000",
    anticoagulantContinuousDose: "500",
    dialysate: dialysisMedicine(drugs.medicine(MED.dialysate)),
    accessType: "avf",
    accessSite: "左前腕",
    needle: "16G",
    problem: esrd,
  };
  const orderIds = await post(stampAuthoredOn(buildDialysisOrderBundle(form, patientId, requester), at(dateOf(-7), "15:00")));
  const [order] = (await createdOf(orderIds, "ServiceRequest")) as fhir4.ServiceRequest[];
  if (!order) throw new Error("透析オーダーが見つかりません");
  const task = buildDialysisTaskUpdate(undefined, order, "accepted");
  task.authoredOn = at(dateOf(-6), "10:00");
  task.lastModified = task.authoredOn;
  await post({ resourceType: "Bundle", type: "transaction", entry: [{ resource: task, request: { method: "POST", url: "Task" } }] });

  // 予約(導入日から 4 週先まで)
  const bookings: DialysisBooking[] = usable.flatMap((o) => {
    const slot = findDialysisSlot(slots, o.date, shift);
    return slot?.status === "free"
      ? [{ schedule: chosen.bed.schedule, slot, shift: { code: shift.code, label: shift.label } }]
      : [];
  });
  const appointments: fhir4.Appointment[] = [];
  for (let i = 0; i < bookings.length; i += 20) {
    const ids = await post(buildDialysisAppointmentBatchBundle(patient, order.id ?? "", bookings.slice(i, i + 20)));
    appointments.push(...((await createdOf(ids, "Appointment")) as fhir4.Appointment[]));
  }
  const appointmentBySlot = new Map(
    appointments.map((a) => [a.slot?.[0]?.reference?.split("/").pop() ?? "", a] as const),
  );

  // 実施記録(昨日まで)。ドライウェイトは見直した回だけ記録される。直近 3 回と血圧低下の回には経過表を付ける。
  const pastCount = bookings.filter((booking) => booking.slot.start.slice(0, 10) < today()).length;
  let dryWeight: DryWeight | null = null;
  let performed = 0;
  let charted = 0;
  for (const booking of bookings) {
    const date = booking.slot.start.slice(0, 10);
    if (date >= today()) break;
    const appointment = appointmentBySlot.get(booking.slot.id ?? "");
    const occurrence = usable.find((o) => o.date === date);
    if (!appointment || !occurrence) continue;
    const day = Math.round((new Date(`${date}T00:00:00`).getTime() - new Date(`${induction}T00:00:00`).getTime()) / 86400000);
    const values = performValues(order, appointment, dryWeight, drugs, { index: performed, day, occurrence }, shift);
    const ids = await post(
      buildDialysisFinishBundle(
        { order, appointment, performer: { id: env.practitioner.id, name: env.practitioner.name } },
        values,
        dryWeight,
      ),
    );
    const hubId = ids.find((entry) => entry.type === "Procedure")?.id;
    const hypotension = performed === HYPOTENSION_SESSION;
    if (hubId && (hypotension || performed >= pastCount - 3)) {
      await post(chartBundle(env, patientId, hubId, values, performed, hypotension));
      charted += 1;
    }
    dryWeight = { value: Number(values.dryWeight), date };
    performed += 1;
  }

  // 月初の採血と、外来の処方(4 週ごと)
  // 導入後の採血は、その日以降で最初の透析の日(透析前に採る)。
  const sessionDates = usable.map((o) => o.date);
  for (const [day, cre, bun, k, hb, ip, ca, alb] of LABS) {
    const date = day < 0 ? dateOf(day) : sessionDates.find((d) => d >= dateOf(day));
    if (!date || date >= today()) continue;
    const bundle = labResultBundle(env, labs, patient, department, date, [
      [LAB.cre, cre],
      [LAB.bun, bun],
      [LAB.k, k],
      [LAB.hb, hb],
      [LAB.ip, ip],
      [LAB.ca, ca],
      [LAB.alb, alb],
    ]);
    const rps: RpSpec[] = [{ usage: QD, days: 28, medicines: [[MED.aml5, 1]] }];
    if (day >= LANTHANUM_FROM) rps.push({ usage: TID, days: 28, medicines: [[MED.lanthanum, 3]] });
    const rx = prescriptionBundle(drugs, patientId, requester, date, rps, day >= LANTHANUM_FROM ? hyperphosphatemia : nephropathy);
    await post({ resourceType: "Bundle", type: "transaction", entry: [...(bundle?.entry ?? []), ...(rx.entry ?? [])] });
  }

  const upcoming = bookings.length - performed;
  const todayNote = usable.some((o) => o.date === today()) ? "(今日の回は予約のまま)" : "";
  env.log(`透析: ベッド ${chosen.bed.bed.name}・実施 ${performed} 回(経過表 ${charted} 回)・予約 ${upcoming} 回${todayNote}`);
}
