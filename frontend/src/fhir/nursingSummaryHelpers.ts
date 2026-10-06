import { addDays, nowFhirDateTime, today } from "../lib/dates";
import { summarizeAllergy } from "./allergyHelpers";
import {
  NURSING_SUMMARY_TYPE,
  buildBodySections,
  isEmptyNoteHtml,
  newSectionDraft,
  plainTextXhtml,
  referencedResponseIds,
  sectionCodeOf,
  sectionDraftOf,
  toDateTimeInput,
  toFhirDateTime,
  type ClinicalNoteSave,
  type ClinicalNoteSectionDraft,
  type SectionOption,
} from "./clinicalNoteHelpers";
import { isActiveCondition, problemLabel, splitConditions, summarizeCondition } from "./conditionHelpers";
import {
  encounterAdmissionDate,
  encounterAttendingName,
  encounterDischargeDate,
  encounterNurseNames,
} from "./encounterHelpers";
import {
  NURSING_ACTIVITY_TYPE_LABELS,
  interventionGroups,
  nursingGoalViews,
  type NursingProblemView,
} from "./nursingCarePlanHelpers";
import type { NursingProfileDigest } from "./nursingProfileHelpers";
import { wardExtension, wardOf } from "./orderHeader";
import { practitionerDisplayName } from "./practitionerHelpers";
import { LOINC_SYSTEM } from "./shared";

// 看護サマリー(docs/nursing-care-plan-design.md)。受け持ち看護師が中間・転棟・退院の区分で、
// 期間中のケアと状態を看護問題ごとに要約する。器は退院時サマリーと同じ Composition。
// - type はローカルの nursing-summary、区分は category、対象の期間は event.period
// - 病棟は作成時の病棟を order-ward 拡張に持つ(病棟単位の承認一覧で ward 検索する)
// - 状態: 作成中 = preliminary / 承認待ち = final + attester(legal = 作成者)/
//   承認済 = attester(official = 承認者)を足す / 差戻し = preliminary に戻し、理由は通知 Task

const LOCAL_CS = "http://fhir-client.local/CodeSystem";
export const NURSING_SUMMARY_KIND_SYSTEM = `${LOCAL_CS}/nursing-summary-kind`;
const SECTION_SYSTEM = `${LOCAL_CS}/nursing-summary-section`;

export type NursingSummaryKind = "interim" | "transfer" | "discharge";
export const NURSING_SUMMARY_KIND_OPTIONS: { code: NursingSummaryKind; display: string }[] = [
  { code: "interim", display: "中間" },
  { code: "transfer", display: "転棟" },
  { code: "discharge", display: "退院" },
];

export function nursingSummaryKindLabel(kind: string | undefined): string {
  return NURSING_SUMMARY_KIND_OPTIONS.find((o) => o.code === kind)?.display ?? "";
}

const BASIC_SECTION = "basic";
const PAST_SECTION = "11348-0";
// 病名は診療記録の対象プロブレム(LOINC 11450-4)と同じコードにすると、カードがサマリーを
// 1 つのプロブレムの記録として扱うので、ローカルのコードにする。
const CONDITION_SECTION = "conditions";
const NURSING_PROBLEM_SECTION = "nursing-problems";
export const NURSING_SUMMARY_PROBLEM_SECTION = NURSING_PROBLEM_SECTION;
export const NURSING_COURSE_SECTION = "nursing-course";
const COURSE_SECTION = NURSING_COURSE_SECTION;
const STATUS_SECTION = "current-status";
const CONTINUING_SECTION = "continuing-care";

export type NursingSummaryEntrySection = typeof CONDITION_SECTION | typeof NURSING_PROBLEM_SECTION;

interface NursingSummarySectionDef extends SectionOption {
  kind: "entry" | "text";
}

/** セクションの定義。この順で保存し、この順で表示する。 */
export const NURSING_SUMMARY_SECTIONS: readonly NursingSummarySectionDef[] = [
  { code: BASIC_SECTION, display: "Basic information", title: "基本情報", kind: "text", system: SECTION_SYSTEM },
  { code: PAST_SECTION, display: "History of past illness", title: "既往歴", kind: "text" },
  { code: CONDITION_SECTION, display: "Conditions", title: "病名", kind: "entry", system: SECTION_SYSTEM },
  {
    code: NURSING_PROBLEM_SECTION,
    display: "Nursing problems",
    title: "看護問題・計画",
    kind: "entry",
    system: SECTION_SYSTEM,
  },
  { code: COURSE_SECTION, display: "Nursing course", title: "看護経過", kind: "text", system: SECTION_SYSTEM },
  { code: STATUS_SECTION, display: "Current status", title: "現在の状態", kind: "text", system: SECTION_SYSTEM },
  {
    code: CONTINUING_SECTION,
    display: "Continuing nursing care",
    title: "継続看護",
    kind: "text",
    system: SECTION_SYSTEM,
  },
] as const;

export const NURSING_SUMMARY_TEXT_SECTIONS: readonly SectionOption[] = NURSING_SUMMARY_SECTIONS.filter(
  (s) => s.kind === "text",
);

export interface NursingSummaryCandidate {
  reference: string;
  display: string;
  selected: boolean;
}

export interface NursingSummaryFormValues {
  encounterId: string;
  kind: NursingSummaryKind;
  periodStart: string;
  periodEnd: string;
  /** datetime-local 形式。 */
  date: string;
  entries: Record<NursingSummaryEntrySection, NursingSummaryCandidate[]>;
  sections: ClinicalNoteSectionDraft[];
}

/** 看護記録(看護職が書いた経過記録)1 件。取り込みの候補。 */
export interface NursingRecordSource {
  id: string;
  date: string;
  author: string;
  title: string;
  text: string;
}

/** 下書きの材料。api/queries の useNursingSummarySources が集める。 */
export interface NursingSummarySources {
  encounter: fhir4.Encounter;
  /** 入院の今の(退院済みなら最後の)病棟。看護サマリーに焼き付ける。 */
  ward: { wardId: string; wardName: string };
  patient: fhir4.Patient | undefined;
  conditions: fhir4.Condition[];
  allergies: fhir4.AllergyIntolerance[];
  nursingProblems: NursingProblemView[];
  nursingRecords: NursingRecordSource[];
  /** その入院の看護プロファイル(区画の順)。 */
  nursingProfile: NursingProfileDigest[];
  /** その入院の看護サマリー(中間の期間の既定に使う)。 */
  summaries: fhir4.Composition[];
}

function emptyEntries(): Record<NursingSummaryEntrySection, NursingSummaryCandidate[]> {
  return { [CONDITION_SECTION]: [], [NURSING_PROBLEM_SECTION]: [] };
}

export function emptyNursingSummaryForm(encounterId: string, kind: NursingSummaryKind): NursingSummaryFormValues {
  return {
    encounterId,
    kind,
    periodStart: "",
    periodEnd: "",
    date: toDateTimeInput(new Date()),
    entries: emptyEntries(),
    sections: NURSING_SUMMARY_TEXT_SECTIONS.map((s) => newSectionDraft(s.code)),
  };
}

function escapeHtml(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** 1 項目 1 行の短い行を、段落を分けずに改行でつないだ 1 段落にする(基本情報・既往歴を詰めて表示する)。 */
function linesToCompactHtml(lines: string[]): string {
  return `<p>${lines.map(escapeHtml).join("<br>")}</p>`;
}

function linesToHtml(lines: string[]): string {
  return lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("");
}

/**
 * 看護プロファイルの要約。区画ごとに「■見出し」と回答の行を 1 段落にする(回答の中のグループは【】で出る)。
 * 平文の字下げ(半角スペース 2 つで 1 段)は HTML で潰れるので全角スペースに置き換える。
 */
function nursingProfileHtml(digests: NursingProfileDigest[]): string {
  return digests
    .map((d) =>
      linesToCompactHtml([
        `■${d.title}`,
        ...d.text.split("\n").map((line) => line.replace(/^( {2})+/, (m) => "　".repeat(m.length / 2))),
      ]),
    )
    .join("");
}

/** 対象期間の既定。退院・転棟は入院日から、中間は前回のサマリーの翌日から。終わりは退院日か今日。 */
export function defaultNursingSummaryPeriod(
  kind: NursingSummaryKind,
  encounter: fhir4.Encounter,
  summaries: fhir4.Composition[],
): { start: string; end: string } {
  const admission = encounter.period?.start?.slice(0, 10) ?? "";
  const end = encounter.period?.end?.slice(0, 10) ?? today();
  if (kind !== "interim") return { start: admission, end };
  const lastEnd = summaries
    .map((s) => s.event?.[0]?.period?.end?.slice(0, 10) ?? "")
    .filter(Boolean)
    .sort()
    .at(-1);
  // 前回のサマリーが今日(退院日)まで書いてあれば、始まりが終わりを越えないよう終わりの日に揃える。
  const next = lastEnd ? addDays(lastEnd, 1) : admission;
  return { start: next > end ? end : next, end };
}

function ageOf(birthDate: string | undefined, at: string): string {
  if (!birthDate) return "";
  const [by, bm, bd] = birthDate.split("-").map(Number);
  const [y, m, d] = at.split("-").map(Number);
  const age = y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
  return Number.isFinite(age) ? `${age}歳` : "";
}

const GENDER_LABELS: Record<string, string> = { male: "男性", female: "女性", other: "その他", unknown: "不明" };

/**
 * 看護問題 1 件の要約。1 行目が「#n 問題」、続く行が目標・計画(OP/TP/EP、看護介入)・最新の評価で、行頭を字下げする。
 * サマリーの本文(section.text)と参照の表示(entry.display)にそのまま使う。入力フォームは 1 行目を見出しにし、中身はツリーで出す。
 */
export function nursingProblemDigest(view: NursingProblemView, index: number, at: string): string {
  const indent = "　";
  const goals = nursingGoalViews(view.goals, at).map(
    (g) => `${g.text}${g.outcomeName ? `(成果: ${g.outcomeName})` : ""}${g.achievement ? `(${g.achievement})` : ""}`,
  );
  const active = view.activities.filter((a) => !a.stopped);
  const plans = [
    ...interventionGroups(active).map((group) => `${group.name}: ${group.rows.map((r) => r.text).join("、")}`),
    ...(["op", "tp", "ep"] as const).flatMap((type) => {
      const rows = active.filter((a) => a.type === type).map((a) => a.text);
      return rows.length ? [`${NURSING_ACTIVITY_TYPE_LABELS[type]}: ${rows.join("、")}`] : [];
    }),
  ];
  const latest = view.evaluations.find((e) => e.kind === "problem");
  const status = view.active ? "" : `(解決 ${view.abatementDate})`;
  return [
    `#${index + 1} ${view.name}${status}`,
    ...(goals.length ? [`${indent}目標: ${goals.join("、")}`] : []),
    ...plans.map((line) => `${indent}${line}`),
    ...(latest
      ? [`${indent}評価 ${latest.date.slice(0, 10)}: ${latest.result}${latest.note ? ` ${latest.note}` : ""}`]
      : []),
  ].join("\n");
}

/**
 * 材料から下書きを作る。既存の値を渡すと本文と選択は残し、候補だけを集め直す。
 * 基本情報・既往歴・現在の状態(看護プロファイルの要約)は空の区画にだけ入れる。
 * 看護経過は自動では入れない(看護記録はフォームで選んで取り込む)。
 */
export function draftNursingSummaryForm(
  sources: NursingSummarySources,
  kind: NursingSummaryKind,
  existing?: NursingSummaryFormValues,
): NursingSummaryFormValues {
  const { encounter } = sources;
  const base = existing ?? emptyNursingSummaryForm(encounter.id ?? "", kind);
  const period = existing
    ? { start: existing.periodStart, end: existing.periodEnd }
    : defaultNursingSummaryPeriod(kind, encounter, sources.summaries);
  const at = today();

  const split = splitConditions(sources.conditions);
  const conditions = split.problems.map((condition) => ({
    reference: `Condition/${condition.id}`,
    display: problemLabel(condition),
    selected: isActiveCondition(condition),
  }));

  // 看護問題は継続中を優先度順、その期間に解決したものを後ろに(解決済みも候補に出す)。
  const inPeriod = sources.nursingProblems.filter(
    (view) => view.active || (view.abatementDate && view.abatementDate >= period.start),
  );
  const nursing = inPeriod.map((view, index) => ({
    reference: `CarePlan/${view.carePlan.id}`,
    display: nursingProblemDigest(view, index, at),
    selected: true,
  }));

  const patient = sources.patient;
  const allergies = sources.allergies
    .filter((a) => !["inactive", "resolved"].includes(a.clinicalStatus?.coding?.[0]?.code ?? ""))
    .map((a) => summarizeAllergy(a).name)
    .filter(Boolean);
  const discharge = encounterDischargeDate(encounter);
  const basicLines = [
    [ageOf(patient?.birthDate, at), GENDER_LABELS[patient?.gender ?? ""] ?? ""].filter(Boolean).join(" "),
    `入院日: ${encounterAdmissionDate(encounter)}${discharge !== "-" ? ` / 退院日: ${discharge}` : ""}`,
    `病棟: ${sources.ward.wardName || "-"}`,
    `主治医: ${encounterAttendingName(encounter) || "-"}`,
    `担当看護師: ${encounterNurseNames(encounter).join("、") || "-"}`,
    `アレルギー: ${allergies.join("、") || "なし"}`,
  ].filter(Boolean);
  const pastLines = split.pasts
    .map((c) => summarizeCondition(c))
    .filter((s) => s.name)
    .map((s) => (s.startDate ? `${s.name}(${s.startDate})` : s.name));

  const drafts: Record<string, string> = {
    [BASIC_SECTION]: linesToCompactHtml(basicLines),
    [PAST_SECTION]: linesToCompactHtml(pastLines.length ? pastLines : ["なし"]),
  };
  if (sources.nursingProfile.length) drafts[STATUS_SECTION] = nursingProfileHtml(sources.nursingProfile);
  const sections = base.sections.map((section) =>
    isEmptyNoteHtml(section.html) && !section.template && drafts[section.code]
      ? { ...section, html: drafts[section.code] }
      : section,
  );

  return {
    ...base,
    periodStart: period.start,
    periodEnd: period.end,
    entries: {
      [CONDITION_SECTION]: mergeCandidates(base.entries[CONDITION_SECTION], conditions, Boolean(existing)),
      [NURSING_PROBLEM_SECTION]: mergeCandidates(base.entries[NURSING_PROBLEM_SECTION], nursing, Boolean(existing)),
    },
    sections,
  };
}

function mergeCandidates(
  current: NursingSummaryCandidate[],
  fresh: NursingSummaryCandidate[],
  keepSelection: boolean,
): NursingSummaryCandidate[] {
  if (!keepSelection) return fresh;
  const currentByRef = new Map(current.map((c) => [c.reference, c]));
  const merged = fresh.map((candidate) => {
    const existing = currentByRef.get(candidate.reference);
    return existing ? { ...candidate, selected: existing.selected } : candidate;
  });
  const freshRefs = new Set(fresh.map((c) => c.reference));
  for (const candidate of current) {
    if (!freshRefs.has(candidate.reference) && candidate.selected) merged.push(candidate);
  }
  return merged;
}

/** 看護経過に看護記録を追記する(取り込み)。エディタは非制御なので uid を替えて作り直させる。 */
export function appendNursingRecords(
  values: NursingSummaryFormValues,
  records: NursingRecordSource[],
): NursingSummaryFormValues {
  const html = linesToHtml(
    records.flatMap((r) => [`${r.date.slice(0, 16).replace("T", " ")} ${r.title}(${r.author})`, ...r.text.split("\n")]),
  );
  return {
    ...values,
    sections: values.sections.map((section) =>
      section.code === COURSE_SECTION && !section.template
        ? { ...section, uid: crypto.randomUUID(), html: isEmptyNoteHtml(section.html) ? html : section.html + html }
        : section,
    ),
  };
}

// ---- build / parse ----

export function validateNursingSummary(values: NursingSummaryFormValues, practitionerId: string | null): string {
  if (!values.encounterId) return "対象の入院を選んでください。";
  if (!values.periodStart || !values.periodEnd) return "対象期間を入れてください。";
  if (values.periodEnd < values.periodStart) return "対象期間の終わりは始まり以降にしてください。";
  const hasText = values.sections.some((s) => !isEmptyNoteHtml(s.html));
  const hasEntry = Object.values(values.entries).some((list) => list.some((c) => c.selected));
  if (!hasText && !hasEntry) return "本文が空です。";
  if (practitionerId === null) return "医療従事者に紐づくアカウントでログインしてください。";
  return "";
}

export interface NursingSummaryBuildOptions {
  patientId: string;
  practitioner: fhir4.Practitioner | null;
  existing?: fhir4.Composition;
  /** 作成時の病棟(新規のときだけ使う)。 */
  ward?: { wardId: string; wardName: string };
  /** 保存の種類。draft = 作成中 / confirm = 確定(承認待ち)/ approve = 承認者が直して承認。 */
  mode: "draft" | "confirm" | "approve";
}

function attesterOf(practitioner: fhir4.Practitioner, mode: "legal" | "official"): fhir4.CompositionAttester {
  return {
    mode,
    time: nowFhirDateTime(),
    party: { reference: `Practitioner/${practitioner.id}`, display: practitionerDisplayName(practitioner) },
  };
}

export function buildNursingSummary(
  values: NursingSummaryFormValues,
  options: NursingSummaryBuildOptions,
): ClinicalNoteSave {
  const { patientId, practitioner, existing, ward, mode } = options;
  const entries: fhir4.BundleEntry[] = [];
  const keptResponseIds = new Set<string>();
  const kindLabel = nursingSummaryKindLabel(values.kind);

  const bodyByCode = new Map(
    buildBodySections(values.sections, NURSING_SUMMARY_TEXT_SECTIONS, entries, keptResponseIds).map(
      (section) => [sectionCodeOf(section), section] as const,
    ),
  );
  const sections: fhir4.CompositionSection[] = [];
  for (const def of NURSING_SUMMARY_SECTIONS) {
    if (def.kind === "text") {
      const body = bodyByCode.get(def.code);
      if (body) sections.push(body);
      continue;
    }
    const selected = values.entries[def.code as NursingSummaryEntrySection].filter((c) => c.selected);
    sections.push({
      title: def.title,
      code: { coding: [{ system: def.system ?? LOINC_SYSTEM, code: def.code, display: def.display }] },
      text: {
        status: "generated",
        div: plainTextXhtml(selected.length ? selected.map((c) => c.display).join("\n") : "なし"),
      },
      ...(selected.length ? { entry: selected.map((c) => ({ reference: c.reference, display: c.display })) } : {}),
    });
  }

  // 作成中は署名なし。確定は作成者の legal。承認者が直して承認するときは作成者の legal を残し official を足す。
  let status: fhir4.Composition["status"] = "preliminary";
  let attester: fhir4.CompositionAttester[] | undefined;
  const legal = existing?.attester?.find((a) => a.mode === "legal");
  if (mode === "confirm" && practitioner?.id) {
    status = existing && existing.status !== "preliminary" ? "amended" : "final";
    attester = [attesterOf(practitioner, "legal")];
  } else if (mode === "approve" && practitioner?.id) {
    status = "amended";
    attester = [...(legal ? [legal] : []), attesterOf(practitioner, "official")];
  }

  const author: fhir4.Reference[] = existing
    ? existing.author
    : [{ reference: `Practitioner/${practitioner?.id}`, display: practitioner ? practitionerDisplayName(practitioner) : undefined }];

  const composition: fhir4.Composition = {
    resourceType: "Composition",
    status,
    type: NURSING_SUMMARY_TYPE,
    category: [
      { coding: [{ system: NURSING_SUMMARY_KIND_SYSTEM, code: values.kind, display: kindLabel }] },
    ],
    subject: { reference: `Patient/${patientId}` },
    encounter: { reference: `Encounter/${values.encounterId}` },
    date: toFhirDateTime(values.date),
    author,
    title: `看護サマリー(${kindLabel})`,
    event: [{ period: { start: values.periodStart, end: values.periodEnd } }],
    section: sections,
  };
  if (attester) composition.attester = attester;
  const savedWard = existing ? wardOf(existing) : null;
  if (savedWard?.wardId) composition.extension = [wardExtension(savedWard.wardId, savedWard.wardName)];
  else if (ward?.wardId) composition.extension = [wardExtension(ward.wardId, ward.wardName)];
  if (existing?.id) composition.id = existing.id;

  for (const id of referencedResponseIds(existing)) {
    if (!keptResponseIds.has(id)) entries.push({ request: { method: "DELETE", url: `QuestionnaireResponse/${id}` } });
  }
  return { composition, entries };
}

export function parseNursingSummaryForm(composition: fhir4.Composition): NursingSummaryFormValues {
  const entries = emptyEntries();
  const textByCode = new Map<string, ClinicalNoteSectionDraft>();
  for (const section of composition.section ?? []) {
    const code = sectionCodeOf(section);
    const def = NURSING_SUMMARY_SECTIONS.find((s) => s.code === code);
    if (!def) continue;
    if (def.kind === "entry") {
      entries[code as NursingSummaryEntrySection] = (section.entry ?? []).flatMap((entry) =>
        entry.reference ? [{ reference: entry.reference, display: entry.display ?? "", selected: true }] : [],
      );
    } else {
      textByCode.set(code, sectionDraftOf(section, code));
    }
  }
  return {
    encounterId: composition.encounter?.reference?.split("/").pop() ?? "",
    kind: nursingSummaryKindOf(composition),
    periodStart: composition.event?.[0]?.period?.start?.slice(0, 10) ?? "",
    periodEnd: composition.event?.[0]?.period?.end?.slice(0, 10) ?? "",
    date: toDateTimeInput(composition.date),
    entries,
    sections: NURSING_SUMMARY_TEXT_SECTIONS.map((def) => textByCode.get(def.code) ?? newSectionDraft(def.code)),
  };
}

// ---- 状態・承認 ----

export function nursingSummaryKindOf(composition: fhir4.Composition): NursingSummaryKind {
  const code = composition.category
    ?.flatMap((c) => c.coding ?? [])
    .find((c) => c.system === NURSING_SUMMARY_KIND_SYSTEM)?.code;
  return code === "transfer" || code === "discharge" ? code : "interim";
}

export type NursingSummaryState = "draft" | "returned" | "pending" | "approved";
export const NURSING_SUMMARY_STATE_LABELS: Record<NursingSummaryState, string> = {
  draft: "作成中",
  returned: "差戻し",
  pending: "承認待ち",
  approved: "承認済",
};

export function nursingSummaryApprover(composition: fhir4.Composition): { name: string; time: string; id: string } | null {
  const official = composition.attester?.find((a) => a.mode === "official");
  if (!official) return null;
  return {
    name: official.party?.display ?? "",
    time: official.time ?? "",
    id: official.party?.reference?.match(/^Practitioner\/(.+)$/)?.[1] ?? "",
  };
}

export function nursingSummaryAuthorId(composition: fhir4.Composition): string {
  return composition.author?.[0]?.reference?.match(/^Practitioner\/(.+)$/)?.[1] ?? "";
}

/** 承認できる人か。看護職で、作成者でも確定した人でもないこと(呼ぶ側が看護職かを渡す)。 */
export function canApproveNursingSummary(
  composition: fhir4.Composition,
  practitionerId: string | null,
  isNursing: boolean,
): boolean {
  if (!practitionerId || !isNursing) return false;
  const legalId = composition.attester
    ?.find((a) => a.mode === "legal")
    ?.party?.reference?.match(/^Practitioner\/(.+)$/)?.[1];
  return nursingSummaryAuthorId(composition) !== practitionerId && legalId !== practitionerId;
}

/** 状態。returned は未対応の差戻しの通知があるか(呼ぶ側が渡す)。 */
export function nursingSummaryStateOf(composition: fhir4.Composition, returned: boolean): NursingSummaryState {
  if (composition.status === "preliminary") return returned ? "returned" : "draft";
  return nursingSummaryApprover(composition) ? "approved" : "pending";
}

/** 承認。内容は変えず、作成者の署名を残して承認者の署名(official)を足す。 */
export function buildApprovedNursingSummary(
  composition: fhir4.Composition,
  approver: fhir4.Practitioner,
): fhir4.Composition {
  return {
    ...composition,
    attester: [...(composition.attester ?? []).filter((a) => a.mode !== "official"), attesterOf(approver, "official")],
  };
}

/** 却下。作成中に戻して署名を外す(理由は差戻しの通知 Task に持つ)。 */
export function buildReturnedNursingSummary(composition: fhir4.Composition): fhir4.Composition {
  const next: fhir4.Composition = { ...composition, status: "preliminary" };
  delete next.attester;
  return next;
}
