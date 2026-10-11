// 糖尿病外来の患者集団(データ抽出の見本)。2 型糖尿病の 30 人を、3 人の医師が 8 週ごとの外来で診ている。
// 1 人ずつの経過より、集団として抜き出したときに差が見えることを狙う。
//
// - 医師ごとにコントロールの傾向が違う(先頭の医師は混在、2 人目は良好、3 人目は不良)。医師が 1 人しかいない
//   環境では全員がその医師になる。
// - 受診中断(最終受診が 180 日以上前)、診断から 90 日以上 HbA1c を測っていない新患、SU 薬の低血糖、
//   尿アルブミンが増えているのに腎症の病名が無い人、クレアチニンが上がってもメトホルミンが続いている人、
//   教育入院などを混ぜる。データ抽出の院内共通の初期値(backend/db/seed_data/extract_query_presets.json)で当たる。
// - 外来受診は当日受付の予約 + 担当医つきの診察の Encounter で作る(外来の担当医・入外の抽出に出る)。

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
  outpatientVisitEntries,
  post,
  prescriptionBundle,
  requesterOf,
  vitalEntries,
  weekday,
  type Named,
  type RpSpec,
  type SeedEnv,
} from "./base";
import { addDays } from "../lib/dates";
import { LAB as DM_LAB, MED } from "./diabetes";

const LAB = { ...DM_LAB, tg: "160020910" };
const BID = "１日２回朝夕食後　服用";
const TID = "１日３回朝昼夕食後　服用";
const QD = "１日１回朝食後　服用";

const INTERVAL = 56;

/** 処方の組み合わせ。BG1〜3 はメトホルミン 500・1000・1500mg、SU1・2 はグリメピリド 1・2mg。 */
type Drug = "BG1" | "BG2" | "BG3" | "DPP" | "SGLT" | "SU1" | "SU2";

interface Member {
  name: [family: string, given: string, familyKana: string, givenKana: string];
  gender: "male" | "female";
  birthDate: string;
  /** 担当医(env.doctors の添字。医師が足りなければ折り返す)。 */
  doctor: number;
  visits: number;
  /** 最終受診が何日前か。 */
  lastDaysAgo: number;
  /** HbA1c の推移の折れ点(受診の回数に均等に割り付けて間を補う)。 */
  a1c: number[];
  /** [何回目の受診から, 処方]。 */
  drugs: [from: number, drugs: Drug[]][];
  /** 尿A/C比・Cre の推移の折れ点(3 回に 1 回測る)。無ければ正常域。 */
  uacr?: number[];
  cre?: number[];
  /** 合併症の病名を付ける受診(何回目か)。 */
  nephropathy?: number;
  retinopathy?: number;
  neuropathy?: number;
  /** 低血糖(血糖 50 台〜60 台)を起こした受診。 */
  hypo?: number;
  /** 教育入院(14 日)した受診。 */
  admission?: number;
  /** HbA1c を初めて測った受診(既定は初診)。 */
  firstA1c?: number;
  hypertension?: boolean;
  dyslipidemia?: boolean;
}

const MEMBERS: Member[] = [
  // 1 人目の医師(混在)
  { name: ["青木", "武", "アオキ", "タケシ"], gender: "male", birthDate: "1958-03-14", doctor: 0, visits: 13, lastDaysAgo: 10, a1c: [7.8, 7.0, 7.1], drugs: [[0, ["BG2"]], [3, ["BG2", "DPP"]]], hypertension: true },
  { name: ["石川", "美和", "イシカワ", "ミワ"], gender: "female", birthDate: "1966-07-02", doctor: 0, visits: 13, lastDaysAgo: 17, a1c: [6.9, 6.6, 6.8], drugs: [[0, ["BG2"]]], dyslipidemia: true },
  { name: ["上田", "誠一", "ウエダ", "セイイチ"], gender: "male", birthDate: "1949-11-20", doctor: 0, visits: 13, lastDaysAgo: 24, a1c: [8.2, 7.6, 7.4], drugs: [[0, ["DPP"]], [4, ["BG1", "DPP"]]], uacr: [25, 60, 120], cre: [0.9, 1.2, 1.45], nephropathy: 6 },
  { name: ["遠藤", "久美子", "エンドウ", "クミコ"], gender: "female", birthDate: "1972-01-25", doctor: 0, visits: 13, lastDaysAgo: 31, a1c: [9.1, 7.2, 6.9], drugs: [[0, ["BG2"]], [2, ["BG3", "SGLT"]]] },
  { name: ["大野", "浩", "オオノ", "ヒロシ"], gender: "male", birthDate: "1955-05-09", doctor: 0, visits: 13, lastDaysAgo: 38, a1c: [7.4, 8.0, 8.6], drugs: [[0, ["BG2"]], [4, ["BG2", "DPP"]], [9, ["BG3", "DPP", "SU1"]]], hypo: 11, retinopathy: 8 },
  { name: ["加藤", "正樹", "カトウ", "マサキ"], gender: "male", birthDate: "1980-09-30", doctor: 0, visits: 9, lastDaysAgo: 290, a1c: [8.5, 7.9, 8.4], drugs: [[0, ["BG2"]]] },
  { name: ["木村", "恵", "キムラ", "メグミ"], gender: "female", birthDate: "1961-04-18", doctor: 0, visits: 13, lastDaysAgo: 45, a1c: [7.0, 7.2, 7.3], drugs: [[0, ["BG2", "DPP"]]], uacr: [20, 35, 48] },
  { name: ["工藤", "勝", "クドウ", "マサル"], gender: "male", birthDate: "1945-12-03", doctor: 0, visits: 13, lastDaysAgo: 52, a1c: [7.6, 7.3, 7.5], drugs: [[0, ["SU1"]], [5, ["SU1", "DPP"]]], hypo: 7, neuropathy: 3 },
  { name: ["小島", "由紀", "コジマ", "ユキ"], gender: "female", birthDate: "1988-06-11", doctor: 0, visits: 3, lastDaysAgo: 12, a1c: [7.9], drugs: [[0, ["BG1"]], [1, ["BG2"]]], firstA1c: 2 },
  { name: ["斎藤", "和也", "サイトウ", "カズヤ"], gender: "male", birthDate: "1968-02-27", doctor: 0, visits: 13, lastDaysAgo: 59, a1c: [8.8, 8.9, 9.2, 7.4, 8.1], drugs: [[0, ["BG2", "DPP"]], [6, ["BG3", "DPP", "SGLT"]]], admission: 6 },
  // 2 人目の医師(良好)
  { name: ["佐野", "典子", "サノ", "ノリコ"], gender: "female", birthDate: "1963-08-08", doctor: 1, visits: 13, lastDaysAgo: 8, a1c: [7.2, 6.5, 6.4], drugs: [[0, ["BG2"]]] },
  { name: ["柴田", "健", "シバタ", "ケン"], gender: "male", birthDate: "1959-10-15", doctor: 1, visits: 13, lastDaysAgo: 15, a1c: [8.0, 6.8, 6.6], drugs: [[0, ["BG2"]], [2, ["BG2", "DPP"]]], hypertension: true },
  { name: ["杉山", "和子", "スギヤマ", "カズコ"], gender: "female", birthDate: "1950-03-22", doctor: 1, visits: 13, lastDaysAgo: 22, a1c: [7.0, 6.8, 6.9], drugs: [[0, ["DPP"]]] },
  { name: ["鈴木", "拓也", "スズキ", "タクヤ"], gender: "male", birthDate: "1975-12-01", doctor: 1, visits: 13, lastDaysAgo: 29, a1c: [9.6, 7.0, 6.7], drugs: [[0, ["BG2", "SGLT"]], [3, ["BG3", "SGLT"]]], dyslipidemia: true },
  { name: ["高田", "洋子", "タカダ", "ヨウコ"], gender: "female", birthDate: "1957-05-30", doctor: 1, visits: 13, lastDaysAgo: 36, a1c: [6.8, 6.6, 6.7], drugs: [[0, ["BG1"]]] },
  { name: ["竹内", "隆", "タケウチ", "タカシ"], gender: "male", birthDate: "1952-07-19", doctor: 1, visits: 13, lastDaysAgo: 43, a1c: [7.4, 6.9, 7.0], drugs: [[0, ["BG2", "DPP"]]], uacr: [45, 40, 32], cre: [1.0, 1.05, 1.1], nephropathy: 0 },
  { name: ["田村", "さおり", "タムラ", "サオリ"], gender: "female", birthDate: "1970-11-11", doctor: 1, visits: 13, lastDaysAgo: 50, a1c: [7.6, 6.9, 6.9], drugs: [[0, ["BG2"]], [4, ["BG2", "SGLT"]]] },
  { name: ["千葉", "茂", "チバ", "シゲル"], gender: "male", birthDate: "1941-01-08", doctor: 1, visits: 13, lastDaysAgo: 57, a1c: [7.3, 7.1, 7.2], drugs: [[0, ["DPP"]]], retinopathy: 0, neuropathy: 5 },
  { name: ["中野", "修", "ナカノ", "オサム"], gender: "male", birthDate: "1983-04-04", doctor: 1, visits: 7, lastDaysAgo: 400, a1c: [7.2, 6.9, 7.0], drugs: [[0, ["BG2"]]] },
  { name: ["西村", "真理", "ニシムラ", "マリ"], gender: "female", birthDate: "1964-09-09", doctor: 1, visits: 4, lastDaysAgo: 26, a1c: [8.4, 7.1], drugs: [[0, ["BG2"]]] },
  // 3 人目の医師(不良)
  { name: ["野口", "博之", "ノグチ", "ヒロユキ"], gender: "male", birthDate: "1967-06-06", doctor: 2, visits: 13, lastDaysAgo: 9, a1c: [8.6, 8.9, 9.3], drugs: [[0, ["BG2"]], [3, ["BG3", "DPP"]], [8, ["BG3", "DPP", "SU1"]]], hypo: 10, hypertension: true },
  { name: ["橋本", "京子", "ハシモト", "キョウコ"], gender: "female", birthDate: "1953-02-14", doctor: 2, visits: 13, lastDaysAgo: 16, a1c: [8.1, 8.5, 8.3], drugs: [[0, ["SU1"]], [6, ["SU2", "DPP"]]], hypo: 9, uacr: [30, 90, 210], cre: [0.8, 0.95, 1.1], nephropathy: 7 },
  { name: ["林", "大輔", "ハヤシ", "ダイスケ"], gender: "male", birthDate: "1978-08-25", doctor: 2, visits: 13, lastDaysAgo: 23, a1c: [9.8, 8.7, 9.1], drugs: [[0, ["BG2", "SGLT"]], [5, ["BG3", "SGLT", "DPP"]]], admission: 4, dyslipidemia: true },
  { name: ["原田", "正", "ハラダ", "タダシ"], gender: "male", birthDate: "1946-10-10", doctor: 2, visits: 13, lastDaysAgo: 30, a1c: [8.0, 8.2, 8.4], drugs: [[0, ["BG2", "SU1"]]], uacr: [80, 180, 320], cre: [1.2, 1.4, 1.6], nephropathy: 3, retinopathy: 6 },
  { name: ["平野", "美智子", "ヒラノ", "ミチコ"], gender: "female", birthDate: "1960-12-24", doctor: 2, visits: 13, lastDaysAgo: 37, a1c: [7.9, 8.3, 8.1], drugs: [[0, ["BG2"]], [5, ["BG2", "DPP"]]], uacr: [28, 42, 66] },
  { name: ["福田", "剛", "フクダ", "ツヨシ"], gender: "male", birthDate: "1971-03-03", doctor: 2, visits: 10, lastDaysAgo: 220, a1c: [9.0, 8.6, 9.2], drugs: [[0, ["BG2"]], [4, ["BG3", "DPP"]]] },
  { name: ["藤井", "千代", "フジイ", "チヨ"], gender: "female", birthDate: "1948-04-29", doctor: 2, visits: 13, lastDaysAgo: 44, a1c: [8.3, 7.9, 8.2], drugs: [[0, ["DPP"]], [4, ["DPP", "SU1"]]], neuropathy: 8 },
  { name: ["松本", "隆司", "マツモト", "タカシ"], gender: "male", birthDate: "1962-01-17", doctor: 2, visits: 13, lastDaysAgo: 51, a1c: [7.8, 8.4, 8.8], drugs: [[0, ["BG2", "DPP"]], [7, ["BG3", "DPP", "SGLT"]]], admission: 10 },
  { name: ["宮崎", "優", "ミヤザキ", "ユウ"], gender: "male", birthDate: "1985-07-07", doctor: 2, visits: 4, lastDaysAgo: 20, a1c: [9.4, 8.2], drugs: [[0, ["BG2"]]], firstA1c: 2 },
  { name: ["山口", "節子", "ヤマグチ", "セツコ"], gender: "female", birthDate: "1956-09-01", doctor: 2, visits: 13, lastDaysAgo: 58, a1c: [8.2, 7.8, 8.0], drugs: [[0, ["BG2", "SU1"]]], dyslipidemia: true },
];

const DISEASES = {
  dm: "２型糖尿病",
  nephropathy: "２型糖尿病性腎症",
  retinopathy: "２型糖尿病網膜症",
  neuropathy: "２型糖尿病性ニューロパチー",
  hypo: "医原性低血糖症",
  hypertension: "高血圧症",
  dyslipidemia: "脂質異常症",
};

export const REQUIREMENTS = {
  labs: Object.values(LAB),
  medicines: [MED.met250, MED.met500, MED.sita, MED.empa, MED.glim],
  usages: [BID, TID, QD],
  diseases: Object.values(DISEASES),
};

/** 折れ点を n 回に均等に割り付け、間を直線で補う。 */
function curve(points: number[], n: number, k: number): number {
  if (points.length === 1 || n === 1) return points[0];
  const position = (k / (n - 1)) * (points.length - 1);
  const i = Math.min(Math.floor(position), points.length - 2);
  return points[i] + (points[i + 1] - points[i]) * (position - i);
}

/** 人と回で決まる小さな揺らぎ(-1〜1)。流すたびに同じ値になる。 */
function jitter(seed: number, k: number): number {
  return (((seed * 37 + k * 11) % 21) - 10) / 10;
}

function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function rpsOf(drugs: Drug[]): RpSpec[] {
  const rps: RpSpec[] = [];
  if (drugs.includes("BG1")) rps.push({ usage: BID, days: INTERVAL, medicines: [[MED.met250, 2]] });
  if (drugs.includes("BG2")) rps.push({ usage: BID, days: INTERVAL, medicines: [[MED.met500, 2]] });
  if (drugs.includes("BG3")) rps.push({ usage: TID, days: INTERVAL, medicines: [[MED.met500, 3]] });
  const morning: [string, number][] = [];
  if (drugs.includes("DPP")) morning.push([MED.sita, 1]);
  if (drugs.includes("SGLT")) morning.push([MED.empa, 1]);
  if (drugs.includes("SU1")) morning.push([MED.glim, 1]);
  if (drugs.includes("SU2")) morning.push([MED.glim, 2]);
  if (morning.length) rps.push({ usage: QD, days: INTERVAL, medicines: morning });
  return rps;
}

function drugsAt(member: Member, k: number): Drug[] {
  return member.drugs.filter(([from]) => from <= k).at(-1)?.[1] ?? [];
}

async function seedMember(
  env: SeedEnv,
  member: Member,
  seed: number,
  labs: LabMaster,
  drugs: DrugMaster,
  diseases: Record<keyof typeof DISEASES, Awaited<ReturnType<typeof findDisease>>>,
): Promise<boolean> {
  const [familyKanji, givenKanji, familyKana, givenKana] = member.name;
  const patient = await createPatient(env, {
    familyKanji,
    givenKanji,
    familyKana,
    givenKana,
    gender: member.gender,
    birthDate: member.birthDate,
  });
  if (!patient?.id) return false;
  const patientId = patient.id;
  const department = departmentOf(env, "糖尿病内科", "内分泌内科", "内科");
  const doctor: Named = env.doctors[member.doctor % env.doctors.length] ?? env.practitioner;
  const requester = requesterOf(env, department, doctor);

  const visits = Array.from({ length: member.visits }, (_, k) =>
    weekday(daysAgo(member.lastDaysAgo + INTERVAL * (member.visits - 1 - k))),
  );
  const dm = await createProblem(patientId, 1, { disease: diseases.dm, start: visits[0] });
  let number = 2;
  const child = async (key: "nephropathy" | "retinopathy" | "neuropathy") => {
    const k = member[key];
    if (k == null) return;
    await createProblem(patientId, number++, { disease: diseases[key], start: visits[k], parentId: dm.conditionId });
  };
  await child("nephropathy");
  await child("retinopathy");
  await child("neuropathy");
  if (member.hypertension) await createProblem(patientId, number++, { disease: diseases.hypertension, start: visits[0] });
  if (member.dyslipidemia) await createProblem(patientId, number++, { disease: diseases.dyslipidemia, start: visits[0] });
  if (member.hypo != null) {
    const end = visits[member.hypo + 1] ?? addDays(visits[member.hypo], 14);
    const resolved = end <= daysAgo(0);
    await createProblem(patientId, number++, {
      disease: diseases.hypo,
      start: visits[member.hypo],
      end: resolved ? end : undefined,
      outcome: resolved ? "resolved" : "active",
    });
  }

  const male = member.gender === "male";
  const baseWeight = male ? 70 + (seed % 5) * 3 : 55 + (seed % 4) * 3;
  for (let k = 0; k < visits.length; k += 1) {
    const date = visits[k];
    const a1c = round(curve(member.a1c, member.visits, k) + jitter(seed, k) * 0.1, 1);
    const glucose =
      member.hypo === k ? 54 + (seed % 10) : Math.round(a1c * 28.7 - 46.7 + jitter(seed + 3, k) * 15);
    const values: [string, number][] = [[LAB.glu, glucose]];
    if (k >= (member.firstA1c ?? 0)) values.unshift([LAB.a1c, a1c]);
    if (k % 3 === 0 || k === visits.length - 1) {
      const uacr = member.uacr ? curve(member.uacr, member.visits, k) : 12 + (seed % 9);
      const cre = member.cre ? curve(member.cre, member.visits, k) : male ? 0.82 : 0.62;
      values.push([LAB.uac, Math.round(uacr + jitter(seed, k) * 2)], [LAB.cre, round(cre + jitter(seed + 1, k) * 0.03, 2)]);
      values.push([LAB.ldl, Math.round((member.dyslipidemia ? 138 : 108) + jitter(seed + 2, k) * 12)]);
      values.push([LAB.tg, Math.round((member.dyslipidemia ? 190 : 120) + jitter(seed + 4, k) * 30)]);
    }
    const lab = labResultBundle(env, labs, patient, department, date, values);
    const rx = prescriptionBundle(drugs, patientId, requester, date, rpsOf(drugsAt(member, k)), dm);
    const systolic = (member.hypertension ? 142 : 126) + Math.round(jitter(seed + 5, k) * 8);
    const vitals = vitalEntries(patientId, department, at(date, "09:20"), {
      weight: round(baseWeight + (a1c - member.a1c[0]) * 1.5 + jitter(seed + 6, k) * 0.6, 1),
      systolic,
      diastolic: Math.round(systolic * 0.62),
    });
    await post({
      resourceType: "Bundle",
      type: "transaction",
      entry: [
        ...outpatientVisitEntries(patient, department, doctor, date, k === 0),
        ...(lab?.entry ?? []),
        ...(rx.entry ?? []),
        ...vitals,
      ],
    });
  }

  if (member.admission != null) {
    const admitted = addDays(visits[member.admission], 3);
    await createStay(env, patient, department, admitted, addDays(admitted, 14), seed);
  }
  return true;
}

export async function seedDiabetesCohort(env: SeedEnv): Promise<void> {
  const labs = new LabMaster();
  await labs.load(REQUIREMENTS.labs);
  const drugs = new DrugMaster();
  await drugs.load(REQUIREMENTS.medicines, REQUIREMENTS.usages);
  const diseases = Object.fromEntries(
    await Promise.all(Object.entries(DISEASES).map(async ([key, name]) => [key, await findDisease(name)] as const)),
  ) as Record<keyof typeof DISEASES, Awaited<ReturnType<typeof findDisease>>>;

  env.log(`医師: ${env.doctors.slice(0, 3).map((d) => d.name).join("、")}`);
  let created = 0;
  for (const [seed, member] of MEMBERS.entries()) {
    if (await seedMember(env, member, seed, labs, drugs, diseases)) created += 1;
  }
  env.log(`糖尿病外来の患者集団: ${created} 人を登録(${MEMBERS.length} 人中)`);
}
