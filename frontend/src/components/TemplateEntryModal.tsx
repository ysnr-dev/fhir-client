import { useEffect, useMemo, useState } from "react";
import {
  usePatient,
  usePopulateSources,
  useQuestionnaireByCanonical,
  useQuestionnaireOptions,
  useQuestionnaireResponse,
} from "../api/queries";
import { displayJapaneseName } from "../fhir/humanName";
import { questionnaireCanonical } from "../fhir/questionnaireResponseHelpers";
import { observationExtractEnabled } from "../fhir/observationExtract";
import { buildPopulateContext } from "../fhir/populateContext";
import {
  DEFAULT_INSTITUTION_NUMBER,
  buildQuestionnaireResponse,
  emptyQuestionnaireResponseMeta,
  parseQuestionnaireResponseMeta,
  validateQuestionnaireResponseMeta,
  type TemplateDraft,
} from "../fhir/questionnaireResponseHelpers";
import { useLoginAutofillSource } from "../hooks/useLoginAutofillSource";
import { useSelfInstitutionNumber } from "../hooks/useSelfInstitutionNumber";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";
import { QuestionnaireResponseForm } from "./QuestionnaireResponseForm";
import { QuestionnaireResponseMetaFields } from "./QuestionnaireResponseMetaFields";
import { TemplateSelect } from "./TemplateSelect";

// テンプレート記入モーダル。診療記録のセクションと放射線オーダーの検査目的・
// 特別指示で共用する。
// QuestionnaireResponseCreatePage と同じ流れ(テンプレート選択 → 記入)を
// モーダル内で行い、登録時に組み立て済みの QuestionnaireResponse を親へ返す。
// ここでは FHIR サーバーへ保存しない — 保存は診療記録本体と同じ
// transaction Bundle で行う(親フォーム側の責務)。

interface TemplateEntryModalProps {
  patientId: string;
  // 再編集の元。未保存の記入内容(draft)か、保存済み QR の id のどちらか。
  // 両方 null なら新規記入(テンプレート選択から始める)。
  draft: TemplateDraft | null;
  responseId: string | null;
  /**
   * 新規記入で最初から選んでおくテンプレートの canonical。放射線オーダーのように
   * 「この項目ならこのテンプレート」がマスタで決まっている場合に渡す。
   * 選び直しは妨げない。
   */
  defaultCanonical?: string;
  /**
   * 記載した回答から Observation を生成する経路かどうか。診療記録のセクションは
   * 生成する(診療記録と同じ transaction で保存する)。放射線オーダーの検査目的・
   * 特別指示は未対応なので、黙って作られないと気づけない旨をここで断る。
   */
  extractsObservations?: boolean;
  onSubmit: (draft: TemplateDraft) => void;
  onClose: () => void;
}

export function TemplateEntryModal({
  patientId,
  draft,
  responseId,
  defaultCanonical,
  extractsObservations = false,
  onSubmit,
  onClose,
}: TemplateEntryModalProps) {
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

  // 既定テンプレートは候補が届いてから当てる(選択済みなら触らない)。
  // 版まで一致しなければ URL だけで拾い、版が上がっても指し先を見失わないようにする。
  useEffect(() => {
    if (!defaultCanonical || questionnaireId || options.questionnaires.length === 0) return;
    const url = defaultCanonical.split("|")[0];
    const found =
      options.questionnaires.find((q) => questionnaireCanonical(q) === defaultCanonical) ??
      options.questionnaires.find((q) => q.url === url);
    if (found?.id) setQuestionnaireId(found.id);
  }, [defaultCanonical, options.questionnaires, questionnaireId]);

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

  // 保険医療機関番号は自院(管理 > 自院設定)の登録値で埋める。記入者名と同じく
  // 取得が非同期なので、仮の初期値のままのときだけ後から流し込む。
  const selfInstitutionNumber = useSelfInstitutionNumber();
  useEffect(() => {
    if (!selfInstitutionNumber) return;
    setMeta((prev) =>
      prev.institutionNumber === DEFAULT_INSTITUTION_NUMBER
        ? { ...prev, institutionNumber: selfInstitutionNumber }
        : prev,
    );
  }, [selfInstitutionNumber]);

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

          {/* 生成しない経路(放射線オーダー)では、黙って作られないと気づけないので断る。 */}
          {!extractsObservations && questionnaire && observationExtractEnabled(questionnaire) && (
            <p className="qe-hint">
              このテンプレートは「回答から Observation を生成する」設定ですが、この記載では
              生成されません。構造化データとして残すには、右ペインの「テンプレート」から単独で
              登録してください。
            </p>
          )}

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
