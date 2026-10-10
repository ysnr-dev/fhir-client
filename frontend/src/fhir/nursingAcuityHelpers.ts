import { addDays, diffDays } from "../lib/dates";
import { encounterAdmissionRoute } from "./admissionRouteHelpers";
import { isInjectionProcedure } from "./injectionPerformHelpers";
import { wardExtension, wardOf } from "./orderHeader";
import { isRadiotherapyFraction } from "./radiotherapyResultHelpers";
import { isSurgeryProcedure } from "./surgeryResultHelpers";
import { isTransfusionProcedure } from "./transfusionResultHelpers";
import { categoryCoding, referenceId } from "./shared";
import { rpActiveDays } from "./medicationScheduleHelpers";
import { groupByRp, SETTING_SYSTEM } from "./prescriptionHelpers";

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

// ---- 一括入力のグリッド ----

/**
 * 一括入力のグリッドの列。A・C の項目と A6 の小項目は「あり / なし」を押して切り替える列、
 * B の項目はセレクトの列。number と header は縦書きの見出し(項目の番号と、括弧の補足を省いた短い名前)、
 * title は省かない名前。
 */
export interface AcuityColumn {
  key: string;
  group: AcuityGroup;
  /** 「1」、A6 の小項目は「①」。 */
  number: string;
  header: string;
  /** A6 の小項目の列なら親の項目(見出しで小項目の列をまとめる 1 行に使う)。 */
  parent?: { code: string; number: number; label: string };
  title: string;
  /** check = 「あり」を切り替える(code は項目か小項目のコード)、state = B のセレクト。 */
  kind: "check" | "state";
  code: string;
  points?: number;
  stateItem?: AcuityStateItem;
}

const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫";

function shortLabel(label: string): string {
  return label.replace(/[(（][^)）]*[)）]/g, "").trim();
}

export function acuityColumns(form: AcuityForm): AcuityColumn[] {
  return form.items.flatMap((item): AcuityColumn[] => {
    if (item.kind === "check") {
      return [
        {
          key: item.code,
          group: item.group,
          number: String(item.number),
          header: shortLabel(item.label),
          title: `${item.group}${item.number} ${item.label}(${item.points}点)`,
          kind: "check",
          code: item.code,
          points: item.points,
        },
      ];
    }
    if (item.kind === "choice") {
      return item.options.map((option, index) => ({
        key: option.code,
        group: item.group,
        number: CIRCLED[index],
        header: shortLabel(option.label),
        parent: { code: item.code, number: item.number, label: item.label },
        title: `${item.group}${item.number} ${item.label} ${CIRCLED[index]}${option.label}(${option.points}点)`,
        kind: "check",
        code: option.code,
        points: option.points,
      }));
    }
    return [
      {
        key: item.code,
        group: item.group,
        number: String(item.number),
        header: item.label,
        title: `${item.group}${item.number} ${item.label}`,
        kind: "state",
        code: item.code,
        stateItem: item,
      },
    ];
  });
}

/**
 * B の項目のセレクトの選択肢。介助の実施を掛ける項目は、0 点の状態(自立など)を除いて
 * 「状態・介助あり / なし」に分ける(1 つのセレクトで状態と介助の実施を選べるように)。値は "状態の番号:介助(0/1)"。
 */
export function acuityStateOptions(item: AcuityStateItem): { value: string; label: string }[] {
  return item.states.flatMap((state, index) => {
    if (!item.assist || state.points === 0) return [{ value: `${index}:0`, label: state.label }];
    return [
      { value: `${index}:1`, label: `${state.label}・介助あり` },
      { value: `${index}:0`, label: `${state.label}・介助なし` },
    ];
  });
}

/** B の項目の今の値(acuityStateOptions の値の形)。 */
export function acuityStateValue(item: AcuityStateItem, values: AcuityValues): string {
  const index = values.states[item.code] ?? 0;
  const assist = item.assist && (item.states[index]?.points ?? 0) > 0 && Boolean(values.assists[item.code]);
  return `${index}:${assist ? 1 : 0}`;
}

/** セレクトで選んだ値を入力値に戻す。 */
export function withAcuityState(item: AcuityStateItem, values: AcuityValues, value: string): AcuityValues {
  const [index, assist] = value.split(":").map(Number);
  return {
    ...values,
    states: { ...values.states, [item.code]: index },
    assists: { ...values.assists, [item.code]: assist === 1 },
  };
}

/**
 * 新しく評価するときの初期値。B は前日の評価(対象外なら空)、A は実施記録から推した項目。
 * 1 人ずつのモーダルと一括入力で同じにする。
 */
export function initialAcuityValues(previous: fhir4.Observation | undefined, suggestions: AcuitySuggestion[]): AcuityValues {
  const initial = emptyAcuityValues();
  if (previous) {
    const prev = parseAcuityObservation(previous).values;
    if (!prev.excluded) {
      initial.states = prev.states;
      initial.assists = prev.assists;
    }
  }
  initial.checks = suggestions.map((suggestion) => suggestion.code);
  return initial;
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

function administered(ma: fhir4.MedicationAdministration): boolean {
  return ma.status === "completed" || ma.status === "in-progress";
}

function administeredDay(ma: fhir4.MedicationAdministration): string {
  return (ma.effectivePeriod?.start ?? ma.effectiveDateTime ?? "").slice(0, 10);
}

const RECEIPT_CODE = /^\d{9}$/;

/** coding のうちレセプト電算処理システム用コード(9 桁)のもの。 */
function receiptCodings(concept: fhir4.CodeableConcept | undefined): fhir4.Coding[] {
  return (concept?.coding ?? []).filter((coding) => RECEIPT_CODE.test(coding.code ?? ""));
}

/** 実施記録・処方に出てくるレセプト電算コード(別表1・別表2 に問い合わせる対象)。 */
export function acuityRecordCodes(args: {
  procedures: fhir4.Procedure[];
  administrations: fhir4.MedicationAdministration[];
  prescriptionItems: fhir4.MedicationRequest[];
}): string[] {
  const codes = new Set<string>();
  for (const procedure of args.procedures) receiptCodings(procedure.code).forEach((c) => codes.add(c.code as string));
  for (const ma of args.administrations) receiptCodings(ma.medicationCodeableConcept).forEach((c) => codes.add(c.code as string));
  for (const mr of args.prescriptionItems) receiptCodings(mr.medicationCodeableConcept).forEach((c) => codes.add(c.code as string));
  return [...codes];
}

/** 評価日の前後で見つかったレセプト電算コード 1 件(どの日に・何という名前で)。 */
interface CodeOccurrence {
  code: string;
  name: string;
  day: string;
}

function shortDay(day: string): string {
  return day.slice(5).replace("-", "/");
}

/**
 * 実施記録のレセプト電算コードを別表1 と突き合わせて、その日に「あり」と推せる項目(docs/nursing-acuity-design.md §7)。
 * 評価票の注記どおり、A・C 項目は評価日に実施したコード(C は手術等の当日から項目の日数のあいだ)で決める。
 * 看護師が確かめて直す前提の初期値で、根拠(コードの名称と日)を添える。
 *   - 実施記録(Procedure)の診療行為コード、施用(MedicationAdministration)と処方(その日に有効な RP)の医薬品コード
 *   - A3 は施用した注射薬のうち別表2 の薬剤を除いた種類数が 3 以上
 *   - A7 は必要度Ⅰでは「救急搬送後の入院」なので、別表1 の A7(必要度Ⅱの「緊急に入院を必要とする状態」)は使わず、
 *     救急車で搬送された入院の入院日と翌日を推す
 *   - 別表1 のコードで拾えないときの補い: 輸血の実施記録 → A5、放射線治療の照射記録 → A6⑤
 * 手術は C の区分を確かめられるよう、術後何日かを hints に並べる。
 */
export function acuitySuggestions(args: {
  date: string;
  encounter: fhir4.Encounter | undefined;
  procedures: fhir4.Procedure[];
  administrations: fhir4.MedicationAdministration[];
  prescriptions?: fhir4.ServiceRequest[];
  prescriptionItems?: fhir4.MedicationRequest[];
  acuityCodes?: { kind: string; item_code: string; code: string; name: string | null; days: number | null }[];
}): { suggestions: AcuitySuggestion[]; hints: string[] } {
  const { date, encounter, procedures, administrations } = args;
  const acuityCodes = args.acuityCodes ?? [];
  const reasons = new Map<string, string[]>();
  const add = (item: string, reason: string) => reasons.set(item, [...(reasons.get(item) ?? []), reason]);

  // 評価日までに見つかったコード(実施記録・施用は実施した日、処方はその日に有効な RP の薬剤)。
  const occurrences: CodeOccurrence[] = [];
  const doneProcedures = procedures.filter(done);
  for (const procedure of doneProcedures) {
    for (const coding of receiptCodings(procedure.code)) {
      occurrences.push({ code: coding.code as string, name: coding.display ?? "", day: performedDay(procedure) });
    }
  }
  const injectionHubIds = new Set(doneProcedures.filter(isInjectionProcedure).map((p) => p.id));
  const injectionCodesToday = new Set<string>();
  for (const ma of administrations) {
    if (!administered(ma)) continue;
    const day = administeredDay(ma);
    for (const coding of receiptCodings(ma.medicationCodeableConcept)) {
      occurrences.push({ code: coding.code as string, name: coding.display ?? ma.medicationCodeableConcept?.text ?? "", day });
      if (day === date && injectionHubIds.has(referenceId(ma.partOf?.[0]?.reference))) {
        injectionCodesToday.add(coding.code as string);
      }
    }
  }
  const itemsByOrder = new Map<string, fhir4.MedicationRequest[]>();
  for (const mr of args.prescriptionItems ?? []) {
    const orderId = referenceId(mr.basedOn?.[0]?.reference);
    if (orderId) itemsByOrder.set(orderId, [...(itemsByOrder.get(orderId) ?? []), mr]);
  }
  for (const order of args.prescriptions ?? []) {
    if (categoryCoding(order, SETTING_SYSTEM)?.code !== "inpatient") continue;
    const start = (order.occurrenceDateTime ?? "").slice(0, 10);
    for (const rp of groupByRp(itemsByOrder.get(order.id ?? "") ?? [])) {
      if (!rpActiveDays(start, rp).includes(date)) continue;
      for (const medicine of rp.medicines) {
        if (RECEIPT_CODE.test(medicine.code)) occurrences.push({ code: medicine.code, name: medicine.name, day: date });
      }
    }
  }

  // 別表1 と突き合わせる。C は当日を含めて項目の日数のあいだ。
  const itemRows = acuityCodes.filter((row) => row.kind === "item" && row.item_code !== "A7");
  for (const row of itemRows) {
    const isC = row.item_code.startsWith("C");
    const from = isC ? addDays(date, -((row.days ?? 1) - 1)) : date;
    for (const occurrence of occurrences) {
      if (occurrence.code !== row.code || occurrence.day < from || occurrence.day > date) continue;
      const name = row.name || occurrence.name || row.code;
      add(row.item_code, isC ? `${name}(${shortDay(occurrence.day)})` : name);
    }
  }

  // A3: 施用した注射薬のうち、別表2 の薬剤を除いた種類数。
  const excluded = new Set(acuityCodes.filter((row) => row.kind === "a3_exclusion").map((row) => row.code));
  const counted = [...injectionCodesToday].filter((code) => !excluded.has(code));
  if (counted.length >= 3) add("A3", `注射薬 ${counted.length} 種類(別表2 を除く)`);

  const today = doneProcedures.filter((p) => performedDay(p) === date);
  if (!reasons.has("A5") && today.some(isTransfusionProcedure)) add("A5", "輸血を実施");
  if (!reasons.has("A6-5") && today.some(isRadiotherapyFraction)) add("A6-5", "放射線治療を照射");

  const admission = encounter?.period?.start?.slice(0, 10);
  if (encounter && admission && encounterAdmissionRoute(encounter).ambulance && date >= admission && date <= addDays(admission, 1)) {
    add("A7", "救急車で搬送された入院");
  }

  const suggestions = [...reasons.entries()].map(([code, list]) => {
    const unique = [...new Set(list)];
    return { code, reason: unique.length > 1 ? `${unique[0]} ほか${unique.length - 1}件` : unique[0] };
  });

  const hints = doneProcedures
    .filter((p) => isSurgeryProcedure(p) && performedDay(p) && performedDay(p) <= date)
    .map((p) => {
      const day = performedDay(p);
      const name = p.code?.text ?? p.code?.coding?.[0]?.display ?? "手術";
      const after = diffDays(day, date);
      return `手術 ${shortDay(day)} ${name}(${after === 0 ? "当日" : `術後${after}日`})`;
    });
  return { suggestions, hints };
}
