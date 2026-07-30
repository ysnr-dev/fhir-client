import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  usePatient,
  useQuestionnaireByCanonical,
  useQuestionnaireResponse,
  useUpdateQuestionnaireResponse,
} from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { PatientHeader } from "../components/PatientHeader";
import { QuestionnaireResponseForm } from "../components/QuestionnaireResponseForm";
import { QuestionnaireResponseMetaFields } from "../components/QuestionnaireResponseMetaFields";
import {
  buildQuestionnaireResponse,
  parseQuestionnaireResponseMeta,
  validateQuestionnaireResponseMeta,
} from "../fhir/questionnaireResponseHelpers";

export function QuestionnaireResponseEditPage() {
  const { patientId, qrId } = useParams<{ patientId: string; qrId: string }>();

  const { data: result, isLoading, error } = useQuestionnaireResponse(qrId);
  const response = result?.data;
  const etag = result?.etag;

  const {
    questionnaire,
    isLoading: questionnaireLoading,
    error: questionnaireError,
  } = useQuestionnaireByCanonical(response?.questionnaire);

  const { data: patientResult } = usePatient(patientId);
  const patient = patientResult?.data;

  return (
    <div className="page">
      <div className="page__header">
        <h1>テンプレート編集</h1>
        <Link to={`/patients/${patientId}/questionnaire-responses`} className="button">
          ← テンプレート一覧に戻る
        </Link>
      </div>

      <PatientHeader patientId={patientId} />

      <ErrorBanner error={error} />
      <ErrorBanner error={questionnaireError} />

      {isLoading || questionnaireLoading ? (
        <p>読み込み中...</p>
      ) : response && !questionnaire ? (
        <p className="patient-table__empty">
          元テンプレート({response.questionnaire})が見つからないため、編集できません。
        </p>
      ) : (
        response &&
        questionnaire &&
        patient && (
          <EditForm
            patientId={patientId as string}
            response={response}
            etag={etag ?? ""}
            questionnaire={questionnaire}
            patient={patient}
          />
        )
      )}
    </div>
  );
}

// メタ情報の初期値を読み込み済みリソースから作るため、読込完了後にマウントする。
function EditForm({
  patientId,
  response,
  etag,
  questionnaire,
  patient,
}: {
  patientId: string;
  response: fhir4.QuestionnaireResponse;
  etag: string;
  questionnaire: fhir4.Questionnaire;
  patient: fhir4.Patient;
}) {
  const navigate = useNavigate();
  const [meta, setMeta] = useState(() => parseQuestionnaireResponseMeta(response));
  const [validationError, setValidationError] = useState<string | null>(null);
  const updateResponse = useUpdateQuestionnaireResponse();

  function handleSubmit(items: fhir4.QuestionnaireResponseItem[]) {
    const metaError = validateQuestionnaireResponseMeta(meta);
    if (metaError) {
      setValidationError(metaError);
      return;
    }
    setValidationError(null);
    updateResponse.mutate(
      {
        response: buildQuestionnaireResponse({
          questionnaire,
          patient,
          items,
          meta,
          existing: response,
        }),
        etag,
      },
      { onSuccess: () => navigate(`/patients/${patientId}/questionnaire-responses`) },
    );
  }

  return (
    <>
      <ErrorBanner error={updateResponse.error} />
      {validationError && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}
      <QuestionnaireResponseForm
        questionnaire={questionnaire}
        initialResponse={response}
        onSubmit={handleSubmit}
        submitLabel="更新"
        submitting={updateResponse.isPending}
      >
        <QuestionnaireResponseMetaFields values={meta} onChange={setMeta} />
      </QuestionnaireResponseForm>
    </>
  );
}
