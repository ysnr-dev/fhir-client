import { addDays, diffDays } from "../lib/dates";
import { encounterAdmissionRoute } from "./admissionRouteHelpers";
import { isInjectionProcedure } from "./injectionPerformHelpers";
import { wardExtension, wardOf } from "./orderHeader";
import { isRadiotherapyFraction } from "./radiotherapyResultHelpers";
import { isSurgeryProcedure } from "./surgeryResultHelpers";
import { isTransfusionProcedure } from "./transfusionResultHelpers";
import { referenceId } from "./shared";

// 重症度、医療・看護必要度(docs/nursing-acuity-design.md)。
//
// 患者 × 日の評価を Observation 1 件に持つ(code = 評価票の版、component = 項目ごとの値)。
// 評価票の項目・配点は版ごとに下の NURSING_ACUITY_FORMS に持ち、改定で変われば版を足す
// (過去の評価は書いた版の定義で読む)。該当患者の基準(割合1・割合2)は施設設定。
//
// 点数の数え方(評価票 別紙7):
// - A: 「あり」の項目の点数の合計。6 専門的な治療・処置は、該当した小項目の点数のうち最も高いもの
// - B: 患者の状態の点数 ×(介助の実施 = 1 / なし = 0)。寝返り・指示が通じる・危険行動は状態の点数のみ
// - C: 「あり」の項目の点数の合計

export const NURSING_ACUITY_SYSTEM = "http://fhir-client.local/CodeSystem/nursing-acuity";
export const NURSING_ACUITY_ITEM_SYSTEM = "http://fhir-client.local/CodeSystem/nursing-acuity-item";
const OBSERVATION_CATEGORY_SYSTEM = "http://terminology.hl7.org/CodeSystem/observation-category";
const DATA_ABSENT_SYSTEM = "http://terminology.hl7.org/CodeSystem/data-absent-reason";

export type AcuityGroup = "A" | "B" | "C";

/** 「あり」で点数が付く項目(A・C)。 */
export interface AcuityCheckItem {
  kind: "check";
  code: string;
  group: "A" | "C";
  number: number;
  label: string;
  points: number;
}

/** 小項目のどれかに該当すれば点数が付く項目(A 6 専門的な治療・処置)。 */
export interface AcuityChoiceItem {
  kind: "choice";
  code: string;
  group: "A";
  number: number;
  label: string;
  options: { code: string; label: string; points: number }[];
}

/** 患者の状態(と介助の実施)で点数が付く項目(B)。 */
export interface AcuityStateItem {
  kind: "state";
  code: string;
  group: "B";
  number: number;
  label: string;
  /** 状態の選択肢。points が点数。 */
  states: { label: string; points: number }[];
  /** 介助の実施を掛けるか。 */
  assist: boolean;
}

export type AcuityItem = AcuityCheckItem | AcuityChoiceItem | AcuityStateItem;

export interface AcuityForm {
  code: string;
  label: string;
  items: AcuityItem[];
}

const check = (group: "A" | "C", number: number, label: string, points: number): AcuityCheckItem => ({
  kind: "check",
  code: `${group}${number}`,
  group,
  number,
  label,
  points,
});

const state = (
  number: number,
  label: string,
  states: [string, number][],
  assist: boolean,
): AcuityStateItem => ({
  kind: "state",
  code: `B${number}`,
  group: "B",
  number,
  label,
  states: states.map(([l, points]) => ({ label: l, points })),
  assist,
});

/**
 * 評価票の版。general-2026 は令和8年度改定の「一般病棟用の重症度、医療・看護必要度Ⅰに係る評価票」
 * (基本診療料の施設基準等の通知 別紙7)。項目名の括弧内の日数は評価の対象になる日数。
 */
export const NURSING_ACUITY_FORMS: AcuityForm[] = [
  {
    code: "general-2026",
    label: "一般病棟用 重症度、医療・看護必要度Ⅰ(令和8年度)",
    items: [
      check("A", 1, "創傷処置(褥瘡の処置を除く)", 1),
      check("A", 2, "呼吸ケア(喀痰吸引のみの場合を除く)", 1),
      check("A", 3, "注射薬剤3種類以上の管理(最大7日間)", 1),
      check("A", 4, "シリンジポンプの管理", 1),
      check("A", 5, "輸血や血液製剤の管理", 2),
      {
        kind: "choice",
        code: "A6",
        group: "A",
        number: 6,
        label: "専門的な治療・処置",
        options: [
          { code: "A6-1", label: "抗悪性腫瘍剤の使用(注射剤のみ)", points: 3 },
          { code: "A6-2", label: "抗悪性腫瘍剤の内服の管理", points: 2 },
          { code: "A6-3", label: "麻薬の使用(注射剤のみ)", points: 3 },
          { code: "A6-4", label: "麻薬の内服、貼付、坐剤の管理", points: 2 },
          { code: "A6-5", label: "放射線治療", points: 2 },
          { code: "A6-6", label: "免疫抑制剤の管理(注射剤のみ)", points: 2 },
          { code: "A6-7", label: "昇圧剤の使用(注射剤のみ)", points: 3 },
          { code: "A6-8", label: "抗不整脈剤の使用(注射剤のみ)", points: 3 },
          { code: "A6-9", label: "抗血栓塞栓薬の持続点滴の使用", points: 3 },
          { code: "A6-10", label: "ドレナージの管理", points: 2 },
          { code: "A6-11", label: "無菌治療室での治療", points: 3 },
        ],
      },
      check("A", 7, "救急搬送後の入院(2日間)", 2),
      state(8, "寝返り", [["できる", 0], ["何かにつかまればできる", 1], ["できない", 2]], false),
      state(9, "移乗", [["自立", 0], ["一部介助", 1], ["全介助", 2]], true),
      state(10, "口腔清潔", [["自立", 0], ["要介助", 1]], true),
      state(11, "食事摂取", [["自立", 0], ["一部介助", 1], ["全介助", 2]], true),
      state(12, "衣服の着脱", [["自立", 0], ["一部介助", 1], ["全介助", 2]], true),
      state(13, "診療・療養上の指示が通じる", [["はい", 0], ["いいえ", 1]], false),
      state(14, "危険行動", [["ない", 0], ["ある", 2]], false),
      check("C", 15, "開頭手術(11日間)", 1),
      check("C", 16, "開胸手術(9日間)", 1),
      check("C", 17, "開腹手術(6日間)", 1),
      check("C", 18, "骨の手術(10日間)", 1),
      check("C", 19, "胸腔鏡・腹腔鏡手術(4日間)", 1),
      check("C", 20, "全身麻酔・脊椎麻酔の手術(5日間)", 1),
      check("C", 21, "救命等に係る内科的治療(4日間)(①経皮的血管内治療 ②経皮的心筋焼灼術等の治療 ③侵襲的な消化器治療)", 1),
      check("C", 22, "別に定める検査(2日間)", 1),
      check("C", 23, "別に定める手術(5日間)", 1),
    ],
  },
];

export function acuityFormOf(code: string | undefined): AcuityForm {
  return NURSING_ACUITY_FORMS.find((form) => form.code === code) ?? NURSING_ACUITY_FORMS[0];
}

// ---- 入力値 ----

/** 1 日分の評価の入力値。checks は「あり」の項目(A・C の項目、A6 の小項目)のコード。 */
export interface AcuityValues {
  checks: string[];
  /** B の項目コード → 状態の選択肢の番号(0 始まり)。 */
  states: Record<string, number>;
  /** B の項目コード → 介助の実施。 */
  assists: Record<string, boolean>;
  /** 評価の対象外(短期滞在手術の患者など)。理由を持つ。 */
  excluded: boolean;
  excludedReason: string;
}

export function emptyAcuityValues(): AcuityValues {
  return { checks: [], states: {}, assists: {}, excluded: false, excludedReason: "" };
}

export interface AcuityScores {
  A: number;
  B: number;
  C: number;
}

export function acuityScores(form: AcuityForm, values: AcuityValues): AcuityScores {
  const scores: AcuityScores = { A: 0, B: 0, C: 0 };
  const checked = new Set(values.checks);
  for (const item of form.items) {
    if (item.kind === "check") {
      if (checked.has(item.code)) scores[item.group] += item.points;
    } else if (item.kind === "choice") {
      const points = item.options.filter((o) => checked.has(o.code)).map((o) => o.points);
      if (points.length > 0) scores.A += Math.max(...points);
    } else {
      const statePoints = item.states[values.states[item.code] ?? 0]?.points ?? 0;
      scores.B += item.assist ? (values.assists[item.code] ? statePoints : 0) : statePoints;
    }
  }
  return scores;
}

// ---- 該当患者の基準 ----

/** 基準の組("A3" "A2+B3" など)。それぞれの得点以上をすべて満たせば該当。 */
export type AcuityTerm = Partial<AcuityScores>;

export function parseAcuityTerm(term: string): AcuityTerm | null {
  const parts = term.split("+");
  const result: AcuityTerm = {};
  for (const part of parts) {
    const match = /^([ABC])(\d{1,2})$/.exec(part.trim());
    if (!match) return null;
    const group = match[1] as AcuityGroup;
    if (result[group] !== undefined) return null;
    result[group] = Number(match[2]);
  }
  return parts.length > 0 ? result : null;
}

/** 基準(組の OR)に該当するか。組が 1 つも無ければ判定しない(null)。 */
export function meetsAcuityCriterion(scores: AcuityScores, terms: string[]): boolean | null {
  const parsed = terms.map(parseAcuityTerm).filter((t): t is AcuityTerm => t !== null);
  if (parsed.length === 0) return null;
  return parsed.some((term) =>
    (Object.entries(term) as [AcuityGroup, number][]).every(([group, min]) => scores[group] >= min),
  );
}

/** 基準の表示("A3点以上 又は C1点以上")。 */
export function acuityCriterionLabel(terms: string[]): string {
  return terms
    .map(parseAcuityTerm)
    .filter((t): t is AcuityTerm => t !== null)
    .map((term) =>
      (Object.entries(term) as [AcuityGroup, number][]).map(([g, min]) => `${g}${min}点以上`).join("かつ"),
    )
    .join(" 又は ");
}

/** 施設設定 nursing_acuity(backend の DEFAULT_NURSING_ACUITY と同じ形)。 */
export interface NursingAcuitySettings {
  form: string;
  ratio1: string[];
  ratio2: string[];
}

export const DEFAULT_NURSING_ACUITY: NursingAcuitySettings = {
  form: "general-2026",
  ratio1: ["A3", "C1"],
  ratio2: ["A2", "C1"],
};

// ---- Observation との変換 ----

function component(code: string, value: Partial<fhir4.ObservationComponent>): fhir4.ObservationComponent {
  return { code: { coding: [{ system: NURSING_ACUITY_ITEM_SYSTEM, code }] }, ...value };
}

/**
 * 1 日分の評価の Observation。対象外は項目を持たず dataAbsentReason(not-applicable)に理由を書く。
 * 合計(A・B・C)も component に持ち、データ抽出などが評価票の定義を知らずに読めるようにする。
 */
export function buildAcuityObservation(args: {
  form: AcuityForm;
  values: AcuityValues;
  patientId: string;
  encounterId: string;
  date: string;
  ward: { wardId: string; wardName: string } | null;
  performer: { id: string; name: string } | null;
  existing?: fhir4.Observation;
}): fhir4.Observation {
  const { form, values, patientId, encounterId, date, ward, performer, existing } = args;
  const observation: fhir4.Observation = {
    resourceType: "Observation",
    ...(existing?.id ? { id: existing.id, meta: existing.meta } : {}),
    status: existing ? "amended" : "final",
    category: [{ coding: [{ system: OBSERVATION_CATEGORY_SYSTEM, code: "survey", display: "Survey" }] }],
    code: { coding: [{ system: NURSING_ACUITY_SYSTEM, code: form.code, display: form.label }], text: "看護必要度" },
    subject: { reference: `Patient/${patientId}` },
    encounter: { reference: `Encounter/${encounterId}` },
    effectiveDateTime: date,
    ...(performer ? { performer: [{ reference: `Practitioner/${performer.id}`, display: performer.name }] } : {}),
    ...(ward?.wardId ? { extension: [wardExtension(ward.wardId, ward.wardName)] } : {}),
  };
  if (values.excluded) {
    observation.dataAbsentReason = {
      coding: [{ system: DATA_ABSENT_SYSTEM, code: "not-applicable", display: "Not Applicable" }],
      text: values.excludedReason.trim() || "対象外",
    };
    return observation;
  }
  const checked = new Set(values.checks);
  const scores = acuityScores(form, values);
  const components: fhir4.ObservationComponent[] = [];
  for (const item of form.items) {
    if (item.kind === "check") {
      components.push(component(item.code, { valueBoolean: checked.has(item.code) }));
    } else if (item.kind === "choice") {
      for (const option of item.options) {
        components.push(component(option.code, { valueBoolean: checked.has(option.code) }));
      }
    } else {
      // 状態は選んだ選択肢の点数で持つ(項目の中で点数は重ならないので、点数から選択肢に戻せる)。
      components.push(component(item.code, { valueInteger: item.states[values.states[item.code] ?? 0]?.points ?? 0 }));
      if (item.assist) {
        components.push(component(`${item.code}-assist`, { valueBoolean: Boolean(values.assists[item.code]) }));
      }
    }
  }
  for (const group of ["A", "B", "C"] as const) {
    components.push(component(group, { valueInteger: scores[group] }));
  }
  observation.component = components;
  return observation;
}

function componentOf(observation: fhir4.Observation, code: string): fhir4.ObservationComponent | undefined {
  return observation.component?.find((c) =>
    c.code.coding?.some((coding) => coding.system === NURSING_ACUITY_ITEM_SYSTEM && coding.code === code),
  );
}

/** Observation から評価票の版と入力値を読む。 */
export function parseAcuityObservation(observation: fhir4.Observation): { form: AcuityForm; values: AcuityValues } {
  const formCode = observation.code.coding?.find((c) => c.system === NURSING_ACUITY_SYSTEM)?.code;
  const form = acuityFormOf(formCode);
  const values = emptyAcuityValues();
  if (observation.dataAbsentReason) {
    values.excluded = true;
    values.excludedReason = observation.dataAbsentReason.text ?? "";
    return { form, values };
  }
  for (const item of form.items) {
    if (item.kind === "check") {
      if (componentOf(observation, item.code)?.valueBoolean) values.checks.push(item.code);
    } else if (item.kind === "choice") {
      for (const option of item.options) {
        if (componentOf(observation, option.code)?.valueBoolean) values.checks.push(option.code);
      }
    } else {
      const points = componentOf(observation, item.code)?.valueInteger ?? 0;
      values.states[item.code] = Math.max(0, item.states.findIndex((s) => s.points === points));
      if (item.assist) values.assists[item.code] = Boolean(componentOf(observation, `${item.code}-assist`)?.valueBoolean);
    }
  }
  return { form, values };
}

export function acuityPatientId(observation: fhir4.Observation): string {
  return referenceId(observation.subject?.reference) ?? "";
}

export function acuityDate(observation: fhir4.Observation): string {
  return observation.effectiveDateTime?.slice(0, 10) ?? "";
}

export function acuityWardId(observation: fhir4.Observation): string {
  return wardOf(observation).wardId;
}

// ---- 記録からの初期値 ----

/** 記録から推した「あり」の項目と、その根拠。 */
export interface AcuitySuggestion {
  code: string;
  reason: string;
}

function performedDay(procedure: fhir4.Procedure): string {
  return (procedure.performedPeriod?.start ?? procedure.performedDateTime ?? "").slice(0, 10);
}

/** 実施した記録か(予定・準備中・実施せず・取消を除く)。 */
function done(procedure: fhir4.Procedure): boolean {
  return procedure.status === "completed" || procedure.status === "in-progress";
}

/**
 * 実施記録から、その日に「あり」と推せる項目。看護師が確かめて直す前提の初期値で、判定そのものではない
 * (A3 の除外薬剤、A6 の対象薬剤、C の術式の区分は評価の手引きと別表で確かめる)。
 *   A3: その日に施用した注射薬が 3 種類以上(薬剤コードで数える)
 *   A5: 輸血の実施記録   A6⑤: 放射線治療の照射記録   A7: 救急車で搬送された入院の入院日と翌日
 * 手術は C の区分を決められないので、日数の目安(術後何日目か)を hints に並べる。
 */
export function acuitySuggestions(args: {
  date: string;
  encounter: fhir4.Encounter | undefined;
  procedures: fhir4.Procedure[];
  administrations: fhir4.MedicationAdministration[];
}): { suggestions: AcuitySuggestion[]; hints: string[] } {
  const { date, encounter, procedures, administrations } = args;
  const suggestions: AcuitySuggestion[] = [];
  const today = procedures.filter((p) => done(p) && performedDay(p) === date);

  const injectionHubIds = new Set(today.filter(isInjectionProcedure).map((p) => p.id));
  const drugs = new Set<string>();
  for (const ma of administrations) {
    if (ma.status === "not-done" || ma.status === "entered-in-error") continue;
    if (!injectionHubIds.has(referenceId(ma.partOf?.[0]?.reference))) continue;
    const coding = ma.medicationCodeableConcept?.coding?.[0];
    const key = coding?.code ?? ma.medicationCodeableConcept?.text;
    if (key) drugs.add(key);
  }
  if (drugs.size >= 3) suggestions.push({ code: "A3", reason: `注射薬 ${drugs.size} 種類を施用` });
  if (today.some(isTransfusionProcedure)) suggestions.push({ code: "A5", reason: "輸血を実施" });
  if (today.some(isRadiotherapyFraction)) suggestions.push({ code: "A6-5", reason: "放射線治療を照射" });

  const admission = encounter?.period?.start?.slice(0, 10);
  if (encounter && admission && encounterAdmissionRoute(encounter).ambulance && date >= admission && date <= addDays(admission, 1)) {
    suggestions.push({ code: "A7", reason: "救急車で搬送された入院" });
  }

  const hints = procedures
    .filter((p) => done(p) && isSurgeryProcedure(p) && performedDay(p) && performedDay(p) <= date)
    .map((p) => {
      const day = performedDay(p);
      const name = p.code?.text ?? p.code?.coding?.[0]?.display ?? "手術";
      const after = diffDays(day, date);
      return `手術 ${day.slice(5).replace("-", "/")} ${name}(${after === 0 ? "当日" : `術後${after}日`})`;
    });
  return { suggestions, hints };
}
