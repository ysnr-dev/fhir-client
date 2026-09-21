import { today } from "../lib/dates";
import { isRadiotherapyServiceRequest, summarizeRadiotherapyOrder } from "./radiotherapyOrderHelpers";
import {
  buildAttester,
  buildBodySections,
  DISCHARGE_SUMMARY_TYPE,
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
import { isActiveCondition, problemLabel, splitConditions } from "./conditionHelpers";
import { summarizeAllergy } from "./allergyHelpers";
import {
  encounterDischargeDisposition,
  withDischargeDisposition,
  type EncounterEvent,
} from "./encounterHelpers";
import { departmentExtension, departmentOf } from "./prescriptionHelpers";
import { practitionerDisplayName } from "./practitionerHelpers";
import { orderDay } from "./shared";

// 退院時サマリー(退院時要約)。診療記録と同じ Composition の器で、
// - type は LOINC 18842-5(Discharge summary)、encounter に入院を持つ(1 入院 1 サマリー)
// - セクションは固定(C-CDA on FHIR Discharge Summary のコード)。参照を持つセクション
//   (退院時診断・手術処置・退院時処方・アレルギー)は section.entry に Condition /
//   ServiceRequest / MedicationRequest / AllergyIntolerance を入れ、text は entry の
//   表示名から生成する(参照解決なしでカード・履歴が描けるように)。本文のセクション
//   (入院経過・検査所見・退院時の状態・退院後の方針)は診療記録と同じリッチテキストで、
//   テンプレート回答の埋め込みも同じ機構で効く。
// - 転帰(退院先)は Encounter.hospitalization.dischargeDisposition に書く(標準要素)。
// 集約は入院期間の日付範囲で行う(オーダーは Encounter を参照していないため。
// 経過表と同じ手段)。

const LOINC_SYSTEM = "http://loinc.org";

export const DIAGNOSIS_SECTION = "11535-2";
export const COURSE_SECTION = "8648-8";
export const PROCEDURE_SECTION = "47519-4";
export const TESTS_SECTION = "30954-2";
export const MEDICATION_SECTION = "10183-2";
export const CONDITION_SECTION = "10184-0";
export const PLAN_SECTION = "18776-5";
export const ALLERGY_SECTION = "48765-2";

export type EntrySectionCode =
  | typeof DIAGNOSIS_SECTION
  | typeof PROCEDURE_SECTION
  | typeof MEDICATION_SECTION
  | typeof ALLERGY_SECTION;

interface SummarySectionDef extends SectionOption {
  kind: "entry" | "text";
}

/** セクションの定義。この順で保存し、この順で表示する。 */
export const SUMMARY_SECTIONS: readonly SummarySectionDef[] = [
  { code: DIAGNOSIS_SECTION, display: "Hospital discharge diagnosis", title: "退院時診断", kind: "entry" },
  { code: COURSE_SECTION, display: "Hospital course", title: "入院経過", kind: "text" },
  { code: PROCEDURE_SECTION, display: "History of procedures", title: "手術・処置", kind: "entry" },
  { code: TESTS_SECTION, display: "Relevant diagnostic tests and laboratory data", title: "主な検査所見", kind: "text" },
  { code: MEDICATION_SECTION, display: "Hospital discharge medications", title: "退院時処方", kind: "entry" },
  { code: CONDITION_SECTION, display: "Hospital discharge physical findings", title: "退院時の状態", kind: "text" },
  { code: PLAN_SECTION, display: "Plan of care", title: "退院後の方針", kind: "text" },
  { code: ALLERGY_SECTION, display: "Allergies and adverse reactions", title: "アレルギー", kind: "entry" },
] as const;

export const SUMMARY_TEXT_SECTIONS: readonly SectionOption[] = SUMMARY_SECTIONS.filter(
  (s) => s.kind === "text",
);
const ENTRY_SECTION_CODES = SUMMARY_SECTIONS.filter((s) => s.kind === "entry").map(
  (s) => s.code as EntrySectionCode,
);

export function summarySectionTitle(code: string): string {
  return SUMMARY_SECTIONS.find((s) => s.code === code)?.title ?? code;
}

/** 参照セクションの候補 1 件。selected のものだけ保存する。 */
export interface SummaryEntryCandidate {
  reference: string;
  display: string;
  selected: boolean;
}

export interface DischargeSummaryFormValues {
  encounterId: string;
  status: "preliminary" | "final";
  /** datetime-local 形式 "YYYY-MM-DDTHH:mm" */
  date: string;
  /** 転帰(退院先)のコード。空は未設定。 */
  disposition: string;
  entries: Record<EntrySectionCode, SummaryEntryCandidate[]>;
  /** 本文セクション(SUMMARY_TEXT_SECTIONS の順)。 */
  sections: ClinicalNoteSectionDraft[];
}

/** 下書きを集めるための、入院期間のデータ。api/queries の useDischargeSummarySources が集める。 */
export interface DischargeSummarySources {
  encounter: fhir4.Encounter;
  /** 入院・転棟・外泊などのイベント(病棟名を引き直し済み)。 */
  events: EncounterEvent[];
  conditions: fhir4.Condition[];
  /** 入院期間内の手術・処置・内視鏡・放射線・生理・病理のオーダー(ヘッダ)とその明細・実施記録。 */
  orders: { headers: fhir4.ServiceRequest[]; items: fhir4.ServiceRequest[]; procedures: fhir4.Procedure[] };
  /** 退院処方(区分「退院」)の薬剤。 */
  dischargeMedications: fhir4.MedicationRequest[];
  allergies: fhir4.AllergyIntolerance[];
}

function emptyEntries(): Record<EntrySectionCode, SummaryEntryCandidate[]> {
  return {
    [DIAGNOSIS_SECTION]: [],
    [PROCEDURE_SECTION]: [],
    [MEDICATION_SECTION]: [],
    [ALLERGY_SECTION]: [],
  };
}

export function emptyDischargeSummaryForm(encounterId: string): DischargeSummaryFormValues {
  return {
    encounterId,
    status: "preliminary",
    date: toDateTimeInput(new Date()),
    disposition: "",
    entries: emptyEntries(),
    sections: SUMMARY_TEXT_SECTIONS.map((s) => newSectionDraft(s.code)),
  };
}

// ---- 下書きの生成 ----

function mdLabel(date: string): string {
  return date.length >= 10 ? `${date.slice(5, 7)}/${date.slice(8, 10)}` : date;
}

function escapeHtml(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function linesToHtml(lines: string[]): string {
  return lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("");
}

function stayRange(encounter: fhir4.Encounter): { start: string; end: string } {
  const start = encounter.period?.start?.slice(0, 10) ?? "";
  // 入院中は今日まで(退院前に下書きを用意する運用のため)。
  const end = encounter.period?.end?.slice(0, 10) ?? today();
  return { start, end };
}

/** 病名が入院期間にかかっているか(発症が退院前で、転帰が入院後か未転帰)。 */
function conditionOverlaps(condition: fhir4.Condition, start: string, end: string): boolean {
  const onset = condition.onsetDateTime?.slice(0, 10) ?? "";
  const abatement = condition.abatementDateTime?.slice(0, 10) ?? "";
  if (onset && end && onset > end) return false;
  if (abatement && start && abatement < start) return false;
  return true;
}

function orderKindCode(sr: fhir4.ServiceRequest): string {
  return (
    (sr.category ?? [])
      .flatMap((c) => c.coding ?? [])
      .find((c) => c.system === "http://fhir-client.local/CodeSystem/order-type")?.code ?? ""
  );
}

const PROCEDURE_KINDS = new Set(["surgery", "treatment", "endoscopy", "radiotherapy"]);
const EXAM_KIND_LABELS: Record<string, string> = {
  rad: "放射線検査",
  physio: "生理検査",
  pathology: "病理検査",
  endoscopy: "内視鏡",
};

function orderDisplayName(
  header: fhir4.ServiceRequest,
  itemsByHeader: Map<string, fhir4.ServiceRequest[]>,
): string {
  // 放射線治療は code が固定(治療処方)なので、部位と線量分割で名前を作る。
  if (isRadiotherapyServiceRequest(header)) {
    const summary = summarizeRadiotherapyOrder(header);
    return ["放射線治療", summary.siteLabel, summary.doseLabel].filter(Boolean).join(" ");
  }
  const own = header.code?.text ?? header.code?.coding?.[0]?.display ?? "";
  const names = (itemsByHeader.get(header.id ?? "") ?? [])
    .map((item) => item.code?.text ?? item.code?.coding?.[0]?.display ?? "")
    .filter(Boolean);
  return own || [...new Set(names)].join("、");
}

function performedDateByOrder(procedures: fhir4.Procedure[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const procedure of procedures) {
    if (
      procedure.status === "entered-in-error" ||
      procedure.status === "not-done" ||
      procedure.status === "preparation"
    ) {
      continue;
    }
    if (procedure.partOf?.length) continue;
    const orderId = procedure.basedOn?.[0]?.reference?.split("/")[1] ?? "";
    const at = (procedure.performedDateTime ?? procedure.performedPeriod?.start ?? "").slice(0, 10);
    if (!orderId) continue;
    const existing = map.get(orderId);
    if (!existing || (at && at < existing)) map.set(orderId, at);
  }
  return map;
}

function medicationDisplay(mr: fhir4.MedicationRequest): string {
  const concept = mr.medicationCodeableConcept;
  const name = concept?.coding?.find((c) => c.display)?.display ?? concept?.text ?? "";
  const dosage = mr.dosageInstruction?.[0];
  const dose = dosage?.doseAndRate?.[0]?.doseQuantity;
  const usage = dosage?.timing?.code?.coding?.find((c) => c.display)?.display ?? "";
  const days = mr.dispenseRequest?.expectedSupplyDuration?.value;
  return [
    name,
    dose?.value != null ? `${dose.value}${dose.unit ?? ""}` : "",
    usage,
    days != null ? `${days}日分` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * 入院期間のデータから下書きを組み立てる。既存の値(existing)を渡すと、本文と
 * 選択済みの参照は残し、候補だけを集め直す(「下書きを集め直す」ボタン)。
 */
export function draftDischargeSummaryForm(
  sources: DischargeSummarySources,
  existing?: DischargeSummaryFormValues,
): DischargeSummaryFormValues {
  const { encounter } = sources;
  const { start, end } = stayRange(encounter);
  const base = existing ?? emptyDischargeSummaryForm(encounter.id ?? "");

  // 退院時診断: プロブレムのうち入院期間にかかるものを選択済みで、他は候補に。
  const diagnoses = splitConditions(sources.conditions).problems.map((condition) => ({
    reference: `Condition/${condition.id}`,
    display: problemLabel(condition),
    selected: isActiveCondition(condition) || conditionOverlaps(condition, start, end),
  }));

  // 手術・処置: 実施済のものを選択済みに。検査は本文(主な検査所見)の下書きへ。
  const itemsByHeader = new Map<string, fhir4.ServiceRequest[]>();
  for (const item of sources.orders.items) {
    const headerId = item.basedOn?.[0]?.reference?.split("/")[1] ?? "";
    if (!headerId) continue;
    const list = itemsByHeader.get(headerId);
    if (list) list.push(item);
    else itemsByHeader.set(headerId, [item]);
  }
  const performedAt = performedDateByOrder(sources.orders.procedures);
  const headers = [...sources.orders.headers].sort((a, b) => orderDay(a).localeCompare(orderDay(b)));
  const procedures: SummaryEntryCandidate[] = [];
  const examLines: string[] = [];
  const surgeryLines: string[] = [];
  for (const header of headers) {
    const kind = orderKindCode(header);
    const performed = performedAt.get(header.id ?? "");
    const day = performed ?? orderDay(header);
    const name = orderDisplayName(header, itemsByHeader);
    if (!name) continue;
    if (PROCEDURE_KINDS.has(kind)) {
      procedures.push({
        reference: `ServiceRequest/${header.id}`,
        display: `${mdLabel(day)} ${name}`,
        selected: Boolean(performed),
      });
      if (kind === "surgery" && performed) surgeryLines.push(`${mdLabel(day)} 手術: ${name}`);
    }
    if (kind in EXAM_KIND_LABELS && performed) {
      examLines.push(`${mdLabel(day)} ${EXAM_KIND_LABELS[kind]}: ${name}`);
    }
  }

  const medications = sources.dischargeMedications.map((mr) => ({
    reference: `MedicationRequest/${mr.id}`,
    display: medicationDisplay(mr),
    selected: true,
  }));

  const allergies = sources.allergies
    .filter((a) => a.clinicalStatus?.coding?.[0]?.code !== "inactive" && a.clinicalStatus?.coding?.[0]?.code !== "resolved")
    .filter((a) => a.verificationStatus?.coding?.[0]?.code !== "refuted")
    .map((a) => {
      const summary = summarizeAllergy(a);
      return {
        reference: `AllergyIntolerance/${a.id}`,
        display: [summary.name, summary.reaction].filter(Boolean).join(" "),
        selected: true,
      };
    });

  // 入院経過: イベント(入院・転棟・外泊・退院)と手術を日付順の箇条書きに。
  const courseLines = [
    ...sources.events.map((e) => `${mdLabel(e.date)} ${e.label}${e.detail ? ` ${e.detail}` : ""}`),
    ...surgeryLines,
  ].sort();

  const entries = {
    [DIAGNOSIS_SECTION]: mergeCandidates(base.entries[DIAGNOSIS_SECTION], diagnoses, Boolean(existing)),
    [PROCEDURE_SECTION]: mergeCandidates(base.entries[PROCEDURE_SECTION], procedures, Boolean(existing)),
    [MEDICATION_SECTION]: mergeCandidates(base.entries[MEDICATION_SECTION], medications, Boolean(existing)),
    [ALLERGY_SECTION]: mergeCandidates(base.entries[ALLERGY_SECTION], allergies, Boolean(existing)),
  };

  const drafts: Record<string, string> = {
    [COURSE_SECTION]: linesToHtml(courseLines),
    [TESTS_SECTION]: linesToHtml(examLines),
  };
  const sections = base.sections.map((section) =>
    // 既に本文があれば触らない。空のセクションにだけ下書きを入れる。
    isEmptyNoteHtml(section.html) && !section.template && drafts[section.code]
      ? { ...section, html: drafts[section.code] }
      : section,
  );

  return {
    ...base,
    encounterId: encounter.id ?? base.encounterId,
    disposition: existing?.disposition || encounterDischargeDisposition(encounter),
    entries,
    sections,
  };
}

/**
 * 既存の候補(保存済みの選択を含む)と集め直した候補を合わせる。既存にあるものは
 * 選択状態を保ち、新しい候補は集め直しの結果の選択状態で足す。既存に無くなった
 * 参照(削除された病名など)は、選択されていれば残す。
 */
function mergeCandidates(
  current: SummaryEntryCandidate[],
  fresh: SummaryEntryCandidate[],
  keepSelection: boolean,
): SummaryEntryCandidate[] {
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

// ---- build / parse / validate ----

export function validateDischargeSummary(
  values: DischargeSummaryFormValues,
  practitionerId: string | null | undefined,
): string | null {
  if (!values.encounterId) return "対象の入院を選択してください。";
  if (!values.date) return "記録日時を入力してください。";
  const hasEntry = ENTRY_SECTION_CODES.some((code) => values.entries[code].some((c) => c.selected));
  const hasText = values.sections.some((s) => !isEmptyNoteHtml(s.html));
  if (!hasEntry && !hasText) return "本文が空です。いずれかのセクションを入力してください。";
  if (practitionerId === null)
    return "ログイン中のアカウントに医療従事者が紐付いていないため、退院時サマリーを作成できません。";
  return null;
}

export interface DischargeSummaryBuildOptions {
  patientId: string;
  practitioner?: fhir4.Practitioner | null;
  existing?: fhir4.Composition;
  /** 対象の入院。転帰を書き換えたときは同じ transaction で PUT する。 */
  encounter: fhir4.Encounter;
  department?: { departmentId: string; departmentName: string };
}

export function buildDischargeSummary(
  values: DischargeSummaryFormValues,
  options: DischargeSummaryBuildOptions,
): ClinicalNoteSave {
  const { patientId, practitioner, existing, encounter, department } = options;
  const entries: fhir4.BundleEntry[] = [];
  const keptResponseIds = new Set<string>();

  const status: fhir4.Composition["status"] =
    existing && existing.status !== "preliminary" ? "amended" : values.status;

  const author: fhir4.Reference[] = existing
    ? existing.author
    : [
        {
          reference: `Practitioner/${practitioner?.id}`,
          display: practitioner ? practitionerDisplayName(practitioner) : undefined,
        },
      ];

  const bodyByCode = new Map(
    buildBodySections(values.sections, SUMMARY_TEXT_SECTIONS, entries, keptResponseIds).map(
      (section) => [sectionCodeOf(section), section] as const,
    ),
  );

  const sections: fhir4.CompositionSection[] = [];
  for (const def of SUMMARY_SECTIONS) {
    if (def.kind === "text") {
      const body = bodyByCode.get(def.code);
      if (body) sections.push(body);
      continue;
    }
    const selected = values.entries[def.code as EntrySectionCode].filter((c) => c.selected);
    sections.push({
      title: def.title,
      code: { coding: [{ system: LOINC_SYSTEM, code: def.code, display: def.display }] },
      // entry から導出した narrative なので generated。選択が無ければ「なし」と残す
      // (書き忘れではなく、確認したうえで無かったことが読めるように)。
      text: {
        status: "generated",
        div: plainTextXhtml(selected.length ? selected.map((c) => c.display).join("\n") : "なし"),
      },
      ...(selected.length
        ? { entry: selected.map((c) => ({ reference: c.reference, display: c.display })) }
        : {}),
    });
  }

  const composition: fhir4.Composition = {
    resourceType: "Composition",
    status,
    type: DISCHARGE_SUMMARY_TYPE,
    attester: buildAttester(status, practitioner, existing),
    subject: { reference: `Patient/${patientId}` },
    encounter: { reference: `Encounter/${values.encounterId}` },
    date: toFhirDateTime(values.date),
    author,
    title: DISCHARGE_SUMMARY_TYPE.text ?? "退院時サマリー",
    section: sections,
  };

  const noteDepartment = department?.departmentId ? department : departmentOf(existing ?? {});
  if (noteDepartment.departmentId) {
    composition.extension = [
      departmentExtension(noteDepartment.departmentId, noteDepartment.departmentName),
    ];
  }
  if (existing?.id) composition.id = existing.id;

  for (const id of referencedResponseIds(existing)) {
    if (!keptResponseIds.has(id)) {
      entries.push({ request: { method: "DELETE", url: `QuestionnaireResponse/${id}` } });
    }
  }

  // 転帰は入院(Encounter)側に書く。変わったときだけ同じ transaction で PUT する。
  if (encounter.id && values.disposition !== encounterDischargeDisposition(encounter)) {
    entries.push({
      resource: withDischargeDisposition(encounter, values.disposition),
      request: { method: "PUT", url: `Encounter/${encounter.id}` },
    });
  }

  return { composition, entries };
}

/** 保存済みのサマリーから編集フォームの初期値を作る。候補は選択済みの参照だけになる。 */
export function parseDischargeSummaryForm(
  composition: fhir4.Composition,
  encounter: fhir4.Encounter | undefined,
): DischargeSummaryFormValues {
  const entries = emptyEntries();
  const sections: ClinicalNoteSectionDraft[] = [];
  const textByCode = new Map<string, ClinicalNoteSectionDraft>();
  for (const section of composition.section ?? []) {
    const code = sectionCodeOf(section);
    const def = SUMMARY_SECTIONS.find((s) => s.code === code);
    if (!def) continue;
    if (def.kind === "entry") {
      entries[code as EntrySectionCode] = (section.entry ?? []).flatMap((entry) =>
        entry.reference ? [{ reference: entry.reference, display: entry.display ?? "", selected: true }] : [],
      );
    } else {
      textByCode.set(code, sectionDraftOf(section, code));
    }
  }
  for (const def of SUMMARY_TEXT_SECTIONS) {
    sections.push(textByCode.get(def.code) ?? newSectionDraft(def.code));
  }
  return {
    encounterId: composition.encounter?.reference?.split("/").pop() ?? "",
    status: composition.status === "preliminary" ? "preliminary" : "final",
    date: toDateTimeInput(composition.date),
    disposition: encounter ? encounterDischargeDisposition(encounter) : "",
    entries,
    sections,
  };
}

export function dischargeSummaryEncounterId(composition: fhir4.Composition | undefined): string {
  return composition?.encounter?.reference?.split("/").pop() ?? "";
}
