import type { DpcBranch, DpcCodingRow } from "../api/masterClient";
import { nowFhirDateTime } from "../lib/dates";
import {
  DEFAULT_INSTITUTION_NUMBER,
  JASPEHR_QUESTIONNAIRE_RESPONSE_PROFILE_URL,
} from "./questionnaireResponseHelpers";

// 診断群分類(14 桁)の決定の記録。入院 1 件に何件でも残す追記型の QuestionnaireResponse で、
// 有効(completed)のうち最新が今の分類、全件が DPC 歴になる。取消は entered-in-error。
// 様式1 と同じく encounter で入院を指すので、カルテの時系列には出ない(encounter:missing=true)。
// 上流の検証(JASPEHR の QuestionnaireResponse)に合わせ、報告単位 ID と、決定者を contained の
// Practitioner で持つのも様式1 と同じ。

export const DPC_CODING_QUESTIONNAIRE = "http://fhir-client.local/Questionnaire/dpc-coding";
export const DPC_CODE_SYSTEM = "http://fhir-client.local/CodeSystem/dpc-code";
const DPC_TIMING_SYSTEM = "http://fhir-client.local/CodeSystem/dpc-coding-timing";

export const DPC_TIMINGS = [
  { code: "admission", label: "入院時" },
  { code: "transfer", label: "転棟時" },
  { code: "monthly", label: "月末" },
  { code: "discharge", label: "退院時" },
  { code: "other", label: "その他" },
] as const;
export type DpcTiming = (typeof DPC_TIMINGS)[number]["code"];

export interface DpcCodingDecision {
  id: string;
  status: fhir4.QuestionnaireResponse["status"];
  authored: string;
  authorName: string;
  dpcCode: string;
  name: string;
  edition: string;
  timing: DpcTiming | "";
  icd10: string;
  bundled: boolean;
  days: (number | null)[];
  points: (number | null)[];
  note: string;
  response: fhir4.QuestionnaireResponse;
}

const STATUS_LABELS: Record<DpcBranch["status"], string> = {
  auto: "自動",
  override: "上書き",
  undetermined: "未確定",
  not_applicable: "対象外",
};

function answer(linkId: string, value: fhir4.QuestionnaireResponseItemAnswer): fhir4.QuestionnaireResponseItem {
  return { linkId, answer: [value] };
}

/** 14 桁の名称(傷病名と、手術・処置等のうち「なし」でないもの)。 */
export function dpcCodeName(row: DpcCodingRow | null | undefined): string {
  if (!row) return "";
  const { disease, surgery, proc1, proc2, comorbidity, severity } = row.names;
  return [disease, surgery, proc1, proc2, comorbidity, severity]
    .filter((name): name is string => Boolean(name) && name !== "なし")
    .join(" / ");
}

const CONTAINED_PRACTITIONER_ID = "practitioner";

export function buildDpcCodingResponse({
  patient,
  institutionNumber,
  encounterId,
  author,
  row,
  edition,
  timing,
  icd10,
  branches,
  note,
}: {
  patient: fhir4.Patient;
  /** 自院の保険医療機関番号(10 桁)。報告単位 ID の先頭に入れる。 */
  institutionNumber: string;
  encounterId: string;
  author: { id?: string; name: string };
  row: DpcCodingRow;
  edition: string;
  timing: DpcTiming;
  icd10: string;
  branches: DpcBranch[];
  note: string;
}): fhir4.QuestionnaireResponse {
  const ints = (linkId: string, values: (number | null)[]): fhir4.QuestionnaireResponseItem => ({
    linkId,
    answer: values.map((v) => (v === null ? { valueString: "-" } : { valueInteger: v })),
  });
  const items: fhir4.QuestionnaireResponseItem[] = [
    answer("dpc-code", { valueCoding: { system: DPC_CODE_SYSTEM, code: row.dpc_code, display: dpcCodeName(row) } }),
    answer("edition", { valueString: edition }),
    answer("timing", {
      valueCoding: {
        system: DPC_TIMING_SYSTEM,
        code: timing,
        display: DPC_TIMINGS.find((t) => t.code === timing)?.label,
      },
    }),
    answer("bundled", { valueBoolean: row.bundled }),
    ints("days", row.days),
    ints("points", row.points),
  ];
  if (icd10) items.push(answer("icd10", { valueString: icd10 }));
  for (const branch of branches.filter((b) => b.status !== "not_applicable")) {
    const evidence = branch.evidence.map((e) =>
      [e.date, e.code, e.name, e.note].filter(Boolean).join(" "),
    );
    items.push({
      linkId: "branch",
      item: [
        answer("branch.key", { valueString: branch.key }),
        answer("branch.label", { valueString: branch.label }),
        ...(branch.value ? [answer("branch.value", { valueString: branch.value })] : []),
        answer("branch.status", { valueString: STATUS_LABELS[branch.status] }),
        ...(evidence.length
          ? [{ linkId: "branch.evidence", answer: evidence.map((text) => ({ valueString: text })) }]
          : []),
      ],
    });
  }
  if (note.trim()) items.push(answer("note", { valueString: note.trim() }));

  const patientKey = patient.identifier?.[0]?.value ?? patient.id ?? "";
  const practitioner: fhir4.Practitioner = {
    resourceType: "Practitioner",
    id: CONTAINED_PRACTITIONER_ID,
    ...(author.id
      ? { identifier: [{ system: "http://fhir-client.local/Practitioner", value: author.id }] }
      : {}),
    name: [{ text: author.name }],
  };
  return {
    resourceType: "QuestionnaireResponse",
    meta: { profile: [JASPEHR_QUESTIONNAIRE_RESPONSE_PROFILE_URL] },
    contained: [practitioner],
    identifier: {
      value: `${institutionNumber || DEFAULT_INSTITUTION_NUMBER}^${patientKey}^${crypto.randomUUID()}`,
    },
    questionnaire: DPC_CODING_QUESTIONNAIRE,
    status: "completed",
    subject: { reference: `Patient/${patient.id}` },
    encounter: { reference: `Encounter/${encounterId}` },
    authored: nowFhirDateTime(),
    author: { reference: `#${CONTAINED_PRACTITIONER_ID}`, display: author.name },
    item: items,
  };
}

function first(response: fhir4.QuestionnaireResponse, linkId: string) {
  return response.item?.find((i) => i.linkId === linkId)?.answer?.[0];
}

function numbers(response: fhir4.QuestionnaireResponse, linkId: string): (number | null)[] {
  const answers = response.item?.find((i) => i.linkId === linkId)?.answer ?? [];
  return answers.map((a) => a.valueInteger ?? null);
}

export function parseDpcCodingResponse(response: fhir4.QuestionnaireResponse): DpcCodingDecision {
  const code = first(response, "dpc-code")?.valueCoding;
  const timing = first(response, "timing")?.valueCoding?.code ?? "";
  return {
    id: response.id ?? "",
    status: response.status,
    authored: response.authored ?? "",
    authorName:
      response.author?.display ??
      response.contained
        ?.filter((r): r is fhir4.Practitioner => r.resourceType === "Practitioner")
        .flatMap((p) => p.name?.map((n) => n.text ?? "") ?? [])[0] ??
      "",
    dpcCode: code?.code ?? "",
    name: code?.display ?? "",
    edition: first(response, "edition")?.valueString ?? "",
    timing: DPC_TIMINGS.some((t) => t.code === timing) ? (timing as DpcTiming) : "",
    icd10: first(response, "icd10")?.valueString ?? "",
    bundled: first(response, "bundled")?.valueBoolean ?? false,
    days: numbers(response, "days"),
    points: numbers(response, "points"),
    note: first(response, "note")?.valueString ?? "",
    response,
  };
}

/** 新しい順に並べ、有効なもののうち最新を今の分類とする。 */
export function sortDpcDecisions(decisions: DpcCodingDecision[]): DpcCodingDecision[] {
  return [...decisions].sort((a, b) => b.authored.localeCompare(a.authored));
}

export function currentDpcDecision(decisions: DpcCodingDecision[]): DpcCodingDecision | undefined {
  return sortDpcDecisions(decisions).find((d) => d.status === "completed");
}

export function dpcTimingLabel(timing: DpcTiming | ""): string {
  return DPC_TIMINGS.find((t) => t.code === timing)?.label ?? "";
}
