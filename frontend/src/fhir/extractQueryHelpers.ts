import { csvBlob } from "../lib/csv";
import { addDays, dateTimeLabel, localDay } from "../lib/dates";
import { excludeNursingProblems } from "./conditionHelpers";
import { ADMISSION_CLASS_CODE, ADMISSION_STATUS, DISCHARGED_STATUS } from "./encounterHelpers";
import { departmentOf } from "./orderHeader";
import { OUTPATIENT_CLASS_CODE } from "./outpatientEncounterHelpers";
import { calculateAge, displayName, genderLabel, patientNumberOf } from "./patientHelpers";
import { conceptLabel, quantityLabel, referenceIdOfType } from "./shared";

// データ抽出(docs/data-extract-design.md)。条件のモデル・条件ごとの FHIR 検索・集合の
// 組み合わせ・結果の行と内訳・CSV。取得(上流を引く)は api/queries/extractQuery.ts が担い、
// ここは純粋関数だけにする(データ源を DWH に差し替えるときも、ここと画面はそのまま使う)。

export type ExtractKind = "patient" | "condition" | "observation" | "medication" | "admission" | "outpatient";

export const EXTRACT_KIND_LABELS: Record<ExtractKind, string> = {
  patient: "患者属性",
  condition: "病名",
  observation: "検査結果・バイタル",
  medication: "処方・注射",
  admission: "入院",
  outpatient: "外来受診",
};

export interface ExtractCode {
  system: string;
  code: string;
  display?: string;
}

/** 期間。absolute は日付(どちらか片方でもよい)、relative は今日から days 日前〜今日。 */
export interface ExtractPeriod {
  mode: "absolute" | "relative";
  from?: string;
  to?: string;
  days?: number;
}

export type ExtractValueOp = "ge" | "gt" | "le" | "lt";
export const EXTRACT_VALUE_OPS: { value: ExtractValueOp; label: string }[] = [
  { value: "ge", label: "以上" },
  { value: "gt", label: "より大きい" },
  { value: "le", label: "以下" },
  { value: "lt", label: "未満" },
];

export type AdmissionDateMode = "overlap" | "admitted" | "discharged";
export const ADMISSION_DATE_MODES: { value: AdmissionDateMode; label: string }[] = [
  { value: "overlap", label: "期間中に入院していた" },
  { value: "admitted", label: "期間中に入院した" },
  { value: "discharged", label: "期間中に退院した" },
];

export const CLINICAL_STATUS_OPTIONS = [
  { value: "active", label: "継続" },
  { value: "resolved", label: "治癒" },
  { value: "inactive", label: "中止" },
  { value: "remission", label: "寛解" },
] as const;

export interface ExtractLeaf {
  key: string;
  kind: ExtractKind;
  label?: string;
  /** 除外(AND グループの直下で、除外でない兄弟があるときだけ)。 */
  not?: boolean;
  period?: ExtractPeriod | null;
  /** 期間内に何件以上あれば該当とするか(既定 1)。 */
  min_count?: number;
  codes?: ExtractCode[];
  gender?: string[];
  age?: { min?: number | null; max?: number | null };
  clinical_status?: string[];
  date_field?: "recorded" | "onset";
  value?: { op: ExtractValueOp; value: number } | null;
  date_mode?: AdmissionDateMode;
  department_id?: string;
  department_name?: string;
}

export interface ExtractGroup {
  op: "and" | "or";
  children: ExtractNode[];
}

export type ExtractNode = ExtractGroup | ExtractLeaf;

export interface ExtractQueryBody {
  schema_version: 1;
  root: ExtractGroup;
}

export const EXTRACT_MAX_DEPTH = 3;
export const EXTRACT_MAX_LEAVES = 20;

export function isGroup(node: ExtractNode): node is ExtractGroup {
  return "op" in node;
}

export function emptyExtractQuery(): ExtractQueryBody {
  return { schema_version: 1, root: { op: "and", children: [] } };
}

function newKey(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function newLeaf(kind: ExtractKind): ExtractLeaf {
  const key = newKey();
  switch (kind) {
    case "patient":
      return { key, kind, gender: [], age: { min: null, max: null } };
    case "condition":
      return { key, kind, codes: [], clinical_status: ["active"], date_field: "recorded", period: null };
    case "observation":
      return { key, kind, codes: [], period: { mode: "relative", days: 365 }, value: null };
    case "medication":
      return { key, kind, codes: [], period: { mode: "relative", days: 365 } };
    case "admission":
      return { key, kind, date_mode: "overlap", period: { mode: "relative", days: 30 } };
    case "outpatient":
      return { key, kind, period: { mode: "relative", days: 30 } };
  }
}

export function newGroup(op: "and" | "or"): ExtractGroup {
  return { op, children: [] };
}

export function collectLeaves(node: ExtractNode): ExtractLeaf[] {
  return isGroup(node) ? node.children.flatMap(collectLeaves) : [node];
}

// ---- 画面の表示 ----

export function periodLabel(period: ExtractPeriod | null | undefined): string {
  if (!period) return "";
  if (period.mode === "relative") return `直近${period.days ?? 0}日`;
  if (period.from && period.to) return `${period.from}〜${period.to}`;
  if (period.from) return `${period.from}以降`;
  return period.to ? `${period.to}まで` : "";
}

/** 条件の表示名。手で付けた名前が無ければ中身から作る(一覧の列名・CSV の見出しにも使う)。 */
export function leafLabel(leaf: ExtractLeaf): string {
  if (leaf.label?.trim()) return leaf.label.trim();
  const codes = (leaf.codes ?? []).map((c) => c.display || c.code);
  const names = codes.length > 2 ? `${codes.slice(0, 2).join("・")}ほか${codes.length - 2}件` : codes.join("・");
  const period = periodLabel(leaf.period);
  switch (leaf.kind) {
    case "patient": {
      const gender = (leaf.gender ?? []).map(genderLabel).join("・");
      const { min, max } = leaf.age ?? {};
      const age = min != null && max != null ? `${min}〜${max}歳` : min != null ? `${min}歳以上` : max != null ? `${max}歳以下` : "";
      return [gender, age].filter(Boolean).join(" ") || "患者属性";
    }
    case "observation": {
      const op = EXTRACT_VALUE_OPS.find((o) => o.value === leaf.value?.op)?.label;
      const value = leaf.value ? `${leaf.value.value}${op ?? ""}` : "";
      return [names || "検査", value, period].filter(Boolean).join(" ");
    }
    case "admission": {
      const mode = ADMISSION_DATE_MODES.find((m) => m.value === leaf.date_mode)?.label ?? "入院";
      return [leaf.department_name, mode, period].filter(Boolean).join(" ");
    }
    case "outpatient":
      return ["外来受診", period].filter(Boolean).join(" ");
    default:
      return [names || EXTRACT_KIND_LABELS[leaf.kind], period].filter(Boolean).join(" ");
  }
}

// ---- 検証 ----

/** 画面で弾く誤り(backend の ExtractQuery の検証と同じ決まり)。空なら実行できる。 */
export function validateExtractQuery(body: ExtractQueryBody): string[] {
  const errors: string[] = [];
  const leaves = collectLeaves(body.root);
  if (leaves.length === 0) errors.push("条件を 1 つ以上追加してください。");
  if (leaves.length > EXTRACT_MAX_LEAVES) errors.push(`条件は ${EXTRACT_MAX_LEAVES} 個までです。`);

  const visit = (group: ExtractGroup, depth: number) => {
    if (group.children.length === 0 && depth > 1) errors.push("空のグループがあります。");
    const negated = group.children.filter((c) => !isGroup(c) && c.not);
    if (negated.length > 0 && group.op === "or") errors.push("OR の下には除外の条件を置けません。");
    if (negated.length > 0 && negated.length === group.children.length) {
      errors.push("除外の条件だけのグループは作れません。");
    }
    for (const child of group.children) {
      if (isGroup(child)) visit(child, depth + 1);
    }
  };
  visit(body.root, 1);

  for (const leaf of leaves) {
    const name = leafLabel(leaf);
    if (["condition", "observation", "medication"].includes(leaf.kind) && !(leaf.codes ?? []).length) {
      errors.push(`${name}: 項目を選んでください。`);
    }
    if (["admission", "outpatient"].includes(leaf.kind) && !leaf.period) errors.push(`${name}: 期間を入れてください。`);
    if (leaf.kind === "patient" && !(leaf.gender ?? []).length && leaf.age?.min == null && leaf.age?.max == null) {
      errors.push(`${name}: 性別か年齢を入れてください。`);
    }
    if (leaf.period?.mode === "relative" && !(leaf.period.days && leaf.period.days > 0)) {
      errors.push(`${name}: 日数を入れてください。`);
    }
    if (leaf.period?.mode === "absolute" && !leaf.period.from && !leaf.period.to) {
      errors.push(`${name}: 期間を入れてください。`);
    }
    if (leaf.value && !Number.isFinite(leaf.value.value)) errors.push(`${name}: 値を数値で入れてください。`);
  }
  return Array.from(new Set(errors));
}

/** 除外にできる位置か(AND の直下で、ほかに除外でない兄弟がある)。 */
export function canNegate(parent: ExtractGroup, leaf: ExtractLeaf): boolean {
  if (parent.op !== "and") return false;
  return parent.children.some((c) => c !== leaf && (isGroup(c) || !c.not));
}

// ---- 条件 → FHIR 検索 ----

export interface ResolvedPeriod {
  from?: string;
  to?: string;
}

export function resolvePeriod(period: ExtractPeriod | null | undefined, today: string): ResolvedPeriod | null {
  if (!period) return null;
  if (period.mode === "relative") return { from: addDays(today, -(period.days ?? 0)), to: today };
  return { from: period.from || undefined, to: period.to || undefined };
}

/** 年齢の範囲を生年月日の範囲に直す(min 歳以上 = 生年月日が今日の min 年前以前)。 */
export function ageToBirthDateRange(age: ExtractLeaf["age"], today: string): { le?: string; gt?: string } {
  const shift = (years: number) => {
    const [y, m, d] = today.split("-").map(Number);
    const date = new Date(Date.UTC(y - years, m - 1, d));
    return date.toISOString().slice(0, 10);
  };
  return {
    le: age?.min != null ? shift(age.min) : undefined,
    gt: age?.max != null ? shift(age.max + 1) : undefined,
  };
}

export const EXTRACT_CODE_CHUNK = 100;

export interface LeafSearch {
  resourceType: string;
  /** コードが多い条件は分けて引き、患者の和集合を取る。 */
  paramsList: URLSearchParams[];
}

function codeParam(codes: ExtractCode[]): string {
  return codes.map((c) => `${c.system}|${c.code}`).join(",");
}

function withCodes(codes: ExtractCode[], build: (codeValue: string) => URLSearchParams): URLSearchParams[] {
  const chunks: URLSearchParams[] = [];
  for (let i = 0; i < codes.length; i += EXTRACT_CODE_CHUNK) {
    chunks.push(build(codeParam(codes.slice(i, i + EXTRACT_CODE_CHUNK))));
  }
  return chunks;
}

function appendRange(params: URLSearchParams, name: string, range: ResolvedPeriod | null) {
  if (range?.from) params.append(name, `ge${range.from}`);
  if (range?.to) params.append(name, `le${range.to}`);
}

/**
 * 条件 1 つぶんの上流の検索。返る行は「患者が該当するかどうか」と一覧の列(件数・日付・最新値)
 * に要る項目だけ(_elements)。値の範囲は上流の value-quantity で絞る。
 */
export function leafSearch(leaf: ExtractLeaf, today: string): LeafSearch {
  const range = resolvePeriod(leaf.period, today);
  const codes = leaf.codes ?? [];
  switch (leaf.kind) {
    case "patient": {
      const params = new URLSearchParams();
      if ((leaf.gender ?? []).length) params.set("gender", (leaf.gender ?? []).join(","));
      const birth = ageToBirthDateRange(leaf.age, today);
      if (birth.le) params.append("birthdate", `le${birth.le}`);
      if (birth.gt) params.append("birthdate", `gt${birth.gt}`);
      params.set("active:not", "false");
      params.set("_elements", "gender,birthDate");
      return { resourceType: "Patient", paramsList: [params] };
    }
    case "condition":
      return {
        resourceType: "Condition",
        paramsList: withCodes(codes, (code) => {
          const params = new URLSearchParams();
          params.set("code", code);
          if ((leaf.clinical_status ?? []).length) params.set("clinical-status", (leaf.clinical_status ?? []).join(","));
          params.set("verification-status:not", "entered-in-error,refuted");
          excludeNursingProblems(params);
          appendRange(params, leaf.date_field === "onset" ? "onset-date" : "recorded-date", range);
          params.set("_elements", "subject,code,recordedDate,onsetDateTime");
          return params;
        }),
      };
    case "observation":
      return {
        resourceType: "Observation",
        paramsList: withCodes(codes, (code) => {
          const params = new URLSearchParams();
          params.set("code", code);
          appendRange(params, "date", range);
          if (leaf.value) params.set("value-quantity", `${leaf.value.op}${leaf.value.value}`);
          params.set("status:not", "entered-in-error,cancelled");
          params.set("_elements", "subject,code,effectiveDateTime,valueQuantity");
          return params;
        }),
      };
    case "medication":
      return {
        resourceType: "MedicationRequest",
        paramsList: withCodes(codes, (code) => {
          const params = new URLSearchParams();
          params.set("code", code);
          appendRange(params, "authoredon", range);
          params.set("status:not", "entered-in-error,cancelled");
          params.set("_elements", "subject,authoredOn,medicationCodeableConcept");
          return params;
        }),
      };
    case "admission": {
      const params = new URLSearchParams();
      params.set("class", ADMISSION_CLASS_CODE);
      params.set("status", `${ADMISSION_STATUS},${DISCHARGED_STATUS}`);
      // Encounter.date は入院期間との比較。sa / eb で入院日・退院日だけを見る。
      if (leaf.date_mode === "admitted") {
        if (range?.from) params.append("date", `sa${addDays(range.from, -1)}`);
        if (range?.to) params.append("date", `le${range.to}`);
      } else if (leaf.date_mode === "discharged") {
        if (range?.from) params.append("date", `ge${range.from}`);
        params.append("date", `eb${addDays(range?.to ?? today, 1)}`);
      } else {
        appendRange(params, "date", range);
      }
      if (leaf.department_id) params.set("service-provider", `Organization/${leaf.department_id}`);
      params.set("_elements", "subject,period,serviceProvider");
      return { resourceType: "Encounter", paramsList: [params] };
    }
    case "outpatient": {
      const params = new URLSearchParams();
      params.set("class", OUTPATIENT_CLASS_CODE);
      params.set("status:not", "cancelled,entered-in-error");
      appendRange(params, "date", range);
      params.set("_elements", "subject,period");
      return { resourceType: "Encounter", paramsList: [params] };
    }
  }
}

const PAGING_PARAMS = new Set(["_elements", "_count", "_offset", "_total"]);

/** 絞り込みの条件を 1 つも持たない検索か(送ると全件を読みに行くので送らない)。 */
export function isUnfiltered(params: URLSearchParams): boolean {
  return [...params.keys()].every((key) => PAGING_PARAMS.has(key) || key === "active:not" || key === "status:not");
}

// ---- 検索結果 → 患者ごとの該当 ----

/** 患者 1 人の、条件 1 つへの該当(一覧の列と CSV になる)。 */
export interface LeafHit {
  count: number;
  first: string;
  last: string;
  /** いちばん新しい記録の中身(検査は値、病名は病名、薬は薬剤名、入院は期間)。 */
  latest: string;
}

export type LeafHits = Map<string, LeafHit>;

/** 条件の検索で返る型。 */
export type ExtractRecord =
  | fhir4.Patient
  | fhir4.Condition
  | fhir4.Observation
  | fhir4.MedicationRequest
  | fhir4.Encounter;

function subjectOf(resource: ExtractRecord): string {
  if (resource.resourceType === "Patient") return resource.id ?? "";
  return referenceIdOfType(resource.subject?.reference, "Patient");
}

function recordDate(leaf: ExtractLeaf, resource: ExtractRecord): string {
  switch (resource.resourceType) {
    case "Condition":
      return (leaf.date_field === "onset" ? resource.onsetDateTime : resource.recordedDate) ?? resource.recordedDate ?? "";
    case "Observation":
      return resource.effectiveDateTime ?? "";
    case "MedicationRequest":
      return resource.authoredOn ?? "";
    case "Encounter":
      return resource.period?.start ?? "";
    default:
      return "";
  }
}

function recordContent(resource: ExtractRecord): string {
  switch (resource.resourceType) {
    case "Condition":
      return conceptLabel(resource.code);
    case "Observation":
      return quantityLabel(resource.valueQuantity);
    case "MedicationRequest":
      return conceptLabel(resource.medicationCodeableConcept);
    case "Encounter": {
      const start = localDay(resource.period?.start);
      const end = localDay(resource.period?.end);
      return end ? `${start}〜${end}` : `${start}〜`;
    }
    default:
      return "";
  }
}

/** 検索で返った行を患者ごとに畳む。min_count に届かない患者は外す。 */
export function leafHitsOf(leaf: ExtractLeaf, resources: ExtractRecord[]): LeafHits {
  const grouped = new Map<string, { date: string; content: string }[]>();
  for (const resource of resources) {
    const patientId = subjectOf(resource);
    if (!patientId) continue;
    const list = grouped.get(patientId) ?? [];
    list.push({ date: recordDate(leaf, resource), content: recordContent(resource) });
    grouped.set(patientId, list);
  }
  const hits: LeafHits = new Map();
  const minCount = leaf.min_count ?? 1;
  for (const [patientId, records] of grouped) {
    if (records.length < minCount) continue;
    const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date));
    hits.set(patientId, {
      count: sorted.length,
      first: localDay(sorted[0]?.date),
      last: localDay(sorted[sorted.length - 1]?.date),
      latest: sorted[sorted.length - 1]?.content ?? "",
    });
  }
  return hits;
}

// ---- 集合の組み合わせ ----

/**
 * 条件の木を患者 id の集合にする。AND は積、OR は和、除外は同じ AND の他の子の積からの差。
 * setOf が null を返す条件は「絞らない」として AND の積から外す(AND の下の患者属性を、兄弟で
 * 絞った患者に後から当てるときの 1 回目の計算に使う)。
 */
export function combineSets(
  group: ExtractGroup,
  setOf: (leaf: ExtractLeaf) => Set<string> | null,
): Set<string> {
  const positives = group.children.filter((c) => isGroup(c) || !c.not);
  const negatives = group.children.filter((c): c is ExtractLeaf => !isGroup(c) && Boolean(c.not));
  const sets = positives
    .map((child) => (isGroup(child) ? combineSets(child, setOf) : setOf(child)))
    .filter((set): set is Set<string> => set !== null);
  let result: Set<string>;
  if (group.op === "or") {
    result = new Set(sets.flatMap((s) => [...s]));
  } else {
    const [first, ...rest] = [...sets].sort((a, b) => a.size - b.size);
    result = new Set([...(first ?? [])].filter((id) => rest.every((s) => s.has(id))));
  }
  for (const leaf of negatives) {
    const excluded = setOf(leaf) ?? new Set<string>();
    result = new Set([...result].filter((id) => !excluded.has(id)));
  }
  return result;
}

/**
 * 上流を引かず、兄弟の結果に後から当てる患者属性の条件(AND の直下で除外でなく、患者属性
 * 以外の兄弟がある)。「75 歳以上」のように該当者が多い条件を全件読まずに済ませる。
 */
export function patientFilterLeaves(root: ExtractGroup): Set<string> {
  const keys = new Set<string>();
  const visit = (group: ExtractGroup) => {
    const hasOther = group.children.some((c) => isGroup(c) || (!c.not && c.kind !== "patient"));
    for (const child of group.children) {
      if (isGroup(child)) visit(child);
      else if (group.op === "and" && hasOther && child.kind === "patient" && !child.not) keys.add(child.key);
    }
  };
  visit(root);
  return keys;
}

/** 患者属性の条件に合うか(patientFilterLeaves の条件を手元で当てる)。 */
export function patientMatches(leaf: ExtractLeaf, patient: fhir4.Patient | undefined, today: string): boolean {
  if (!patient) return false;
  if ((leaf.gender ?? []).length && !(leaf.gender ?? []).includes(patient.gender ?? "")) return false;
  const birth = ageToBirthDateRange(leaf.age, today);
  if ((birth.le || birth.gt) && !patient.birthDate) return false;
  if (birth.le && patient.birthDate! > birth.le) return false;
  if (birth.gt && patient.birthDate! <= birth.gt) return false;
  return true;
}

// ---- 結果の行・内訳・CSV ----

export interface ExtractRow {
  patientId: string;
  patientNumber: string;
  name: string;
  birthDate: string;
  age: number | undefined;
  gender: string;
  hits: Record<string, LeafHit | undefined>;
}

export function extractRows(
  ids: Set<string>,
  patients: Map<string, fhir4.Patient>,
  leaves: ExtractLeaf[],
  hitsByLeaf: Map<string, LeafHits>,
): ExtractRow[] {
  return [...ids]
    .map((patientId) => {
      const patient = patients.get(patientId);
      return {
        patientId,
        patientNumber: (patient && patientNumberOf(patient)) ?? "",
        name: patient ? displayName(patient) : "",
        birthDate: patient?.birthDate ?? "",
        age: patient?.birthDate ? calculateAge(patient.birthDate) : undefined,
        gender: genderLabel(patient?.gender),
        hits: Object.fromEntries(leaves.map((leaf) => [leaf.key, hitsByLeaf.get(leaf.key)?.get(patientId)])),
      };
    })
    .sort((a, b) => a.patientNumber.localeCompare(b.patientNumber, undefined, { numeric: true }));
}

/** 一覧の列にする条件(除外と患者属性は「該当なし」「属性そのもの」なので列にしない)。 */
export function resultColumns(leaves: ExtractLeaf[]): ExtractLeaf[] {
  return leaves.filter((leaf) => !leaf.not && leaf.kind !== "patient");
}

export const AGE_BANDS = ["0-9", "10-19", "20-29", "30-39", "40-49", "50-59", "60-69", "70-79", "80-89", "90-"];

export function ageBandOf(age: number | undefined): string {
  if (age == null) return "不明";
  return AGE_BANDS[Math.min(Math.floor(age / 10), AGE_BANDS.length - 1)];
}

export interface ExtractBreakdown {
  genders: string[];
  bands: string[];
  /** cells[band][gender] = 人数 */
  cells: Record<string, Record<string, number>>;
  totalsByGender: Record<string, number>;
  totalsByBand: Record<string, number>;
  total: number;
}

export function extractBreakdown(rows: ExtractRow[]): ExtractBreakdown {
  const genders = Array.from(new Set(rows.map((r) => r.gender))).sort();
  const bands = [...AGE_BANDS, "不明"].filter((band) => rows.some((r) => ageBandOf(r.age) === band));
  const cells: Record<string, Record<string, number>> = {};
  const totalsByGender: Record<string, number> = {};
  const totalsByBand: Record<string, number> = {};
  for (const row of rows) {
    const band = ageBandOf(row.age);
    cells[band] ??= {};
    cells[band][row.gender] = (cells[band][row.gender] ?? 0) + 1;
    totalsByGender[row.gender] = (totalsByGender[row.gender] ?? 0) + 1;
    totalsByBand[band] = (totalsByBand[band] ?? 0) + 1;
  }
  return { genders, bands, cells, totalsByGender, totalsByBand, total: rows.length };
}

/** 患者 1 行の CSV。条件ごとに件数・最初・最後・最新を並べる。 */
export function extractCsv(rows: ExtractRow[], leaves: ExtractLeaf[]): Blob {
  const columns = resultColumns(leaves);
  const header = [
    "患者番号",
    "氏名",
    "年齢",
    "性別",
    "生年月日",
    "患者ID",
    ...columns.flatMap((leaf) => {
      const label = leafLabel(leaf);
      return [`${label} 件数`, `${label} 最初`, `${label} 最後`, `${label} 最新`];
    }),
  ];
  return csvBlob(
    header,
    rows.map((row) => [
      row.patientNumber,
      row.name,
      row.age ?? "",
      row.gender,
      row.birthDate,
      row.patientId,
      ...columns.flatMap((leaf) => {
        const hit = row.hits[leaf.key];
        return hit ? [hit.count, hit.first, hit.last, hit.latest] : ["", "", "", ""];
      }),
    ]),
  );
}

// ---- 明細 CSV(条件に当たった記録を 1 件 1 行) ----

/** 明細に出す条件(除外は該当者に記録が無く、患者属性は記録を持たないので出さない)。 */
export function detailLeaves(leaves: ExtractLeaf[]): ExtractLeaf[] {
  return resultColumns(leaves);
}

export interface ExtractDetail {
  leaf: ExtractLeaf;
  records: ExtractRecord[];
}

const DETAIL_HEADER = [
  "患者番号",
  "氏名",
  "年齢",
  "性別",
  "患者ID",
  "条件",
  "種類",
  "日付",
  "終了日",
  "コード",
  "名称",
  "値",
  "単位",
  "判定",
  "基準値",
  "状態",
  "発症日",
  "用量",
  "用法",
  "日数",
  "診療科",
  "記録ID",
];

const CLINICAL_STATUS_LABELS: Record<string, string> = Object.fromEntries(
  CLINICAL_STATUS_OPTIONS.map((o) => [o.value, o.label]),
);

// 記録の状態(status)の表示名。表に無い値はコードのまま出す。
const STATUS_LABELS: Record<string, Record<string, string>> = {
  Observation: { final: "確定", preliminary: "速報", amended: "訂正", corrected: "訂正", registered: "登録" },
  MedicationRequest: { active: "有効", completed: "終了", stopped: "中止", "on-hold": "保留", draft: "下書き" },
  Encounter: { "in-progress": "入院中", finished: "終了", planned: "予定", arrived: "来院" },
};

function statusLabel(record: ExtractRecord): string {
  const status = "status" in record ? (record.status ?? "") : "";
  return STATUS_LABELS[record.resourceType]?.[status] ?? status;
}

/** 種類ごとに違う列(DETAIL_HEADER の「種類」以降)。 */
function detailCells(record: ExtractRecord): (string | number)[] {
  const firstCode = (concept: fhir4.CodeableConcept | undefined) => concept?.coding?.[0]?.code ?? "";
  switch (record.resourceType) {
    case "Observation":
      return [
        "検査結果",
        dateTimeLabel(record.effectiveDateTime),
        "",
        firstCode(record.code),
        conceptLabel(record.code),
        record.valueQuantity?.value ?? "",
        record.valueQuantity?.unit ?? "",
        record.interpretation?.[0]?.coding?.[0]?.code ?? "",
        record.referenceRange?.[0]?.text ?? "",
        statusLabel(record),
        "",
        "",
        "",
        "",
        departmentOf(record).departmentName,
        record.id ?? "",
      ];
    case "Condition": {
      const status = record.clinicalStatus?.coding?.[0]?.code ?? "";
      return [
        "病名",
        localDay(record.recordedDate),
        localDay(record.abatementDateTime),
        firstCode(record.code),
        conceptLabel(record.code),
        "",
        "",
        "",
        "",
        CLINICAL_STATUS_LABELS[status] ?? status,
        localDay(record.onsetDateTime),
        "",
        "",
        "",
        departmentOf(record).departmentName,
        record.id ?? "",
      ];
    }
    case "MedicationRequest": {
      const dosage = record.dosageInstruction?.[0];
      const dose = dosage?.doseAndRate?.[0]?.doseQuantity;
      return [
        "処方・注射",
        dateTimeLabel(record.authoredOn),
        "",
        firstCode(record.medicationCodeableConcept),
        conceptLabel(record.medicationCodeableConcept),
        "",
        "",
        "",
        "",
        statusLabel(record),
        "",
        dose?.value != null ? `${dose.value}${dose.unit ?? ""}` : "",
        dosage?.text ?? "",
        record.dispenseRequest?.expectedSupplyDuration?.value ?? "",
        departmentOf(record).departmentName,
        record.id ?? "",
      ];
    }
    case "Encounter":
      return [
        record.class?.code === OUTPATIENT_CLASS_CODE ? "外来受診" : "入院",
        localDay(record.period?.start),
        localDay(record.period?.end),
        "",
        "",
        "",
        "",
        "",
        "",
        statusLabel(record),
        "",
        "",
        "",
        "",
        record.serviceProvider?.display ?? "",
        record.id ?? "",
      ];
    default:
      return [];
  }
}

function detailSortKey(record: ExtractRecord): string {
  switch (record.resourceType) {
    case "Observation":
      return record.effectiveDateTime ?? "";
    case "Condition":
      return record.recordedDate ?? "";
    case "MedicationRequest":
      return record.authoredOn ?? "";
    case "Encounter":
      return record.period?.start ?? "";
    default:
      return "";
  }
}

/**
 * 明細の CSV。結果の患者ごとに、条件に当たった記録を条件の順・日付の順に 1 件 1 行で並べる。
 * 種類ごとに使わない列は空にして、1 つの表にそろえる(Excel で絞り込めるように)。
 */
export function extractDetailCsv(rows: ExtractRow[], details: ExtractDetail[]): Blob {
  const lines: (string | number)[][] = [];
  for (const row of rows) {
    for (const { leaf, records } of details) {
      const mine = records
        .filter((record) => subjectOf(record) === row.patientId)
        .sort((a, b) => detailSortKey(a).localeCompare(detailSortKey(b)));
      for (const record of mine) {
        lines.push([
          row.patientNumber,
          row.name,
          row.age ?? "",
          row.gender,
          row.patientId,
          leafLabel(leaf),
          ...detailCells(record),
        ]);
      }
    }
  }
  return csvBlob(DETAIL_HEADER, lines);
}

// ---- 病名の ICD10 ----

export const ICD10_SYSTEM = "http://jpfhir.jp/fhir/core/mhlw/CodeSystem/ICD10-2013-full";

/**
 * ICD10 の入力を検索に使うコードに広げる。上流の token は完全一致なので、3 桁(E11)は
 * 4 桁の細分類(E110〜E119)も足す。病名マスタの ICD10 はピリオド無しで持つ。
 */
export function expandIcd10(input: string): ExtractCode[] {
  return input
    .split(/[\s,、]+/)
    .map((code) => code.trim().toUpperCase().replace(".", ""))
    .filter((code) => /^[A-Z]\d{2}\d?$/.test(code))
    .flatMap((code) =>
      code.length === 3 ? [code, ...Array.from({ length: 10 }, (_, i) => `${code}${i}`)] : [code],
    )
    .map((code) => ({ system: ICD10_SYSTEM, code, display: `ICD10 ${code}` }));
}
