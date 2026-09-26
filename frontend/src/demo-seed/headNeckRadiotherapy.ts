// 頭頸部放射線治療のあとの口腔機能。約 2 年。中咽頭癌に IMRT 70Gy/35 回を照射する。照射中に
// 口腔粘膜炎が G3 まで上がり、体重と Alb が落ちる。照射後は唾液が戻りきらず(口内乾燥 G2 が続く)、
// 半年ほどして開口量が減って開口障害(トリスムス)が出る。開口訓練で開口量が少しずつ戻る。
// 口腔機能はテンプレート「口腔機能の検査」に記入する(該当項目数はテンプレートの計算式で求める)。
// チャートは院内共通の「口腔機能」(プリセット)で見る。

import {
  at,
  createPatient,
  createProblem,
  daysAgo,
  departmentOf,
  findDisease,
  findTemplate,
  LabMaster,
  labResultBundle,
  post,
  radiotherapyAdverseEvents,
  radiotherapyCourse,
  requesterOf,
  templateEntries,
  vitalEntries,
  weekday,
  type AdverseEventSpec,
  type SeedEnv,
} from "./base";
import { addDays } from "../lib/dates";

export const TEMPLATE_URL = "http://fhir-client.local/Questionnaire/oral-function-01";
export const LAB = { alb: "160018910" };
const RT_PROTOCOL = "RT-HN-SIB-70";

const START_DAYS_AGO = 700;
/** 照射の開始(起点からの日数)。35 回を平日に続けて約 7 週。 */
const RT_START = 14;

/** 口腔機能の検査。day は起点からの日数。 */
interface OralExam {
  day: number;
  tci: number;
  moisture: number;
  bite: number;
  teeth: number;
  pa: number;
  ta: number;
  ka: number;
  tongue: number;
  glucose: number;
  eat10: number;
  opening: number;
  saliva: number;
  weight: number;
  alb: number;
}

const EXAMS: OralExam[] = [
  // 照射前
  { day: 0, tci: 30, moisture: 28.5, bite: 620, teeth: 24, pa: 6.4, ta: 6.2, ka: 6.0, tongue: 33.0, glucose: 160, eat10: 0, opening: 48, saliva: 14.0, weight: 64.2, alb: 4.1 },
  // 照射終了時
  { day: 63, tci: 60, moisture: 24.0, bite: 420, teeth: 24, pa: 5.4, ta: 5.2, ka: 5.0, tongue: 24.0, glucose: 85, eat10: 14, opening: 43, saliva: 5.5, weight: 57.9, alb: 3.3 },
  { day: 120, tci: 50, moisture: 25.0, bite: 480, teeth: 24, pa: 5.8, ta: 5.6, ka: 5.4, tongue: 26.0, glucose: 98, eat10: 9, opening: 42, saliva: 5.0, weight: 58.6, alb: 3.6 },
  { day: 210, tci: 40, moisture: 25.6, bite: 520, teeth: 24, pa: 6.0, ta: 5.8, ka: 5.6, tongue: 28.0, glucose: 110, eat10: 6, opening: 40, saliva: 6.0, weight: 60.1, alb: 3.8 },
  // 開口障害が出る → 開口訓練を始める
  { day: 300, tci: 38, moisture: 25.8, bite: 510, teeth: 24, pa: 6.0, ta: 5.9, ka: 5.7, tongue: 28.0, glucose: 112, eat10: 5, opening: 34, saliva: 6.5, weight: 60.8, alb: 3.9 },
  { day: 390, tci: 35, moisture: 26.0, bite: 540, teeth: 24, pa: 6.1, ta: 6.0, ka: 5.8, tongue: 29.0, glucose: 120, eat10: 4, opening: 37, saliva: 7.0, weight: 61.5, alb: 3.9 },
  { day: 480, tci: 32, moisture: 26.4, bite: 560, teeth: 24, pa: 6.2, ta: 6.0, ka: 5.9, tongue: 30.0, glucose: 125, eat10: 3, opening: 39, saliva: 7.2, weight: 62.0, alb: 4.0 },
  { day: 570, tci: 30, moisture: 26.6, bite: 570, teeth: 24, pa: 6.2, ta: 6.1, ka: 5.9, tongue: 30.5, glucose: 128, eat10: 3, opening: 40, saliva: 7.5, weight: 62.3, alb: 4.0 },
  { day: 660, tci: 30, moisture: 26.8, bite: 580, teeth: 24, pa: 6.3, ta: 6.1, ka: 6.0, tongue: 31.0, glucose: 130, eat10: 2, opening: 41, saliva: 7.6, weight: 62.6, alb: 4.0 },
];

/** 照射中の体重(週 1 回)。 */
const RT_WEIGHT: [day: number, weight: number][] = [[28, 62.8], [42, 60.9], [56, 58.7]];

/** 有害事象(起点からの日数)。同じ用語で Grade が変われば別の記録にする。resolved が無ければ継続中。 */
const ADVERSE: { term: string; grade: number; onset: number; resolved?: number }[] = [
  { term: "口腔粘膜炎", grade: 1, onset: 24, resolved: 34 },
  { term: "口腔粘膜炎", grade: 2, onset: 35, resolved: 48 },
  { term: "口腔粘膜炎", grade: 3, onset: 49, resolved: 70 },
  { term: "口腔粘膜炎", grade: 1, onset: 71, resolved: 95 },
  { term: "口内乾燥", grade: 1, onset: 30, resolved: 45 },
  { term: "口内乾燥", grade: 2, onset: 46 },
  { term: "味覚不全", grade: 2, onset: 35, resolved: 150 },
  { term: "嚥下障害", grade: 2, onset: 45, resolved: 100 },
  { term: "トリスムス", grade: 1, onset: 290 },
];

export const REQUIREMENTS = {
  labs: Object.values(LAB),
  medicines: [] as string[],
  usages: [] as string[],
  diseases: ["中咽頭癌", "放射線口腔乾燥症", "開口障害"],
  templates: [TEMPLATE_URL],
  radiotherapyProtocol: RT_PROTOCOL,
};

export async function seedHeadNeckRadiotherapy(env: SeedEnv): Promise<void> {
  const questionnaire = await findTemplate(TEMPLATE_URL);
  if (!questionnaire) {
    env.log("テンプレート「口腔機能の検査」が取り込まれていないので飛ばします(docs/report-mappings/oral-function-01.md)");
    return;
  }
  const patient = await createPatient(env, {
    familyKanji: "小林",
    givenKanji: "和夫",
    familyKana: "コバヤシ",
    givenKana: "カズオ",
    gender: "male",
    birthDate: "1955-03-08",
  });
  if (!patient?.id) return;
  const patientId = patient.id;
  const ent = departmentOf(env, "耳鼻咽喉科", "頭頸部外科", "歯科口腔外科", "内科");
  const radiation = departmentOf(env, "放射線治療科", "放射線科");

  const labs = new LabMaster();
  await labs.load(Object.values(LAB));

  const t0 = weekday(daysAgo(START_DAYS_AGO));
  const day = (n: number) => addDays(t0, n);
  const cancer = await createProblem(patientId, 1, { disease: await findDisease("中咽頭癌"), start: t0 });
  await createProblem(patientId, 2, { disease: await findDisease("放射線口腔乾燥症"), start: day(70) });
  await createProblem(patientId, 3, { disease: await findDisease("開口障害"), start: day(300) });

  const course = await radiotherapyCourse(env, patientId, requesterOf(env, radiation), cancer, day(RT_START), RT_PROTOCOL);
  if (course) {
    const specs: AdverseEventSpec[] = ADVERSE.map((a) => ({
      term: a.term,
      grade: a.grade,
      onset: day(a.onset),
      resolved: a.resolved != null ? day(a.resolved) : undefined,
    }));
    await radiotherapyAdverseEvents(env, patientId, course, specs);
  }

  for (const [n, weight] of RT_WEIGHT) {
    await post({ resourceType: "Bundle", type: "transaction", entry: vitalEntries(patientId, at(weekday(day(n)), "09:30"), { weight }) });
  }

  const exams = EXAMS.filter((exam) => day(exam.day) <= daysAgo(0));
  for (const exam of exams) {
    const date = weekday(day(exam.day));
    const lab = labResultBundle(env, labs, patient, ent, date, [[LAB.alb, exam.alb]]);
    const vitals = vitalEntries(patientId, at(date, "09:30"), { weight: exam.weight });
    const oral = templateEntries(env, questionnaire, patient, at(date, "14:00"), {
      tci: exam.tci,
      mucosal_moisture: exam.moisture,
      bite_force: exam.bite,
      remaining_teeth: exam.teeth,
      odk_pa: exam.pa,
      odk_ta: exam.ta,
      odk_ka: exam.ka,
      tongue_pressure: exam.tongue,
      glucose_elution: exam.glucose,
      eat10: exam.eat10,
      mouth_opening: exam.opening,
      stimulated_saliva: exam.saliva,
    });
    await post({ resourceType: "Bundle", type: "transaction", entry: [...(lab?.entry ?? []), ...vitals, ...oral] });
  }

  env.log(`頭頸部放射線治療後: 口腔機能の検査 ${exams.length} 回を登録(チャートは院内共通の「口腔機能」)`);
}
