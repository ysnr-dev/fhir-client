// 直腸癌。約 1 年半の経過。血便で受診 → 内視鏡・造影 CT → 直腸癌確定 → 術前化学放射線療法
// (45Gy/25 回 + カペシタビン)→ 低位前方切除術 → 術後補助化学療法(CapeOX 8 コース)→
// 経過観察中に CEA が上がって肝転移再発 → 二次治療(FOLFIRI)で CEA が下がり始めている。
// 血算・肝機能は化学療法に合わせて下がる。

import {
  at,
  createPatient,
  createProblem,
  createStay,
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
  vitalEntries,
  weekday,
  type Named,
  type SeedEnv,
} from "./base";
import { addDays } from "../lib/dates";
import { searchResource } from "../api/fhirClient";
import {
  fetchRegimen,
  radiotherapyDeviceClient,
  radiotherapyModalityClient,
  radiotherapyProtocolClient,
  radiotherapyTechniqueClient,
  searchEndoscopyItems,
  searchMedicineDoseConversions,
  searchRadItems,
  searchSurgeryItems,
  type RegimenDetail,
} from "../api/masterClient";
import type { OrderContext } from "../orderContext";
import type { ProblemRef } from "../fhir/conditionHelpers";
import { CATEGORY_OPTIONS as PRESCRIPTION_CATEGORY_OPTIONS } from "../fhir/prescriptionHelpers";
import { CATEGORY_OPTIONS as INJECTION_CATEGORY_OPTIONS } from "../fhir/injectionHelpers";
import { buildEndoscopyOrderBundle, emptyEndoscopyOrderForm } from "../fhir/endoscopyOrderHelpers";
import { buildEndoscopyPerformBundle } from "../fhir/endoscopyResultHelpers";
import { buildRadOrderBundle, emptyRadOrderForm } from "../fhir/radOrderHelpers";
import { buildRadPerformBundle } from "../fhir/radResultHelpers";
import { buildSurgeryOrderBundle, emptySurgeryOrderForm, type SurgeryOrderItemLine } from "../fhir/surgeryOrderHelpers";
import { buildSurgeryPerformBundle, emptySurgeryPerformForm } from "../fhir/surgeryResultHelpers";
import {
  applyRadiotherapyProtocol,
  buildRadiotherapyOrderBundle,
  emptyRadiotherapyOrderForm,
  summarizeRadiotherapyOrder,
} from "../fhir/radiotherapyOrderHelpers";
import { buildRadiotherapyFractionBundle } from "../fhir/radiotherapyResultHelpers";
import {
  bsaOf,
  buildRegimenApplicationBundle,
  buildRegimenCycleBundle,
  parseRegimenApplication,
  planSteps,
  validateRegimenApply,
  type DoseFactorMap,
  type RegimenApplyValues,
} from "../fhir/regimenOrderHelpers";

const LAB = {
  wbc: "160008010-01",
  hb: "160008010-03",
  plt: "160008010-05",
  ast: "160022510",
  alt: "160022610",
  cre: "160019210",
  cea: "160036510",
  ca199: "160037210",
};
const CAPECITABINE = "610470009";
const BID = "１日２回朝夕食後　服用";
const START_DAYS_AGO = 560;
const HEIGHT = 158;

type Labs = Partial<Record<keyof typeof LAB, number>>;

/** 検査の日と値。day は初診からの日数。 */
const LAB_DAYS: [day: number, labs: Labs][] = [
  [0, { wbc: 6.8, hb: 10.6, plt: 312, ast: 22, alt: 18, cre: 0.68, cea: 14.2, ca199: 52 }],
  [42, { wbc: 5.1, hb: 10.9, plt: 250, ast: 24, alt: 20, cre: 0.7, cea: 9.8, ca199: 38 }],
  [56, { wbc: 4.3, hb: 11.2, plt: 210, ast: 25, alt: 22, cre: 0.71, cea: 7.2, ca199: 30 }],
  [105, { wbc: 5.8, hb: 11.6, plt: 238, ast: 21, alt: 17, cre: 0.69, cea: 4.8, ca199: 24 }],
  [119, { wbc: 8.9, hb: 10.1, plt: 286, ast: 30, alt: 28, cre: 0.72, cea: 3.1, ca199: 20 }],
  // 術後補助 CapeOX の各コース Day 1
  [154, { wbc: 6.2, hb: 11.8, plt: 245, ast: 24, alt: 20, cre: 0.7, cea: 2.9, ca199: 24 }],
  [175, { wbc: 4.8, hb: 11.5, plt: 198, ast: 28, alt: 26, cre: 0.71, cea: 2.6, ca199: 21 }],
  [196, { wbc: 4.1, hb: 11.2, plt: 176, ast: 31, alt: 30, cre: 0.72, cea: 2.4, ca199: 18 }],
  [217, { wbc: 3.9, hb: 11.0, plt: 160, ast: 34, alt: 33, cre: 0.73, cea: 2.3, ca199: 17 }],
  [238, { wbc: 3.6, hb: 10.9, plt: 142, ast: 36, alt: 35, cre: 0.74, cea: 2.2, ca199: 16 }],
  [259, { wbc: 3.8, hb: 11.1, plt: 150, ast: 33, alt: 31, cre: 0.73, cea: 2.4, ca199: 17 }],
  [280, { wbc: 3.4, hb: 10.8, plt: 138, ast: 38, alt: 36, cre: 0.74, cea: 2.3, ca199: 16 }],
  [301, { wbc: 3.5, hb: 10.9, plt: 146, ast: 35, alt: 33, cre: 0.73, cea: 2.2, ca199: 15 }],
  // 経過観察 → CEA 上昇
  [360, { wbc: 5.4, hb: 12.0, plt: 212, ast: 22, alt: 18, cre: 0.7, cea: 2.8, ca199: 18 }],
  [420, { wbc: 5.6, hb: 12.1, plt: 220, ast: 26, alt: 22, cre: 0.71, cea: 4.9, ca199: 34 }],
  [445, { wbc: 5.9, hb: 11.9, plt: 228, ast: 34, alt: 30, cre: 0.7, cea: 8.6, ca199: 58 }],
  // FOLFIRI の各コース Day 1
  [466, { wbc: 5.6, hb: 11.6, plt: 230, ast: 36, alt: 32, cre: 0.71, cea: 9.4, ca199: 64 }],
  [480, { wbc: 4.2, hb: 11.2, plt: 205, ast: 34, alt: 30, cre: 0.72, cea: 8.1, ca199: 55 }],
  [494, { wbc: 3.6, hb: 10.8, plt: 190, ast: 31, alt: 28, cre: 0.72, cea: 7.0, ca199: 47 }],
  [508, { wbc: 3.9, hb: 10.9, plt: 198, ast: 29, alt: 25, cre: 0.71, cea: 6.2, ca199: 41 }],
  [522, { wbc: 3.3, hb: 10.6, plt: 182, ast: 27, alt: 24, cre: 0.72, cea: 5.4, ca199: 36 }],
  [536, { wbc: 3.7, hb: 10.8, plt: 188, ast: 26, alt: 22, cre: 0.71, cea: 4.9, ca199: 32 }],
];

const WEIGHT: [day: number, weight: number][] = [
  [0, 58.4], [42, 57.6], [56, 57.1], [105, 57.4], [119, 55.8], [154, 56.2], [196, 55.9], [238, 55.4], [280, 55.1],
  [301, 55.2], [360, 56.0], [420, 56.3], [445, 55.8], [466, 55.6], [494, 55.0], [522, 54.6], [536, 54.5],
];

async function createdOf(ids: { type: string; id: string }[], type: string): Promise<fhir4.Resource[]> {
  const wanted = ids.filter((entry) => entry.type === type).map((entry) => entry.id);
  if (wanted.length === 0) return [];
  const { data } = await searchResource<fhir4.Resource>(type, new URLSearchParams({ _id: wanted.join(",") }));
  return (data.entry ?? []).map((e) => e.resource).filter((r): r is fhir4.Resource => Boolean(r));
}

/** オーダーのヘッダ(明細から basedOn で指される側)。 */
async function headerOf(ids: { type: string; id: string }[]): Promise<fhir4.ServiceRequest> {
  const requests = (await createdOf(ids, "ServiceRequest")) as fhir4.ServiceRequest[];
  const header = requests.find((sr) => !sr.basedOn?.length) ?? requests[0];
  if (!header) throw new Error("オーダーのヘッダが見つかりません");
  return header;
}

async function endoscopy(env: SeedEnv, patientId: string, requester: OrderContext, problem: ProblemRef, date: string) {
  const item = (await searchEndoscyItemsSafe("大腸内視鏡検査(全大腸)"))[0];
  if (!item) return env.log("内視鏡マスタに大腸内視鏡が無いので飛ばします");
  const values = {
    ...emptyEndoscopyOrderForm(problem, "outpatient"),
    startDate: date,
    items: [
      {
        id: "",
        code: item.item_code,
        name: item.name,
        shortName: item.short_name ?? "",
        examTypeCode: item.exam_type_code ?? "",
        examTypeName: "",
        reasonConditionId: problem.conditionId,
        reasonName: problem.display,
        purpose: "血便の精査",
        remarks: "",
        purposeTemplate: null,
        remarksTemplate: null,
        parentCode: "",
        groupable: item.groupable,
        date,
        time: "",
        priority: "routine" as const,
      },
    ],
  };
  const order = await headerOf(await post(stampAuthoredOn(buildEndoscopyOrderBundle(values, patientId, requester), at(date))));
  await post(
    buildEndoscopyPerformBundle(
      {
        performedAt: `${date}T10:00`,
        performerId: env.practitioner.id,
        performerName: env.practitioner.name,
        procedures: [{ code: item.item_code, name: item.name }],
        medicines: [],
        materials: [],
        comment: "直腸(Ra)に 1/2 周性の 2 型腫瘍。生検を提出。",
      },
      order,
      undefined,
    ),
  );
}

async function searchEndoscyItemsSafe(name: string) {
  const result = await searchEndoscopyItems({ keyword: "大腸内視鏡", per: 20 }).catch(() => ({ items: [] }));
  return [...result.items.filter((i) => i.name === name), ...result.items];
}

async function contrastCt(env: SeedEnv, patientId: string, requester: OrderContext, problem: ProblemRef, date: string, comment: string) {
  const result = await searchRadItems({ keyword: "造影腹部", per: 20 }).catch(() => ({ items: [] }));
  const item = result.items.find((i) => i.name.includes("造影") && i.name.endsWith("腹部")) ?? result.items[0];
  if (!item) return env.log("放射線マスタに造影 CT が無いので飛ばします");
  const values = {
    ...emptyRadOrderForm(problem, "outpatient"),
    startDate: date,
    items: [
      {
        id: "",
        code: item.item_code,
        name: item.name,
        shortName: item.short_name ?? "",
        jj1017Code: item.jj1017_code ?? "",
        modalityCode: item.modality_code ?? "",
        modalityName: "",
        bodyPartCode: item.body_part_code ?? "",
        bodyPartName: "",
        lateralityCode: item.laterality_code ?? "",
        lateralityName: "",
        reasonConditionId: problem.conditionId,
        reasonName: problem.display,
        purpose: comment,
        remarks: "",
        purposeTemplate: null,
        remarksTemplate: null,
        parentCode: "",
        groupable: item.groupable,
        date,
        time: "",
        priority: "routine" as const,
      },
    ],
  };
  const order = await headerOf(await post(stampAuthoredOn(buildRadOrderBundle(values, patientId, requester), at(date))));
  await post(
    buildRadPerformBundle(
      {
        performedAt: `${date}T11:00`,
        performerId: env.practitioner.id,
        performerName: env.practitioner.name,
        procedures: [{ code: item.item_code, name: item.name }],
        contrasts: [],
        materials: [],
        doses: {},
        comment: "",
      },
      order,
      undefined,
    ),
  );
}

async function radiotherapy(env: SeedEnv, patientId: string, requester: OrderContext, problem: ProblemRef, start: string) {
  const protocols = await radiotherapyProtocolClient.search({ code: "RT-RECTUM-PRE-45", per: 5 }).catch(() => ({ items: [] }));
  const protocol = protocols.items.find((p) => p.code === "RT-RECTUM-PRE-45");
  if (!protocol) return env.log("放射線治療のプロトコル(直腸癌 術前)が無いので飛ばします");
  const [modalities, techniques, devices] = await Promise.all([
    radiotherapyModalityClient.search({ per: 100 }),
    radiotherapyTechniqueClient.search({ per: 100 }),
    radiotherapyDeviceClient.search({ per: 100 }),
  ]);
  const values = applyRadiotherapyProtocol(
    {
      ...emptyRadiotherapyOrderForm("outpatient"),
      startDate: start,
      problem,
      practitionerId: env.practitioner.id,
      practitionerName: env.practitioner.name,
      concurrentTherapy: "カペシタビン併用",
    },
    protocol,
    { modalities: modalities.items, techniques: techniques.items, devices: devices.items },
  );
  const device = devices.items[0];
  if (device) values.phases = values.phases.map((phase) => (phase.device.code ? phase : { ...phase, device: { code: device.code, name: device.name } }));
  const order = await headerOf(await post(stampAuthoredOn(buildRadiotherapyOrderBundle(values, patientId, requester), at(start))));
  const phase = summarizeRadiotherapyOrder(order).phases[0];
  const entries: fhir4.BundleEntry[] = [];
  let date = weekday(start);
  for (let n = 1; n <= 25; n += 1) {
    const bundle = buildRadiotherapyFractionBundle(
      {
        performedDate: date,
        startTime: "10:00",
        endTime: "10:12",
        phaseId: phase.phaseId,
        fractionNumber: String(n),
        doses: Object.fromEntries(phase.doses.map((dose) => [dose.volumeId, String(dose.fractionDose)])),
        device: { code: phase.deviceCode, name: phase.deviceName },
        imageGuidance: "",
        performerId: env.practitioner.id,
        performerName: env.practitioner.name,
        note: "",
      },
      order,
    );
    entries.push(...(bundle.entry ?? []));
    date = weekday(addDays(date, 1));
  }
  await post({ resourceType: "Bundle", type: "transaction", entry: entries });
}

async function surgery(
  env: SeedEnv,
  patientId: string,
  requester: OrderContext,
  surgical: Named,
  problem: ProblemRef,
  date: string,
) {
  const found = (await searchSurgeryItems({ keyword: "直腸", per: 20 }).catch(() => ({ items: [] }))).items[0];
  const line: SurgeryOrderItemLine = {
    id: "",
    code: found?.item_code ?? "150316310",
    name: found?.name ?? "腹腔鏡下直腸切除・切断術（低位前方切除術）",
    shortName: "",
    receiptCode: found?.receipt_code ?? "150316310",
    bodySiteText: "直腸(Ra)",
    laterality: "",
    approach: "",
    reasonConditionId: problem.conditionId,
    reasonName: problem.display,
  };
  const room = env.locations.find((l) => l.name.includes("手術室"));
  const staff = [{ role: "surgeon" as const, practitionerId: env.practitioner.id, practitionerName: env.practitioner.name }];
  const values = {
    ...emptySurgeryOrderForm(problem, "inpatient"),
    scheduledDate: date,
    scheduledTime: "09:00",
    durationMinutes: "300",
    roomId: room?.id ?? "",
    roomName: room?.name ?? "",
    surgicalDepartmentId: surgical.id,
    surgicalDepartmentName: surgical.name,
    staff,
    items: [line],
  };
  const order = await headerOf(await post(stampAuthoredOn(buildSurgeryOrderBundle(values, patientId, requester), at(addDays(date, -14)))));
  await post(
    buildSurgeryPerformBundle(
      {
        ...emptySurgeryPerformForm(),
        enteredAt: `${date}T08:50`,
        exitedAt: `${date}T14:40`,
        staff,
        procedures: [{ code: line.code, name: line.name }],
      },
      order,
      undefined,
    ),
  );
}

interface RegimenCourse {
  code: string;
  start: string;
  /** コースごとの Day 1。1 回の登録は 3 コースまでなので分けて送る。 */
  cycleStarts: string[];
  weight: number;
}

async function doseFactors(regimen: RegimenDetail): Promise<DoseFactorMap> {
  const codes = [...new Set(regimen.steps.flatMap((step) => step.drugs.map((drug) => drug.medicine_code)).filter(Boolean))];
  const factors: DoseFactorMap = new Map();
  if (codes.length === 0) return factors;
  const result = await searchMedicineDoseConversions({ medicine_code: codes.join(","), per: 100 });
  for (const row of result.items) {
    const factor = Number(row.factor);
    if (!(factor > 0)) continue;
    const byUnit = factors.get(row.medicine_code) ?? new Map<string, number>();
    byUnit.set(row.from_unit, factor);
    factors.set(row.medicine_code, byUnit);
  }
  return factors;
}

async function chemotherapy(env: SeedEnv, patientId: string, requester: OrderContext, problem: ProblemRef, course: RegimenCourse) {
  const regimen = await fetchRegimen(course.code).catch(() => null);
  if (!regimen) return env.log(`レジメン ${course.code} が無いので飛ばします`);
  const factors = await doseFactors(regimen);
  const height = String(HEIGHT);
  const weight = String(course.weight);
  const bsa = bsaOf({ height, weight });
  const base: RegimenApplyValues = {
    startDate: course.cycleStarts[0],
    firstCycle: 1,
    cycleCount: "1",
    plannedCycles: String(course.cycleStarts.length),
    setting: "outpatient",
    injectionCategory: INJECTION_CATEGORY_OPTIONS.outpatient[0].code,
    prescriptionCategory: PRESCRIPTION_CATEGORY_OPTIONS.outpatient[0].code,
    problem,
    height,
    weight,
    gfr: "",
    gfrSource: "egfr",
    comment: "",
    reductionReason: "",
    carryOver: false,
    steps: planSteps(regimen, { bsa, weight: course.weight, gfr: null }, factors),
  };
  // 3 コースずつ登録する(1 回に登録できる上限)。2 回目以降は最初の適用に続けて足す。
  let application: ReturnType<typeof parseRegimenApplication> = null;
  for (let first = 0; first < course.cycleStarts.length; first += 3) {
    const count = Math.min(3, course.cycleStarts.length - first);
    const values = { ...base, startDate: course.cycleStarts[first], firstCycle: first + 1, cycleCount: String(count) };
    const invalid = validateRegimenApply(values, regimen);
    if (invalid) throw new Error(`${regimen.name}: ${invalid}`);
    const bundle = application
      ? buildRegimenCycleBundle(values, regimen, application, patientId, requester)
      : buildRegimenApplicationBundle(values, regimen, patientId, requester);
    const ids = await post(stampAuthoredOn(bundle, at(addDays(course.cycleStarts[first], -3))));
    if (!application) {
      const requests = (await createdOf(ids.slice(0, 5), "ServiceRequest")) as fhir4.ServiceRequest[];
      application = requests.map(parseRegimenApplication).find((a) => a) ?? null;
      if (!application) throw new Error(`${regimen.name}: 適用のヘッダが見つかりません`);
    }
  }
  env.log(`${regimen.name}: ${course.cycleStarts.length} コースを登録`);
}

export const REQUIREMENTS = {
  labs: Object.values(LAB),
  medicines: [CAPECITABINE],
  usages: [BID],
  diseases: ["直腸癌", "転移性肝癌"],
  regimens: ["900003", "900002"],
  radiotherapyProtocol: "RT-RECTUM-PRE-45",
};

export async function seedRectalCancer(env: SeedEnv): Promise<void> {
  const patient = await createPatient(env, {
    familyKanji: "佐々木",
    givenKanji: "恵子",
    familyKana: "ササキ",
    givenKana: "ケイコ",
    gender: "female",
    birthDate: "1962-11-03",
  });
  if (!patient?.id) return;
  const patientId = patient.id;
  const gastro = departmentOf(env, "消化器内科", "内科");
  const surgical = departmentOf(env, "消化器外科", "外科");
  const oncology = departmentOf(env, "腫瘍内科", "消化器内科", "内科");
  const radiation = departmentOf(env, "放射線治療科", "放射線科");

  const labs = new LabMaster();
  await labs.load(Object.values(LAB));
  const drugs = new DrugMaster();
  await drugs.load([CAPECITABINE], [BID]);

  const t0 = weekday(daysAgo(START_DAYS_AGO));
  const day = (n: number) => addDays(t0, n);

  // 病名: 疑い → 確定(疑いは確定へ引き継いで閉じる)。確定の後に肝転移を下位プロブレムで。
  const confirmed = await createProblem(patientId, 2, { disease: await findDisease("直腸癌"), start: day(16) });
  const suspected = await createProblem(patientId, 1, {
    disease: await findDisease("直腸癌"),
    start: t0,
    end: day(16),
    outcome: "resolved",
    suspected: true,
    succeededByIds: [confirmed.conditionId],
  });

  // 検査値と体重
  for (const [n, values] of LAB_DAYS) {
    const date = day(n);
    const lab = labResultBundle(
      env,
      labs,
      patient,
      n >= 110 && n <= 126 ? surgical : gastro,
      date,
      Object.entries(values).map(([key, value]) => [LAB[key as keyof typeof LAB], value as number]),
      n >= 110 && n <= 126 ? "inpatient" : "outpatient",
    );
    const weight = WEIGHT.find(([d]) => d === n)?.[1];
    const vitals = weight != null ? vitalEntries(patientId, at(date, "09:20"), { weight }) : [];
    await post({ resourceType: "Bundle", type: "transaction", entry: [...(lab?.entry ?? []), ...vitals] });
  }
  await post({
    resourceType: "Bundle",
    type: "transaction",
    entry: vitalEntries(patientId, at(t0, "09:15"), { systolic: 124, diastolic: 76, pulse: 82, temperature: 36.6 }),
  });

  // 精査
  await endoscopy(env, patientId, requesterOf(env, gastro), suspected, day(6));
  await contrastCt(env, patientId, requesterOf(env, gastro), suspected, day(9), "直腸癌の病期診断");

  // 術前化学放射線療法(45Gy/25 回 + カペシタビン)
  await radiotherapy(env, patientId, requesterOf(env, radiation), confirmed, day(28));
  await post(
    prescriptionBundle(drugs, patientId, requesterOf(env, oncology), day(28), [{ usage: BID, days: 35, medicines: [[CAPECITABINE, 8]] }], confirmed),
  );

  // 手術(入院 14 日)
  await createStay(env, patient, surgical, day(110), day(126), 3);
  await surgery(env, patientId, requesterOf(env, surgical), surgical, confirmed, day(112));

  // 術後補助化学療法 CapeOX 8 コース(3 週ごと)
  await chemotherapy(env, patientId, requesterOf(env, oncology), confirmed, {
    code: "900003",
    start: day(154),
    cycleStarts: Array.from({ length: 8 }, (_, i) => day(154 + 21 * i)),
    weight: 56.2,
  });

  // 再発: CEA 上昇 → 造影 CT → 肝転移
  await contrastCt(env, patientId, requesterOf(env, gastro), confirmed, day(448), "CEA 上昇。再発の検索");
  await createProblem(patientId, 3, {
    disease: await findDisease("転移性肝癌"),
    start: day(452),
    parentId: confirmed.conditionId,
  });

  // 二次治療 FOLFIRI(2 週ごと、今日より前のコースだけ)
  const folfiri = Array.from({ length: 6 }, (_, i) => day(466 + 14 * i)).filter((d) => d <= daysAgo(0));
  await chemotherapy(env, patientId, requesterOf(env, oncology), confirmed, {
    code: "900002",
    start: day(466),
    cycleStarts: folfiri,
    weight: 55.6,
  });
  env.log("直腸癌: 登録完了");
}
