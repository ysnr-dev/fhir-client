import { useAllergy } from "../api/queries";
import { summarizeAllergy } from "../fhir/allergyHelpers";
import { isPatientMismatch } from "../fhir/patientHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { JsonBlock } from "./JsonBlock";

// アレルギーの内容表示。詳細ページとカルテ画面のアレルギータブの双方から使う。
// 編集・削除の操作ボタンは、遷移先が異なるので呼び出し側が持つ。

export function AllergyDetailPanel({
  patientId,
  allergyId,
}: {
  patientId: string;
  allergyId: string;
}) {
  const { data: result, isLoading, error: loadError } = useAllergy(allergyId);

  const allergy = result?.data;
  // URL の患者と AllergyIntolerance.patient が食い違う場合は他患者のものなので表示しない。
  const patientMismatch = isPatientMismatch(patientId, allergy?.patient);
  const error =
    loadError ??
    (patientMismatch ? new Error("指定されたアレルギーは別の患者のものです。") : undefined);

  const summary = allergy && !patientMismatch ? summarizeAllergy(allergy) : undefined;

  return (
    <>
      <ErrorBanner error={error} />

      {isLoading ? (
        <p>読み込み中...</p>
      ) : (
        summary && (
          <div className="prescription-detail">
            <fieldset>
              <legend>アレルギー情報</legend>
              <dl className="prescription-detail__common">
                <dt>アレルゲン</dt>
                <dd>{summary.name}</dd>
                <dt>JFAGYコード</dt>
                <dd>{summary.jfagyCode || "-"}</dd>
                <dt>分類</dt>
                <dd>{summary.categoryLabel || "-"}</dd>
                <dt>タイプ</dt>
                <dd>{summary.typeLabel || "-"}</dd>
                <dt>重篤化リスク</dt>
                <dd>{summary.criticalityLabel || "-"}</dd>
                <dt>臨床状態</dt>
                <dd>{summary.clinicalStatusLabel || "-"}</dd>
                <dt>確からしさ</dt>
                <dd>{summary.verificationStatusLabel || "-"}</dd>
                <dt>発症日</dt>
                <dd>{summary.onsetDate || "-"}</dd>
                <dt>記録日</dt>
                <dd>{summary.recordedDate || "-"}</dd>
                <dt>症状</dt>
                <dd>{summary.reaction || "-"}</dd>
                <dt>メモ</dt>
                <dd>{summary.note || "-"}</dd>
              </dl>
            </fieldset>

            <details className="prescription-detail__raw">
              <summary>FHIR JSON を表示</summary>
              <JsonBlock value={allergy} />
            </details>
          </div>
        )
      )}
    </>
  );
}
