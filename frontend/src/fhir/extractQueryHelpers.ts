import { csvBlob } from "../lib/csv";
import { localDay } from "../lib/dates";
import { DETAIL_COLUMNS, EXTRACT_KIND_DEFS, extractKindDef } from "./extractKinds";
import {
  EXTRACT_KINDS,
  LEAF_OUTPUT_FIELDS,
  ageToBirthDateRange,
  type ExtractCode,
  type ExtractGroup,
  type ExtractKind,
  type ExtractLeaf,
  type ExtractNode,
  type ExtractPeriod,
  type ExtractRecord,
  type ExtractRelation,
  type LeafOutputField,
  type LeafSearch,
} from "./extractQueryModel";
import {
  addressLabelOf,
  calculateAge,
  displayKana,
  displayName,
  genderLabel,
  homePhoneOf,
  mobilePhoneOf,
  patientNumberOf,
} from "./patientHelpers";
import { referenceIdOfType } from "./shared";

export * from "./extractQueryModel";

// データ抽出(docs/data-extract-design.md)。条件の組み合わせ・結果の行と内訳・CSV。条件の種類ごとの
// 検索と記録の読み方は fhir/extractKinds.ts、条件のモデルは fhir/extractQueryModel.ts。取得(上流を
// 引く)は api/queries/extractQuery.ts が担い、ここは純粋関数だけにする(データ源を DWH に差し替える
// ときも、ここと画面はそのまま使う)。

export const EXTRACT_KIND_LABELS = Object.fromEntries(
  EXTRACT_KINDS.map((kind) => [kind, EXTRACT_KIND_DEFS[kind].label]),
) as Record<ExtractKind, string>;

export interface ExtractQueryBody {
  schema_version: 1;
  root: ExtractGroup;
  output?: ExtractOutput;
}

// ---- 出力項目 ----

/** 一覧・CSV に出す患者の項目(患者番号・氏名はいつも出す)。 */
export type PatientColumn =
  | "kana"
  | "age"
  | "gender"
  | "birth_date"
  | "postal_code"
  | "address"
  | "phone"
  | "patient_id";

export const PATIENT_COLUMNS: { value: PatientColumn; label: string }[] = [
  { value: "kana", label: "カナ" },
  { value: "age", label: "年齢" },
  { value: "gender", label: "性別" },
  { value: "birth_date", label: "生年月日" },
  { value: "postal_code", label: "郵便番号" },
  { value: "address", label: "住所" },
  { value: "phone", label: "電話" },
  { value: "patient_id", label: "患者ID" },
];

export interface ExtractOutput {
  patient_columns?: PatientColumn[];
}

/** 出力項目を選んでいないときの患者の列。一覧も CSV も同じ列にする。 */
export const DEFAULT_PATIENT_COLUMNS: PatientColumn[] = ["age", "gender", "birth_date"];

/** 出す患者の列(PATIENT_COLUMNS の並び)。 */
export function patientColumnsOf(output: ExtractOutput | undefined): PatientColumn[] {
  const selected = output?.patient_columns;
  const columns = selected && selected.length ? selected : DEFAULT_PATIENT_COLUMNS;
  return PATIENT_COLUMNS.map((c) => c.value).filter((value) => columns.includes(value));
}

/** 条件の出す項目(LEAF_OUTPUT_FIELDS の並び)。選んでいなければすべて。 */
export function leafOutputFieldsOf(leaf: ExtractLeaf): LeafOutputField[] {
  const selected = leaf.output_fields;
  return LEAF_OUTPUT_FIELDS.map((f) => f.value).filter((value) => !selected?.length || selected.includes(value));
}

export function patientColumnLabel(column: PatientColumn): string {
  return PATIENT_COLUMNS.find((c) => c.value === column)?.label ?? column;
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
  return { key: newKey(), kind, ...EXTRACT_KIND_DEFS[kind].initial() };
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
  const codes = [
    ...(leaf.drug_classes ?? []).map((c) => c.name || `薬効${c.code}`),
    ...(leaf.codes ?? []).map((c) => c.display || c.code),
  ];
  const names = codes.length > 2 ? `${codes.slice(0, 2).join("・")}ほか${codes.length - 2}件` : codes.join("・");
  const relation = leaf.relation ? relationLabel(leaf.relation) : "";
  const period = [periodLabel(leaf.period), relation, (leaf.min_count ?? 1) > 1 ? `${leaf.min_count}件以上` : ""]
    .filter(Boolean)
    .join(" ");
  return extractKindDef(leaf.kind).describe(leaf, names, period);
}

function relationLabel(relation: ExtractRelation): string {
  const day = (n: number) => (n === 0 ? "当日" : n > 0 ? `${n}日後` : `${-n}日前`);
  const base = relation.anchor_date === "end" ? "終了" : "";
  return `基準${base}の${day(relation.from_days)}〜${day(relation.to_days)}`;
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
      else if (child.relation) {
        const anchor = relationAnchorOf(group, child);
        if (!anchor) errors.push(`${leafLabel(child)}: 基準の条件を選び直してください。`);
        else if (child.relation.from_days > child.relation.to_days) {
          errors.push(`${leafLabel(child)}: 日数の範囲が逆です。`);
        }
      }
    }
  };
  visit(body.root, 1);

  for (const leaf of leaves) {
    const name = leafLabel(leaf);
    for (const message of extractKindDef(leaf.kind).validate(leaf)) errors.push(`${name}: ${message}`);
    if (leaf.period?.mode === "relative" && !(leaf.period.days && leaf.period.days > 0)) {
      errors.push(`${name}: 日数を入れてください。`);
    }
    if (leaf.period?.mode === "absolute" && !leaf.period.from && !leaf.period.to) {
      errors.push(`${name}: 期間を入れてください。`);
    }
    if (leaf.value && !Number.isFinite(leaf.value.value)) errors.push(`${name}: 値を数値で入れてください。`);
    if (leaf.min_count != null && !(Number.isInteger(leaf.min_count) && leaf.min_count >= 1)) {
      errors.push(`${name}: 件数は 1 以上の整数で入れてください。`);
    }
  }
  return Array.from(new Set(errors));
}

/** 時間関係の基準にできる兄弟(AND の直下の、除外でも患者属性でもなく、自分も時間関係を持たない条件)。 */
export function relationAnchors(parent: ExtractGroup, leaf: ExtractLeaf): ExtractLeaf[] {
  if (parent.op !== "and") return [];
  return parent.children.filter(
    (c): c is ExtractLeaf => !isGroup(c) && c !== leaf && !c.not && c.kind !== "patient" && !c.relation,
  );
}

export function relationAnchorOf(parent: ExtractGroup, leaf: ExtractLeaf): ExtractLeaf | undefined {
  if (!leaf.relation) return undefined;
  return relationAnchors(parent, leaf).find((c) => c.key === leaf.relation!.key);
}

/** 条件 → それが属するグループ(時間関係の基準を探すため)。 */
export function parentGroups(root: ExtractGroup): Map<string, ExtractGroup> {
  const parents = new Map<string, ExtractGroup>();
  const visit = (group: ExtractGroup) => {
    for (const child of group.children) {
      if (isGroup(child)) visit(child);
      else parents.set(child.key, group);
    }
  };
  visit(root);
  return parents;
}

/** 除外にできる位置か(AND の直下で、ほかに除外でない兄弟がある)。 */
export function canNegate(parent: ExtractGroup, leaf: ExtractLeaf): boolean {
  if (parent.op !== "and") return false;
  return parent.children.some((c) => c !== leaf && (isGroup(c) || !c.not));
}

// ---- 条件 → FHIR 検索 ----

/** 条件 1 つぶんの上流の検索(種類ごとの検索は fhir/extractKinds.ts)。 */
export function leafSearch(leaf: ExtractLeaf, today: string): LeafSearch {
  return extractKindDef(leaf.kind).search(leaf, today);
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

function subjectOf(resource: ExtractRecord): string {
  if (resource.resourceType === "Patient") return resource.id ?? "";
  return referenceIdOfType(resource.subject?.reference, "Patient");
}

function recordDate(leaf: ExtractLeaf, resource: ExtractRecord): string {
  return extractKindDef(leaf.kind).recordDate(leaf, resource);
}

/** 検索で返った行を患者ごとに畳む。min_count に届かない患者は外す。 */
export function leafHitsOf(leaf: ExtractLeaf, resources: ExtractRecord[]): LeafHits {
  const grouped = new Map<string, { date: string; content: string }[]>();
  for (const resource of resources) {
    const patientId = subjectOf(resource);
    if (!patientId) continue;
    const list = grouped.get(patientId) ?? [];
    list.push({ date: recordDate(leaf, resource), content: extractKindDef(leaf.kind).recordContent(resource) });
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

/** 内訳(月別・診療科別)に使う、記録 1 件ぶんの要約。 */
export interface LeafRecord {
  patientId: string;
  /** 記録の日(YYYY-MM-DD)。 */
  day: string;
  department: string;
}

/** 検索で返った行を、内訳に使う要約にする。min_count に届かない患者の記録も含む(結果の患者で絞って使う)。 */
export function leafRecordsOf(leaf: ExtractLeaf, resources: ExtractRecord[]): LeafRecord[] {
  return resources
    .map((resource) => ({
      patientId: subjectOf(resource),
      day: localDay(recordDate(leaf, resource)),
      department: extractKindDef(leaf.kind).recordDepartment(resource),
    }))
    .filter((record) => record.patientId);
}

function startDay(leaf: ExtractLeaf, resource: ExtractRecord): string {
  return localDay(recordDate(leaf, resource));
}

function endDay(leaf: ExtractLeaf, resource: ExtractRecord): string {
  return extractKindDef(leaf.kind).endDay?.(resource) ?? "";
}

function dayDiff(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * 時間関係で記録を絞る。患者ごとに、基準の条件の記録のどれか 1 つから from_days〜to_days 日に
 * 入る記録だけを残す。基準の日は anchor_date(終了日を持たない記録は開始日)。上流では表せない
 * ので、両方の記録を読んでから手元で突き合わせる。
 */
export function applyRelation(
  leaf: ExtractLeaf,
  records: ExtractRecord[],
  anchor: ExtractLeaf,
  anchorRecords: ExtractRecord[],
): ExtractRecord[] {
  const relation = leaf.relation;
  if (!relation) return records;
  const anchorDays = new Map<string, string[]>();
  for (const record of anchorRecords) {
    const patientId = subjectOf(record);
    const day = (relation.anchor_date === "end" ? endDay(anchor, record) : "") || startDay(anchor, record);
    if (!patientId || !day) continue;
    anchorDays.set(patientId, [...(anchorDays.get(patientId) ?? []), day]);
  }
  return records.filter((record) => {
    const day = startDay(leaf, record);
    const bases = anchorDays.get(subjectOf(record));
    if (!day || !bases) return false;
    return bases.some((base) => {
      const diff = dayDiff(base, day);
      return diff >= relation.from_days && diff <= relation.to_days;
    });
  });
}

export type LeafBreakdownAxis = "month" | "department";

export interface LeafBreakdownRow {
  key: string;
  records: number;
  patients: number;
}

/**
 * 条件 1 つの内訳。結果の患者の記録を月別(YYYY-MM、古い順)か診療科別(件数の多い順)に数える。
 * 日付・診療科の無い記録は「不明」にまとめる。
 */
export function leafBreakdown(
  records: LeafRecord[],
  patientIds: Set<string>,
  axis: LeafBreakdownAxis,
): LeafBreakdownRow[] {
  const groups = new Map<string, { records: number; patients: Set<string> }>();
  for (const record of records) {
    if (!patientIds.has(record.patientId)) continue;
    const key = (axis === "month" ? record.day.slice(0, 7) : record.department) || "不明";
    const group = groups.get(key) ?? { records: 0, patients: new Set<string>() };
    group.records += 1;
    group.patients.add(record.patientId);
    groups.set(key, group);
  }
  const rows = [...groups].map(([key, g]) => ({ key, records: g.records, patients: g.patients.size }));
  return axis === "month"
    ? rows.sort((a, b) => (a.key === "不明" ? 1 : b.key === "不明" ? -1 : a.key.localeCompare(b.key)))
    : rows.sort((a, b) => b.records - a.records || a.key.localeCompare(b.key));
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

/** 結果の行の患者の部分(患者の抽出とテンプレートの抽出で共通)。 */
export interface ExtractPatientRow {
  patientId: string;
  patientNumber: string;
  name: string;
  kana: string;
  birthDate: string;
  age: number | undefined;
  gender: string;
  postalCode: string;
  address: string;
  phone: string;
}

export interface ExtractRow extends ExtractPatientRow {
  hits: Record<string, LeafHit | undefined>;
}

/** 記録を表にするタブで画面に並べる行の上限(CSV にはすべて出す)。 */
export const RECORD_DISPLAY_LIMIT = 500;

export function patientRowOf(patientId: string, patient: fhir4.Patient | undefined): ExtractPatientRow {
  return {
    patientId,
    patientNumber: (patient && patientNumberOf(patient)) ?? "",
    name: patient ? displayName(patient) : "",
    kana: patient ? displayKana(patient) : "",
    birthDate: patient?.birthDate ?? "",
    age: patient?.birthDate ? calculateAge(patient.birthDate) : undefined,
    gender: genderLabel(patient?.gender),
    postalCode: patient?.address?.[0]?.postalCode ?? "",
    address: patient ? addressLabelOf(patient) : "",
    phone: patient ? homePhoneOf(patient) || mobilePhoneOf(patient) : "",
  };
}

/** 患者の列の値。 */
export function patientCell(row: ExtractPatientRow, column: PatientColumn): string | number {
  switch (column) {
    case "kana":
      return row.kana;
    case "age":
      return row.age ?? "";
    case "gender":
      return row.gender;
    case "birth_date":
      return row.birthDate;
    case "postal_code":
      return row.postalCode;
    case "address":
      return row.address;
    case "phone":
      return row.phone;
    case "patient_id":
      return row.patientId;
  }
}

/** 条件の項目の値(CSV の 1 列ぶん)。 */
export function leafFieldCell(hit: LeafHit | undefined, field: LeafOutputField): string | number {
  if (!hit) return "";
  return field === "count" ? hit.count : field === "first" ? hit.first : field === "last" ? hit.last : hit.latest;
}

/** 一覧のセルにまとめた条件の値(「6件 2026-04-24〜2026-09-11 8.5%」)。選んだ項目だけを並べる。 */
export function leafCellText(hit: LeafHit | undefined, fields: LeafOutputField[]): string {
  if (!hit) return "";
  const parts: string[] = [];
  if (fields.includes("count")) parts.push(`${hit.count}件`);
  const first = fields.includes("first") ? hit.first : "";
  const last = fields.includes("last") ? hit.last : "";
  if (first && last) parts.push(first === last ? last : `${first}〜${last}`);
  else if (first) parts.push(`${first}〜`);
  else if (last) parts.push(`〜${last}`);
  if (fields.includes("latest") && hit.latest) parts.push(hit.latest);
  return parts.join(" ");
}

export function extractRows(
  ids: Set<string>,
  patients: Map<string, fhir4.Patient>,
  leaves: ExtractLeaf[],
  hitsByLeaf: Map<string, LeafHits>,
): ExtractRow[] {
  return [...ids]
    .map((patientId) => ({
      ...patientRowOf(patientId, patients.get(patientId)),
      hits: Object.fromEntries(leaves.map((leaf) => [leaf.key, hitsByLeaf.get(leaf.key)?.get(patientId)])),
    }))
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

/** 患者 1 行の CSV。患者の列と、条件ごとに選んだ項目(既定は件数・最初・最後・最新)を並べる。 */
export function extractCsv(rows: ExtractRow[], leaves: ExtractLeaf[], output?: ExtractOutput): Blob {
  const patientColumns = patientColumnsOf(output);
  const columns = resultColumns(leaves);
  const fieldsByLeaf = new Map(columns.map((leaf) => [leaf.key, leafOutputFieldsOf(leaf)]));
  const fieldLabel = (field: LeafOutputField) => LEAF_OUTPUT_FIELDS.find((f) => f.value === field)!.label;
  const header = [
    "患者番号",
    "氏名",
    ...patientColumns.map(patientColumnLabel),
    ...columns.flatMap((leaf) => fieldsByLeaf.get(leaf.key)!.map((field) => `${leafLabel(leaf)} ${fieldLabel(field)}`)),
  ];
  return csvBlob(
    header,
    rows.map((row) => [
      row.patientNumber,
      row.name,
      ...patientColumns.map((column) => patientCell(row, column)),
      ...columns.flatMap((leaf) => fieldsByLeaf.get(leaf.key)!.map((field) => leafFieldCell(row.hits[leaf.key], field))),
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

/**
 * 明細の CSV。結果の患者ごとに、条件に当たった記録を条件の順・日付の順に 1 件 1 行で並べる。
 * 種類ごとに使わない列は空にして、1 つの表にそろえる(Excel で絞り込めるように)。
 */
export function extractDetailCsv(rows: ExtractRow[], details: ExtractDetail[], output?: ExtractOutput): Blob {
  const patientColumns = patientColumnsOf(output);
  const lines: (string | number)[][] = [];
  for (const row of rows) {
    for (const { leaf, records } of details) {
      const mine = records
        .filter((record) => subjectOf(record) === row.patientId)
        .sort((a, b) => recordDate(leaf, a).localeCompare(recordDate(leaf, b)));
      for (const record of mine) {
        lines.push([
          row.patientNumber,
          row.name,
          ...patientColumns.map((column) => patientCell(row, column)),
          leafLabel(leaf),
          ...detailCells(leaf, record),
        ]);
      }
    }
  }
  return csvBlob(
    ["患者番号", "氏名", ...patientColumns.map(patientColumnLabel), "条件", ...DETAIL_COLUMNS.map(([, label]) => label)],
    lines,
  );
}

/** 明細の、条件の列より後ろの値(種類ごとに使わない列は空)。 */
function detailCells(leaf: ExtractLeaf, record: ExtractRecord): (string | number)[] {
  const fields = extractKindDef(leaf.kind).detail(record);
  return DETAIL_COLUMNS.map(([key]) => fields[key] ?? "");
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
