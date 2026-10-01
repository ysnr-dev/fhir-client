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
import { dateTimeLabel, diffDays } from "../lib/dates";
import { summarizeAllergy } from "./allergyHelpers";
import { summarizeBodyMeasures } from "./bodyMeasureHelpers";
import { bloodTypeLabel } from "./transfusionOrderHelpers";
import { summarizeBloodType } from "./bloodTypeHelpers";
import { conditionCategoryOf, isActiveCondition, summarizeCondition } from "./conditionHelpers";
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
import { calculateAge, genderLabel, patientNumberOf } from "./patientHelpers";
import { groupByRp, splitPrescriptionDetailBundle, summarizeServiceRequest } from "./prescriptionHelpers";
import {
  BLOOD_PRESSURE,
  DIASTOLIC,
  LOINC_SYSTEM,
  SYSTOLIC,
  VITAL_MEASURES,
  groupVitalEntries,
  vitalDisplayRows,
} from "./vitalHelpers";

export interface PopulateSources {
  patient: fhir4.Patient;
  /** 今日(YYYY-MM-DD)。年齢・病日・投与中の判定の基準日。 */
  today: string;
  /** 患者のアクティブな Condition(clinical-status=active で検索済み) */
  conditions: fhir4.Condition[];
  /** 患者の Condition 全件(転帰を問わない)。既往歴の一覧に使う。 */
  allConditions: fhir4.Condition[];
  /** 最新の検査結果の詳細 Bundle(_include 付き検索の結果)。なければ undefined */
  labDetail?: fhir4.Bundle;
  /** 最新の処方の詳細 Bundle(_revinclude 付き検索の結果)。なければ undefined */
  prescriptionDetail?: fhir4.Bundle;
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
    variable: "today",
    label: "今日の日付",
    expression: "%today",
    description: "記入を始めた日の日付を YYYY-MM-DD で入れます。「日付」項目で使えます。",
    sample: "2026-10-01",
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
    variable: "pastHistory",
    label: "既往歴",
    expression: "%pastHistory",
    description: `既往歴に登録した病名を、開始日の新しい順に 1 行ずつ並べます(転帰は問いません)。開始日があれば添えます。${MULTILINE_NOTE}`,
    sample: "虫垂炎(2001/06/10)\n胃潰瘍(1998/03)",
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
  const lines: string[] = [date ? `【処方 ${date}】` : "【処方】"];
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
  }
  return lines.join("\n");
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
    return { admissionDate: "", hospitalDay: undefined, ward: "", attending: "", admissionDepartment: "" };
  }
  const { encounter, wardName, roomName } = admission;
  const admissionDate = encounterAdmissionDate(encounter);
  const hasDate = admissionDate !== "-";
  const attending = encounterAttendingName(encounter);
  const department = encounterDepartmentName(encounter);
  return {
    admissionDate: hasDate ? admissionDate : "",
    hospitalDay: hasDate ? diffDays(admissionDate, today) + 1 : undefined,
    ward: [wardName, roomName].filter(Boolean).join(" "),
    attending: attending === "-" ? "" : attending,
    admissionDepartment: department === "-" ? "" : department,
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
    pastHistory: formatPastHistory(sources.allConditions),
    activeMedications: formatActiveMedications(sources.activeMedications),
    labResults: formatLabResults(sources.labDetail),
    prescriptions: formatPrescriptions(sources.prescriptionDetail),
  };
}
