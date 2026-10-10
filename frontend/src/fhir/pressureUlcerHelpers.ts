import { addDays, localDay } from "../lib/dates";
import { containedPractitionerName } from "./questionnaireResponseHelpers";
import { referenceId } from "./shared";

// 褥瘡の DESIGN-R 評価と発生率(docs/care-team-design.md §6)。評価は同梱テンプレート PU_DESIGNR_01
// (docs/report-mappings/pressure-ulcer-designr-01.questionnaire.json)の回答で、**1 創 1 回答**。
// 評価のたびに新しい回答を書くので、創の今の状態は「患者 × 部位の最新の回答」。
// 項目の linkId はテンプレートの約束で、施設が複製して直すときも linkId は変えない。

/** 施設設定 pressure_ulcer(backend の DEFAULT_PRESSURE_ULCER と同じ形)。 */
export interface PressureUlcerSettings {
  /** DESIGN-R 評価のテンプレートの url(版を問わない)。 */
  template: string;
}

export const DEFAULT_PRESSURE_ULCER: PressureUlcerSettings = {
  template: "http://fhir-client.local/Questionnaire/pressure-ulcer-designr-01",
};

export const PU_SITE_OPTIONS = [
  { code: "sacrum", label: "仙骨部" },
  { code: "coccyx", label: "尾骨部" },
  { code: "ischium", label: "坐骨部" },
  { code: "trochanter", label: "大転子部" },
  { code: "heel", label: "踵部" },
  { code: "other", label: "その他" },
] as const;

export const DESIGNR_LINK_IDS = {
  depth: "designr_d",
  exudate: "designr_e",
  size: "designr_s",
  inflammation: "designr_i",
  granulation: "designr_g",
  necrotic: "designr_n",
  pocket: "designr_p",
  total: "designr_total",
  severity: "designr_severity",
} as const;

/** 1 回の評価(回答 1 件)を読んだもの。 */
export interface PressureUlcerEvaluation {
  responseId: string;
  patientId: string;
  /** 記入日(日付)。 */
  authored: string;
  authorName: string;
  siteCode: string;
  siteLabel: string;
  onsetKind: "brought" | "acquired" | "";
  onsetDate: string;
  state: "open" | "healed" | "";
  healedDate: string;
  depth: string;
  total: number | null;
  severity: string;
}

function answerOf(items: fhir4.QuestionnaireResponseItem[] | undefined, linkId: string): fhir4.QuestionnaireResponseItemAnswer | undefined {
  for (const item of items ?? []) {
    if (item.linkId === linkId) return item.answer?.[0];
    const nested = answerOf(item.item, linkId) ?? answerOf(item.answer?.flatMap((a) => a.item ?? []), linkId);
    if (nested) return nested;
  }
  return undefined;
}

function codeOf(items: fhir4.QuestionnaireResponseItem[] | undefined, linkId: string): string {
  return answerOf(items, linkId)?.valueCoding?.code ?? "";
}

function stringOf(items: fhir4.QuestionnaireResponseItem[] | undefined, linkId: string): string {
  const answer = answerOf(items, linkId);
  return answer?.valueString ?? answer?.valueDate ?? "";
}

export function parsePressureUlcerResponse(response: fhir4.QuestionnaireResponse): PressureUlcerEvaluation {
  const items = response.item;
  const siteCode = codeOf(items, "pu_site");
  const siteLabel =
    siteCode === "other"
      ? stringOf(items, "pu_site_other") || "その他"
      : (PU_SITE_OPTIONS.find((o) => o.code === siteCode)?.label ?? siteCode);
  const onsetKind = codeOf(items, "pu_onset_kind");
  const state = codeOf(items, "pu_state");
  const total = answerOf(items, DESIGNR_LINK_IDS.total)?.valueInteger;
  return {
    responseId: response.id ?? "",
    patientId: referenceId(response.subject?.reference) ?? "",
    authored: localDay(response.authored),
    authorName: containedPractitionerName(response) || response.author?.display || "",
    siteCode,
    siteLabel,
    onsetKind: onsetKind === "brought" || onsetKind === "acquired" ? onsetKind : "",
    onsetDate: stringOf(items, "pu_onset_date"),
    state: state === "healed" ? "healed" : state === "open" ? "open" : "",
    healedDate: stringOf(items, "pu_healed_date"),
    depth: codeOf(items, DESIGNR_LINK_IDS.depth),
    total: typeof total === "number" ? total : null,
    severity: stringOf(items, DESIGNR_LINK_IDS.severity),
  };
}

/** d2 以上(真皮までの損傷より深い)か。DTI 疑い・判定不能は含めない。 */
export function isDepthD2OrDeeper(depth: string): boolean {
  return ["d2", "D3", "D4", "D5"].includes(depth);
}

/** 創のキー(患者 × 部位。その他は名称まで)。 */
export function woundKeyOf(evaluation: PressureUlcerEvaluation): string {
  return `${evaluation.patientId}:${evaluation.siteCode}:${evaluation.siteCode === "other" ? evaluation.siteLabel : ""}`;
}

/** 創ごとの最新の評価(記入日の新しいもの)。 */
export function latestEvaluationsByWound(responses: fhir4.QuestionnaireResponse[]): Map<string, PressureUlcerEvaluation> {
  const byWound = new Map<string, PressureUlcerEvaluation>();
  for (const response of responses) {
    const evaluation = parsePressureUlcerResponse(response);
    if (!evaluation.patientId) continue;
    const key = woundKeyOf(evaluation);
    const current = byWound.get(key);
    if (!current || current.authored < evaluation.authored) byWound.set(key, evaluation);
  }
  return byWound;
}

/** 創ごとの最初の評価(発生の把握に使う)。 */
export function firstEvaluationsByWound(responses: fhir4.QuestionnaireResponse[]): Map<string, PressureUlcerEvaluation> {
  const byWound = new Map<string, PressureUlcerEvaluation>();
  for (const response of responses) {
    const evaluation = parsePressureUlcerResponse(response);
    if (!evaluation.patientId) continue;
    const key = woundKeyOf(evaluation);
    const current = byWound.get(key);
    if (!current || current.authored > evaluation.authored) byWound.set(key, evaluation);
  }
  return byWound;
}

/** その日に保有していた創か(発生日〜治癒日の前日。日付が無ければ最初の評価日〜最新の評価の状態で判断)。 */
export function woundOpenOn(first: PressureUlcerEvaluation, latest: PressureUlcerEvaluation, day: string): boolean {
  const start = first.onsetDate || first.authored;
  if (!start || day < start) return false;
  if (latest.state === "healed") {
    const end = latest.healedDate || latest.authored;
    return day < end;
  }
  return true;
}

export interface PressureUlcerMonthStats {
  /** 在院患者数(実人数)。 */
  patients: number;
  /** 月の初めから持ち込んで(または入院時に保有して)いた患者。 */
  brought: number;
  /** 院内で新たに発生した患者(発生日がその月)。 */
  acquired: number;
  /** うち d2 以上。 */
  acquiredD2: number;
  /** 月末(今日より先なら今日)に保有していた患者。 */
  prevalent: number;
  /** 月末の在院患者数。 */
  prevalentBase: number;
}

/**
 * 月の発生率の材料。日本褥瘡学会の定義に合わせる:
 *   褥瘡発生率 = 期間中に院内で新たに褥瘡が発生した患者数 ÷ 期間中の在院患者数(実人数)× 100
 *   褥瘡有病率 = 調査日(月末)に褥瘡を保有する患者数 ÷ 調査日の在院患者数 × 100
 * 発生日はテンプレートの「発生日」(無ければ最初の評価日)。持込は発生区分で分ける。
 */
export function pressureUlcerMonthStats(args: {
  /** 日 → その日に病棟に居た患者 id。 */
  presence: Map<string, Set<string>>;
  responses: fhir4.QuestionnaireResponse[];
  from: string;
  to: string;
  today: string;
}): PressureUlcerMonthStats {
  const { presence, responses, from, to, today } = args;
  const lastDay = to < today ? to : today;
  const allPatients = new Set<string>();
  for (const set of presence.values()) for (const id of set) allPatients.add(id);
  const first = firstEvaluationsByWound(responses);
  const latest = latestEvaluationsByWound(responses);
  const acquired = new Set<string>();
  const acquiredD2 = new Set<string>();
  const brought = new Set<string>();
  const prevalent = new Set<string>();
  for (const [key, firstEvaluation] of first) {
    const latestEvaluation = latest.get(key) ?? firstEvaluation;
    if (!allPatients.has(firstEvaluation.patientId)) continue;
    const onset = firstEvaluation.onsetDate || firstEvaluation.authored;
    if (firstEvaluation.onsetKind === "acquired" && onset >= from && onset <= lastDay) {
      acquired.add(firstEvaluation.patientId);
      if (isDepthD2OrDeeper(latestEvaluation.depth) || isDepthD2OrDeeper(firstEvaluation.depth)) acquiredD2.add(firstEvaluation.patientId);
    }
    if (firstEvaluation.onsetKind === "brought" && woundOpenOn(firstEvaluation, latestEvaluation, from)) brought.add(firstEvaluation.patientId);
    if (presence.get(lastDay)?.has(firstEvaluation.patientId) && woundOpenOn(firstEvaluation, latestEvaluation, lastDay)) {
      prevalent.add(firstEvaluation.patientId);
    }
  }
  return {
    patients: allPatients.size,
    brought: brought.size,
    acquired: acquired.size,
    acquiredD2: acquiredD2.size,
    prevalent: prevalent.size,
    prevalentBase: presence.get(lastDay)?.size ?? 0,
  };
}

/** 最終評価から日数が経った創(保有患者の一覧で強調)。 */
export function evaluationOverdue(evaluation: PressureUlcerEvaluation, today: string, days = 7): boolean {
  return Boolean(evaluation.authored) && addDays(evaluation.authored, days) <= today;
}
