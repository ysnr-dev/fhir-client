// テンプレート回答フォームの初期値式(initialExpression)・計算式から参照できる
// 実行時コンテキスト(%変数)の組み立て。
//
// 患者の FHIR リソースをフォーム入力向けの整形済みテキストへ変換して提供する。
// テンプレート側は初期値式に「%conditions」のように変数参照を書くだけでよい
// (FHIRPath としても妥当な式なので、jsp-7 の枠組みのまま扱える)。
//
// 提供する変数:
//   %patient       Patient リソースそのもの(例: %patient.address.first().text)
//   %conditions    転帰が「継続」の傷病名を「、」区切りで並べたテキスト
//   %labResults    最新の検査結果(DiagnosticReport)1件の項目・値の一覧テキスト
//   %prescriptions 最新の処方(ServiceRequest)1件の Rp・薬品の一覧テキスト
import { summarizeCondition } from "./conditionHelpers";
import {
  observationLineDisplay,
  specimenNamesById,
  splitLabResultDetailBundle,
} from "./labResultHelpers";
import { groupByRp, splitPrescriptionDetailBundle, summarizeServiceRequest } from "./prescriptionHelpers";

export interface PopulateSources {
  patient: fhir4.Patient;
  /** 患者のアクティブな Condition(clinical-status=active で検索済み) */
  conditions: fhir4.Condition[];
  /** 最新の検査結果の詳細 Bundle(_include 付き検索の結果)。なければ undefined */
  labDetail?: fhir4.Bundle;
  /** 最新の処方の詳細 Bundle(_revinclude 付き検索の結果)。なければ undefined */
  prescriptionDetail?: fhir4.Bundle;
}

// 転帰「継続」(clinicalStatus: active)の傷病名を「、」区切りで並べる。
// 絞り込みは取得時の clinical-status=active 検索で済んでいる。
export function formatConditions(conditions: fhir4.Condition[]): string {
  return conditions
    .map((c) => summarizeCondition(c).name)
    .filter(Boolean)
    .join("、");
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

// テンプレート編集画面で初期値式として選べる式の一覧(変数選択モーダル)。
// %patient は Patient リソースそのものなので、よく使う値の取り出し方を式ごと並べる。
export interface PopulateExpressionOption {
  /** 変数名(%なし)。モーダルの左の一覧をこれでまとめる。 */
  variable: string;
  label: string;
  expression: string;
  description: string;
  sample: string;
}

const NAME_EXPRESSION = (representation: string) =>
  `%patient.name.where(extension.value = '${representation}').select(family + ' ' + given.first()).first()`;

export const POPULATE_EXPRESSION_OPTIONS: PopulateExpressionOption[] = [
  {
    variable: "conditions",
    label: "傷病名(継続中)",
    expression: "%conditions",
    description:
      "転帰が「継続」の傷病名を、開始日の新しい順に「、」区切りで並べます。プロブレム・既往歴・保険病名の区別はしません。",
    sample: "2型糖尿病、高血圧症、脂質異常症",
  },
  {
    variable: "labResults",
    label: "最新の検査結果",
    expression: "%labResults",
    description:
      "最新の検体検査結果 1 件(検査日が最も新しいもの)の全項目を、項目ごとに 1 行で並べます。基準値外は (H)/(L) が付きます。複数行になるので「テキスト」項目で使います。",
    sample: "【検査結果 2026/09/05】\nAST: 32 U/L\nALT: 48 U/L (H)\nHbA1c: 7.2 % (H)\n血糖: 142 mg/dL (H)",
  },
  {
    variable: "prescriptions",
    label: "最新の処方",
    expression: "%prescriptions",
    description:
      "最新の処方 1 件(処方日が最も新しいもの)を Rp ごとに、薬品・用量と用法・日数の順で並べます。注射は含みません。複数行になるので「テキスト」項目で使います。",
    sample:
      "【処方 2026/09/20】\nRp1\n　メトホルミン塩酸塩錠250mg 2錠\n　用法: 1日2回朝夕食後 28日分\nRp2\n　アムロジピン錠5mg 1錠\n　用法: 1日1回朝食後 28日分",
  },
  {
    variable: "patient",
    label: "患者氏名(漢字)",
    expression: NAME_EXPRESSION("IDE"),
    description: "患者の漢字氏名を「姓 名」で入れます。",
    sample: "大腸 太郎",
  },
  {
    variable: "patient",
    label: "患者氏名(カナ)",
    expression: NAME_EXPRESSION("SYL"),
    description: "患者のカナ氏名を「姓 名」で入れます。",
    sample: "ダイチョウ タロウ",
  },
  {
    variable: "patient",
    label: "生年月日",
    expression: "%patient.birthDate",
    description: "患者の生年月日を YYYY-MM-DD で入れます。「日付」項目で使えます。",
    sample: "1958-04-12",
  },
  {
    variable: "patient",
    label: "住所",
    expression: "%patient.address.first().text",
    description: "患者情報に登録した住所(1 件目)を入れます。",
    sample: "東京都千代田区千代田1-1",
  },
  {
    variable: "patient",
    label: "電話番号",
    expression: "%patient.telecom.where(system = 'phone').value.first()",
    description: "患者情報に登録した電話番号(1 件目)を入れます。",
    sample: "03-1234-5678",
  },
];

// initialExpression / calculatedExpression の評価環境(%変数名 → 値)を組み立てる。
export function buildPopulateContext(sources: PopulateSources): Record<string, unknown> {
  return {
    patient: sources.patient,
    conditions: formatConditions(sources.conditions),
    labResults: formatLabResults(sources.labDetail),
    prescriptions: formatPrescriptions(sources.prescriptionDetail),
  };
}
