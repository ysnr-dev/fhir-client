import { useCondition } from "../api/queries";
import { parseConditionForm, summarizeCondition } from "../fhir/conditionHelpers";
import { isPatientMismatch } from "../fhir/patientHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { JsonBlock } from "./JsonBlock";

// 病名の内容表示。詳細ページとカルテ画面の病名タブの双方から使う。
// 編集・削除の操作ボタンは、遷移先が異なるので呼び出し側が持つ。

export function ConditionDetailPanel({
  patientId,
  conditionId,
}: {
  patientId: string;
  conditionId: string;
}) {
  const { data: result, isLoading, error: loadError } = useCondition(conditionId);

  const condition = result?.data;
  // URL の患者と Condition.subject の患者が食い違う場合は他患者の病名なので表示しない。
  const patientMismatch = isPatientMismatch(patientId, condition?.subject);
  const error =
    loadError ??
    (patientMismatch ? new Error("指定された病名は別の患者のものです。") : undefined);

  const summary = condition && !patientMismatch ? summarizeCondition(condition) : undefined;
  const form = condition && !patientMismatch ? parseConditionForm(condition) : undefined;

  return (
    <>
      <ErrorBanner error={error} />

      {isLoading ? (
        <p>読み込み中...</p>
      ) : (
        summary &&
        form && (
          <div className="prescription-detail">
            <fieldset>
              <legend>病名情報</legend>
              <dl className="prescription-detail__common">
                <dt>病名</dt>
                <dd>{summary.name}</dd>
                <dt>接頭語</dt>
                <dd>{form.prefixModifiers.map((m) => m.name).join("、") || "-"}</dd>
                <dt>接尾語</dt>
                <dd>{form.postfixModifiers.map((m) => m.name).join("、") || "-"}</dd>
                <dt>病名管理番号</dt>
                <dd>{form.disease?.management_number || "-"}</dd>
                <dt>ICD10</dt>
                <dd>{form.disease?.icd10_2013 ?? "-"}</dd>
                <dt>病名交換用コード</dt>
                <dd>{form.disease?.exchange_code ?? "-"}</dd>
                <dt>開始日</dt>
                <dd>{summary.startDate || "-"}</dd>
                <dt>終了日</dt>
                <dd>{summary.endDate || "-"}</dd>
                <dt>転帰区分</dt>
                <dd>{summary.outcomeDisplay || "-"}</dd>
              </dl>
            </fieldset>

            <details className="prescription-detail__raw">
              <summary>FHIR JSON を表示</summary>
              <JsonBlock value={condition} />
            </details>
          </div>
        )
      )}
    </>
  );
}
