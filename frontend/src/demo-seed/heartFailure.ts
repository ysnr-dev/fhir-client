// 心不全。約 1 年の経過。急性増悪で入院し、利尿薬で体重と BNP が下がって退院。外来で
// しばらく落ち着くが、体重がじわじわ増えて浮腫・息切れが悪化 → フロセミド増量で持ち直す。
// 感染を契機に 2 度目の短期入院、カリウムが上がってスピロノラクトンを減量する。
// 症状(浮腫・NYHA)はテンプレートに記入し、チャートの選択肢の行で見せる。

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
  type RpSpec,
  type SeedEnv,
} from "./base";
import { addDays } from "../lib/dates";
import { createResource, searchResource } from "../api/fhirClient";
import { templateChartItems } from "../fhir/chartDefinitionHelpers";
import { observationExtractExtensions, responseSaveBundle } from "../fhir/observationExtract";
import { buildQuestionnaireResponse, DEFAULT_INSTITUTION_NUMBER } from "../fhir/questionnaireResponseHelpers";

export const LAB = { bnp: "160162350", cre: "160019210", k: "160021410", na: "160021110-01" };
export const MED = {
  furo20: "620000167",
  furo40: "620000168",
  spiro25: "620004915",
  tolv: "622694301",
  carv: "610462040",
};
const QD = "１日１回朝食後　服用";
const BID = "１日２回朝夕食後　服用";

const TEMPLATE_URL = "http://fhir-client.local/Questionnaire/hf-symptom-01";
const ITEM_SYSTEM = "http://fhir-client.local/CodeSystem/observation-item";
const EDEMA = ["なし", "軽度", "中等度", "高度"];
const NYHA = ["I度", "II度", "III度", "IV度"];

/** 1 回の記録。day は起点(初回入院日)からの日数。 */
interface Visit {
  day: number;
  weight: number;
  systolic: number;
  diastolic: number;
  pulse: number;
  bnp?: number;
  cre?: number;
  k?: number;
  na?: number;
  /** 浮腫・NYHA の段階(0 始まり)。 */
  edema?: number;
  nyha?: number;
  inpatient?: boolean;
}

const START_DAYS_AGO = 350;

const VISITS: Visit[] = [
  // 1 回目の入院(急性増悪)
  { day: 0, weight: 66.8, systolic: 162, diastolic: 94, pulse: 108, bnp: 1280, cre: 1.12, k: 3.8, na: 134, edema: 3, nyha: 3, inpatient: true },
  { day: 2, weight: 65.2, systolic: 148, diastolic: 86, pulse: 96, inpatient: true },
  { day: 4, weight: 63.9, systolic: 138, diastolic: 80, pulse: 88, bnp: 860, cre: 1.28, k: 3.5, na: 133, edema: 2, nyha: 2, inpatient: true },
  { day: 6, weight: 63.0, systolic: 132, diastolic: 78, pulse: 84, inpatient: true },
  { day: 8, weight: 62.4, systolic: 128, diastolic: 76, pulse: 80, bnp: 520, cre: 1.34, k: 3.9, na: 135, edema: 1, nyha: 1, inpatient: true },
  { day: 12, weight: 61.8, systolic: 126, diastolic: 74, pulse: 76, bnp: 410, cre: 1.22, k: 4.2, na: 137, edema: 0, nyha: 1, inpatient: true },
  // 外来(4 週ごと)
  { day: 26, weight: 62.2, systolic: 128, diastolic: 76, pulse: 74, bnp: 380, cre: 1.2, k: 4.3, na: 138, edema: 0, nyha: 1 },
  { day: 54, weight: 62.0, systolic: 126, diastolic: 74, pulse: 72, bnp: 340, cre: 1.18, k: 4.5, na: 138, edema: 0, nyha: 1 },
  { day: 82, weight: 62.4, systolic: 130, diastolic: 76, pulse: 72, bnp: 310, cre: 1.22, k: 4.6, na: 139, edema: 0, nyha: 1 },
  { day: 110, weight: 62.1, systolic: 128, diastolic: 74, pulse: 70, bnp: 300, cre: 1.2, k: 4.7, na: 138, edema: 1, nyha: 1 },
  { day: 138, weight: 62.9, systolic: 134, diastolic: 78, pulse: 74, bnp: 360, cre: 1.26, k: 4.9, na: 137, edema: 1, nyha: 1 },
  // 体重がじわじわ増えて悪化 → フロセミド増量
  { day: 166, weight: 64.0, systolic: 140, diastolic: 82, pulse: 80, bnp: 520, cre: 1.3, k: 4.7, na: 136, edema: 2, nyha: 2 },
  { day: 180, weight: 65.4, systolic: 144, diastolic: 84, pulse: 84, bnp: 680, cre: 1.32, k: 4.5, na: 135, edema: 2, nyha: 2 },
  { day: 194, weight: 64.1, systolic: 136, diastolic: 80, pulse: 78, bnp: 520, cre: 1.46, k: 4.3, na: 136, edema: 1, nyha: 1 },
  { day: 222, weight: 62.9, systolic: 130, diastolic: 76, pulse: 74, bnp: 420, cre: 1.4, k: 4.6, na: 137, edema: 0, nyha: 1 },
  // 2 回目の入院(感染契機、短期)
  { day: 262, weight: 64.6, systolic: 150, diastolic: 88, pulse: 102, bnp: 890, cre: 1.52, k: 5.4, na: 134, edema: 2, nyha: 2, inpatient: true },
  { day: 265, weight: 63.4, systolic: 136, diastolic: 80, pulse: 90, bnp: 620, cre: 1.48, k: 5.2, na: 135, inpatient: true },
  { day: 268, weight: 62.8, systolic: 130, diastolic: 76, pulse: 80, bnp: 460, cre: 1.45, k: 5.0, na: 136, edema: 1, nyha: 1, inpatient: true },
  // 退院後の外来
  { day: 282, weight: 62.6, systolic: 128, diastolic: 76, pulse: 74, bnp: 430, cre: 1.42, k: 5.3, na: 137, edema: 0, nyha: 1 },
  { day: 310, weight: 62.3, systolic: 126, diastolic: 74, pulse: 72, bnp: 380, cre: 1.4, k: 4.8, na: 138, edema: 0, nyha: 1 },
  { day: 338, weight: 62.1, systolic: 124, diastolic: 74, pulse: 70, bnp: 340, cre: 1.38, k: 4.6, na: 138, edema: 0, nyha: 1 },
];

/** その日に出す処方。day は起点からの日数。 */
function prescriptionFor(day: number): { days: number; rps: RpSpec[]; inpatient: boolean } | null {
  const carvedilol: RpSpec = { usage: BID, days: 0, medicines: [[MED.carv, 1]] };
  const withDays = (rps: RpSpec[], days: number) => rps.map((rp) => ({ ...rp, days }));
  // 1 回目の入院: フロセミド 40 → トルバプタン追加 → 退院前に内服を整える
  if (day === 0) return { days: 7, inpatient: true, rps: withDays([{ usage: QD, medicines: [[MED.furo40, 1]] }], 7) };
  if (day === 2) return { days: 7, inpatient: true, rps: withDays([{ usage: QD, medicines: [[MED.tolv, 1]] }], 7) };
  if (day === 8) {
    return {
      days: 18,
      inpatient: true,
      rps: withDays([{ usage: QD, medicines: [[MED.furo20, 1], [MED.spiro25, 1]] }, carvedilol], 18),
    };
  }
  // 2 回目の入院: トルバプタンを 5 日
  if (day === 262) return { days: 5, inpatient: true, rps: withDays([{ usage: QD, medicines: [[MED.tolv, 1]] }], 5) };
  const visit = VISITS.find((v) => v.day === day);
  if (!visit || visit.inpatient) return null;
  // 外来: 悪化した時期(166〜221 日)はフロセミド 40、K が上がった後(282 日〜)はスピロノラクトン半錠。
  const furosemide: [string, number] = day >= 166 && day < 222 ? [MED.furo40, 1] : [MED.furo20, 1];
  const spironolactone: [string, number] = [MED.spiro25, day >= 282 ? 0.5 : 1];
  const next = VISITS.find((v) => v.day > day && !v.inpatient)?.day ?? day + 28;
  const days = Math.min(28, next - day);
  return { days, inpatient: false, rps: withDays([{ usage: QD, medicines: [furosemide, spironolactone] }, carvedilol], days) };
}

/** 症状観察のテンプレート。同じ URL のものがあれば使う。 */
async function ensureSymptomTemplate(env: SeedEnv): Promise<fhir4.Questionnaire> {
  const { data } = await searchResource<fhir4.Questionnaire>("Questionnaire", new URLSearchParams({ url: TEMPLATE_URL }));
  const existing = data.entry?.map((e) => e.resource).find((q) => q?.url === TEMPLATE_URL);
  if (existing) return existing;
  const radio: fhir4.Extension[] = [
    {
      url: "http://hl7.org/fhir/StructureDefinition/questionnaire-itemControl",
      valueCodeableConcept: { coding: [{ system: "http://hl7.org/fhir/CodeSystem/questionnaire-item-control", code: "radio-button" }] },
    },
    { url: "http://hl7.org/fhir/StructureDefinition/questionnaire-choiceOrientation", valueCode: "horizontal" },
  ];
  const options = (labels: string[]) => labels.map((display, i) => ({ valueCoding: { code: String(i + 1).padStart(2, "0"), display } }));
  const { data: created } = await createResource<fhir4.Questionnaire>({
    resourceType: "Questionnaire",
    meta: { profile: ["http://www.hosp.ncgm.go.jp/JASPEHR/fhir/StructureDefinition/jaspehr-questionnaire"] },
    url: TEMPLATE_URL,
    version: "1.0.0",
    name: "HF_SYMPTOM_01",
    title: "心不全 症状観察",
    status: "active",
    subjectType: ["Patient"],
    extension: observationExtractExtensions(true, "exam"),
    item: [
      { linkId: "edema", text: "浮腫", type: "choice", code: [{ system: ITEM_SYSTEM, code: "HF-EDEMA", display: "浮腫" }], extension: radio, answerOption: options(EDEMA) },
      { linkId: "nyha", text: "息切れ(NYHA)", type: "choice", code: [{ system: ITEM_SYSTEM, code: "HF-NYHA", display: "NYHA 心機能分類" }], extension: radio, answerOption: options(NYHA) },
    ],
  });
  env.log("テンプレート「心不全 症状観察」を作成");
  return created;
}

function symptomEntries(
  env: SeedEnv,
  questionnaire: fhir4.Questionnaire,
  patient: fhir4.Patient,
  dateTime: string,
  edema: number,
  nyha: number,
): fhir4.BundleEntry[] {
  const answer = (linkId: string, index: number) => {
    const item = questionnaire.item?.find((i) => i.linkId === linkId);
    const coding = item?.answerOption?.[index]?.valueCoding;
    return { linkId, text: item?.text, answer: coding ? [{ valueCoding: coding }] : [] };
  };
  const response = buildQuestionnaireResponse({
    questionnaire,
    patient,
    items: [answer("edema", edema), answer("nyha", nyha)],
    meta: { status: "completed", authorName: env.practitioner.name, institutionNumber: DEFAULT_INSTITUTION_NUMBER },
  });
  response.authored = dateTime;
  return responseSaveBundle({ questionnaire, response }).entry ?? [];
}

export const REQUIREMENTS = {
  labs: Object.values(LAB),
  medicines: Object.values(MED),
  usages: [QD, BID],
  diseases: ["慢性心不全", "高血圧症", "心房細動"],
};

export async function seedHeartFailure(env: SeedEnv): Promise<void> {
  const patient = await createPatient(env, {
    familyKanji: "森",
    givenKanji: "正男",
    familyKana: "モリ",
    givenKana: "マサオ",
    gender: "male",
    birthDate: "1947-02-20",
  });
  if (!patient?.id) return;
  const patientId = patient.id;
  const department = departmentOf(env, "循環器内科", "内科");
  const requester = requesterOf(env, department);

  const labs = new LabMaster();
  await labs.load(Object.values(LAB));
  const drugs = new DrugMaster();
  await drugs.load(Object.values(MED), [QD, BID]);
  const questionnaire = await ensureSymptomTemplate(env);

  const start = daysAgo(START_DAYS_AGO);
  const dateOf = (day: number) => addDays(start, day);
  const hf = await createProblem(patientId, 1, { disease: await findDisease("慢性心不全"), start: dateOf(0) });
  await createProblem(patientId, 2, { disease: await findDisease("高血圧症"), start: addDays(start, -900) });
  await createProblem(patientId, 3, { disease: await findDisease("心房細動"), start: dateOf(0) });

  for (const visit of VISITS) {
    const date = dateOf(visit.day);
    const setting = visit.inpatient ? "inpatient" : "outpatient";
    const values: [string, number][] = [];
    if (visit.bnp != null) values.push([LAB.bnp, visit.bnp]);
    if (visit.cre != null) values.push([LAB.cre, visit.cre]);
    if (visit.k != null) values.push([LAB.k, visit.k]);
    if (visit.na != null) values.push([LAB.na, visit.na]);
    const lab = values.length ? labResultBundle(env, labs, patient, department, date, values, setting) : null;
    const vitals = vitalEntries(patientId, at(date, "09:30"), {
      weight: visit.weight,
      systolic: visit.systolic,
      diastolic: visit.diastolic,
      pulse: visit.pulse,
    });
    const symptoms =
      visit.edema != null && visit.nyha != null
        ? symptomEntries(env, questionnaire, patient, at(date, "10:00"), visit.edema, visit.nyha)
        : [];
    const plan = prescriptionFor(visit.day);
    const rx = plan
      ? prescriptionBundle(drugs, patientId, requester, date, plan.rps, hf, plan.inpatient ? "inpatient" : "outpatient")
      : null;
    await post({
      resourceType: "Bundle",
      type: "transaction",
      entry: [...(lab?.entry ?? []), ...vitals, ...symptoms, ...(rx?.entry ?? [])],
    });
  }

  await createStay(env, patient, department, dateOf(0), dateOf(12), 1);
  await createStay(env, patient, department, dateOf(262), dateOf(269), 2);

  await ensureFacilityChart(env, "心不全(症状つき)", {
    axis: { unit: "month", columns: 12 },
    items: [
      vitalItem("29463-7"),
      vitalItem("85354-9"),
      ...labItemsOf(labs, [LAB.bnp, LAB.cre, LAB.k]),
      ...templateChartItems(questionnaire).filter((item) => item.options?.length),
    ],
    events: ["condition", "encounter"],
    drugs: drugsOf(drugs, [
      [MED.furo20, "フロセミド"],
      [MED.spiro25, "スピロノラクトン"],
      [MED.tolv, "トルバプタン"],
      [MED.carv, "カルベジロール"],
    ]),
    overlay: false,
  });
  env.log(`心不全: 記録 ${VISITS.length} 回・入院 2 回を登録`);
}
