// 歯周病と糖尿病(医科歯科連携)。約 2 年。糖尿病外来で HbA1c が 8 台から下がらず、歯科に紹介して
// 重度の歯周炎(ステージ III・グレード C)が分かる。糖尿病の薬は変えないまま、歯周基本治療で
// BOP 率と HbA1c がそろって下がる。1 年目に歯周のメインテナンス(SPT)が途切れて両方が戻り、
// 再開してまた下がる。歯周の検査はテンプレート「歯周組織検査のまとめ」に記入する。
// チャートは院内共通の「歯周病×糖尿病」(プリセット)で見る。対比で BOP 率 × HbA1c を ±14 日で組む。

import {
  at,
  createPatient,
  createProblem,
  daysAgo,
  departmentOf,
  DrugMaster,
  findDisease,
  findTemplate,
  LabMaster,
  labResultBundle,
  post,
  prescriptionBundle,
  requesterOf,
  templateEntries,
  vitalEntries,
  weekday,
  type SeedEnv,
} from "./base";
import { addDays } from "../lib/dates";

export const TEMPLATE_URL = "http://fhir-client.local/Questionnaire/perio-summary-01";
export const LAB = { a1c: "160010010", glu: "160019410" };
export const MED = { met500: "622242501" };
const BID = "１日２回朝夕食後　服用";

const START_DAYS_AGO = 700;

/** 4 週ごとの外来の HbA1c。歯周基本治療(21〜100 日)で下がり、SPT が途切れた 1 年目に戻る。 */
const A1C = [
  8.6, 8.7, 8.5, 8.2, 7.9, 7.7, 7.5, 7.4, 7.3, 7.2, 7.3, 7.6, 7.9, 7.8, 7.5, 7.3, 7.2, 7.1, 7.0, 7.1, 7.0, 6.9,
  7.0, 6.9, 6.9,
];

/** 歯周の検査。day は起点からの日数。exam は 0 = 歯周基本検査・1 = 歯周精密検査。 */
interface PerioExam {
  day: number;
  exam: 0 | 1;
  teeth: number;
  pd4: number;
  pd6: number;
  maxPd: number;
  bop: number;
  pisa: number;
  pcr: number;
  mobility: number;
}

const EXAMS: PerioExam[] = [
  // 初診(紹介)。重度の歯周炎
  { day: 21, exam: 1, teeth: 26, pd4: 42, pd6: 11, maxPd: 8, bop: 52.0, pisa: 2050, pcr: 72.0, mobility: 5 },
  // 歯周基本治療(SRP)の後の再評価
  { day: 105, exam: 1, teeth: 26, pd4: 20, pd6: 4, maxPd: 7, bop: 24.5, pisa: 980, pcr: 28.0, mobility: 3 },
  // SPT
  { day: 196, exam: 0, teeth: 26, pd4: 14, pd6: 2, maxPd: 6, bop: 16.0, pisa: 620, pcr: 20.0, mobility: 2 },
  // SPT が半年途切れて再燃(動揺の強い 1 歯を抜歯)
  { day: 350, exam: 0, teeth: 25, pd4: 24, pd6: 5, maxPd: 7, bop: 34.0, pisa: 1320, pcr: 45.0, mobility: 3 },
  { day: 434, exam: 1, teeth: 25, pd4: 15, pd6: 2, maxPd: 6, bop: 18.5, pisa: 700, pcr: 24.0, mobility: 2 },
  { day: 525, exam: 0, teeth: 25, pd4: 11, pd6: 1, maxPd: 5, bop: 13.0, pisa: 520, pcr: 18.0, mobility: 2 },
  { day: 616, exam: 0, teeth: 25, pd4: 10, pd6: 1, maxPd: 5, bop: 12.0, pisa: 480, pcr: 17.0, mobility: 1 },
  { day: 693, exam: 0, teeth: 25, pd4: 9, pd6: 1, maxPd: 5, bop: 11.5, pisa: 450, pcr: 16.0, mobility: 1 },
];

/** ステージ III・グレード C(選択肢の添字)。初診から変わらない。 */
const STAGE = 2;
const GRADE = 2;

export const REQUIREMENTS = {
  labs: Object.values(LAB),
  medicines: Object.values(MED),
  usages: [BID],
  diseases: ["２型糖尿病", "慢性歯周炎"],
  templates: [TEMPLATE_URL],
};

export async function seedPeriodontal(env: SeedEnv): Promise<void> {
  const questionnaire = await findTemplate(TEMPLATE_URL);
  if (!questionnaire) {
    env.log("テンプレート「歯周組織検査のまとめ」が取り込まれていないので飛ばします(docs/report-mappings/perio-summary-01.md)");
    return;
  }
  const patient = await createPatient(env, {
    familyKanji: "佐藤",
    givenKanji: "誠",
    familyKana: "サトウ",
    givenKana: "マコト",
    gender: "male",
    birthDate: "1966-09-14",
  });
  if (!patient?.id) return;
  const patientId = patient.id;
  const internal = departmentOf(env, "糖尿病内科", "内分泌内科", "内科");
  const requester = requesterOf(env, internal);

  const labs = new LabMaster();
  await labs.load(Object.values(LAB));
  const drugs = new DrugMaster();
  await drugs.load(Object.values(MED), [BID]);

  const t0 = weekday(daysAgo(START_DAYS_AGO));
  const day = (n: number) => addDays(t0, n);
  const dm = await createProblem(patientId, 1, { disease: await findDisease("２型糖尿病"), start: addDays(t0, -400) });
  await createProblem(patientId, 2, { disease: await findDisease("慢性歯周炎"), start: day(EXAMS[0].day) });

  for (let k = 0; k < A1C.length; k += 1) {
    const date = weekday(day(28 * k));
    const a1c = A1C[k];
    const glucose = Math.round(a1c * 28.7 - 46.7 + ((k * 7) % 11) - 5);
    const lab = labResultBundle(env, labs, patient, internal, date, [[LAB.a1c, a1c], [LAB.glu, glucose]]);
    const rx = prescriptionBundle(drugs, patientId, requester, date, [{ usage: BID, days: 28, medicines: [[MED.met500, 2]] }], dm);
    const vitals = vitalEntries(patientId, at(date, "09:30"), { weight: 72.4 - k * 0.05, systolic: 128, diastolic: 78 });
    await post({ resourceType: "Bundle", type: "transaction", entry: [...(lab?.entry ?? []), ...(rx.entry ?? []), ...vitals] });
  }

  const exams = EXAMS.filter((exam) => day(exam.day) <= daysAgo(0));
  for (const exam of exams) {
    const entries = templateEntries(env, questionnaire, patient, at(weekday(day(exam.day)), "14:00"), {
      exam_type: exam.exam,
      present_teeth: exam.teeth,
      pd4_sites: exam.pd4,
      pd6_sites: exam.pd6,
      max_pd: exam.maxPd,
      bop_rate: exam.bop,
      pisa: exam.pisa,
      pcr: exam.pcr,
      mobility_teeth: exam.mobility,
      stage: STAGE,
      grade: GRADE,
    });
    await post({ resourceType: "Bundle", type: "transaction", entry: entries });
  }

  env.log(`歯周病×糖尿病: 外来 ${A1C.length} 回・歯周検査 ${exams.length} 回を登録(チャートは院内共通の「歯周病×糖尿病」)`);
}
