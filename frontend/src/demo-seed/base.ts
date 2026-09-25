// デモ用のサンプル患者を作る生成器の土台。アプリの画面が使う組み立て関数(fhir/*Helpers)で
// リソースを作り、画面と同じ経路(/fhir・/master)に書き込むので、画面で登録したものと同じ形になる。
//
// アプリからは import しない(本番ビルドに入らない)。開発環境ではブラウザの開発者ツールから
// `await import("/src/demo-seed/index.ts")`、本番は esbuild で 1 ファイルにまとめてログイン済みの
// タブで実行する(docs/demo-seed.md)。
//
// 日付はすべて実行日からの相対で決める(いつ流しても「直近 N 年の経過」になる)。

import { fetchAuthSession } from "../api/authClient";
import { createResource, postBundle, searchResource, typeOperation } from "../api/fhirClient";
import {
  createChartDefinition,
  fetchChartDefinitions,
  fetchLabResultItem,
  fetchMedicinesByCodes,
  searchDiseases,
  searchMedicineUsages,
  type LabResultItem,
  type Medicine,
  type MedicineUsage,
} from "../api/masterClient";
import { addDays, today } from "../lib/dates";
import type { OrderContext } from "../orderContext";
import { buildCondition, emptyConditionForm, type OutcomeCode, type ProblemRef } from "../fhir/conditionHelpers";
import { buildPatient, emptyPatientForm, DEFAULT_IDENTIFIER_SYSTEM, type PatientFormValues } from "../fhir/patientHelpers";
import {
  buildLabResultBundle,
  emptyLabResultForm,
  judgeInterpretation,
  labResultSubjectOf,
  matchReferenceRange,
  type LabResultLineValues,
} from "../fhir/labResultHelpers";
import { buildPrescriptionBundle, CATEGORY_OPTIONS, type PrescriptionSetting } from "../fhir/prescriptionHelpers";
import { buildAdmissionEncounter, buildDischargedEncounter } from "../fhir/encounterHelpers";
import { BED_PHYSICAL_TYPE } from "../fhir/wardHelpers";
import type { Disease } from "../api/masterClient";
import {
  chartDrugOf,
  labChartItem,
  vitalChartItems,
  type ChartDefinitionBody,
  type ChartDrug,
  type ChartItem,
} from "../fhir/chartDefinitionHelpers";

const PHYSICAL_TYPE_SYSTEM = "http://terminology.hl7.org/CodeSystem/location-physical-type";
const UCUM = "http://unitsofmeasure.org";
const LOINC = "http://loinc.org";

// ---- 実行環境 ----

export interface Named {
  id: string;
  name: string;
}

export interface SeedEnv {
  practitioner: Named;
  departments: Named[];
  beds: Named[];
  locations: Named[];
  /** 名(given)の後ろに足す語。試しに流すときに本番の患者と名前がぶつからないようにする。 */
  nameSuffix: string;
  log: (message: string) => void;
}

function nameOf(resource: fhir4.Practitioner | fhir4.Organization | fhir4.Location): string {
  if (resource.resourceType === "Practitioner") {
    const name = resource.name?.[0];
    return name?.text || [name?.family, ...(name?.given ?? [])].filter(Boolean).join(" ");
  }
  return resource.name ?? "";
}

async function searchAll<T extends fhir4.Resource>(type: string, params: Record<string, string>): Promise<T[]> {
  const search = new URLSearchParams({ _count: "500", ...params });
  const { data } = await searchResource<T>(type, search);
  return (data.entry ?? []).map((entry) => entry.resource).filter((r): r is T => r?.resourceType === type);
}

/** ログイン中の医療従事者・診療科・ベッドなど、環境ごとに違うものを引いて揃える。 */
export async function loadEnv(log: (message: string) => void, nameSuffix = ""): Promise<SeedEnv> {
  const session = await fetchAuthSession();
  const practitionerId = session.user?.practitioner_id;
  if (!practitionerId) throw new Error("ログインユーザーに医療従事者が紐付いていません");
  const [practitioner] = await searchAll<fhir4.Practitioner>("Practitioner", { _id: practitionerId });
  const organizations = await searchAll<fhir4.Organization>("Organization", {});
  const locations = await searchAll<fhir4.Location>("Location", {});
  const beds = locations.filter((location) =>
    location.physicalType?.coding?.some(
      (coding) => coding.system === PHYSICAL_TYPE_SYSTEM && coding.code === BED_PHYSICAL_TYPE.code,
    ),
  );
  return {
    practitioner: { id: practitionerId, name: practitioner ? nameOf(practitioner) : "" },
    departments: organizations.map((o) => ({ id: o.id ?? "", name: nameOf(o) })),
    beds: beds.map((b) => ({ id: b.id ?? "", name: nameOf(b) })),
    locations: locations.map((l) => ({ id: l.id ?? "", name: nameOf(l) })),
    nameSuffix,
    log,
  };
}

/** 名前に語を含む最初の診療科。無ければ最初の候補語、それも無ければ一覧の先頭。 */
export function departmentOf(env: SeedEnv, ...words: string[]): Named {
  for (const word of words) {
    const found = env.departments.find((d) => d.name === word) ?? env.departments.find((d) => d.name.includes(word));
    if (found) return found;
  }
  const fallback = env.departments[0];
  if (!fallback) throw new Error("診療科(Organization)がありません");
  return fallback;
}

export function requesterOf(env: SeedEnv, department: Named): OrderContext {
  return {
    departmentId: department.id,
    departmentName: department.name,
    practitionerId: env.practitioner.id,
    practitionerName: env.practitioner.name,
  };
}

// ---- 日付 ----

/** 実行日から days 日前(負で未来)。 */
export function daysAgo(days: number): string {
  return addDays(today(), -days);
}

export function at(date: string, time = "09:00"): string {
  return `${date}T${time}:00+09:00`;
}

/** date 以降の最初の平日。 */
export function weekday(date: string): string {
  let d = date;
  while ([0, 6].includes(new Date(`${d}T00:00:00`).getDay())) d = addDays(d, 1);
  return d;
}

// ---- 書き込み ----

/** transaction を送り、応答の location から作られた id を順に返す。 */
export async function post(bundle: fhir4.Bundle): Promise<{ type: string; id: string }[]> {
  const { data } = await postBundle(bundle);
  return (data.entry ?? []).map((entry) => {
    const parts = (entry.response?.location ?? "").split("/");
    const historyAt = parts.indexOf("_history");
    const [type, id] = historyAt > 1 ? parts.slice(historyAt - 2, historyAt) : parts.slice(-2);
    return { type, id };
  });
}

/** オーダーの登録日時を開始日に合わせる(組み立て関数は保存時刻を入れるため)。 */
export function stampAuthoredOn(bundle: fhir4.Bundle, dateTime: string): fhir4.Bundle {
  for (const entry of bundle.entry ?? []) {
    const resource = entry.resource as fhir4.ServiceRequest | fhir4.MedicationRequest | undefined;
    if (resource?.resourceType === "ServiceRequest" || resource?.resourceType === "MedicationRequest") {
      resource.authoredOn = dateTime;
    }
  }
  return bundle;
}

/** 通知(未確認の Task)を作らない。デモ患者の結果で通知のベルが埋まらないように。 */
export function withoutTasks(bundle: fhir4.Bundle): fhir4.Bundle {
  return { ...bundle, entry: (bundle.entry ?? []).filter((entry) => entry.resource?.resourceType !== "Task") };
}

/** post の結果のうち、指定した型のリソースを読み直す。 */
export async function createdOf(ids: { type: string; id: string }[], type: string): Promise<fhir4.Resource[]> {
  const wanted = ids.filter((entry) => entry.type === type).map((entry) => entry.id);
  if (wanted.length === 0) return [];
  const { data } = await searchResource<fhir4.Resource>(type, new URLSearchParams({ _id: wanted.join(",") }));
  return (data.entry ?? []).map((e) => e.resource).filter((r): r is fhir4.Resource => Boolean(r));
}

// ---- 患者 ----

export interface PatientSpec {
  familyKanji: string;
  givenKanji: string;
  familyKana: string;
  givenKana: string;
  gender: "male" | "female";
  birthDate: string;
}

/** 同じ氏名・生年月日の患者がいれば null(二重に作らない)。いなければ番号を採って作る。 */
export async function createPatient(env: SeedEnv, specWithoutSuffix: PatientSpec): Promise<fhir4.Patient | null> {
  const spec = { ...specWithoutSuffix, givenKanji: `${specWithoutSuffix.givenKanji}${env.nameSuffix}` };
  const existing = await searchAll<fhir4.Patient>("Patient", {
    family: spec.familyKanji,
    given: spec.givenKanji,
    birthdate: spec.birthDate,
  });
  // 上流は未対応の検索条件を黙って無視することがあるので、氏名と生年月日はここでも確かめる。
  const same = existing.some(
    (p) =>
      p.birthDate === spec.birthDate &&
      p.name?.some((n) => n.family === spec.familyKanji && n.given?.includes(spec.givenKanji)),
  );
  if (same) {
    env.log(`${spec.familyKanji} ${spec.givenKanji} は登録済みなので作りません`);
    return null;
  }
  const { data } = await typeOperation<fhir4.Parameters>(
    "Patient",
    "next-identifier",
    new URLSearchParams({ system: DEFAULT_IDENTIFIER_SYSTEM }),
  );
  const number = data.parameter?.find((p) => p.name === "value")?.valueString ?? "";
  const values: PatientFormValues = { ...emptyPatientForm, ...spec, identifierValue: number };
  const { data: patient } = await createResource(buildPatient(values));
  env.log(`患者 ${spec.familyKanji} ${spec.givenKanji}(${number || "番号なし"})を作成`);
  return patient;
}

// ---- 病名 ----

export interface ConditionSpec {
  disease: Disease;
  start: string;
  end?: string;
  outcome?: OutcomeCode;
  suspected?: boolean;
  parentId?: string;
  succeededByIds?: string[];
}

export function disease(
  management_number: string,
  name: string,
  exchange_code: string,
  icd10_2013: string,
  receipt_code: string,
): Disease {
  return {
    id: 0,
    management_number,
    name,
    name_kana: null,
    adoption_category: null,
    exchange_code,
    icd10_2013,
    receipt_code,
    single_use_prohibited_category: null,
  };
}

export async function createProblem(
  patientId: string,
  number: number,
  spec: ConditionSpec,
): Promise<ProblemRef> {
  const values = {
    ...emptyConditionForm(),
    category: "problem" as const,
    diseaseMode: "master" as const,
    disease: spec.disease,
    startDate: spec.start,
    endDate: spec.end ?? "",
    outcome: spec.outcome ?? "active",
    parentId: spec.parentId ?? "",
    succeededByIds: spec.succeededByIds ?? [],
    postfixModifiers: spec.suspected
      ? [{ id: 0, management_number: "27000001", name: "の疑い", name_kana: null, exchange_code: "5395", connection_position_category: null, modifier_category: null, receipt_code: "8002" }]
      : [],
  };
  const { data } = await createResource(buildCondition(values, patientId, undefined, number));
  const name = `${spec.disease.name}${spec.suspected ? "の疑い" : ""}`;
  return { conditionId: data.id ?? "", display: `#${number} ${name}` };
}

// ---- 検査結果 ----

export class LabMaster {
  private items = new Map<string, LabResultItem>();

  async load(codes: string[]): Promise<void> {
    for (const code of codes) {
      if (this.items.has(code)) continue;
      const item = await fetchLabResultItem(code).catch(() => null);
      if (item) this.items.set(code, item);
    }
  }

  get(code: string): LabResultItem | undefined {
    return this.items.get(code);
  }
}

/** 検体検査の結果 1 回ぶん(報告書 + 結果)。H/L は基準値マスタから判定する。 */
export function labResultBundle(
  env: SeedEnv,
  master: LabMaster,
  patient: fhir4.Patient,
  department: Named,
  date: string,
  /** 数値、またはコード型(CD / CO)の項目なら選択肢のコード。 */
  values: [code: string, value: number | string][],
  setting: "outpatient" | "inpatient" = "outpatient",
): fhir4.Bundle | null {
  const subject = labResultSubjectOf(patient);
  const lines: LabResultLineValues[] = values.flatMap(([code, value]) => {
    const item = master.get(code);
    if (!item) return [];
    const text = String(value);
    return [{ item, value: text, interpretation: judgeInterpretation(text, matchReferenceRange(item, subject, date)), note: "" }];
  });
  if (lines.length === 0) return null;
  const form = {
    ...emptyLabResultForm(setting),
    specimenDate: date,
    departmentId: department.id,
    departmentName: department.name,
    performer: { organizationId: "", organizationName: "", practitionerId: env.practitioner.id, practitionerName: env.practitioner.name },
    lines,
  };
  const bundle = withoutTasks(buildLabResultBundle(form, patient.id ?? "", [], subject));
  for (const entry of bundle.entry ?? []) {
    const resource = entry.resource as fhir4.DiagnosticReport | undefined;
    if (resource?.resourceType === "DiagnosticReport") resource.issued = at(date, "11:00");
  }
  return bundle;
}

// ---- バイタル ----

export function vitalEntries(
  patientId: string,
  dateTime: string,
  values: { weight?: number; systolic?: number; diastolic?: number; pulse?: number; temperature?: number; spo2?: number },
): fhir4.BundleEntry[] {
  const base = (code: string, display: string, value: Partial<fhir4.Observation>): fhir4.BundleEntry => ({
    fullUrl: `urn:uuid:${crypto.randomUUID()}`,
    request: { method: "POST", url: "Observation" },
    resource: {
      resourceType: "Observation",
      meta: { profile: ["http://jpfhir.jp/fhir/core/StructureDefinition/JP_Observation_Common"] },
      status: "final",
      category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "vital-signs" }] }],
      code: { coding: [{ system: LOINC, code, display }] },
      subject: { reference: `Patient/${patientId}` },
      effectiveDateTime: dateTime,
      ...value,
    },
  });
  const q = (value: number, unit: string, code: string) => ({ value, unit, system: UCUM, code });
  const entries: fhir4.BundleEntry[] = [];
  if (values.weight != null) entries.push(base("29463-7", "Body weight", { valueQuantity: q(values.weight, "kg", "kg") }));
  if (values.systolic != null && values.diastolic != null) {
    entries.push(
      base("85354-9", "Blood pressure panel", {
        component: [
          { code: { coding: [{ system: LOINC, code: "8480-6", display: "Systolic blood pressure" }] }, valueQuantity: q(values.systolic, "mmHg", "mm[Hg]") },
          { code: { coding: [{ system: LOINC, code: "8462-4", display: "Diastolic blood pressure" }] }, valueQuantity: q(values.diastolic, "mmHg", "mm[Hg]") },
        ],
      }),
    );
  }
  if (values.pulse != null) entries.push(base("8867-4", "Heart rate", { valueQuantity: q(values.pulse, "/分", "/min") }));
  if (values.temperature != null) entries.push(base("8310-5", "Body temperature", { valueQuantity: q(values.temperature, "℃", "Cel") }));
  if (values.spo2 != null) entries.push(base("2708-6", "Oxygen saturation in Arterial blood", { valueQuantity: q(values.spo2, "%", "%") }));
  return entries;
}

// ---- 処方 ----

export class DrugMaster {
  private medicines = new Map<string, Medicine>();
  private usages = new Map<string, MedicineUsage>();

  async load(medicineCodes: string[], usageNames: string[]): Promise<void> {
    const missing = medicineCodes.filter((code) => !this.medicines.has(code));
    if (missing.length) {
      const result = await fetchMedicinesByCodes(missing);
      for (const medicine of result.items) this.medicines.set(medicine.medicine_code, medicine);
    }
    for (const name of usageNames) {
      if (this.usages.has(name)) continue;
      const result = await searchMedicineUsages({ usage_name: name, per: 20 });
      const usage = result.items.find((u) => u.usage_name === name) ?? result.items[0];
      if (usage) this.usages.set(name, usage);
    }
  }

  medicine(code: string): Medicine {
    const medicine = this.medicines.get(code);
    if (!medicine) throw new Error(`薬剤マスタに ${code} がありません`);
    return medicine;
  }

  usage(name: string): MedicineUsage {
    const usage = this.usages.get(name);
    if (!usage) throw new Error(`用法マスタに「${name}」がありません`);
    return usage;
  }
}

export interface RpSpec {
  usage: string;
  days?: number;
  medicines: [code: string, dose: number][];
}

/** 処方 1 件(Rp は複数可)。登録日時は開始日にそろえる。 */
export function prescriptionBundle(
  drugs: DrugMaster,
  patientId: string,
  requester: OrderContext,
  start: string,
  rps: RpSpec[],
  problem: ProblemRef | null,
  setting: PrescriptionSetting = "outpatient",
): fhir4.Bundle {
  const category = setting ? (CATEGORY_OPTIONS[setting].find((c) => c.code === "external") ?? CATEGORY_OPTIONS[setting][0]).code : "";
  const bundle = buildPrescriptionBundle(
    {
      setting,
      category,
      startDate: start,
      comment: "",
      problem,
      rps: rps.map((rp) => ({
        usage: drugs.usage(rp.usage),
        doseDays: rp.days ? String(rp.days) : "",
        doseCount: "",
        usageComment: "",
        medicines: rp.medicines.map(([code, dose]) => ({ medicine: drugs.medicine(code), dose: String(dose), comment: "" })),
      })),
    },
    patientId,
    requester,
  );
  return stampAuthoredOn(bundle, at(start));
}

// ---- 入院 ----

/** 退院済みの入院 1 件。ベッドが無い環境では作らない。 */
export async function createStay(
  env: SeedEnv,
  patient: fhir4.Patient,
  department: Named,
  admitted: string,
  discharged: string,
  bedIndex = 0,
): Promise<string | null> {
  const bed = env.beds[bedIndex % Math.max(1, env.beds.length)];
  if (!bed) {
    env.log("ベッド(Location)が無いので入院は作りません");
    return null;
  }
  const encounter = buildAdmissionEncounter(
    patient,
    { bedId: bed.id, bedLabel: bed.name, departmentName: department.name, practitionerName: env.practitioner.name, nurses: [] },
    { departmentId: department.id, practitionerId: env.practitioner.id, nurseIds: [], admissionDate: `${admitted}T10:00`, note: "" },
  );
  const { data } = await createResource(buildDischargedEncounter(encounter, `${discharged}T10:00`));
  return data.id ?? null;
}

// ---- マスタ引き ----

/** 病名マスタから名称の完全一致で引く。見つからなければ例外(コードの無い病名は作らない)。 */
export async function findDisease(name: string): Promise<Disease> {
  const result = await searchDiseases({ name, per: 50 });
  const found = result.items.find((d) => d.name === name);
  if (!found) throw new Error(`病名マスタに「${name}」がありません`);
  return found;
}

// ---- チャート定義 ----

/** 院内共通のチャート定義。同じ名前があれば作らない(施設で直した内容を戻さない)。 */
export async function ensureFacilityChart(
  env: SeedEnv,
  name: string,
  body: Omit<ChartDefinitionBody, "schema_version">,
): Promise<void> {
  const { items } = await fetchChartDefinitions({});
  if (items.some((d) => d.scope === "facility" && d.name === name)) {
    env.log(`チャート「${name}」は登録済み`);
    return;
  }
  await createChartDefinition({
    scope: "facility",
    owner_id: null,
    owner_name: null,
    name,
    definition: { schema_version: 1, ...body },
  });
  env.log(`チャート「${name}」を作成`);
}

/** 検査結果項目マスタ → チャートの項目。マスタに無いものは落とす。 */
export function labItemsOf(master: LabMaster, codes: string[]): ChartItem[] {
  return codes.flatMap((code) => {
    const item = master.get(code);
    return item ? [labChartItem(item)] : [];
  });
}

/** 薬剤マスタ → 追う薬剤。 */
export function drugsOf(drugs: DrugMaster, entries: [code: string, name: string][]): ChartDrug[] {
  return entries.map(([code, name]) => ({ ...chartDrugOf(drugs.medicine(code)), name }));
}

export function vitalItem(code: string): ChartItem {
  const item = vitalChartItems().find((entry) => entry.key === `vital:${code}`);
  if (!item) throw new Error(`バイタルの項目 ${code} がありません`);
  return item;
}
