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

// 最新の処方 1 件を「処方日 + Rp ごとの用法・薬品」の複数行テキストにする。
export function formatPrescriptions(prescriptionDetail: fhir4.Bundle | undefined): string {
  if (!prescriptionDetail) return "";
  const { serviceRequest, medicationRequests } = splitPrescriptionDetailBundle(prescriptionDetail);
  if (!serviceRequest || medicationRequests.length === 0) return "";

  const date = summarizeServiceRequest(serviceRequest).date.replaceAll("-", "/");
  const lines: string[] = [date ? `【処方 ${date}】` : "【処方】"];
  for (const rp of groupByRp(medicationRequests)) {
    const amount =
      rp.doseDays !== undefined
        ? `${rp.doseDays}日分`
        : rp.doseCount !== undefined
          ? `${rp.doseCount}回分`
          : "";
    const usage = [rp.usageName, amount].filter(Boolean).join(" ");
    lines.push(`Rp${rp.rpNumber}${usage ? ` ${usage}` : ""}`);
    for (const medicine of rp.medicines) {
      const dose =
        medicine.dose !== undefined ? ` ${medicine.dose}${medicine.unit ?? ""}` : "";
      lines.push(`・${medicine.name}${dose}`);
    }
  }
  return lines.join("\n");
}

// initialExpression / calculatedExpression の評価環境(%変数名 → 値)を組み立てる。
export function buildPopulateContext(sources: PopulateSources): Record<string, unknown> {
  return {
    patient: sources.patient,
    conditions: formatConditions(sources.conditions),
    labResults: formatLabResults(sources.labDetail),
    prescriptions: formatPrescriptions(sources.prescriptionDetail),
  };
}
