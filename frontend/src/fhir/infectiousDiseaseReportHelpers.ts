import { addDays, diffDays } from "../lib/dates";
import { conditionIcd10 } from "./cancerRegistryHelpers";
import { ICD10_SYSTEM, summarizeCondition } from "./conditionHelpers";
import {
  matchConditionResponses,
  responseAnswer,
  templateRecordState,
  type TemplateRecordState,
} from "./conditionTemplateHelpers";
import { plainAnswerText } from "./questionnaireResponseHelpers";

// 感染症法の発生届(docs/infectious-disease-report-design.md)。届出対象の感染症(全数把握)に当たる病名を
// ICD-10 で見つけ、発生届のテンプレートの回答 1 件 = 届出 1 件として記録する。対象の病名は回答の対象プロブレム。

/** 施設設定 infectious_disease_report(backend の DEFAULT_INFECTIOUS_DISEASE_REPORT と同じ形)。 */
export interface InfectiousDiseaseReportSettings {
  /** 発生届のテンプレートの url(版を問わない)。 */
  template: string;
}

export const DEFAULT_INFECTIOUS_DISEASE_REPORT: InfectiousDiseaseReportSettings = {
  template: "http://fhir-client.local/Questionnaire/idsc-notify-01",
};

export type NotifiableDiseaseClass = "一類" | "二類" | "三類" | "四類" | "五類" | "新型インフルエンザ等";

export interface NotifiableDisease {
  /** 届出基準の感染症名。 */
  name: string;
  class: NotifiableDiseaseClass;
  /** 届出期限(日)。0 = 直ちに、7 = 7 日以内。 */
  deadlineDays: 0 | 7;
  /** ICD-10(ピリオド無し)の前方一致。 */
  icd10: string[];
  /** 氏名・住所を届け出ない(年齢・性別などだけの)感染症。 */
  anonymous?: boolean;
}

const c = (
  name: string,
  cls: NotifiableDiseaseClass,
  icd10: string[],
  options: { deadlineDays?: 0 | 7; anonymous?: boolean } = {},
): NotifiableDisease => ({
  name,
  class: cls,
  icd10,
  deadlineDays: options.deadlineDays ?? (cls === "五類" ? 7 : 0),
  anonymous: options.anonymous,
});

/**
 * 全数把握の届出対象感染症と ICD-10 の対応(感染症法 第 12 条、届出基準)。定点把握の五類は含まない。
 * 届出期限は一類〜四類・新型インフルエンザ等が「直ちに」、五類が「7 日以内」(麻しん・風しん・侵襲性髄膜炎菌感染症は直ちに)。
 * 耐性菌(CRE・VRE・VRSA・MDRA)は ICD-10 で表せないので入れていない(細菌検査の結果から拾うのは別途)。
 */
export const NOTIFIABLE_DISEASES: NotifiableDisease[] = [
  // 一類
  c("エボラ出血熱", "一類", ["A984"]),
  c("クリミア・コンゴ出血熱", "一類", ["A980"]),
  c("痘そう", "一類", ["B03"]),
  c("南米出血熱", "一類", ["A960", "A961", "A968"]),
  c("ペスト", "一類", ["A20"]),
  c("マールブルグ病", "一類", ["A983"]),
  c("ラッサ熱", "一類", ["A962"]),
  // 二類
  c("急性灰白髄炎", "二類", ["A80"]),
  c("結核", "二類", ["A15", "A16", "A17", "A18", "A19"]),
  c("ジフテリア", "二類", ["A36"]),
  c("重症急性呼吸器症候群(SARS)", "二類", ["U049"]),
  c("鳥インフルエンザ(H5N1・H7N9)", "二類", ["J09"]),
  // 三類
  c("コレラ", "三類", ["A00"]),
  c("細菌性赤痢", "三類", ["A03"]),
  c("腸管出血性大腸菌感染症", "三類", ["A043"]),
  c("腸チフス", "三類", ["A010"]),
  c("パラチフス", "三類", ["A011", "A012", "A013", "A014"]),
  // 四類
  c("E型肝炎", "四類", ["B172"]),
  c("A型肝炎", "四類", ["B15"]),
  c("ウエストナイル熱", "四類", ["A923"]),
  c("エキノコックス症", "四類", ["B67"]),
  c("黄熱", "四類", ["A95"]),
  c("オウム病", "四類", ["A70"]),
  c("オムスク出血熱", "四類", ["A981"]),
  c("回帰熱", "四類", ["A68"]),
  c("キャサヌル森林病", "四類", ["A982"]),
  c("Q熱", "四類", ["A78"]),
  c("狂犬病", "四類", ["A82"]),
  c("コクシジオイデス症", "四類", ["B38"]),
  c("エムポックス(サル痘)", "四類", ["B04"]),
  c("腎症候性出血熱", "四類", ["A985"]),
  c("西部ウマ脳炎", "四類", ["A831"]),
  c("ダニ媒介脳炎", "四類", ["A84"]),
  c("炭疽", "四類", ["A22"]),
  c("チクングニア熱", "四類", ["A920"]),
  c("つつが虫病", "四類", ["A753"]),
  c("デング熱", "四類", ["A90", "A91"]),
  c("東部ウマ脳炎", "四類", ["A832"]),
  c("ニパウイルス感染症", "四類", ["B338"]),
  c("日本紅斑熱", "四類", ["A778"]),
  c("日本脳炎", "四類", ["A830"]),
  c("ハンタウイルス肺症候群", "四類", ["B334"]),
  c("Bウイルス病", "四類", ["B004"]),
  c("鼻疽", "四類", ["A240"]),
  c("ブルセラ症", "四類", ["A23"]),
  c("ベネズエラウマ脳炎", "四類", ["A922"]),
  c("発しんチフス", "四類", ["A750"]),
  c("ボツリヌス症", "四類", ["A051"]),
  c("マラリア", "四類", ["B50", "B51", "B52", "B53", "B54"]),
  c("野兎病", "四類", ["A21"]),
  c("ライム病", "四類", ["A692"]),
  c("リフトバレー熱", "四類", ["A924"]),
  c("類鼻疽", "四類", ["A241", "A242", "A243", "A244"]),
  c("レジオネラ症", "四類", ["A481"]),
  c("レプトスピラ症", "四類", ["A27"]),
  c("ロッキー山紅斑熱", "四類", ["A770"]),
  // 五類(全数把握)
  c("アメーバ赤痢", "五類", ["A06"], { anonymous: true }),
  c("ウイルス性肝炎(E型・A型を除く)", "五類", ["B16", "B170", "B171", "B178", "B179"], { anonymous: true }),
  c("急性脳炎", "五類", ["A86", "G040"], { anonymous: true }),
  c("クリプトスポリジウム症", "五類", ["A072"], { anonymous: true }),
  c("クロイツフェルト・ヤコブ病", "五類", ["A810"], { anonymous: true }),
  c("劇症型溶血性レンサ球菌感染症", "五類", ["A400", "A401", "A402", "A483"], { anonymous: true }),
  c("後天性免疫不全症候群", "五類", ["B20", "B21", "B22", "B23", "B24", "Z21"], { anonymous: true }),
  c("ジアルジア症", "五類", ["A071"], { anonymous: true }),
  c("侵襲性インフルエンザ菌感染症", "五類", ["A413", "G000"], { anonymous: true }),
  c("侵襲性髄膜炎菌感染症", "五類", ["A39"], { deadlineDays: 0 }),
  c("侵襲性肺炎球菌感染症", "五類", ["A403", "G001"], { anonymous: true }),
  c("水痘(入院例)", "五類", ["B01"], { anonymous: true }),
  c("先天性風しん症候群", "五類", ["P350"], { anonymous: true }),
  c("梅毒", "五類", ["A50", "A51", "A52", "A53"], { anonymous: true }),
  c("播種性クリプトコックス症", "五類", ["B457"], { anonymous: true }),
  c("破傷風", "五類", ["A33", "A34", "A35"], { anonymous: true }),
  c("百日咳", "五類", ["A37"], { anonymous: true }),
  c("風しん", "五類", ["B06"], { deadlineDays: 0 }),
  c("麻しん", "五類", ["B05"], { deadlineDays: 0 }),
];

/** 病名(ICD-10)に当たる届出対象感染症。無ければ undefined。長い(細かい)コードを優先する。 */
export function notifiableDiseaseOfIcd10(icd10: string): NotifiableDisease | undefined {
  const code = icd10.replace(".", "").toUpperCase();
  if (!code) return undefined;
  let best: { disease: NotifiableDisease; length: number } | undefined;
  for (const disease of NOTIFIABLE_DISEASES) {
    for (const prefix of disease.icd10) {
      if (code.startsWith(prefix) && (!best || prefix.length > best.length)) best = { disease, length: prefix.length };
    }
  }
  return best?.disease;
}

export function notifiableDiseaseOf(condition: fhir4.Condition): NotifiableDisease | undefined {
  return notifiableDiseaseOfIcd10(conditionIcd10(condition));
}

/** 届出対象の病名を引く `code=` のトークン(3 桁は 4 桁の細分類まで広げる)。 */
export function notifiableIcd10Tokens(): string[] {
  const codes = new Set<string>();
  for (const disease of NOTIFIABLE_DISEASES) {
    for (const prefix of disease.icd10) {
      codes.add(prefix);
      if (prefix.length === 3) for (let i = 0; i < 10; i += 1) codes.add(`${prefix}${i}`);
    }
  }
  return [...codes].map((code) => `${ICD10_SYSTEM}|${code}`);
}

export function deadlineLabel(disease: NotifiableDisease): string {
  return disease.deadlineDays === 0 ? "直ちに" : `${disease.deadlineDays} 日以内`;
}

/** 届出期限(含む)。診断日(病名の開始日)が無ければ空。 */
export function notifiableDueDate(diagnosisDate: string, disease: NotifiableDisease): string {
  return diagnosisDate ? addDays(diagnosisDate, disease.deadlineDays) : "";
}

// ---- 発生届の回答 ----

/** 発生届テンプレートの届出状況(未届出 / 届出済)と届出年月日の linkId。 */
export const IDN_STATUS_LINK_ID = "idn_status";
export const IDN_NOTIFY_DATE_LINK_ID = "idn_notify-date";
export const IDN_STATUS_REPORTED = "reported";

export type InfectiousReportState = TemplateRecordState | "written";

export const INFECTIOUS_REPORT_STATE_LABELS: Record<InfectiousReportState, string> = {
  missing: "未届出",
  draft: "記入中",
  written: "記入済",
  done: "届出済",
};

export interface InfectiousDiseaseReportRow {
  condition: fhir4.Condition;
  patientId: string;
  disease: NotifiableDisease;
  diagnosisDate: string;
  dueDate: string;
  /** 期限までの日数(負は超過)。期限が無ければ null。 */
  daysLeft: number | null;
  state: InfectiousReportState;
  response?: fhir4.QuestionnaireResponse;
  /** 回答の届出年月日。 */
  notifiedOn: string;
}

/** 届出の状態。回答が確定していても、届出状況が「届出済」でなければ「記入済」。 */
export function infectiousReportStateOf(response: fhir4.QuestionnaireResponse | undefined): InfectiousReportState {
  const state = templateRecordState(response);
  if (state !== "done") return state;
  return responseAnswer(response, IDN_STATUS_LINK_ID)?.valueCoding?.code === IDN_STATUS_REPORTED ? "done" : "written";
}

export function infectiousDiseaseReportRows(
  conditions: fhir4.Condition[],
  responses: fhir4.QuestionnaireResponse[],
  today: string,
): InfectiousDiseaseReportRow[] {
  return matchConditionResponses(conditions, responses).flatMap(({ condition, patientId, response }) => {
    const disease = notifiableDiseaseOf(condition);
    if (!disease) return [];
    const diagnosisDate = summarizeCondition(condition).startDate;
    const dueDate = notifiableDueDate(diagnosisDate, disease);
    return [
      {
        condition,
        patientId,
        disease,
        diagnosisDate,
        dueDate,
        daysLeft: dueDate ? diffDays(today, dueDate) : null,
        state: infectiousReportStateOf(response),
        response,
        notifiedOn: plainAnswerText(responseAnswer(response, IDN_NOTIFY_DATE_LINK_ID) ?? {}),
      },
    ];
  });
}

/** 一覧の既定の期間(今日までの 90 日)。 */
export function defaultInfectiousReportFrom(today: string): string {
  return addDays(today, -90);
}

// ---- 初期値変数 ----

/** 初期値式から参照できる変数名(% なし)。 */
export const INFECTIOUS_POPULATE_VARIABLES = [
  "notifiableDiseaseName",
  "notifiableDiseaseClass",
  "notifiableDiseaseDeadline",
  "notifiableDueDate",
  "notifiableDiagnosisDate",
] as const;

/**
 * 記入の対象の病名。対象プロブレムが届出対象ならそれ、そうでなければ届出対象の病名のうち
 * 開始日が最も新しいもの(conditions は開始日の新しい順)。
 */
export function focusNotifiableCondition(
  conditions: fhir4.Condition[],
  focusConditionId: string | undefined,
): fhir4.Condition | undefined {
  const focused = focusConditionId ? conditions.find((c) => c.id === focusConditionId) : undefined;
  if (focused && notifiableDiseaseOf(focused)) return focused;
  return conditions.find((condition) => Boolean(notifiableDiseaseOf(condition)));
}

/** 初期値式の環境に足す「発生届」の変数。対象が無いときも変数名は必ず置く。 */
export function infectiousDiseaseValues(
  conditions: fhir4.Condition[],
  focusConditionId: string | undefined,
): Record<string, string> {
  const condition = focusNotifiableCondition(conditions, focusConditionId);
  const disease = condition ? notifiableDiseaseOf(condition) : undefined;
  const diagnosisDate = condition ? summarizeCondition(condition).startDate : "";
  return {
    notifiableDiseaseName: disease?.name ?? "",
    notifiableDiseaseClass: disease?.class ?? "",
    notifiableDiseaseDeadline: disease ? deadlineLabel(disease) : "",
    notifiableDueDate: disease ? notifiableDueDate(diagnosisDate, disease) : "",
    notifiableDiagnosisDate: diagnosisDate,
  };
}
