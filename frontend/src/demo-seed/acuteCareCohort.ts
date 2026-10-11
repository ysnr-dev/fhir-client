// 入院・注射・部門オーダーの患者集団(データ抽出の見本)。糖尿病外来の集団(diabetesCohort)では当たらない
// 院内共通の初期値(backend/db/seed_data/extract_query_presets.json)に、それぞれ当たる人と当たらない人を置く。
//
// - 直近 30 日の入院・退院: 入院中 2 人(肺炎・脳梗塞)と、30 日以内に退院した 2 人(腎盂腎炎・鼠径ヘルニア)
// - 抗菌薬の注射が 30 日に 2 回以上: 肺炎(連日)・腎盂腎炎(1 日 2 回)。蜂窩織炎の外来 1 回は当たらない
// - 退院後 30 日以内の再入院: 心不全の再入院と、胆嚢摘出後の創部感染(後者は手術後 30 日以内の再入院にも当たる)
// - 直近 30 日の放射線検査の実施: 肺炎(胸部)・脳梗塞(頭部 CT)・膝の痛み(膝)
// - 内視鏡の依頼があり実施のない患者: 大腸内視鏡を依頼して来なかった 1 人。胃の内視鏡を済ませた 1 人は当たらない
//
// 入院は手持ちのベッドに入れる(入院中の 2 人は空きベッド。空きが無ければ入院を作らない)。

import {
  at,
  createCurrentStay,
  createdOf,
  createPatient,
  createProblem,
  createStay,
  daysAgo,
  departmentOf,
  DrugMaster,
  findDisease,
  headerOf,
  LabMaster,
  labResultBundle,
  outpatientVisitEntries,
  post,
  requesterOf,
  stampAuthoredOn,
  type Department,
  type PatientSpec,
  type SeedEnv,
} from "./base";
import { addDays } from "../lib/dates";
import { searchEndoscopyItems, searchRadItems, searchSurgeryItems, type Medicine } from "../api/masterClient";
import type { OrderContext } from "../orderContext";
import type { ProblemRef } from "../fhir/conditionHelpers";
import type { PrescriptionSetting } from "../fhir/prescriptionHelpers";
import { buildInjectionBundle, emptyInjectionForm, emptyInjectionRp } from "../fhir/injectionHelpers";
import { buildInjectionPerformBundle, emptyInjectionPerformForm } from "../fhir/injectionPerformHelpers";
import { buildEndoscopyOrderBundle, emptyEndoscopyOrderForm } from "../fhir/endoscopyOrderHelpers";
import { buildEndoscopyPerformBundle } from "../fhir/endoscopyResultHelpers";
import { buildRadOrderBundle, emptyRadOrderForm } from "../fhir/radOrderHelpers";
import { buildRadPerformBundle } from "../fhir/radResultHelpers";
import { buildSurgeryOrderBundle, emptySurgeryOrderForm } from "../fhir/surgeryOrderHelpers";
import { buildSurgeryPerformBundle, emptySurgeryPerformForm } from "../fhir/surgeryResultHelpers";

const LAB = { wbc: "160008010-01", crp: "160054710" };

/** 抗菌薬はどれも生食 100mL 付きのキット(1 本で 1 回分)。 */
const MED = {
  ctrx: "620002955",
  cez: "621757001",
  sbtAbpc: "620004776",
};

const DISEASES = {
  pneumonia: "細菌性肺炎",
  pyelonephritis: "急性腎盂腎炎",
  heartFailure: "慢性心不全",
  gallstone: "胆のう結石症",
  woundInfection: "術後創部感染",
  hernia: "鼠径ヘルニア",
  polyp: "大腸ポリープ",
  gastritis: "慢性胃炎",
  infarction: "アテローム血栓性脳梗塞",
  knee: "変形性膝関節症",
  cellulitis: "下腿蜂巣炎",
};

const RAD = {
  chest: ["胸部立位正面", "Ｘ線単純撮影胸部立位正面(P→A)"],
  headCt: ["頭部仰臥位", "Ｘ線ＣＴ検査頭部仰臥位"],
  knee: ["右膝関節正面", "Ｘ線単純撮影右膝関節正面(指定無し)"],
} as const;

const ENDOSCOPY = {
  colon: ["大腸内視鏡", "大腸内視鏡検査(全大腸)"],
  egd: ["上部消化管内視鏡", "上部消化管内視鏡(経口)"],
} as const;

const SURGERY = {
  cholecystectomy: ["胆嚢摘出", "腹腔鏡下胆嚢摘出術"],
  hernia: ["鼠径ヘルニア", "鼠径ヘルニア手術"],
} as const;

export const REQUIREMENTS = {
  labs: Object.values(LAB),
  medicines: Object.values(MED),
  usages: [] as string[],
  diseases: Object.values(DISEASES),
  radItems: Object.values(RAD),
  endoscopyItems: Object.values(ENDOSCOPY),
  surgeryItems: Object.values(SURGERY),
};

type Item = readonly [keyword: string, name: string];

/** マスタを語で引き、名称が一致する項目を返す(無ければ null)。 */
async function findItem<T extends { name: string }>(
  search: (params: { keyword: string; per: number }) => Promise<{ items: T[] }>,
  [keyword, name]: Item,
): Promise<T | null> {
  const result = await search({ keyword, per: 50 }).catch(() => ({ items: [] as T[] }));
  return result.items.find((item) => item.name === name) ?? null;
}

export const findRadItem = (item: Item) => findItem(searchRadItems, item);
export const findEndoscopyItem = (item: Item) => findItem(searchEndoscopyItems, item);
export const findSurgeryItem = (item: Item) => findItem(searchSurgeryItems, item);

interface Context {
  env: SeedEnv;
  patient: fhir4.Patient;
  patientId: string;
  department: Department;
  requester: OrderContext;
  labs: LabMaster;
}

async function visit(c: Context, date: string, first: boolean) {
  await post({
    resourceType: "Bundle",
    type: "transaction",
    entry: outpatientVisitEntries(c.patient, c.department, c.env.practitioner, date, first),
  });
}

async function labs(c: Context, date: string, wbc: number, crp: number, setting: "outpatient" | "inpatient") {
  const bundle = labResultBundle(c.env, c.labs, c.patient, c.department, date, [[LAB.wbc, wbc], [LAB.crp, crp]], setting);
  if (bundle) await post(bundle);
}

/**
 * 抗菌薬の点滴を start から days 日、1 日 times.length 回(1 日 1 オーダー)。今日までの分は全回実施済みにする。
 */
async function antibiotic(
  c: Context,
  problem: ProblemRef,
  setting: PrescriptionSetting,
  start: string,
  days: number,
  medicine: Medicine,
  times: string[],
) {
  const values = {
    ...emptyInjectionForm(problem, setting),
    startDate: start,
    endDate: addDays(start, days - 1),
    rps: [
      {
        ...emptyInjectionRp,
        usageType: "drip" as const,
        routeCode: "IV",
        methodCode: "30",
        lineCode: "peripheral",
        rate: "200",
        times: times.map((time) => ({ start: time, end: "" })),
        medicines: [{ medicine, dose: "1", comment: "" }],
      },
    ],
  };
  const ids = await post(stampAuthoredOn(buildInjectionBundle(values, c.patientId, c.requester), at(start)));
  const orders = (await createdOf(ids, "ServiceRequest")) as fhir4.ServiceRequest[];
  const mrs = (await createdOf(ids, "MedicationRequest")) as fhir4.MedicationRequest[];
  const now = daysAgo(0);
  const entries: fhir4.BundleEntry[] = [];
  for (const order of orders) {
    const day = order.occurrenceDateTime?.slice(0, 10) ?? "";
    if (!day || day > now) continue;
    const own = mrs.filter((mr) => mr.basedOn?.some((ref) => ref.reference === `ServiceRequest/${order.id}`));
    times.forEach((time, k) => {
      const perform = {
        ...emptyInjectionPerformForm(own),
        startedAt: `${day}T${time}`,
        performerId: c.env.practitioner.id,
        performerName: c.env.practitioner.name,
      };
      entries.push(...(buildInjectionPerformBundle(perform, order, own, undefined, k).entry ?? []));
    });
  }
  if (entries.length) await post({ resourceType: "Bundle", type: "transaction", entry: entries });
}

async function radExam(c: Context, problem: ProblemRef, item: Item, date: string, purpose: string, setting: PrescriptionSetting) {
  const found = await findRadItem(item);
  if (!found) return c.env.log(`放射線マスタに ${item[1]} が無いので飛ばします`);
  const values = {
    ...emptyRadOrderForm(problem, setting),
    startDate: date,
    items: [
      {
        id: "",
        code: found.item_code,
        name: found.name,
        shortName: found.short_name ?? "",
        jj1017Code: found.jj1017_code ?? "",
        modalityCode: found.modality_code ?? "",
        modalityName: "",
        bodyPartCode: found.body_part_code ?? "",
        bodyPartName: "",
        lateralityCode: found.laterality_code ?? "",
        lateralityName: "",
        reasonConditionId: problem.conditionId,
        reasonName: problem.display,
        purpose,
        remarks: "",
        purposeTemplate: null,
        remarksTemplate: null,
        parentCode: "",
        groupable: found.groupable,
        date,
        time: "",
        priority: "routine" as const,
        undated: false,
      },
    ],
  };
  const order = await headerOf(await post(stampAuthoredOn(buildRadOrderBundle(values, c.patientId, c.requester), at(date))));
  await post(
    buildRadPerformBundle(
      {
        performedAt: `${date}T11:00`,
        performerId: c.env.practitioner.id,
        performerName: c.env.practitioner.name,
        procedures: [{ code: found.item_code, name: found.name }],
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

/** 内視鏡の依頼。performed なら当日に実施まで入れる。 */
async function endoscopy(c: Context, problem: ProblemRef, item: Item, date: string, purpose: string, performed: string | null) {
  const found = await findEndoscopyItem(item);
  if (!found) return c.env.log(`内視鏡マスタに ${item[1]} が無いので飛ばします`);
  const values = {
    ...emptyEndoscopyOrderForm(problem, "outpatient"),
    startDate: date,
    items: [
      {
        id: "",
        code: found.item_code,
        name: found.name,
        shortName: found.short_name ?? "",
        examTypeCode: found.exam_type_code ?? "",
        examTypeName: "",
        reasonConditionId: problem.conditionId,
        reasonName: problem.display,
        purpose,
        remarks: "",
        purposeTemplate: null,
        remarksTemplate: null,
        parentCode: "",
        groupable: found.groupable,
        date,
        time: "",
        priority: "routine" as const,
        undated: false,
      },
    ],
  };
  const order = await headerOf(
    await post(stampAuthoredOn(buildEndoscopyOrderBundle(values, c.patientId, c.requester), at(addDays(date, -14)))),
  );
  if (performed == null) return;
  await post(
    buildEndoscopyPerformBundle(
      {
        performedAt: `${date}T10:00`,
        performerId: c.env.practitioner.id,
        performerName: c.env.practitioner.name,
        procedures: [{ code: found.item_code, name: found.name }],
        medicines: [],
        materials: [],
        comment: performed,
      },
      order,
      undefined,
    ),
  );
}

async function surgery(c: Context, problem: ProblemRef, item: Item, date: string, bodySite: string, minutes: number) {
  const found = await findSurgeryItem(item);
  if (!found) return c.env.log(`術式マスタに ${item[1]} が無いので飛ばします`);
  const room = c.env.locations.find((l) => l.name.includes("手術室"));
  const staff = [{ role: "surgeon" as const, practitionerId: c.env.practitioner.id, practitionerName: c.env.practitioner.name }];
  const values = {
    ...emptySurgeryOrderForm(problem, "inpatient"),
    scheduledDate: date,
    scheduledTime: "09:00",
    durationMinutes: String(minutes),
    roomId: room?.id ?? "",
    roomName: room?.name ?? "",
    surgicalDepartmentId: c.department.id,
    surgicalDepartmentName: c.department.name,
    staff,
    items: [
      {
        id: "",
        code: found.item_code,
        name: found.name,
        shortName: found.short_name ?? "",
        receiptCode: found.receipt_code ?? "",
        bodySiteText: bodySite,
        laterality: "",
        approach: "",
        reasonConditionId: problem.conditionId,
        reasonName: problem.display,
      },
    ],
  };
  const order = await headerOf(
    await post(stampAuthoredOn(buildSurgeryOrderBundle(values, c.patientId, c.requester), at(addDays(date, -14)))),
  );
  const end = new Date(new Date(at(date, "09:00")).getTime() + (minutes + 20) * 60_000);
  const exited = `${date}T${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`;
  await post(
    buildSurgeryPerformBundle(
      { ...emptySurgeryPerformForm(), enteredAt: `${date}T08:50`, exitedAt: exited, staff, procedures: [{ code: found.item_code, name: found.name }] },
      order,
      undefined,
    ),
  );
}

type Diseases = Record<keyof typeof DISEASES, Awaited<ReturnType<typeof findDisease>>>;

interface Member {
  spec: PatientSpec;
  departments: string[];
  story: (c: Context, d: Diseases, medicine: (code: string) => Medicine) => Promise<void>;
}

const d = daysAgo;

const MEMBERS: Member[] = [
  {
    // 肺炎で入院中。入院日から CTRX を連日、胸部 X 線は入院時と 5 日目。
    spec: { familyKanji: "高橋", givenKanji: "清", familyKana: "タカハシ", givenKana: "キヨシ", gender: "male", birthDate: "1939-05-20" },
    departments: ["呼吸器内科", "内科"],
    story: async (c, dz, med) => {
      const problem = await createProblem(c.patientId, 1, { disease: dz.pneumonia, start: d(6) });
      await createCurrentStay(c.env, c.patient, c.department, d(6));
      await labs(c, d(6), 14.8, 12.6, "inpatient");
      await radExam(c, problem, RAD.chest, d(6), "肺炎の評価", "inpatient");
      await antibiotic(c, problem, "inpatient", d(6), 7, med(MED.ctrx), ["10:00"]);
      await labs(c, d(2), 9.1, 4.8, "inpatient");
      await radExam(c, problem, RAD.chest, d(2), "肺炎の経過", "inpatient");
    },
  },
  {
    // 脳梗塞で入院中。頭部 CT のみ、抗菌薬は無し。
    spec: { familyKanji: "石井", givenKanji: "幸子", familyKana: "イシイ", givenKana: "サチコ", gender: "female", birthDate: "1941-09-09" },
    departments: ["脳神経内科", "神経内科", "内科"],
    story: async (c, dz) => {
      const problem = await createProblem(c.patientId, 1, { disease: dz.infarction, start: d(3) });
      await createCurrentStay(c.env, c.patient, c.department, d(3));
      await radExam(c, problem, RAD.headCt, d(3), "右片麻痺の精査", "inpatient");
    },
  },
  {
    // 腎盂腎炎で 8 日入院し 16 日前に退院。CEZ を 1 日 2 回 7 日。
    spec: { familyKanji: "吉田", givenKanji: "春江", familyKana: "ヨシダ", givenKana: "ハルエ", gender: "female", birthDate: "1950-02-11" },
    departments: ["腎臓内科", "泌尿器科", "内科"],
    story: async (c, dz, med) => {
      const problem = await createProblem(c.patientId, 1, { disease: dz.pyelonephritis, start: d(24), end: d(16), outcome: "resolved" });
      await createStay(c.env, c.patient, c.department, d(24), d(16), 1);
      await labs(c, d(24), 16.2, 15.3, "inpatient");
      await antibiotic(c, problem, "inpatient", d(24), 7, med(MED.cez), ["08:00", "20:00"]);
      await labs(c, d(18), 7.4, 2.1, "inpatient");
    },
  },
  {
    // 鼠径ヘルニアの待機手術。19 日前に手術、17 日前に退院し、再入院は無い。
    spec: { familyKanji: "森田", givenKanji: "賢治", familyKana: "モリタ", givenKana: "ケンジ", gender: "male", birthDate: "1952-04-15" },
    departments: ["外科", "消化器外科"],
    story: async (c, dz) => {
      const problem = await createProblem(c.patientId, 1, { disease: dz.hernia, start: d(48), end: d(19), outcome: "resolved" });
      await visit(c, d(48), true);
      await createStay(c.env, c.patient, c.department, d(20), d(17), 2);
      await surgery(c, problem, SURGERY.hernia, d(19), "右鼠径部", 90);
      await visit(c, d(10), false);
    },
  },
  {
    // 心不全の増悪で入院 → 退院 14 日後に再入院(退院後 30 日以内の再入院)。
    spec: { familyKanji: "渡辺", givenKanji: "茂樹", familyKana: "ワタナベ", givenKana: "シゲキ", gender: "male", birthDate: "1944-08-03" },
    departments: ["循環器内科", "内科"],
    story: async (c, dz) => {
      const problem = await createProblem(c.patientId, 1, { disease: dz.heartFailure, start: d(75) });
      await createStay(c.env, c.patient, c.department, d(75), d(62), 3);
      await radExam(c, problem, RAD.chest, d(75), "心拡大・胸水の評価", "inpatient");
      await createStay(c.env, c.patient, c.department, d(48), d(36), 3);
      await radExam(c, problem, RAD.chest, d(48), "心不全の再増悪", "inpatient");
    },
  },
  {
    // 胆嚢摘出の 11 日後に創部感染で再入院(手術後 30 日以内の再入院・退院後 30 日以内の再入院)。
    spec: { familyKanji: "中村", givenKanji: "恵美子", familyKana: "ナカムラ", givenKana: "エミコ", gender: "female", birthDate: "1958-12-07" },
    departments: ["外科", "消化器外科"],
    story: async (c, dz, med) => {
      const gallstone = await createProblem(c.patientId, 1, { disease: dz.gallstone, start: d(64), end: d(49), outcome: "resolved" });
      await visit(c, d(64), true);
      await createStay(c.env, c.patient, c.department, d(50), d(45), 4);
      await surgery(c, gallstone, SURGERY.cholecystectomy, d(49), "胆嚢", 120);
      const infection = await createProblem(c.patientId, 2, { disease: dz.woundInfection, start: d(38), end: d(31), outcome: "resolved" });
      await createStay(c.env, c.patient, c.department, d(38), d(31), 4);
      await labs(c, d(38), 12.9, 8.4, "inpatient");
      await antibiotic(c, infection, "inpatient", d(38), 6, med(MED.sbtAbpc), ["06:00", "14:00", "22:00"]);
      await labs(c, d(33), 6.8, 0.9, "inpatient");
    },
  },
  {
    // 便潜血陽性で大腸内視鏡を依頼したが、予約の日に来なかった(依頼があり実施のない患者)。
    spec: { familyKanji: "岡田", givenKanji: "美代子", familyKana: "オカダ", givenKana: "ミヨコ", gender: "female", birthDate: "1961-06-22" },
    departments: ["消化器内科", "内科"],
    story: async (c, dz) => {
      await visit(c, d(35), true);
      const problem = await createProblem(c.patientId, 1, { disease: dz.polyp, start: d(35), suspected: true });
      await endoscopy(c, problem, ENDOSCOPY.colon, d(14), "便潜血陽性の精査", null);
    },
  },
  {
    // 胃の内視鏡を依頼どおりに実施(依頼があり実施のない患者には当たらない)。
    spec: { familyKanji: "前田", givenKanji: "隆", familyKana: "マエダ", givenKana: "タカシ", gender: "male", birthDate: "1970-10-02" },
    departments: ["消化器内科", "内科"],
    story: async (c, dz) => {
      await visit(c, d(40), true);
      const problem = await createProblem(c.patientId, 1, { disease: dz.gastritis, start: d(40) });
      await endoscopy(c, problem, ENDOSCOPY.egd, d(21), "心窩部痛の精査", "胃体部に萎縮性変化。潰瘍なし。");
      await visit(c, d(21), false);
    },
  },
  {
    // 膝の痛みで外来。膝の X 線を当日に撮影。
    spec: { familyKanji: "菅原", givenKanji: "豊", familyKana: "スガワラ", givenKana: "ユタカ", gender: "male", birthDate: "1955-01-30" },
    departments: ["整形外科"],
    story: async (c, dz) => {
      await visit(c, d(5), true);
      const problem = await createProblem(c.patientId, 1, { disease: dz.knee, start: d(5) });
      await radExam(c, problem, RAD.knee, d(5), "右膝痛", "outpatient");
    },
  },
  {
    // 蜂窩織炎で外来の点滴 1 回(抗菌薬の注射 2 回以上には当たらない)。
    spec: { familyKanji: "坂本", givenKanji: "直人", familyKana: "サカモト", givenKana: "ナオト", gender: "male", birthDate: "1990-03-12" },
    departments: ["皮膚科", "内科"],
    story: async (c, dz, med) => {
      await visit(c, d(9), true);
      const problem = await createProblem(c.patientId, 1, { disease: dz.cellulitis, start: d(9), end: d(2), outcome: "resolved" });
      await labs(c, d(9), 11.2, 5.6, "outpatient");
      await antibiotic(c, problem, "outpatient", d(9), 1, med(MED.cez), ["11:00"]);
      await visit(c, d(2), false);
    },
  },
];

export async function seedAcuteCareCohort(env: SeedEnv): Promise<void> {
  const labMaster = new LabMaster();
  await labMaster.load(REQUIREMENTS.labs);
  const drugs = new DrugMaster();
  await drugs.load(REQUIREMENTS.medicines, []);
  const diseases = Object.fromEntries(
    await Promise.all(Object.entries(DISEASES).map(async ([key, name]) => [key, await findDisease(name)] as const)),
  ) as Diseases;
  const medicine = (code: string) => drugs.medicine(code);

  let created = 0;
  for (const member of MEMBERS) {
    const patient = await createPatient(env, member.spec);
    if (!patient?.id) continue;
    const department = departmentOf(env, ...member.departments);
    await member.story(
      { env, patient, patientId: patient.id, department, requester: requesterOf(env, department), labs: labMaster },
      diseases,
      medicine,
    );
    created += 1;
  }
  env.log(`入院・部門オーダーの患者集団: ${created} 人を登録(${MEMBERS.length} 人中)`);
}
