import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  useCreateQuestionnaireResponse,
  usePatient,
  usePopulateSources,
  useQuestionnaireOptions,
} from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { PatientHeader } from "../components/PatientHeader";
import { QuestionnaireResponseForm } from "../components/QuestionnaireResponseForm";
import { QuestionnaireResponseMetaFields } from "../components/QuestionnaireResponseMetaFields";
import { buildPopulateContext } from "../fhir/populateContext";
import {
  buildQuestionnaireResponse,
  emptyQuestionnaireResponseMeta,
  validateQuestionnaireResponseMeta,
} from "../fhir/questionnaireResponseHelpers";

export function QuestionnaireResponseCreatePage() {
  const { patientId } = useParams<{ patientId: string }>();
  const navigate = useNavigate();

  const { data: patientResult } = usePatient(patientId);
  const patient = patientResult?.data;

  // 登録対象のテンプレートは「有効」のもののみ選択できる。
  const { questionnaires, isLoading, error } = useQuestionnaireOptions();
  const activeQuestionnaires = questionnaires.filter((q) => q.status === "active");
  const [questionnaireId, setQuestionnaireId] = useState("");
  const questionnaire = activeQuestionnaires.find((q) => q.id === questionnaireId);

  const [meta, setMeta] = useState(emptyQuestionnaireResponseMeta);
  const [validationError, setValidationError] = useState<string | null>(null);

  // 初期値式(%conditions / %labResults / %prescriptions / %patient)の実行時
  // コンテキスト。取得完了までフォームを描画しない(初期回答はマウント時に確定するため)。
  const populate = usePopulateSources(patientId);
  const expressionContext = useMemo(
    () =>
      patient && !populate.isLoading
        ? buildPopulateContext({
            patient,
            conditions: populate.conditions,
            labDetail: populate.labDetail,
            prescriptionDetail: populate.prescriptionDetail,
          })
        : undefined,
    [patient, populate.isLoading, populate.conditions, populate.labDetail, populate.prescriptionDetail],
  );

  const createResponse = useCreateQuestionnaireResponse();

  function handleSubmit(
    items: fhir4.QuestionnaireResponseItem[],
    imageEntries: fhir4.BundleEntry[],
  ) {
    if (!questionnaire || !patient) return;
    const metaError = validateQuestionnaireResponseMeta(meta);
    if (metaError) {
      setValidationError(metaError);
      return;
    }
    setValidationError(null);
    createResponse.mutate(
      {
        response: buildQuestionnaireResponse({ questionnaire, patient, items, meta }),
        imageEntries,
      },
      { onSuccess: () => navigate(`/patients/${patientId}/questionnaire-responses`) },
    );
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>テンプレート登録</h1>
        <Link to={`/patients/${patientId}/questionnaire-responses`} className="button">
          ← テンプレート一覧に戻る
        </Link>
      </div>

      <PatientHeader patientId={patientId} />

      <ErrorBanner error={error} />
      <ErrorBanner error={populate.error} />
      <ErrorBanner error={createResponse.error} />
      {validationError && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}

      {isLoading ? (
        <p>読み込み中...</p>
      ) : activeQuestionnaires.length === 0 ? (
        <p className="patient-table__empty">
          有効なテンプレートがありません。先にテンプレートを作成し、ステータスを「有効」にしてください。
        </p>
      ) : (
        <div className="qp-field qr-template-select">
          <label>
            <span className="qp-field__label">テンプレート</span>
            <select
              value={questionnaireId}
              onChange={(e) => setQuestionnaireId(e.target.value)}
            >
              <option value="">選択してください</option>
              {activeQuestionnaires.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.title ?? q.name} (v{q.version})
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {questionnaire &&
        (expressionContext ? (
          // テンプレート切替時に入力途中の回答を持ち越さないよう key で作り直す。
          <QuestionnaireResponseForm
            key={questionnaire.id}
            questionnaire={questionnaire}
            onSubmit={handleSubmit}
            submitLabel="登録"
            submitting={createResponse.isPending}
            expressionContext={expressionContext}
          >
            <QuestionnaireResponseMetaFields values={meta} onChange={setMeta} />
          </QuestionnaireResponseForm>
        ) : (
          <p>読み込み中...</p>
        ))}
    </div>
  );
}
