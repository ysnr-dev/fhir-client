import { useEffect, useMemo, useState } from "react";
import {
  usePatient,
  usePopulateSources,
  useQuestionnaireByCanonical,
  useQuestionnaireOptions,
  useQuestionnaireResponse,
} from "../api/queries";
import type { ClinicalNoteTemplateDraft } from "../fhir/clinicalNoteHelpers";
import { displayJapaneseName } from "../fhir/humanName";
import { buildPopulateContext } from "../fhir/populateContext";
import {
  buildQuestionnaireResponse,
  emptyQuestionnaireResponseMeta,
  parseQuestionnaireResponseMeta,
  validateQuestionnaireResponseMeta,
} from "../fhir/questionnaireResponseHelpers";
import { useLoginAutofillSource } from "../hooks/useLoginAutofillSource";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";
import { QuestionnaireResponseForm } from "./QuestionnaireResponseForm";
import { QuestionnaireResponseMetaFields } from "./QuestionnaireResponseMetaFields";
import { TemplateSelect } from "./TemplateSelect";

// 診療記録セクションのテンプレート記入モーダル。
// QuestionnaireResponseCreatePage と同じ流れ(テンプレート選択 → 記入)を
// モーダル内で行い、登録時に組み立て済みの QuestionnaireResponse を親へ返す。
// ここでは FHIR サーバーへ保存しない — 保存は診療記録本体と同じ
// transaction Bundle で行う(親フォーム側の責務)。

interface ClinicalNoteTemplateModalProps {
  patientId: string;
  // 再編集の元。未保存の記入内容(draft)か、保存済み QR の id のどちらか。
  // 両方 null なら新規記入(テンプレート選択から始める)。
  draft: ClinicalNoteTemplateDraft | null;
  responseId: string | null;
  onSubmit: (draft: ClinicalNoteTemplateDraft) => void;
  onClose: () => void;
}

export function ClinicalNoteTemplateModal({
  patientId,
  draft,
  responseId,
  onSubmit,
  onClose,
}: ClinicalNoteTemplateModalProps) {
  const { data: patientResult, error: patientError } = usePatient(patientId);
  const patient = patientResult?.data;

  // 保存済み QR の再編集(未再編集): QR → canonical で元テンプレートを引く。
  // draft がある場合はそこに questionnaire ごと保持しているので取得不要。
  const needsFetch = !draft && Boolean(responseId);
  const savedResponse = useQuestionnaireResponse(needsFetch ? (responseId ?? undefined) : undefined);
  const savedQuestionnaire = useQuestionnaireByCanonical(
    needsFetch ? savedResponse.data?.data.questionnaire : undefined,
  );

  // 新規記入: 有効なテンプレートから選択。
  const options = useQuestionnaireOptions({ status: "active" });
  const [questionnaireId, setQuestionnaireId] = useState("");

  const questionnaire =
    draft?.questionnaire ??
    (needsFetch
      ? savedQuestionnaire.questionnaire
      : options.questionnaires.find((q) => q.id === questionnaireId));
  const initialResponse = draft?.response ?? (needsFetch ? savedResponse.data?.data : undefined);

  const [meta, setMeta] = useState(() =>
    initialResponse ? parseQuestionnaireResponseMeta(initialResponse) : emptyQuestionnaireResponseMeta(),
  );
  const [validationError, setValidationError] = useState<string | null>(null);

  // 記入者名はログイン中の医療従事者で補完(QuestionnaireResponseCreatePage と同じ規約)。
  const loginAutofill = useLoginAutofillSource();
  const loginPractitionerName = loginAutofill.source
    ? displayJapaneseName(loginAutofill.source.practitioner.name)
    : "";
  useEffect(() => {
    if (!loginPractitionerName) return;
    setMeta((prev) => (prev.authorName ? prev : { ...prev, authorName: loginPractitionerName }));
  }, [loginPractitionerName]);

  // 保存済み QR の読込完了後にメタを反映する(初期 state 時点では未取得のため)。
  const fetchedMetaSource = needsFetch ? savedResponse.data?.data : undefined;
  useEffect(() => {
    if (fetchedMetaSource) setMeta(parseQuestionnaireResponseMeta(fetchedMetaSource));
  }, [fetchedMetaSource]);

  // 初期値式(%patient など)の実行時コンテキスト。新規記入時のみ必要。
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
    onSubmit({
      questionnaire,
      response: buildQuestionnaireResponse({
        questionnaire,
        patient,
        items,
        meta,
        existing: initialResponse,
      }),
      imageEntries,
    });
  }

  const loading =
    !patient ||
    (needsFetch && (savedResponse.isLoading || savedQuestionnaire.isLoading)) ||
    (!initialResponse && (options.isLoading || populate.isLoading || !loginAutofill.ready));

  return (
    <Modal title="テンプレート記載" onClose={onClose} className="modal--wide">
      <ErrorBanner error={patientError} />
      <ErrorBanner error={options.error} />
      <ErrorBanner error={savedResponse.error} />
      <ErrorBanner error={savedQuestionnaire.error} />
      <ErrorBanner error={populate.error} />
      {validationError && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}

      {loading ? (
        <p>読み込み中...</p>
      ) : (
        <>
          {/* 新規記入時のみテンプレートを選ばせる。再編集では元テンプレート固定。 */}
          {!initialResponse &&
            (options.questionnaires.length === 0 ? (
              <p className="patient-table__empty">
                有効なテンプレートがありません。先にテンプレートを作成し、ステータスを「有効」にしてください。
              </p>
            ) : (
              <div className="qr-template-select">
                <TemplateSelect
                  questionnaires={options.questionnaires}
                  value={questionnaireId}
                  onChange={setQuestionnaireId}
                />
              </div>
            ))}

          {questionnaire && (
            // テンプレート切替時に入力途中の回答を持ち越さないよう key で作り直す。
            <QuestionnaireResponseForm
              key={questionnaire.id}
              questionnaire={questionnaire}
              initialResponse={initialResponse}
              onSubmit={handleSubmit}
              submitLabel="記載を反映"
              expressionContext={initialResponse ? undefined : expressionContext}
              loginAutofill={initialResponse ? undefined : loginAutofill.source}
            >
              <QuestionnaireResponseMetaFields values={meta} onChange={setMeta} />
            </QuestionnaireResponseForm>
          )}
        </>
      )}
    </Modal>
  );
}
