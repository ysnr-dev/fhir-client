// テンプレート回答フォームの初期値式(initialExpression)・計算式から参照できる
// 実行時コンテキスト(%変数)の組み立て。
//
// 患者の FHIR リソースをフォーム入力向けの整形済みテキスト(数値は数値)へ変換して提供する。
// テンプレート側は初期値式に「%conditions」のように変数参照を書くだけでよい
// (FHIRPath としても妥当な式なので、jsp-7 の枠組みのまま扱える)。
//
// 提供する変数の一覧と説明は POPULATE_EXPRESSION_OPTIONS(テンプレート編集画面の
// 変数選択モーダルに出すもの)が正。テンプレートの変数(variable 拡張)が同じ名前を
// 定義していれば、そちらが優先される(QuestionnaireResponseForm の expressionEnv)。
import type { PatientCaution } from "../api/masterClient";
import { dateTimeLabel, diffDays, toWareki } from "../lib/dates";
import { summarizeAllergy } from "./allergyHelpers";
import { summarizeBodyMeasures } from "./bodyMeasureHelpers";
import { bloodTypeLabel } from "./transfusionOrderHelpers";
import { summarizeBloodType } from "./bloodTypeHelpers";
import { cancerPopulateValues, type CancerPopulateSources } from "./cancerRegistryHelpers";
import { infectiousDiseaseValues } from "./infectiousDiseaseReportHelpers";
import { conditionCategoryOf, ICD10_SYSTEM, isActiveCondition, summarizeCondition } from "./conditionHelpers";
import {
  encounterAdmissionDate,
  encounterAttendingName,
  encounterDepartmentName,
} from "./encounterHelpers";
import type { InfectionRow } from "./infectionHelpers";
import { summarizeFlag } from "./flagHelpers";
import {
  observationLineDisplay,
  specimenNamesById,
  splitLabResultDetailBundle,
} from "./labResultHelpers";
import type { ActiveMedication } from "./medicationSafetyHelpers";
import { parseOrganization } from "./organizationHelpers";
import { calculateAge, genderLabel, patientNumberOf, prefectureCodeOf } from "./patientHelpers";
import { practitionerFieldValue } from "./practitionerField";
import { baseRoleOf, parseDepartmentRoles } from "./practitionerRoleHelpers";
import { groupByRp, splitPrescriptionDetailBundle, summarizeServiceRequest } from "./prescriptionHelpers";
import {
  BLOOD_PRESSURE,
  DIASTOLIC,
  SYSTOLIC,
  VITAL_MEASURES,
  groupVitalEntries,
  vitalDisplayRows,
} from "./vitalHelpers";
import { labExpression, type PopulateLabRow } from "./populateLab";
import { oralExamPopulateValues, type OralExamPopulateSources } from "./populateOralExam";
import { surgeryPopulateValues, type SurgeryPopulateSources } from "./populateSurgery";
import { codingBySystem, LOINC_SYSTEM } from "./shared";

export interface PopulateSources {
  patient: fhir4.Patient;
  /** 今日(YYYY-MM-DD)。年齢・病日・投与中の判定の基準日。 */
  today: string;
  /** 記入を始めたときの対象プロブレム(一覧から渡した病名)の Condition id。腫瘍・届出対象の感染症の対象を決める。 */
  focusConditionId?: string;
  /** 患者のアクティブな Condition(clinical-status=active で検索済み) */
  conditions: fhir4.Condition[];
  /** 患者の Condition 全件(転帰を問わない)。既往歴の一覧に使う。 */
  allConditions: fhir4.Condition[];
  /** 最新の検査結果の詳細 Bundle(_include 付き検索の結果)。なければ undefined */
  labDetail?: fhir4.Bundle;
  /** 最新の処方の詳細 Bundle(_revinclude 付き検索の結果)。なければ undefined */
  prescriptionDetail?: fhir4.Bundle;
  /** テンプレートが参照する結果項目の最新値(populateLab.ts)。参照が無ければ空。 */
  labs: PopulateLabRow[];
  /** 活動中のアレルギー。 */
  allergies: fhir4.AllergyIntolerance[];
  /** 血液型(ABO / RhD)の Observation。 */
  bloodType: fhir4.Observation[];
  /** 感染症の一覧(summarizeInfections の結果。陽性以外も含む)。 */
  infections: InfectionRow[];
  /** 有効な診療上の注意。 */
  flags: fhir4.Flag[];
  /** 注意区分マスタ(コード → 行)。注意の表示名に使う。 */
  cautionsByCode: Map<string, PatientCaution>;
  /** 身長・体重の Observation(新しい順)。 */
  bodyMeasures: fhir4.Observation[];
  /** 直近のバイタルの Observation(新しい順)。 */
  vitals: fhir4.Observation[];
  /** 入院中ならその入院と病棟・病室名。入院していなければ null。 */
  admission: { encounter: fhir4.Encounter; wardName: string; roomName: string } | null;
  /** 今日の時点で投与中の処方の薬剤。 */
  activeMedications: ActiveMedication[];
  /** 自院(施設設定)。未設定なら null。 */
  facility: fhir4.Organization | null;
  /** ログイン中の医療従事者とそのロール(所属・診療科)。紐付く医療従事者が無ければ null。 */
  author: { practitioner: fhir4.Practitioner; roles: fhir4.PractitionerRole[] } | null;
  /** 腫瘍・病理の変数の元データ(cancerRegistryHelpers.ts)。テンプレートの式が参照するときだけ揃う。 */
  cancer?: CancerPopulateSources;
  /** 手術の変数の元データ(populateSurgery.ts)。テンプレートの式が参照するときだけ揃う。 */
  surgery?: SurgeryPopulateSources;
  /** 口腔診査の変数の元データ(populateOralExam.ts)。テンプレートの式が参照するときだけ揃う。 */
  oralExam?: OralExamPopulateSources;
  /** 最新の受診・入院。式が %lastVisitDate を参照するときだけ揃う。 */
  lastEncounter?: fhir4.Encounter;
  /** 同じテンプレートのこの患者の記入済みの件数(取り消しを除く)。式が %responseSequence を参照するときだけ揃う。 */
  responseCount?: number;
  /** 記入する入院(無ければ今の入院)に結び付いた確定済みの回答。式が %admissionAnswers を参照するときだけ揃う。 */
  admissionResponses?: fhir4.QuestionnaireResponse[];
}

/** 式が変数のどれかを参照しているか(%名前 の後ろに名前の続きが無いもの)。 */
export function usesVariables(expressions: Iterable<string | undefined>, names: readonly string[]): boolean {
  const pattern = new RegExp(`%(?:${names.join("|")})(?![A-Za-z0-9_])`);
  for (const expression of expressions) {
    if (expression && pattern.test(expression)) return true;
  }
  return false;
}

// テンプレート編集画面で初期値式として選べる式の一覧(変数選択モーダル)。
// %patient は Patient リソースそのものなので、よく使う値の取り出し方を式ごと並べる。
export interface PopulateExpressionOption {
  /** モーダルの左の一覧の見出し。 */
  group: string;
  /** 変数名(%なし)。 */
  variable: string;
  label: string;
  expression: string;
  description: string;
  sample: string;
  /** 項目を選んで式を組み立てる変数。expression は見本で、名前だけでは値が決まらない。 */
  parameterized?: "lab";
}

// 表記の指定が無い name(他システム由来)は漢字名として扱う(humanName.ts と同じ)ので、
// 漢字は「カナ(SYL)でないもの」で引く。
const NAME_SELECT = ".select(family + ' ' + given.first()).first()";
const KANJI_NAME_EXPRESSION = `%patient.name.where(extension.where(value = 'SYL').empty())${NAME_SELECT}`;
const KANA_NAME_EXPRESSION = `%patient.name.where(extension.value = 'SYL')${NAME_SELECT}`;

const MULTILINE_NOTE = "複数行になるので「テキスト」項目で使います。";
const NUMBER_NOTE = "数値なので「整数」「小数」項目や計算式でも使えます。";

export const POPULATE_EXPRESSION_OPTIONS: PopulateExpressionOption[] = [
  // ---- 患者 ----
  {
    group: "患者",
    variable: "patient",
    label: "患者氏名(漢字)",
    expression: KANJI_NAME_EXPRESSION,
    description: "患者の漢字氏名を「姓 名」で入れます。",
    sample: "大腸 太郎",
  },
  {
    group: "患者",
    variable: "patient",
    label: "患者氏名(カナ)",
    expression: KANA_NAME_EXPRESSION,
    description: "患者のカナ氏名を「姓 名」で入れます。",
    sample: "ダイチョウ タロウ",
  },
  {
    group: "患者",
    variable: "patientNumber",
    label: "患者番号",
    expression: "%patientNumber",
    description: "患者番号を入れます。",
    sample: "16",
  },
  {
    group: "患者",
    variable: "patient",
    label: "生年月日",
    expression: "%patient.birthDate",
    description: "患者の生年月日を YYYY-MM-DD で入れます。「日付」項目で使えます。",
    sample: "1958-04-12",
  },
  {
    group: "患者",
    variable: "birthDateWareki",
    label: "生年月日(和暦)",
    expression: "%birthDateWareki",
    description: "患者の生年月日を和暦で入れます。",
    sample: "昭和33年4月12日",
  },
  {
    group: "患者",
    variable: "age",
    label: "年齢",
    expression: "%age",
    description: `今日の時点の満年齢を入れます。${NUMBER_NOTE}`,
    sample: "68",
  },
  {
    group: "患者",
    variable: "gender",
    label: "性別",
    expression: "%gender",
    description: "性別を「男性」「女性」などの文字で入れます。",
    sample: "男性",
  },
  {
    group: "患者",
    variable: "patient",
    label: "住所",
    expression: "%patient.address.first().text",
    description: "患者情報に登録した住所(1 件目)を入れます。",
    sample: "東京都千代田区千代田1-1",
  },
  {
    group: "患者",
    variable: "patient",
    label: "電話番号",
    expression: "%patient.telecom.where(system = 'phone').value.first()",
    description: "患者情報に登録した電話番号(1 件目)を入れます。",
    sample: "03-1234-5678",
  },
  {
    group: "患者",
    variable: "prefectureCode",
    label: "都道府県コード",
    expression: "%prefectureCode",
    description: "患者の住所の都道府県を 2 桁のコード(01〜47)で入れます。",
    sample: "13",
  },
  {
    group: "患者",
    variable: "deathDate",
    label: "死亡日",
    expression: "%deathDate",
    description: "患者情報の死亡日を YYYY-MM-DD で入れます。生存していれば空です。",
    sample: "2026-10-10",
  },
  {
    group: "患者",
    variable: "lastVisitDate",
    label: "最終来院日",
    expression: "%lastVisitDate",
    description: "最新の受診・入院の開始日を YYYY-MM-DD で入れます。",
    sample: "2026-10-20",
  },
  {
    group: "患者",
    variable: "today",
    label: "今日の日付",
    expression: "%today",
    description: "記入を始めた日の日付を YYYY-MM-DD で入れます。「日付」項目で使えます。",
    sample: "2026-10-01",
  },
  {
    group: "患者",
    variable: "todayWareki",
    label: "今日の日付(和暦)",
    expression: "%todayWareki",
    description: "記入を始めた日の日付を和暦で入れます。",
    sample: "令和8年10月1日",
  },

  // ---- 体格・バイタル ----
  {
    group: "体格・バイタル",
    variable: "bodyHeight",
    label: "身長(最新)",
    expression: "%bodyHeight",
    description: `最新の身長(cm)を入れます。${NUMBER_NOTE}`,
    sample: "168.5",
  },
  {
    group: "体格・バイタル",
    variable: "bodyWeight",
    label: "体重(最新)",
    expression: "%bodyWeight",
    description: `最新の体重(kg)を入れます。${NUMBER_NOTE}`,
    sample: "62.3",
  },
  {
    group: "体格・バイタル",
    variable: "bmi",
    label: "BMI",
    expression: "%bmi",
    description: `最新の身長と体重から求めた BMI(小数 1 桁)を入れます。身長・体重のどちらかが無ければ入りません。${NUMBER_NOTE}`,
    sample: "21.9",
  },
  {
    group: "体格・バイタル",
    variable: "vitals",
    label: "最新のバイタル(まとめ)",
    expression: "%vitals",
    description:
      "直近の測定 1 回ぶんのバイタルを、測定日時に続けて「項目 値」で 1 行に並べます。その回に測っていない項目は出ません。",
    sample: "【バイタル 2026/09/30 10:00】体温 36.8℃ / 血圧 128/76mmHg / 脈拍 72/分 / SpO2 98%",
  },
  {
    group: "体格・バイタル",
    variable: "temperature",
    label: "体温(最新)",
    expression: "%temperature",
    description: `最新の体温(℃)を入れます。項目ごとに最も新しい測定値を採ります。${NUMBER_NOTE}`,
    sample: "36.8",
  },
  {
    group: "体格・バイタル",
    variable: "systolicBP",
    label: "収縮期血圧(最新)",
    expression: "%systolicBP",
    description: `最新の収縮期血圧(mmHg)を入れます。${NUMBER_NOTE}`,
    sample: "128",
  },
  {
    group: "体格・バイタル",
    variable: "diastolicBP",
    label: "拡張期血圧(最新)",
    expression: "%diastolicBP",
    description: `最新の拡張期血圧(mmHg)を入れます。${NUMBER_NOTE}`,
    sample: "76",
  },
  {
    group: "体格・バイタル",
    variable: "pulse",
    label: "脈拍(最新)",
    expression: "%pulse",
    description: `最新の脈拍(/分)を入れます。${NUMBER_NOTE}`,
    sample: "72",
  },
  {
    group: "体格・バイタル",
    variable: "spo2",
    label: "SpO2(最新)",
    expression: "%spo2",
    description: `最新の SpO2(%)を入れます。${NUMBER_NOTE}`,
    sample: "98",
  },
  {
    group: "体格・バイタル",
    variable: "respiratoryRate",
    label: "呼吸数(最新)",
    expression: "%respiratoryRate",
    description: `最新の呼吸数(/分)を入れます。${NUMBER_NOTE}`,
    sample: "16",
  },

  // ---- アレルギー・感染症 ----
  {
    group: "アレルギー・感染症",
    variable: "allergies",
    label: "アレルギー",
    expression: "%allergies",
    description:
      "活動中のアレルギーを「、」区切りで並べます。分類と症状が登録されていれば括弧で添えます。",
    sample: "ペニシリン系抗生物質(医薬品・発疹)、卵(食品)",
  },
  {
    group: "アレルギー・感染症",
    variable: "bloodType",
    label: "血液型",
    expression: "%bloodType",
    description:
      "登録されている血液型を入れます。検査で確定していない(申告などの)型には「(未確定)」を付けます。",
    sample: "A型 RhD＋",
  },
  {
    group: "アレルギー・感染症",
    variable: "infections",
    label: "感染症(陽性)",
    expression: "%infections",
    description:
      "陽性の感染症を「、」区切りで並べます。手入力の登録と検査結果の両方から拾い、確認日を添えます。",
    sample: "HBs抗原(2026/08/12)、梅毒(2026/08/12)",
  },
  {
    group: "アレルギー・感染症",
    variable: "cautions",
    label: "診療上の注意",
    expression: "%cautions",
    description: "有効な診療上の注意を「、」区切りで並べます。コメントがあれば括弧で添えます。",
    sample: "転倒注意、造影剤禁忌(過去に蕁麻疹)",
  },

  // ---- 入院 ----
  {
    group: "入院",
    variable: "admissionDate",
    label: "入院日",
    expression: "%admissionDate",
    description: "入院中の入院日を YYYY-MM-DD で入れます。入院していなければ入りません。「日付」項目で使えます。",
    sample: "2026-09-25",
  },
  {
    group: "入院",
    variable: "admissionDateWareki",
    label: "入院日(和暦)",
    expression: "%admissionDateWareki",
    description: "入院中の入院日を和暦で入れます。入院していなければ入りません。",
    sample: "令和8年9月25日",
  },
  {
    group: "入院",
    variable: "hospitalDay",
    label: "入院日数",
    expression: "%hospitalDay",
    description: `入院日を 1 日目として、今日が何日目かを入れます。入院していなければ入りません。${NUMBER_NOTE}`,
    sample: "7",
  },
  {
    group: "入院",
    variable: "ward",
    label: "病棟・病室",
    expression: "%ward",
    description: "入院中の病棟と病室を入れます。入院していなければ入りません。",
    sample: "東3階病棟 301号室",
  },
  {
    group: "入院",
    variable: "admissionDepartment",
    label: "入院診療科",
    expression: "%admissionDepartment",
    description: "入院中の診療科を入れます。入院していなければ入りません。",
    sample: "消化器外科",
  },
  {
    group: "入院",
    variable: "attending",
    label: "主治医",
    expression: "%attending",
    description: "入院中の主治医の氏名を入れます。入院していなければ入りません。",
    sample: "児玉 義憲",
  },
  {
    group: "入院",
    variable: "admissionAnswers",
    label: "この入院の回答",
    expression: "%admissionAnswers.where(linkId = 'pu_present').value",
    description:
      "入院に結び付いた確定済みのテンプレート回答(看護プロファイルなど)の項目を、linkId ごとに最新の値で持ちます。linkId を書き換えて使います。選択肢はコードが入ります。",
    sample: "1",
  },

  // ---- 傷病名 ----
  {
    group: "傷病名",
    variable: "conditions",
    label: "傷病名(継続中・全区分)",
    expression: "%conditions",
    description:
      "転帰が「継続」の傷病名を、開始日の新しい順に「、」区切りで並べます。プロブレム・既往歴・保険病名の区別はしません。",
    sample: "2型糖尿病、高血圧症、脂質異常症",
  },
  {
    group: "傷病名",
    variable: "problems",
    label: "プロブレム(継続中)",
    expression: "%problems",
    description: `転帰が「継続」のプロブレムを、番号順に 1 行ずつ「#番号 病名」で並べます。${MULTILINE_NOTE}`,
    sample: "#1 2型糖尿病\n#2 高血圧症\n#3 S状結腸癌",
  },
  {
    group: "傷病名",
    variable: "diagnosisIcd10",
    label: "傷病名の ICD-10(継続中・確定)",
    expression: "%diagnosisIcd10",
    description:
      "転帰が「継続」で「の疑い」の付かない傷病名の ICD-10 コードの並びです。チェック項目の条件で「で始まる」と組み合わせ、病名の有無を判定するのに使います。",
    sample: "E119、I10、E785",
  },
  {
    group: "傷病名",
    variable: "pastHistory",
    label: "既往歴",
    expression: "%pastHistory",
    description: `既往歴に登録した病名を、開始日の新しい順に 1 行ずつ並べます(転帰は問いません)。開始日があれば添えます。${MULTILINE_NOTE}`,
    sample: "虫垂炎(2001/06/10)\n胃潰瘍(1998/03)",
  },

  {
    group: "傷病名",
    variable: "notifiableDiseaseName",
    label: "届出対象の感染症名",
    expression: "%notifiableDiseaseName",
    description:
      "届出基準の感染症名を入れます。対象プロブレムが届出対象の病名ならそれ、そうでなければ届出対象の病名のうち開始日が最も新しいものです。",
    sample: "腸管出血性大腸菌感染症",
  },
  {
    group: "傷病名",
    variable: "notifiableDiseaseClass",
    label: "感染症の類型",
    expression: "%notifiableDiseaseClass",
    description: "届出対象の感染症の類型(一類〜五類・新型インフルエンザ等)を入れます。",
    sample: "三類",
  },
  {
    group: "傷病名",
    variable: "notifiableDiseaseDeadline",
    label: "届出期限の区分",
    expression: "%notifiableDiseaseDeadline",
    description: "「直ちに」か「7 日以内」を入れます。",
    sample: "直ちに",
  },
  {
    group: "傷病名",
    variable: "notifiableDueDate",
    label: "届出期限",
    expression: "%notifiableDueDate",
    description: "診断日(病名の開始日)から数えた届出期限を YYYY-MM-DD で入れます。「日付」項目で使えます。",
    sample: "2026-10-25",
  },
  {
    group: "傷病名",
    variable: "notifiableDiagnosisDate",
    label: "届出対象の感染症の診断日",
    expression: "%notifiableDiagnosisDate",
    description: "届出対象の病名の開始日を YYYY-MM-DD で入れます。「日付」項目で使えます。",
    sample: "2026-10-24",
  },

  // ---- 腫瘍(対象の腫瘍。docs/cancer-registry-design.md §3) ----
  {
    group: "腫瘍",
    variable: "cancerName",
    label: "腫瘍の病名",
    expression: "%cancerName",
    description:
      "対象の腫瘍の病名を入れます。記入を始めたプロブレムが悪性腫瘍などの病名ならそれ、そうでなければそうした病名のうち開始日が最も新しいものです。",
    sample: "S状結腸癌",
  },
  {
    group: "腫瘍",
    variable: "cancerIcd10",
    label: "腫瘍の ICD-10",
    expression: "%cancerIcd10",
    description: "腫瘍の病名の ICD-10 をピリオド付きで入れます。",
    sample: "C18.7",
  },
  {
    group: "腫瘍",
    variable: "cancerTopography",
    label: "腫瘍の局在コード",
    expression: "%cancerTopography",
    description:
      "固形がん(C00〜C80)では ICD-10 の 4 桁と同じ ICD-O-3 の局在コードをピリオド無しで入れます。続発性・血液腫瘍・上皮内癌と 3 桁だけの ICD-10 では入りません。",
    sample: "C187",
  },
  {
    group: "腫瘍",
    variable: "cancerDiagnosisDate",
    label: "腫瘍の診断日",
    expression: "%cancerDiagnosisDate",
    description: "腫瘍の病名の開始日を YYYY-MM-DD で入れます。「日付」項目で使えます。",
    sample: "2026-08-15",
  },
  {
    group: "腫瘍",
    variable: "cancerSurgeryDate",
    label: "腫瘍の初回手術日",
    expression: "%cancerSurgeryDate",
    description: "腫瘍の診断日以後で最も早い手術の実施記録の入室日を YYYY-MM-DD で入れます。",
    sample: "2026-09-01",
  },
  {
    group: "腫瘍",
    variable: "cancerChemoStartDate",
    label: "腫瘍の化学療法の開始日",
    expression: "%cancerChemoStartDate",
    description: "腫瘍の診断日以後で最も早いレジメン適用の開始日(C1 Day1)を YYYY-MM-DD で入れます。",
    sample: "2026-09-22",
  },
  {
    group: "腫瘍",
    variable: "cancerRadiotherapyStartDate",
    label: "腫瘍の放射線治療の開始日",
    expression: "%cancerRadiotherapyStartDate",
    description: "腫瘍の診断日以後で最も早い照射の実施日(無ければコースの開始予定日)を YYYY-MM-DD で入れます。",
    sample: "2026-10-01",
  },
  {
    group: "腫瘍",
    variable: "cancerDiagnosisBasis",
    label: "診断根拠(院内がん登録のコード)",
    expression: "%cancerDiagnosisBasis",
    description: "確定した病理レポートがあれば組織診の「1」、細胞診だけなら「3」を入れます。無ければ入りません。",
    sample: "1",
  },

  // ---- 病理(最新の確定した病理レポート) ----
  {
    group: "病理",
    variable: "pathologyDiagnosis",
    label: "病理診断",
    expression: "%pathologyDiagnosis",
    description:
      "最新の確定した病理レポートの「診断」を入れます。診断がシノプティックレポート(テンプレート)なら、組織型・グレード・pTNM・病期の要約にします。",
    sample: "管状腺癌(tub) G2 pT3 pN1a pM0 IIIB 期",
  },
  {
    group: "病理",
    variable: "pathologyDate",
    label: "病理診断日",
    expression: "%pathologyDate",
    description: "最新の確定した病理レポートの日付を YYYY-MM-DD で入れます。",
    sample: "2026-08-20",
  },
  {
    group: "病理",
    variable: "pathologyHistologicType",
    label: "組織型",
    expression: "%pathologyHistologicType",
    description: "最新の確定した病理レポートの診断がシノプティックレポート(テンプレート)なら、その組織型を入れます。",
    sample: "管状腺癌(tub)",
  },
  {
    group: "病理",
    variable: "pathologyMorphology",
    label: "形態コード(院内がん登録のコード)",
    expression: "%pathologyMorphology",
    description:
      "シノプティックレポートの組織型の ICD-O-3 形態コードとグレードから、6 桁(細胞型 4 桁 + 性状 + 分化度)を入れます。グレードが無ければ分化度は 9。",
    sample: "821132",
  },
  {
    group: "病理",
    variable: "pathologyPT",
    label: "pT 分類(院内がん登録のコード)",
    expression: "%pathologyPT",
    description: "シノプティックレポートの pT を 4 桁のコードで入れます。術前治療後は 6620。",
    sample: "1300",
  },
  {
    group: "病理",
    variable: "pathologyPN",
    label: "pN 分類(院内がん登録のコード)",
    expression: "%pathologyPN",
    description: "シノプティックレポートの pN を 4 桁のコードで入れます。術前治療後は 6620。",
    sample: "2110",
  },
  {
    group: "病理",
    variable: "pathologyPM",
    label: "pM 分類(院内がん登録のコード)",
    expression: "%pathologyPM",
    description: "シノプティックレポートの pM を 4 桁のコードで入れます。術前治療後は 6620。",
    sample: "3000",
  },
  {
    group: "病理",
    variable: "pathologyPStage",
    label: "病期(院内がん登録のコード)",
    expression: "%pathologyPStage",
    description: "シノプティックレポートの pStage(術後病理学的病期)を 4 桁のコードで入れます。術前治療後は 6620。",
    sample: "4310",
  },
  {
    group: "病理",
    variable: "pathologyExtent",
    label: "進展度(院内がん登録のコード)",
    expression: "%pathologyExtent",
    description:
      "シノプティックレポートの pTNM から術後病理学的進展度のコードを機械的に読み替えます(遠隔転移 440 > 領域リンパ節転移 420 > 上皮内 400 > 隣接臓器浸潤 430 > 限局 410)。部位の規約と合わないことがあるので確かめて直します。",
    sample: "420",
  },

  // ---- 手術(対象の手術) ----
  {
    group: "手術",
    variable: "surgeryDate",
    label: "手術日",
    expression: "%surgeryDate",
    description:
      "対象の手術の入室日を YYYY-MM-DD で入れます。対象は記入を始めた手術(手術の一覧から開いたもの)、無ければ患者の最新の手術です。",
    sample: "2026-08-28",
  },
  {
    group: "手術",
    variable: "surgeryProcedureName",
    label: "主術式",
    expression: "%surgeryProcedureName",
    description: "実施した術式の 1 件目の名称を入れます。",
    sample: "腹腔鏡下胆嚢摘出術",
  },
  {
    group: "手術",
    variable: "surgeryProcedureCode",
    label: "主術式のコード",
    expression: "%surgeryProcedureCode",
    description: "主術式のレセ電算コード(K コード)を入れます。",
    sample: "K672-2",
  },
  {
    group: "手術",
    variable: "surgeryProcedures",
    label: "術式(すべて)",
    expression: "%surgeryProcedures",
    description: "実施した術式と麻酔の手技料をすべて「、」区切りで入れます。",
    sample: "腹腔鏡下胆嚢摘出術、閉鎖循環式全身麻酔",
  },
  {
    group: "手術",
    variable: "surgeryPriority",
    label: "手術の予定区分",
    expression: "%surgeryPriority",
    description: "申込の予定区分(予定 / 緊急など)を入れます。",
    sample: "予定",
  },
  {
    group: "手術",
    variable: "surgeryRequestDepartment",
    label: "手術の依頼科",
    expression: "%surgeryRequestDepartment",
    description: "申込の依頼科を入れます。",
    sample: "消化器外科",
  },
  {
    group: "手術",
    variable: "surgeryDepartment",
    label: "執刀科",
    expression: "%surgeryDepartment",
    description: "申込の執刀科を入れます。",
    sample: "消化器外科",
  },
  {
    group: "手術",
    variable: "surgeon",
    label: "執刀医",
    expression: "%surgeon",
    description: "実施記録の執刀医の氏名を入れます。複数なら「、」区切り。",
    sample: "児玉 義憲",
  },
  {
    group: "手術",
    variable: "surgeryAssistants",
    label: "助手",
    expression: "%surgeryAssistants",
    description: "実施記録の助手の氏名を入れます。",
    sample: "医師 一郎",
  },
  {
    group: "手術",
    variable: "anesthesiologist",
    label: "麻酔科医",
    expression: "%anesthesiologist",
    description: "実施記録の麻酔科医の氏名を入れます。",
    sample: "麻酔 花子",
  },
  {
    group: "手術",
    variable: "anesthesiaMethods",
    label: "麻酔方法",
    expression: "%anesthesiaMethods",
    description: "申込の麻酔方法を「、」区切りで入れます。",
    sample: "全身麻酔(吸入)、硬膜外麻酔",
  },
  {
    group: "手術",
    variable: "anesthesiaManagement",
    label: "麻酔管理",
    expression: "%anesthesiaManagement",
    description: "麻酔科管理 / 執刀医管理を入れます。",
    sample: "麻酔科管理",
  },
  {
    group: "手術",
    variable: "surgeryRoomMinutes",
    label: "在室時間(分)",
    expression: "%surgeryRoomMinutes",
    description: `入室から退室までの分を入れます。${NUMBER_NOTE}`,
    sample: "140",
  },
  {
    group: "手術",
    variable: "anesthesiaMinutes",
    label: "麻酔時間(分)",
    expression: "%anesthesiaMinutes",
    description: `麻酔開始から麻酔終了までの分を入れます。${NUMBER_NOTE}`,
    sample: "120",
  },
  {
    group: "手術",
    variable: "operationMinutes",
    label: "手術時間(分)",
    expression: "%operationMinutes",
    description: `執刀開始から執刀終了までの分を入れます。${NUMBER_NOTE}`,
    sample: "95",
  },
  {
    group: "手術",
    variable: "bloodLoss",
    label: "出血量(mL)",
    expression: "%bloodLoss",
    description: `実施記録の出血量を入れます。${NUMBER_NOTE}`,
    sample: "50",
  },
  {
    group: "手術",
    variable: "transfusionVolume",
    label: "輸血量(mL)",
    expression: "%transfusionVolume",
    description: `実施記録の輸血量を入れます。${NUMBER_NOTE}`,
    sample: "0",
  },
  {
    group: "手術",
    variable: "transfused",
    label: "輸血の有無",
    expression: "%transfused",
    description:
      "輸血量が 1 mL 以上なら true、実施記録があって無ければ false です。チェック項目の条件に使えます。選択肢のコードにするときは %transfused.select(iif($this, 'yes', 'no')) のように書きます。",
    sample: "false",
  },
  {
    group: "手術",
    variable: "woundClass",
    label: "創分類",
    expression: "%woundClass",
    description: "実施記録の創分類(清潔 / 準清潔 / 汚染 / 感染・不潔)を入れます。",
    sample: "準清潔",
  },
  {
    group: "手術",
    variable: "surgeryComplication",
    label: "術中の合併症(自由記載)",
    expression: "%surgeryComplication",
    description: "実施記録の合併症の記載を入れます。",
    sample: "なし",
  },
  {
    group: "手術",
    variable: "surgeryOutcome",
    label: "手術の転帰",
    expression: "%surgeryOutcome",
    description: "実施記録の転帰(良好 / 合併症あり / 死亡)を入れます。",
    sample: "良好",
  },
  {
    group: "手術",
    variable: "surgeryAdmissionDate",
    label: "手術の入院日",
    expression: "%surgeryAdmissionDate",
    description: "手術日を含む入院の入院日を YYYY-MM-DD で入れます。",
    sample: "2026-08-27",
  },
  {
    group: "手術",
    variable: "surgeryDischargeDate",
    label: "手術の退院日",
    expression: "%surgeryDischargeDate",
    description: "手術日を含む入院の退院日を YYYY-MM-DD で入れます。入院中なら入りません。",
    sample: "2026-09-03",
  },
  {
    group: "手術",
    variable: "postoperativeDays",
    label: "術後在院日数",
    expression: "%postoperativeDays",
    description: `手術日から退院日までの日数を入れます。退院していなければ入りません。${NUMBER_NOTE}`,
    sample: "6",
  },
  {
    group: "手術",
    variable: "surgeryToDeathDays",
    label: "手術から死亡までの日数",
    expression: "%surgeryToDeathDays",
    description: `手術日から死亡日までの日数を入れます。死亡していなければ入りません。術後 30 日以内の死亡は %surgeryToDeathDays <= 30 で判定します。${NUMBER_NOTE}`,
    sample: "12",
  },

  // ---- 口腔診査(最新の口腔状態スナップショット) ----
  {
    group: "口腔診査",
    variable: "oralExamDate",
    label: "口腔診査日",
    expression: "%oralExamDate",
    description: "最新の口腔診査の診査日を YYYY-MM-DD で入れます。診査が無ければ入りません。「日付」項目で使えます。",
    sample: "2026-10-17",
  },
  {
    group: "口腔診査",
    variable: "oralPresentTeeth",
    label: "現在歯数",
    expression: "%oralPresentTeeth",
    description: `最新の口腔診査の現在歯の本数を入れます。歯ごとに最初の併存グループで数え、過剰歯は数えません。${NUMBER_NOTE}`,
    sample: "28",
  },
  {
    group: "口腔診査",
    variable: "oralCariesTeeth",
    label: "未処置歯数",
    expression: "%oralCariesTeeth",
    description: `最新の口腔診査で基本状態が未処置歯(むし歯・治療中)の本数を入れます。チェック項目の条件で「より大きい 0」にすると、むし歯の有無になります。${NUMBER_NOTE}`,
    sample: "2",
  },
  {
    group: "口腔診査",
    variable: "oralTreatedTeeth",
    label: "処置歯数",
    expression: "%oralTreatedTeeth",
    description: `最新の口腔診査の処置歯の本数を入れます。${NUMBER_NOTE}`,
    sample: "8",
  },
  {
    group: "口腔診査",
    variable: "oralMissingTeeth",
    label: "喪失歯数",
    expression: "%oralMissingTeeth",
    description: `最新の口腔診査の欠損歯(喪失・欠損補綴・インプラント)の本数を入れます。${NUMBER_NOTE}`,
    sample: "4",
  },
  {
    group: "口腔診査",
    variable: "oralCariesTeethList",
    label: "未処置歯の部位",
    expression: "%oralCariesTeethList",
    description: "最新の口腔診査の未処置歯を「右上7」のような歯の名前で「、」区切りで並べます。",
    sample: "右上2、左上6、左上7",
  },
  {
    group: "口腔診査",
    variable: "oralExamSummary",
    label: "歯数のまとめ",
    expression: "%oralExamSummary",
    description: "最新の口腔診査の現在歯・未処置歯・処置歯・喪失歯の本数を 1 行にまとめます。",
    sample: "現在歯28本(未処置歯2本・処置歯8本)、喪失歯4本",
  },
  {
    group: "口腔診査",
    variable: "oralExamNote",
    label: "口腔診査の所見・特記事項",
    expression: "%oralExamNote",
    description: `最新の口腔診査の口腔全体「所見・特記事項」の自由記載を 1 行ずつ並べます。${MULTILINE_NOTE}`,
    sample: "下顎前歯部に歯石沈着\n左下臼歯部に骨瘤",
  },
  {
    group: "口腔診査",
    variable: "oralTeeth",
    label: "歯ごとの健診記号(右上8)",
    expression: "%oralTeeth.where(tooth = '右上8').symbol",
    description:
      "最新の口腔診査のその歯の歯科健診記号(／ C ○ △ (△) シ サ CO ×)を入れます。歯の名前は右上8〜1・左上1〜8・右下8〜1・左下1〜8、乳歯は右上A〜E などに書き換えます。末尾を .abbr にすると内容の略号(C2・FMC など)、.basic にすると基本状態のコードになります。様式の歯式図の歯ごとに置くと図に記号が入ります。",
    sample: "C",
  },
  {
    group: "口腔診査",
    variable: "oralExamChart",
    label: "口腔診査の歯式図(画像)",
    expression: "%oralExamChart",
    description:
      "最新の口腔診査の歯式図を画像(PNG)にして入れます。様式の「画像」項目で使い、紙面の歯式図の欄に塗りつぶしで重ねます。紙の歯式図と同じアーチ状(患者の右が左、乳歯は内側)で、歯の色・歯面・健診記号・略号・ブリッジ・義歯の線は画面の歯式図と同じです。Word / Excel では使えません。",
    sample: "(画像)",
  },

  // ---- 処方・検査 ----
  {
    group: "処方・検査",
    variable: "activeMedications",
    label: "投与中の処方薬",
    expression: "%activeMedications",
    description: `今日の時点で投与期間中の処方の薬剤を、1 行ずつ投与終了日を添えて並べます。中止した処方と注射は含みません。${MULTILINE_NOTE}`,
    sample: "メトホルミン塩酸塩錠250mg(〜2026/10/18)\nアムロジピン錠5mg(〜2026/10/18)",
  },
  {
    group: "処方・検査",
    variable: "prescriptions",
    label: "最新の処方",
    expression: "%prescriptions",
    description: `最新の処方 1 件(処方日が最も新しいもの)を Rp ごとに、薬品・用量と用法・日数の順で並べます。注射は含みません。${MULTILINE_NOTE}`,
    sample:
      "【処方 2026/09/20】\nRp1\n　メトホルミン塩酸塩錠250mg 2錠\n　用法: 1日2回朝夕食後 28日分\nRp2\n　アムロジピン錠5mg 1錠\n　用法: 1日1回朝食後 28日分",
  },
  {
    group: "処方・検査",
    variable: "labResults",
    label: "最新の検査結果",
    expression: "%labResults",
    description: `最新の検体検査結果 1 件(検査日が最も新しいもの)の全項目を、項目ごとに 1 行で並べます。基準値外は (H)/(L) が付きます。${MULTILINE_NOTE}`,
    sample: "【検査結果 2026/09/05】\nAST: 32 U/L\nALT: 48 U/L (H)\nHbA1c: 7.2 % (H)\n血糖: 142 mg/dL (H)",
  },
  {
    group: "処方・検査",
    variable: "labs",
    label: "検査項目の最新値",
    expression: labExpression("160010010", "value"),
    parameterized: "lab",
    description:
      "結果項目を選んで、その項目の最新の結果 1 件から値・単位・採取日・値と単位・判定のどれかを入れます。値が数値になるのは数値型(PQ)の項目だけで、コード型・文字列型は表示の文字列になります。結果項目マスタの施設コードで引くので、施設コードを持たない旧い結果は対象外です。",
    sample: "7.2",
  },

  // ---- 自院 ----
  {
    group: "自院",
    variable: "facilityName",
    label: "医療機関名",
    expression: "%facilityName",
    description: "施設設定の自院の名称を入れます。",
    sample: "テスト病院",
  },
  {
    group: "自院",
    variable: "facilityPostalCode",
    label: "医療機関郵便番号",
    expression: "%facilityPostalCode",
    description: "自院の郵便番号を入れます。",
    sample: "100-0001",
  },
  {
    group: "自院",
    variable: "facilityAddress",
    label: "医療機関住所",
    expression: "%facilityAddress",
    description: "自院の住所を入れます。",
    sample: "東京都千代田区千代田1-1",
  },
  {
    group: "自院",
    variable: "facilityPhone",
    label: "医療機関電話番号",
    expression: "%facilityPhone",
    description: "自院の電話番号を入れます。",
    sample: "03-1234-5678",
  },
  {
    group: "自院",
    variable: "facilityFax",
    label: "医療機関FAX",
    expression: "%facilityFax",
    description: "自院の FAX 番号を入れます。",
    sample: "03-1234-5679",
  },
  {
    group: "自院",
    variable: "facilityInstitutionNumber",
    label: "保険医療機関番号",
    expression: "%facilityInstitutionNumber",
    description: "自院の保険医療機関番号を入れます。",
    sample: "1310000001",
  },

  // ---- 記入 ----
  {
    group: "記入",
    variable: "authorName",
    label: "作成者氏名",
    expression: "%authorName",
    description: "ログイン中の医療従事者の漢字氏名を「姓 名」で入れます。",
    sample: "児玉 義憲",
  },
  {
    group: "記入",
    variable: "authorKana",
    label: "作成者氏名(カナ)",
    expression: "%authorKana",
    description: "ログイン中の医療従事者のカナ氏名を「姓 名」で入れます。",
    sample: "コダマ ヨシノリ",
  },
  {
    group: "記入",
    variable: "authorRole",
    label: "作成者職種",
    expression: "%authorRole",
    description: "ログイン中の医療従事者の職種を入れます。",
    sample: "医師",
  },
  {
    group: "記入",
    variable: "authorDepartment",
    label: "作成者診療科",
    expression: "%authorDepartment",
    description: "ログイン中の医療従事者の診療科(既定の診療科)を入れます。",
    sample: "消化器外科",
  },
  {
    group: "記入",
    variable: "responseSequence",
    label: "記入回数",
    expression: "%responseSequence",
    description: `このテンプレートでこの患者に記入するのが何回目かを入れます(記入済みの件数 + 1。取り消したものは数えません)。Word / Excel の文書では入りません。${NUMBER_NOTE}`,
    sample: "3",
  },
];

const slashDate = (date: string) => date.replaceAll("-", "/");

// 転帰「継続」(clinicalStatus: active)の傷病名を「、」区切りで並べる。
// 絞り込みは取得時の clinical-status=active 検索で済んでいる。
export function formatConditions(conditions: fhir4.Condition[]): string {
  return conditions
    .map((c) => summarizeCondition(c).name)
    .filter(Boolean)
    .join("、");
}

// 継続中のプロブレムを番号順に「#1 病名」で 1 行ずつ。番号の無いものは後ろに回す。
export function formatProblems(conditions: fhir4.Condition[]): string {
  return conditions
    .filter((c) => conditionCategoryOf(c) === "problem" && isActiveCondition(c))
    .map((c) => summarizeCondition(c))
    .filter((s) => s.name)
    .sort((a, b) => (a.problemNumber ?? Infinity) - (b.problemNumber ?? Infinity))
    .map((s) => (s.problemNumber === undefined ? s.name : `#${s.problemNumber} ${s.name}`))
    .join("\n");
}

// 継続中の確定病名の ICD-10(重複なし)。「の疑い」は verificationStatus が provisional。
export function diagnosisIcd10Codes(conditions: fhir4.Condition[]): string[] {
  const codes = conditions
    .filter((c) => c.verificationStatus?.coding?.[0]?.code !== "provisional")
    .map((c) => codingBySystem(c.code?.coding, ICD10_SYSTEM)?.code ?? "")
    .filter(Boolean);
  return [...new Set(codes)];
}

// 既往歴を(取得時の開始日の新しい順のまま)1 行ずつ。開始日があれば添える。
export function formatPastHistory(conditions: fhir4.Condition[]): string {
  return conditions
    .filter((c) => conditionCategoryOf(c) === "past")
    .map((c) => summarizeCondition(c))
    .filter((s) => s.name)
    .map((s) => (s.startDate ? `${s.name}(${slashDate(s.startDate)})` : s.name))
    .join("\n");
}

// 最新の検査結果 1 件を「採取日 + 項目ごとの値(単位・H/L)」の複数行テキストにする。
export function formatLabResults(labDetail: fhir4.Bundle | undefined): string {
  if (!labDetail) return "";
  const { report, observations, specimens } = splitLabResultDetailBundle(labDetail);
  if (!report || observations.length === 0) return "";

  const names = specimenNamesById(specimens);
  const date = report.effectiveDateTime?.slice(0, 10)?.replaceAll("-", "/") ?? "";
  const lines = observations.map((obs) => {
    const line = observationLineDisplay(obs, names);
    const value = [line.value, line.unit].filter(Boolean).join(" ");
    const flag = line.interpretation ? ` (${line.interpretation})` : "";
    return `${line.name}: ${value}${flag}`;
  });
  return [date ? `【検査結果 ${date}】` : "【検査結果】", ...lines].join("\n");
}

// 最新の処方 1 件を「処方日 + Rp ごとの薬品・用法」の複数行テキストにする。
// 紙の処方箋と同じく、Rp 見出し → 薬品 → 最後に用法(投与量・コメント)の順で並べる。
export function formatPrescriptions(prescriptionDetail: fhir4.Bundle | undefined): string {
  if (!prescriptionDetail) return "";
  const { serviceRequest, medicationRequests } = splitPrescriptionDetailBundle(prescriptionDetail);
  if (!serviceRequest || medicationRequests.length === 0) return "";

  const date = summarizeServiceRequest(serviceRequest).date.replaceAll("-", "/");
  return [date ? `【処方 ${date}】` : "【処方】", ...prescriptionRpLines(medicationRequests)].join("\n");
}

/** 処方 1 件の Rp ごとの行(Rp 見出し → 薬品 → 用法・調剤指示)。文書への転記でも使う。 */
export function prescriptionRpLines(medicationRequests: fhir4.MedicationRequest[]): string[] {
  const lines: string[] = [];
  for (const rp of groupByRp(medicationRequests)) {
    lines.push(`Rp${rp.rpNumber}`);
    for (const medicine of rp.medicines) {
      const dose =
        medicine.dose !== undefined ? ` ${medicine.dose}${medicine.unit ?? ""}` : "";
      const uneven = medicine.unevenLabel ? `（${medicine.unevenLabel}）` : "";
      const comment = medicine.comment ? `（${medicine.comment}）` : "";
      lines.push(`　${medicine.name}${dose}${uneven}${comment}`);
    }
    const amount =
      rp.doseDays !== undefined
        ? `${rp.doseDays}日分`
        : rp.doseCount !== undefined
          ? `${rp.doseCount}回分`
          : "";
    const usage = [rp.usageName, rp.supplementLabel, amount].filter(Boolean).join(" ");
    const usageComment = rp.usageComment ? `（${rp.usageComment}）` : "";
    if (usage || usageComment) lines.push(`　用法: ${usage}${usageComment}`);
    if (rp.dispenseInstructionLabel) lines.push(`　調剤指示: ${rp.dispenseInstructionLabel}`);
  }
  return lines;
}

// 投与中の処方薬を 1 行ずつ。同じ薬が複数の処方にあれば、投与終了日の遅い方だけ残す。
export function formatActiveMedications(medications: ActiveMedication[]): string {
  const latestEnd = new Map<string, string>();
  for (const medication of medications) {
    if (medication.brought) continue;
    const current = latestEnd.get(medication.name);
    if (current === undefined || medication.endDate > current) {
      latestEnd.set(medication.name, medication.endDate);
    }
  }
  return [...latestEnd]
    .map(([name, endDate]) => (endDate ? `${name}(〜${slashDate(endDate)})` : name))
    .join("\n");
}

export function formatAllergies(allergies: fhir4.AllergyIntolerance[]): string {
  return allergies
    .map((allergy) => summarizeAllergy(allergy))
    .filter((s) => s.name)
    .map((s) => {
      const detail = [s.categoryLabel, s.reaction].filter(Boolean).join("・");
      return detail ? `${s.name}(${detail})` : s.name;
    })
    .join("、");
}

export function formatBloodType(observations: fhir4.Observation[]): string {
  const summary = summarizeBloodType(observations);
  if (!summary) return "";
  const label = bloodTypeLabel(summary.abo, summary.rhd);
  if (!label) return "";
  return summary.tested ? label : `${label}(未確定)`;
}

export function formatInfections(rows: InfectionRow[]): string {
  return rows
    .filter((row) => row.result === "positive")
    .map((row) =>
      row.effectiveDate ? `${row.typeLabel}(${slashDate(row.effectiveDate)})` : row.typeLabel,
    )
    .join("、");
}

export function formatCautions(
  flags: fhir4.Flag[],
  cautionsByCode: Map<string, PatientCaution>,
): string {
  return flags
    .map((flag) => summarizeFlag(flag, cautionsByCode))
    .filter((s) => s.name)
    .map((s) => (s.text && s.text !== s.name ? `${s.name}(${s.text})` : s.name))
    .join("、");
}

function loincCodeOf(observation: fhir4.Observation): string {
  return observation.code?.coding?.find((c) => c.system === LOINC_SYSTEM)?.code ?? "";
}

// 直近の測定 1 回ぶん(新しい順の先頭の束)を 1 行にする。
export function formatVitals(vitals: fhir4.Observation[]): string {
  const latest = groupVitalEntries(vitals).sort((a, b) =>
    b.effectiveDateTime.localeCompare(a.effectiveDateTime),
  )[0];
  if (!latest) return "";
  const rows = vitalDisplayRows(latest).map((row) => `${row.label} ${row.value}`);
  if (rows.length === 0) return "";
  const at = latest.effectiveDateTime ? slashDate(dateTimeLabel(latest.effectiveDateTime)) : "";
  return `${at ? `【バイタル ${at}】` : "【バイタル】"}${rows.join(" / ")}`;
}

// 項目ごとの最新値。取得は新しい順なので、コードごとに最初に見つかった値を採る。
function latestVitalValues(vitals: fhir4.Observation[]): Record<string, number | undefined> {
  const firstOf = (code: string) => vitals.find((o) => loincCodeOf(o) === code);
  const quantity = (code: string) => firstOf(code)?.valueQuantity?.value;
  const measure = (key: string) => {
    const code = VITAL_MEASURES.find((m) => m.key === key)?.code;
    return code ? quantity(code) : undefined;
  };
  const bp = firstOf(BLOOD_PRESSURE.code);
  const bpComponent = (code: string) =>
    bp?.component?.find((c) => c.code?.coding?.some((coding) => coding.code === code))
      ?.valueQuantity?.value;

  return {
    temperature: measure("temperature"),
    pulse: measure("pulse"),
    spo2: measure("spo2"),
    respiratoryRate: measure("respiration"),
    systolicBP: bpComponent(SYSTOLIC.code),
    diastolicBP: bpComponent(DIASTOLIC.code),
  };
}

// 入院していなくても変数名は必ず置く(環境に無い変数を参照すると FHIRPath が例外を投げる)。
function admissionValues(
  admission: PopulateSources["admission"],
  today: string,
): Record<string, string | number | undefined> {
  if (!admission) {
    return {
      admissionDate: "",
      admissionDateWareki: "",
      hospitalDay: undefined,
      ward: "",
      attending: "",
      admissionDepartment: "",
    };
  }
  const { encounter, wardName, roomName } = admission;
  const admissionDate = encounterAdmissionDate(encounter);
  const hasDate = admissionDate !== "-";
  const attending = encounterAttendingName(encounter);
  const department = encounterDepartmentName(encounter);
  return {
    admissionDate: hasDate ? admissionDate : "",
    admissionDateWareki: hasDate ? toWareki(admissionDate) : "",
    hospitalDay: hasDate ? diffDays(admissionDate, today) + 1 : undefined,
    ward: [wardName, roomName].filter(Boolean).join(" "),
    attending: attending === "-" ? "" : attending,
    admissionDepartment: department === "-" ? "" : department,
  };
}

/**
 * 入院に結び付いた回答の項目を { linkId, value } に平らにする。linkId ごとに記入日時の新しい回答の最初の値を採る
 * (選択肢はコード)。上流の型情報が無い値でも式から .value で読めるよう、値は素の値にしておく。
 */
export function admissionAnswerValues(
  responses: fhir4.QuestionnaireResponse[] | undefined,
): { linkId: string; value: string | number | boolean }[] {
  const rows = new Map<string, string | number | boolean>();
  const sorted = [...(responses ?? [])].sort((a, b) => (b.authored ?? "").localeCompare(a.authored ?? ""));
  const walk = (items: fhir4.QuestionnaireResponseItem[] | undefined) => {
    for (const item of items ?? []) {
      const answer = item.answer?.[0];
      const value =
        answer?.valueCoding?.code ??
        answer?.valueString ??
        answer?.valueDate ??
        answer?.valueDateTime ??
        answer?.valueInteger ??
        answer?.valueDecimal ??
        answer?.valueBoolean ??
        answer?.valueQuantity?.value;
      if (value !== undefined && value !== "" && !rows.has(item.linkId)) rows.set(item.linkId, value);
      walk(item.item);
      for (const a of item.answer ?? []) walk(a.item);
    }
  };
  for (const response of sorted) walk(response.item);
  return [...rows].map(([linkId, value]) => ({ linkId, value }));
}

function facilityValues(facility: PopulateSources["facility"]): Record<string, string> {
  const values = facility ? parseOrganization(facility) : undefined;
  return {
    facilityName: values?.name ?? "",
    facilityPostalCode: values?.postalCode ?? "",
    facilityAddress: values?.addressText ?? "",
    facilityPhone: values?.phone ?? "",
    facilityFax: values?.fax ?? "",
    facilityInstitutionNumber: values?.institutionNumber ?? "",
  };
}

function authorValues(author: PopulateSources["author"]): Record<string, string> {
  if (!author) return { authorName: "", authorKana: "", authorRole: "", authorDepartment: "" };
  const { practitioner, roles } = author;
  const role = baseRoleOf(roles);
  return {
    authorName: practitionerFieldValue(practitioner, role, "name"),
    authorKana: practitionerFieldValue(practitioner, role, "kana"),
    authorRole: practitionerFieldValue(practitioner, role, "role"),
    authorDepartment: parseDepartmentRoles(roles)[0]?.name ?? "",
  };
}

// initialExpression / calculatedExpression の評価環境(%変数名 → 値)を組み立てる。
// 値の無い変数は undefined にする(式は空を返し、項目は空欄のまま)。
export function buildPopulateContext(sources: PopulateSources): Record<string, unknown> {
  const { patient, today } = sources;
  const body = summarizeBodyMeasures(sources.bodyMeasures);
  const age = patient.birthDate ? calculateAge(patient.birthDate, new Date(`${today}T00:00:00`)) : undefined;
  const gender = genderLabel(patient.gender);

  return {
    patient,
    patientNumber: patientNumberOf(patient) ?? "",
    age,
    gender: gender === "-" ? "" : gender,
    today,
    todayWareki: toWareki(today),
    birthDateWareki: toWareki(patient.birthDate),
    bodyHeight: body.height?.value,
    bodyWeight: body.weight?.value,
    bmi: body.bmi ?? undefined,
    vitals: formatVitals(sources.vitals),
    ...latestVitalValues(sources.vitals),
    allergies: formatAllergies(sources.allergies),
    bloodType: formatBloodType(sources.bloodType),
    infections: formatInfections(sources.infections),
    cautions: formatCautions(sources.flags, sources.cautionsByCode),
    ...admissionValues(sources.admission, today),
    conditions: formatConditions(sources.conditions),
    problems: formatProblems(sources.conditions),
    diagnosisIcd10: diagnosisIcd10Codes(sources.conditions),
    pastHistory: formatPastHistory(sources.allConditions),
    activeMedications: formatActiveMedications(sources.activeMedications),
    labResults: formatLabResults(sources.labDetail),
    labs: sources.labs,
    prescriptions: formatPrescriptions(sources.prescriptionDetail),
    ...facilityValues(sources.facility),
    ...authorValues(sources.author),
    prefectureCode: prefectureCodeOf(patient.address?.[0]?.state),
    deathDate: patient.deceasedDateTime?.slice(0, 10) ?? "",
    lastVisitDate: sources.lastEncounter?.period?.start?.slice(0, 10) ?? "",
    responseSequence: sources.responseCount === undefined ? undefined : sources.responseCount + 1,
    admissionAnswers: admissionAnswerValues(sources.admissionResponses),
    ...cancerPopulateValues(sources.allConditions, sources.focusConditionId, sources.cancer),
    ...infectiousDiseaseValues(sources.allConditions, sources.focusConditionId),
    ...surgeryPopulateValues(patient, sources.surgery),
    ...oralExamPopulateValues(sources.oralExam),
  };
}
