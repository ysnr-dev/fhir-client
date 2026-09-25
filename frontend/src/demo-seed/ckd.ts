// 慢性腎臓病(腎硬化症)。約 3 年の外来経過。ARB で尿蛋白が 2+ → ± に下がり Cre も落ち着くが、
// 血圧が上がって尿蛋白が 2+ に戻ると Cre の上がり方が速くなる(アムロジピンを追加)。K が上がって
// ARB を減量し重曹を足す。腎性貧血にダルベポエチンを 4 週ごとに皮下注射し、Hb が戻る。
// 尿蛋白(定性)はコード型の検査で、チャートでは選択肢の行と網掛けにする
// (尿蛋白 2+ 以上の時期と ± の時期で Cre の上がり方を層別の要約・対比で比べる)。

import {
  at,
  createdOf,
  createPatient,
  createProblem,
  daysAgo,
  departmentOf,
  DrugMaster,
  drugsOf,
  ensureFacilityChart,
  findDisease,
  LabMaster,
  labItemsOf,
  labResultBundle,
  post,
  prescriptionBundle,
  requesterOf,
  vitalEntries,
  vitalItem,
  type RpSpec,
  type SeedEnv,
} from "./base";
import { addDays } from "../lib/dates";
import type { OrderContext } from "../orderContext";
import type { ProblemRef } from "../fhir/conditionHelpers";
import { isChoiceItem } from "../fhir/chartDefinitionHelpers";
import {
  buildInjectionSingleDayEntries,
  emptyInjectionForm,
  emptyInjectionRp,
} from "../fhir/injectionHelpers";
import { buildInjectionPerformBundle, emptyInjectionPerformForm } from "../fhir/injectionPerformHelpers";
import type { Medicine } from "../api/masterClient";

export const LAB = {
  cre: "160019210",
  bun: "160019010",
  k: "160021410",
  hb: "160008010-03",
  protein: "160000310-03",
};
export const MED = {
  olm20: "622452901",
  olm10: "622452801",
  aml5: "620007818",
  nahco3: "612340028",
  esa30: "622199801",
  esa60: "622200001",
};
const QD = "１日１回朝食後　服用";
const TID = "１日３回朝昼夕食後　服用";
const START_DAYS_AGO = 1090;

/** 尿蛋白(定性)の選択肢コード(JP_Urine_Code_CS)。 */
const UP = { neg: "1", trace: "2", p1: "3", p2: "4", p3: "5" } as const;

/** 1 回の外来。day は初診からの日数、protein は尿蛋白(定性)の選択肢コード。 */
type Visit = [day: number, cre: number, bun: number, k: number, hb: number, protein: string, systolic: number, diastolic: number, weight: number];

const VISITS: Visit[] = [
  // 8 週ごと。ARB を始めて尿蛋白が下がる。
  [0, 1.32, 21, 4.4, 12.9, UP.p2, 158, 94, 68.5],
  [56, 1.41, 23, 4.6, 12.8, UP.p1, 142, 86, 68.2],
  [112, 1.44, 23, 4.7, 12.7, UP.p1, 134, 80, 68.0],
  [168, 1.43, 22, 4.6, 12.8, UP.trace, 130, 78, 67.8],
  [224, 1.46, 24, 4.7, 12.6, UP.trace, 128, 78, 67.9],
  [280, 1.47, 24, 4.6, 12.5, UP.trace, 132, 80, 68.1],
  [336, 1.5, 25, 4.8, 12.4, UP.p1, 138, 84, 68.6],
  // 血圧が上がり尿蛋白が 2+ に戻る → アムロジピン追加。Cre の上がり方が速くなる。
  [392, 1.56, 27, 4.8, 12.2, UP.p2, 150, 90, 69.0],
  [448, 1.68, 29, 4.9, 12.0, UP.p2, 138, 84, 68.8],
  [504, 1.79, 32, 5.2, 11.7, UP.p3, 136, 82, 68.5],
  // K 上昇 → ARB 減量・重曹追加。
  [560, 1.92, 35, 5.7, 11.4, UP.p2, 134, 82, 68.2],
  [616, 2.01, 36, 5.1, 11.0, UP.p2, 140, 86, 67.9],
  // 腎性貧血 → ダルベポエチン 4 週ごと。ここから 4 週ごとの受診。
  [672, 2.12, 39, 5.0, 10.4, UP.p2, 142, 86, 67.5],
  [700, 2.15, 40, 4.9, 10.6, UP.p2, 138, 84, 67.4],
  [728, 2.2, 41, 4.9, 10.9, UP.p1, 136, 82, 67.3],
  [756, 2.24, 42, 5.0, 11.2, UP.p1, 134, 82, 67.0],
  [784, 2.28, 42, 4.9, 11.5, UP.p1, 132, 80, 66.9],
  [812, 2.31, 43, 4.8, 11.6, UP.p1, 132, 80, 66.8],
  [840, 2.36, 44, 5.0, 11.4, UP.p1, 134, 80, 66.6],
  [868, 2.45, 46, 5.1, 11.3, UP.p2, 140, 84, 66.5],
  [896, 2.56, 48, 5.2, 11.0, UP.p2, 142, 86, 66.3],
  // Hb が下がってきたのでダルベポエチンを増量。
  [924, 2.68, 50, 5.3, 10.8, UP.p3, 146, 88, 66.0],
  [952, 2.79, 52, 5.2, 11.1, UP.p2, 140, 84, 65.8],
  [980, 2.88, 54, 5.1, 11.4, UP.p2, 138, 84, 65.7],
  [1008, 2.97, 55, 5.2, 11.5, UP.p2, 136, 82, 65.5],
  [1036, 3.05, 57, 5.3, 11.6, UP.p2, 136, 82, 65.4],
  [1064, 3.12, 58, 5.2, 11.7, UP.p2, 134, 80, 65.2],
];

const AMLODIPINE_FROM = 392;
const ARB_REDUCED_FROM = 560;
const ESA_FROM = 672;
const ESA_INCREASED_FROM = 924;

export const REQUIREMENTS = {
  labs: Object.values(LAB),
  /** コード型でないとチャートの選択肢の行・網掛けにならない検査。 */
  codedLabs: [LAB.protein],
  medicines: Object.values(MED),
  usages: [QD, TID],
  diseases: ["慢性腎臓病", "高血圧症", "高カリウム血症", "腎性貧血"],
};

function prescriptionFor(day: number, days: number): RpSpec[] {
  const morning: [string, number][] = [[day >= ARB_REDUCED_FROM ? MED.olm10 : MED.olm20, 1]];
  if (day >= AMLODIPINE_FROM) morning.push([MED.aml5, 1]);
  const rps: RpSpec[] = [{ usage: QD, days, medicines: morning }];
  if (day >= ARB_REDUCED_FROM) rps.push({ usage: TID, days, medicines: [[MED.nahco3, 3]] });
  return rps;
}

/** ダルベポエチンの皮下注射 1 回(オーダーと実施記録)。 */
async function esaInjection(
  env: SeedEnv,
  patientId: string,
  requester: OrderContext,
  problem: ProblemRef,
  date: string,
  medicine: Medicine,
) {
  const values = {
    ...emptyInjectionForm(problem, "outpatient"),
    startDate: date,
    endDate: date,
    rps: [
      {
        ...emptyInjectionRp,
        usageType: "one-shot" as const,
        routeCode: "SC",
        methodCode: "32",
        times: [{ start: "10:30", end: "" }],
        medicines: [{ medicine, dose: "1", comment: "" }],
      },
    ],
  };
  const entries = buildInjectionSingleDayEntries(values, patientId, requester, at(date));
  const ids = await post({ resourceType: "Bundle", type: "transaction", entry: entries });
  const [order] = (await createdOf(ids, "ServiceRequest")) as fhir4.ServiceRequest[];
  const mrs = (await createdOf(ids, "MedicationRequest")) as fhir4.MedicationRequest[];
  if (!order) throw new Error("注射オーダーのヘッダが見つかりません");
  const perform = {
    ...emptyInjectionPerformForm(mrs),
    startedAt: `${date}T10:40`,
    performerId: env.practitioner.id,
    performerName: env.practitioner.name,
  };
  await post(buildInjectionPerformBundle(perform, order, mrs, undefined, 0));
}

export async function seedCkd(env: SeedEnv): Promise<void> {
  const patient = await createPatient(env, {
    familyKanji: "山本",
    givenKanji: "修",
    familyKana: "ヤマモト",
    givenKana: "オサム",
    gender: "male",
    birthDate: "1953-08-17",
  });
  if (!patient?.id) return;
  const patientId = patient.id;
  const department = departmentOf(env, "腎臓内科", "内科");
  const requester = requesterOf(env, department);

  const labs = new LabMaster();
  await labs.load(Object.values(LAB));
  const drugs = new DrugMaster();
  await drugs.load(Object.values(MED), [QD, TID]);

  const start = daysAgo(START_DAYS_AGO);
  const dateOf = (day: number) => addDays(start, day);
  const ckd = await createProblem(patientId, 1, { disease: await findDisease("慢性腎臓病"), start: dateOf(0) });
  await createProblem(patientId, 2, { disease: await findDisease("高血圧症"), start: addDays(start, -1800) });
  await createProblem(patientId, 3, {
    disease: await findDisease("高カリウム血症"),
    start: dateOf(ARB_REDUCED_FROM),
    end: dateOf(ESA_FROM),
    outcome: "resolved",
  });
  const anemia = await createProblem(patientId, 4, { disease: await findDisease("腎性貧血"), start: dateOf(ESA_FROM) });

  const visits = VISITS.filter(([day]) => dateOf(day) <= daysAgo(0));
  for (const [index, [day, cre, bun, k, hb, protein, systolic, diastolic, weight]] of visits.entries()) {
    const date = dateOf(day);
    const next = visits[index + 1]?.[0];
    const days = next != null ? next - day : 28;
    const lab = labResultBundle(env, labs, patient, department, date, [
      [LAB.cre, cre],
      [LAB.bun, bun],
      [LAB.k, k],
      [LAB.hb, hb],
      [LAB.protein, protein],
    ]);
    const rx = prescriptionBundle(drugs, patientId, requester, date, prescriptionFor(day, days), ckd);
    const vitals = vitalEntries(patientId, at(date, "09:30"), { weight, systolic, diastolic });
    await post({
      resourceType: "Bundle",
      type: "transaction",
      entry: [...(lab?.entry ?? []), ...(rx.entry ?? []), ...vitals],
    });
    if (day >= ESA_FROM) {
      const esa = drugs.medicine(day >= ESA_INCREASED_FROM ? MED.esa60 : MED.esa30);
      await esaInjection(env, patientId, requester, anemia, date, esa);
    }
  }

  const items = [...labItemsOf(labs, [LAB.cre, LAB.bun, LAB.k, LAB.hb, LAB.protein]), vitalItem("85354-9")];
  const protein = items.find((item) => item.key === `lab:${LAB.protein}`);
  await ensureFacilityChart(env, "慢性腎臓病(尿蛋白・腎性貧血)", {
    axis: { unit: "month", columns: 36 },
    items,
    events: ["condition", "encounter", "injection"],
    drugs: drugsOf(drugs, [
      [MED.olm20, "オルメサルタン"],
      [MED.aml5, "アムロジピン"],
      [MED.nahco3, "炭酸水素ナトリウム"],
      [MED.esa30, "ダルベポエチン"],
    ]),
    overlay: false,
    // 尿蛋白(定性)を全レーンに網掛けする。マスタが数値型のままなら選択肢の行にならないので付けない。
    background: protein && isChoiceItem(protein) ? { kind: "item", key: protein.key } : null,
  });
  env.log(`慢性腎臓病: 外来 ${visits.length} 回を登録`);
}
