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
// 評価票の項目・配点は版ごとに下の NURSING_ACUITY_FORMS に持ち(一般病棟用・ICU 用・HCU 用)、改定で変われば
// 版を足す(過去の評価は書いた版の定義で読む)。該当患者の基準(割合1・割合2)は版の既定を持ち、一般病棟用だけ
// 施設設定で上書きする。
//
// 点数の数え方(評価票 別紙7・17・18):
// - A: 「あり」の項目の点数の合計。6 専門的な治療・処置は、該当した小項目の点数のうち最も高いもの
// - B: 患者の状態の点数 ×(介助の実施 = 1 / なし = 0)。寝返り・指示が通じる・危険行動は状態の点数のみ
// - C: 「あり」の項目の点数の合計(一般病棟用だけ)

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

/** B の項目の版をまたぐ共通キー(前日の評価を別の版へ引き継ぐときに項目を対応づける)。 */
export type AcuityStateKey = "turn" | "transfer" | "oral" | "meal" | "dress" | "instruction" | "danger";

/** 患者の状態(と介助の実施)で点数が付く項目(B)。 */
export interface AcuityStateItem {
  kind: "state";
  code: string;
  group: "B";
  number: number;
  label: string;
  stateKey: AcuityStateKey;
  /** 状態の選択肢。points が点数。 */
  states: { label: string; points: number }[];
  /** 介助の実施を掛けるか。 */
  assist: boolean;
}

export type AcuityItem = AcuityCheckItem | AcuityChoiceItem | AcuityStateItem;

/** コード一覧(別表)の版。general = 別紙7、icu = 別紙17、hcu = 別紙18。 */
export type AcuityCodeForm = "general" | "icu" | "hcu";

/** 記録から初期値を推すときの、版ごとの項目の対応(acuitySuggestions)。 */
export interface AcuityRules {
  codeForm: AcuityCodeForm;
  /** 注射薬の種類数(別表2 を除いて 3 種類以上)で推す項目。 */
  injectionCountItem?: string;
  /** 別表のコードで拾えないときに輸血の実施記録で補う項目。 */
  transfusionItem?: string;
  /** 放射線治療の照射記録で補う項目。 */
  radiotherapyItem?: string;
  /** 救急車で搬送された入院の入院日と翌日に推す項目。 */
  ambulanceItem?: string;
}

/** 該当患者の基準(割合1・割合2)。組の OR(書き方は parseAcuityTerm)。 */
export interface AcuityCriteria {
  ratio1: string[];
  ratio2: string[];
}

export interface AcuityForm {
  code: string;
  label: string;
  /** 一覧の見出しなどに使う短い名前。 */
  shortLabel: string;
  items: AcuityItem[];
  /** 版の既定の基準。一般病棟用は施設設定で上書きする(acuityCriteria)。 */
  criteria: AcuityCriteria;
  rules: AcuityRules;
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
  stateKey: AcuityStateKey,
  label: string,
  states: [string, number][],
  assist: boolean,
): AcuityStateItem => ({
  kind: "state",
  code: `B${number}`,
  group: "B",
  number,
  label,
  stateKey,
  states: states.map(([l, points]) => ({ label: l, points })),
  assist,
});

/** B 患者の状況等の 7 項目(どの版も同じ。番号だけ版で変わる)。 */
const patientStateItems = (first: number): AcuityStateItem[] => [
  state(first, "turn", "寝返り", [["できる", 0], ["何かにつかまればできる", 1], ["できない", 2]], false),
  state(first + 1, "transfer", "移乗", [["自立", 0], ["一部介助", 1], ["全介助", 2]], true),
  state(first + 2, "oral", "口腔清潔", [["自立", 0], ["要介助", 1]], true),
  state(first + 3, "meal", "食事摂取", [["自立", 0], ["一部介助", 1], ["全介助", 2]], true),
  state(first + 4, "dress", "衣服の着脱", [["自立", 0], ["一部介助", 1], ["全介助", 2]], true),
  state(first + 5, "instruction", "診療・療養上の指示が通じる", [["はい", 0], ["いいえ", 1]], false),
  state(first + 6, "danger", "危険行動", [["ない", 0], ["ある", 2]], false),
];

/**
 * 評価票の版(令和8年度改定、基本診療料の施設基準等の通知)。
 *   general-2026: 一般病棟用の重症度、医療・看護必要度Ⅰに係る評価票(別紙7)。項目名の括弧内の日数は評価の対象になる日数
 *   icu-2026: 特定集中治療室用の重症度、医療・看護必要度に係る評価票(別紙17)。基準は A 得点 2 点以上
 *   hcu-2026: ハイケアユニット用の重症度、医療・看護必要度に係る評価票(別紙18)。A は各 1 点で、
 *             基準①は 2・7〜13 のいずれかに該当、基準②は A のいずれかに該当(= A 1 点以上)
 */
export const NURSING_ACUITY_FORMS: AcuityForm[] = [
  {
    code: "general-2026",
    label: "一般病棟用 重症度、医療・看護必要度Ⅰ(令和8年度)",
    shortLabel: "一般病棟用",
    criteria: { ratio1: ["A3", "C1"], ratio2: ["A2", "C1"] },
    rules: {
      codeForm: "general",
      injectionCountItem: "A3",
      transfusionItem: "A5",
      radiotherapyItem: "A6-5",
      ambulanceItem: "A7",
    },
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
      ...patientStateItems(8),
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
  {
    code: "icu-2026",
    label: "特定集中治療室用 重症度、医療・看護必要度(令和8年度)",
    shortLabel: "ICU 用",
    criteria: { ratio1: ["A2"], ratio2: [] },
    rules: { codeForm: "icu", transfusionItem: "A6" },
    items: [
      check("A", 1, "蘇生術の施行", 2),
      check("A", 2, "動脈圧測定(動脈ライン)", 2),
      check("A", 3, "シリンジポンプの管理", 1),
      check("A", 4, "中心静脈圧測定(中心静脈ライン)", 2),
      check("A", 5, "人工呼吸器の管理", 2),
      check("A", 6, "輸血や血液製剤の管理", 2),
      check("A", 7, "肺動脈圧測定(スワンガンツカテーテル)", 2),
      check("A", 8, "一時的ペーシング", 2),
      check("A", 9, "抗不整脈剤の使用(注射剤のみ)", 2),
      check("A", 10, "特殊な治療法等(CHDF、IABP、PCPS、補助人工心臓、ICP測定、ECMO、IMPELLA)", 2),
      ...patientStateItems(11),
    ],
  },
  {
    code: "hcu-2026",
    label: "ハイケアユニット用 重症度、医療・看護必要度(令和8年度)",
    shortLabel: "HCU 用",
    criteria: {
      ratio1: ["#A2", "#A7", "#A8", "#A9", "#A10", "#A11", "#A12", "#A13"],
      ratio2: ["A1"],
    },
    rules: { codeForm: "hcu", injectionCountItem: "A4", transfusionItem: "A9" },
    items: [
      check("A", 1, "創傷処置(褥瘡の処置を除く)", 1),
      check("A", 2, "蘇生術の施行", 1),
      check("A", 3, "呼吸ケア(喀痰吸引のみの場合及び人工呼吸器の装着の場合を除く)", 1),
      check("A", 4, "注射薬剤3種類以上の管理(最大7日間)", 1),
      check("A", 5, "動脈圧測定(動脈ライン)", 1),
      check("A", 6, "シリンジポンプの管理", 1),
      check("A", 7, "中心静脈圧測定(中心静脈ライン)", 1),
      check("A", 8, "人工呼吸器の管理", 1),
      check("A", 9, "輸血や血液製剤の管理", 1),
      check("A", 10, "肺動脈圧測定(スワンガンツカテーテル)", 1),
      check("A", 11, "一時的ペーシング", 1),
      check("A", 12, "抗不整脈剤の使用(注射剤のみ)", 1),
      check("A", 13, "特殊な治療法等(CHDF、IABP、PCPS、補助人工心臓、ICP測定、ECMO、IMPELLA)", 1),
      ...patientStateItems(14),
    ],
  },
];

export function acuityFormOf(code: string | undefined): AcuityForm {
  return NURSING_ACUITY_FORMS.find((form) => form.code === code) ?? NURSING_ACUITY_FORMS[0];
}

/** 版に項目のある区分(ICU・HCU 用に C は無い)。 */
export function acuityGroupsOf(form: AcuityForm): AcuityGroup[] {
  return (["A", "B", "C"] as const).filter((group) => form.items.some((item) => item.group === group));
}

/** 版に使う該当患者の基準。一般病棟用は施設設定(ratio1 / ratio2)、ICU・HCU 用は版の既定。 */
export function acuityCriteria(form: AcuityForm, settings: NursingAcuitySettings): AcuityCriteria {
  return form.rules.codeForm === "general" ? { ratio1: settings.ratio1, ratio2: settings.ratio2 } : form.criteria;
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
 * 新しく評価するときの初期値。B は前日の評価(対象外なら空。版が違えば項目の共通キーで対応づける)、
 * A は実施記録から推した項目。1 人ずつのモーダルと一括入力で同じにする。
 */
export function initialAcuityValues(
  form: AcuityForm,
  previous: fhir4.Observation | undefined,
  suggestions: AcuitySuggestion[],
): AcuityValues {
  const initial = emptyAcuityValues();
  if (previous) {
    const prev = parseAcuityObservation(previous);
    if (!prev.values.excluded) {
      for (const item of form.items) {
        if (item.kind !== "state") continue;
        const source = prev.form.items.find((i) => i.kind === "state" && i.stateKey === item.stateKey);
        if (!source) continue;
        if (prev.values.states[source.code] !== undefined) initial.states[item.code] = prev.values.states[source.code];
        if (prev.values.assists[source.code] !== undefined) initial.assists[item.code] = prev.values.assists[source.code];
      }
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

/**
 * 基準の組。得点の条件("A3" = A 得点 3 点以上)と項目の条件("#A2" = 項目 A2 に該当。A6 の小項目は "#A6-5")を
 * "+" でつないだもの("A2+B3"、"#A2+#A7")で、すべて満たせば該当。backend の ACUITY_TERM と同じ文法。
 */
export interface AcuityTerm {
  scores: Partial<AcuityScores>;
  items: string[];
}

export function parseAcuityTerm(term: string): AcuityTerm | null {
  const parts = term.split("+");
  const result: AcuityTerm = { scores: {}, items: [] };
  for (const part of parts) {
    const score = /^([ABC])(\d{1,2})$/.exec(part.trim());
    if (score) {
      const group = score[1] as AcuityGroup;
      if (result.scores[group] !== undefined) return null;
      result.scores[group] = Number(score[2]);
      continue;
    }
    const item = /^#([AC]\d{1,2}(?:-\d{1,2})?)$/.exec(part.trim());
    if (!item || result.items.includes(item[1])) return null;
    result.items.push(item[1]);
  }
  return parts.length > 0 ? result : null;
}

function meetsTerm(term: AcuityTerm, scores: AcuityScores, checks: string[]): boolean {
  return (
    (Object.entries(term.scores) as [AcuityGroup, number][]).every(([group, min]) => scores[group] >= min) &&
    term.items.every((code) => checks.includes(code))
  );
}

/** 基準(組の OR)に該当するか。組が 1 つも無ければ判定しない(null)。checks は「あり」の項目のコード。 */
export function meetsAcuityCriterion(scores: AcuityScores, terms: string[], checks: string[] = []): boolean | null {
  const parsed = terms.map(parseAcuityTerm).filter((t): t is AcuityTerm => t !== null);
  if (parsed.length === 0) return null;
  return parsed.some((term) => meetsTerm(term, scores, checks));
}

/**
 * 基準の表示("A3点以上 又は C1点以上"、"A2・A7・A8 のいずれかに該当")。項目だけの組が並ぶときは
 * 1 つにまとめる。
 */
export function acuityCriterionLabel(terms: string[]): string {
  const parsed = terms.map(parseAcuityTerm).filter((t): t is AcuityTerm => t !== null);
  const singleItems = parsed.filter((t) => Object.keys(t.scores).length === 0 && t.items.length === 1);
  const rest = parsed.filter((t) => !singleItems.includes(t));
  const labels = rest.map((term) =>
    [
      ...(Object.entries(term.scores) as [AcuityGroup, number][]).map(([g, min]) => `${g}${min}点以上`),
      ...term.items.map((code) => `${code}に該当`),
    ].join("かつ"),
  );
  if (singleItems.length === 1) labels.push(`${singleItems[0].items[0]}に該当`);
  if (singleItems.length > 1) labels.push(`${singleItems.map((t) => t.items[0]).join("・")} のいずれかに該当`);
  return labels.join(" 又は ");
}

/** 届出単位 1 つの設定(施設設定 nursing_acuity.units の値。キーは病棟か病室の Location id)。 */
export interface AcuityUnitSetting {
  kind: "ward" | "room";
  /** 届出区分(ACUITY_CATEGORY_OPTIONS のコード)。空は未設定。 */
  category: string;
  /** 評価方式(Ⅰ / Ⅱ)。基準値の表と届出様式の表示に使う。 */
  method: "I" | "II";
  /** 届出病床数。無ければ使えるベッドの数。 */
  beds?: number;
  /** 基準値(%)。無ければ区分の既定。 */
  ratio1?: number;
  ratio2?: number;
}

/** 年度(4 月〜翌 3 月)ごとの救急搬送の件数の上書き(応需係数。docs/nursing-acuity-design.md §9)。 */
export interface AcuityEmergencyYearSetting {
  /** (1) 救急搬送受入件数(病院全体)。 */
  transports?: number;
  /** (4) 届出単位ごとの救急搬送からの入院件数(単位の Location id → 件数)。 */
  admissions?: Record<string, number>;
}

/** 施設設定 nursing_acuity(backend の DEFAULT_NURSING_ACUITY と同じ形)。 */
export interface NursingAcuitySettings {
  /** 届出単位の設定が無い病棟に使う評価票の版。 */
  form: string;
  /** 一般病棟用の該当患者の基準(組の OR)。ICU・HCU 用は版の既定を使う。 */
  ratio1: string[];
  ratio2: string[];
  /** 届出単位(病棟・病室の Location id → 設定)。 */
  units: Record<string, AcuityUnitSetting>;
  /** 年度 → 救急搬送の件数の上書き。 */
  emergency_years: Record<string, AcuityEmergencyYearSetting>;
}

export const DEFAULT_NURSING_ACUITY: NursingAcuitySettings = {
  form: "general-2026",
  ratio1: ["A3", "C1"],
  ratio2: ["A2", "C1"],
  units: {},
  emergency_years: {},
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
  for (const group of acuityGroupsOf(form)) {
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
 * 実施記録のレセプト電算コードを版のコード一覧(別紙7・17・18 の別表1)と突き合わせて、その日に「あり」と推せる項目
 * (docs/nursing-acuity-design.md §7)。評価票の注記どおり、A・C 項目は評価日に実施したコード(C は手術等の当日から
 * 項目の日数のあいだ)で決める。看護師が確かめて直す前提の初期値で、根拠(コードの名称と日)を添える。
 *   - 実施記録(Procedure)の診療行為コード、施用(MedicationAdministration)と処方(その日に有効な RP)の医薬品コード
 *   - 注射薬剤3種類以上の管理(一般 A3・HCU A4)は施用した注射薬のうち別表2 の薬剤を除いた種類数が 3 以上
 *   - 一般の A7 は必要度Ⅰでは「救急搬送後の入院」なので、別表1 の A7(必要度Ⅱの「緊急に入院を必要とする状態」)は
 *     使わず、救急車で搬送された入院の入院日と翌日を推す
 *   - 別表1 のコードで拾えないときの補い: 輸血の実施記録 → 輸血や血液製剤の管理、放射線治療の照射記録 → 一般の A6⑤
 * 手術は C の区分を確かめられるよう、術後何日かを hints に並べる。
 */
export function acuitySuggestions(args: {
  form: AcuityForm;
  date: string;
  encounter: fhir4.Encounter | undefined;
  procedures: fhir4.Procedure[];
  administrations: fhir4.MedicationAdministration[];
  prescriptions?: fhir4.ServiceRequest[];
  prescriptionItems?: fhir4.MedicationRequest[];
  acuityCodes?: {
    form: AcuityCodeForm;
    kind: string;
    item_code: string;
    code: string;
    name: string | null;
    days: number | null;
  }[];
}): { suggestions: AcuitySuggestion[]; hints: string[] } {
  const { form, date, encounter, procedures, administrations } = args;
  const rules = form.rules;
  const acuityCodes = (args.acuityCodes ?? []).filter((row) => row.form === rules.codeForm);
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

  // 別表1 と突き合わせる。C は当日を含めて項目の日数のあいだ。救急車搬送で推す項目のコードは使わない。
  const itemRows = acuityCodes.filter((row) => row.kind === "item" && row.item_code !== rules.ambulanceItem);
  for (const row of itemRows) {
    const isC = row.item_code.startsWith("C");
    const from = isC ? addDays(date, -((row.days ?? 1) - 1)) : date;
    for (const occurrence of occurrences) {
      if (occurrence.code !== row.code || occurrence.day < from || occurrence.day > date) continue;
      const name = row.name || occurrence.name || row.code;
      add(row.item_code, isC ? `${name}(${shortDay(occurrence.day)})` : name);
    }
  }

  // 注射薬剤3種類以上の管理: 施用した注射薬のうち、別表2 の薬剤を除いた種類数。
  if (rules.injectionCountItem) {
    const excluded = new Set(acuityCodes.filter((row) => row.kind === "a3_exclusion").map((row) => row.code));
    const counted = [...injectionCodesToday].filter((code) => !excluded.has(code));
    if (counted.length >= 3) add(rules.injectionCountItem, `注射薬 ${counted.length} 種類(別表2 を除く)`);
  }

  const today = doneProcedures.filter((p) => performedDay(p) === date);
  if (rules.transfusionItem && !reasons.has(rules.transfusionItem) && today.some(isTransfusionProcedure)) {
    add(rules.transfusionItem, "輸血を実施");
  }
  if (rules.radiotherapyItem && !reasons.has(rules.radiotherapyItem) && today.some(isRadiotherapyFraction)) {
    add(rules.radiotherapyItem, "放射線治療を照射");
  }

  const admission = encounter?.period?.start?.slice(0, 10);
  if (
    rules.ambulanceItem &&
    encounter &&
    admission &&
    encounterAdmissionRoute(encounter).ambulance &&
    date >= admission &&
    date <= addDays(admission, 1)
  ) {
    add(rules.ambulanceItem, "救急車で搬送された入院");
  }

  const suggestions = [...reasons.entries()].map(([code, list]) => {
    const unique = [...new Set(list)];
    return { code, reason: unique.length > 1 ? `${unique[0]} ほか${unique.length - 1}件` : unique[0] };
  });

  const hints = (form.items.some((item) => item.group === "C") ? doneProcedures : [])
    .filter((p) => isSurgeryProcedure(p) && performedDay(p) && performedDay(p) <= date)
    .map((p) => {
      const day = performedDay(p);
      const name = p.code?.text ?? p.code?.coding?.[0]?.display ?? "手術";
      const after = diffDays(day, date);
      return `手術 ${shortDay(day)} ${name}(${after === 0 ? "当日" : `術後${after}日`})`;
    });
  return { suggestions, hints };
}
