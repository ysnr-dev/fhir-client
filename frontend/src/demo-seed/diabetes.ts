// 糖尿病(悪化傾向)。3 年間の外来経過。メトホルミンで一度は落ち着くが、体重増加とともに
// HbA1c がじわじわ上がり、DPP-4 阻害薬 → SGLT2 阻害薬 → 教育入院 → SU 薬と治療を強めても
// 追いつかない。並行して尿アルブミンが増え、腎症・網膜症が加わる。

import {
  at,
  createPatient,
  createProblem,
  createStay,
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
  weekday,
  type RpSpec,
  type SeedEnv,
} from "./base";
import { addDays } from "../lib/dates";

export const LAB = { a1c: "160010010", glu: "160019410", cre: "160019210", uac: "160004810-01", k: "160021410", ldl: "160167250" };
export const MED = {
  met250: "621974701",
  met500: "622242501",
  sita: "621951001",
  empa: "622401201",
  glim: "610443002",
};
const BID = "１日２回朝夕食後　服用";
const TID = "１日３回朝昼夕食後　服用";
const QD = "１日１回朝食後　服用";

const A1C = [
  7.4, 7.2, 7.0, 6.9, 6.9, 6.8, 6.9, 6.9, 7.0, 7.1, 7.2, 7.3, 7.4, 7.3, 7.2, 7.4, 7.5, 7.6, 7.8, 7.9, 8.1, 8.0,
  7.8, 8.0, 8.3, 8.5, 8.7, 8.9, 8.4, 8.0, 7.8, 7.9, 8.0, 8.1, 8.2, 8.3, 8.2, 8.4, 8.5,
];
const WEIGHT = [
  76.0, 75.6, 75.2, 75.0, 75.1, 75.3, 75.6, 75.9, 76.3, 76.8, 77.2, 77.6, 78.1, 78.3, 78.6, 79.0, 79.5, 79.9, 80.4,
  80.8, 81.1, 80.9, 81.2, 81.6, 82.0, 82.4, 82.9, 83.1, 80.6, 80.9, 81.3, 81.6, 81.9, 82.2, 82.5, 82.7, 83.0, 83.2,
  83.4,
];
/** 3 回に 1 回の腎機能と脂質。[Cre, 尿A/C比, K, LDL-C] */
const RENAL: [number, number, number, number][] = [
  [0.78, 15, 4.1, 132], [0.8, 17, 4.2, 128], [0.82, 20, 4.2, 126], [0.84, 24, 4.3, 124], [0.86, 30, 4.3, 122],
  [0.9, 38, 4.4, 121], [0.95, 52, 4.5, 120], [1.0, 70, 4.5, 119], [1.06, 95, 4.6, 118], [1.12, 130, 4.7, 118],
  [1.18, 170, 4.8, 117], [1.25, 230, 4.9, 116], [1.32, 290, 5.0, 118],
];

export const REQUIREMENTS = {
  labs: Object.values(LAB),
  medicines: Object.values(MED),
  usages: [BID, TID, QD],
  diseases: ["２型糖尿病", "高血圧症", "脂質異常症", "糖尿病性腎症", "糖尿病網膜症"],
};

export async function seedDiabetes(env: SeedEnv): Promise<void> {
  const patient = await createPatient(env, {
    familyKanji: "田中",
    givenKanji: "健一",
    familyKana: "タナカ",
    givenKana: "ケンイチ",
    gender: "male",
    birthDate: "1964-05-12",
  });
  if (!patient?.id) return;
  const patientId = patient.id;
  const department = departmentOf(env, "糖尿病内科", "内分泌内科", "内科");
  const requester = requesterOf(env, department);

  const labs = new LabMaster();
  await labs.load(Object.values(LAB));
  const drugs = new DrugMaster();
  await drugs.load(Object.values(MED), [BID, TID, QD]);

  const visits = A1C.map((_, k) => weekday(daysAgo(14 + 28 * (A1C.length - 1 - k))));
  const dm = await createProblem(patientId, 1, { disease: await findDisease("２型糖尿病"), start: visits[0] });
  await createProblem(patientId, 2, { disease: await findDisease("高血圧症"), start: visits[0] });
  await createProblem(patientId, 3, { disease: await findDisease("脂質異常症"), start: visits[0] });
  await createProblem(patientId, 4, {
    disease: await findDisease("糖尿病性腎症"),
    start: visits[15],
    parentId: dm.conditionId,
  });
  await createProblem(patientId, 5, {
    disease: await findDisease("糖尿病網膜症"),
    start: visits[22],
    parentId: dm.conditionId,
  });

  for (let k = 0; k < visits.length; k += 1) {
    const date = visits[k];
    const a1c = A1C[k];
    const glucose = Math.round(a1c * 28.7 - 46.7 + ((k * 7) % 11) - 5);
    const values: [string, number][] = [[LAB.a1c, a1c], [LAB.glu, glucose]];
    if (k % 3 === 0) {
      const [cre, uac, potassium, ldl] = RENAL[k / 3];
      values.push([LAB.cre, cre], [LAB.uac, uac], [LAB.k, potassium], [LAB.ldl, ldl]);
    }
    const lab = labResultBundle(env, labs, patient, department, date, values);

    const metformin: RpSpec =
      k === 0
        ? { usage: BID, days: 28, medicines: [[MED.met250, 2]] }
        : k < 9
          ? { usage: BID, days: 28, medicines: [[MED.met500, 2]] }
          : { usage: TID, days: 28, medicines: [[MED.met500, 3]] };
    const morning: [string, number][] = [];
    if (k >= 12) morning.push([MED.sita, 1]);
    if (k >= 20) morning.push([MED.empa, 1]);
    if (k >= 28) morning.push([MED.glim, k >= 33 ? 2 : 1]);
    const rps: RpSpec[] = [metformin, ...(morning.length ? [{ usage: QD, days: 28, medicines: morning }] : [])];
    const rx = prescriptionBundle(drugs, patientId, requester, date, rps, dm);

    const systolic = 132 + Math.round(k * 0.4);
    const vitals = vitalEntries(patientId, at(date, "09:30"), {
      weight: WEIGHT[k],
      systolic,
      diastolic: Math.round(systolic * 0.62),
    });

    await post({
      resourceType: "Bundle",
      type: "transaction",
      entry: [...(lab?.entry ?? []), ...(rx.entry ?? []), ...vitals],
    });
  }

  // 血糖が上がりきった時期に教育入院(10 日)。
  await createStay(env, patient, department, visits[27], addDays(visits[27], 10));

  await ensureFacilityChart(env, "糖尿病(治療強化・腎症)", {
    axis: { unit: "month", columns: 36 },
    items: [...labItemsOf(labs, [LAB.a1c, LAB.glu, LAB.uac, LAB.cre]), vitalItem("29463-7")],
    events: ["condition", "encounter"],
    drugs: drugsOf(drugs, [
      [MED.met500, "メトホルミン"],
      [MED.sita, "シタグリプチン"],
      [MED.empa, "エンパグリフロジン"],
      [MED.glim, "グリメピリド"],
    ]),
    overlay: false,
    background: null,
  });
  env.log(`糖尿病: 外来 ${visits.length} 回を登録`);
}
