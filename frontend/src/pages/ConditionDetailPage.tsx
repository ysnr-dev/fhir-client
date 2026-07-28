import { Link, useNavigate, useParams } from "react-router-dom";
import { useCondition, useDeleteCondition } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { JsonBlock } from "../components/JsonBlock";
import { PatientHeader } from "../components/PatientHeader";
import { parseConditionForm, summarizeCondition } from "../fhir/conditionHelpers";
import { isPatientMismatch } from "../fhir/patientHelpers";

export function ConditionDetailPage() {
  const { patientId, conditionId } = useParams<{ patientId: string; conditionId: string }>();
  const navigate = useNavigate();

  const { data: result, isLoading, error: loadError } = useCondition(conditionId);
  const deleteCondition = useDeleteCondition();

  const condition = result?.data;
  // URL の患者と Condition.subject の患者が食い違う場合は他患者の病名なので表示しない。
  const patientMismatch = isPatientMismatch(patientId, condition?.subject);
  const error =
    loadError ??
    deleteCondition.error ??
    (patientMismatch ? new Error("指定された病名は別の患者のものです。") : undefined);

  function handleDelete() {
    if (!conditionId) return;
    if (!window.confirm("この病名を削除します。よろしいですか?")) return;
    deleteCondition.mutate(conditionId, {
      onSuccess: () => navigate(`/patients/${patientId}/conditions`),
    });
  }

  const summary = condition && !patientMismatch ? summarizeCondition(condition) : undefined;
  const form = condition && !patientMismatch ? parseConditionForm(condition) : undefined;

  return (
    <div className="page">
      <div className="page__header">
        <h1>病名詳細</h1>
        <div>
          <Link to={`/patients/${patientId}/conditions/${conditionId}/edit`} className="button">
            編集
          </Link>
          <button type="button" onClick={handleDelete} disabled={deleteCondition.isPending}>
            削除
          </button>
          <Link to={`/patients/${patientId}/conditions`} className="button">
            ← 病名一覧に戻る
          </Link>
        </div>
      </div>

      <PatientHeader patientId={patientId} />

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
    </div>
  );
}
