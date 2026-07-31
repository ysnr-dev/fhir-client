import { Link, useNavigate, useParams } from "react-router-dom";
import { useAllergy, useDeleteAllergy } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { JsonBlock } from "../components/JsonBlock";
import { PatientHeader } from "../components/PatientHeader";
import { summarizeAllergy } from "../fhir/allergyHelpers";
import { isPatientMismatch } from "../fhir/patientHelpers";

export function AllergyDetailPage() {
  const { patientId, allergyId } = useParams<{ patientId: string; allergyId: string }>();
  const navigate = useNavigate();

  const { data: result, isLoading, error: loadError } = useAllergy(allergyId);
  const deleteAllergy = useDeleteAllergy();

  const allergy = result?.data;
  // URL の患者と AllergyIntolerance.patient が食い違う場合は他患者のものなので表示しない。
  const patientMismatch = isPatientMismatch(patientId, allergy?.patient);
  const error =
    loadError ??
    deleteAllergy.error ??
    (patientMismatch ? new Error("指定されたアレルギーは別の患者のものです。") : undefined);

  function handleDelete() {
    if (!allergyId) return;
    if (!window.confirm("このアレルギーを削除します。よろしいですか?")) return;
    deleteAllergy.mutate(allergyId, {
      onSuccess: () => navigate(`/patients/${patientId}/allergies`),
    });
  }

  const summary = allergy && !patientMismatch ? summarizeAllergy(allergy) : undefined;

  return (
    <div className="page">
      <div className="page__header">
        <h1>アレルギー詳細</h1>
        <div>
          <Link to={`/patients/${patientId}/allergies/${allergyId}/edit`} className="button">
            編集
          </Link>
          <button type="button" onClick={handleDelete} disabled={deleteAllergy.isPending}>
            削除
          </button>
          <Link to={`/patients/${patientId}/allergies`} className="button">
            ← アレルギー一覧に戻る
          </Link>
        </div>
      </div>

      <PatientHeader patientId={patientId} />

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
    </div>
  );
}
