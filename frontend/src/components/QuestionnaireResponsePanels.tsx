import { localDay } from "../lib/dates";
import { useEffect, useMemo, useState } from "react";
import { FhirError } from "../api/fhirClient";
import {
  useCreateQuestionnaireResponse,
  useKarteConditions,
  useLatestQuestionnaireResponse,
  usePatient,
  usePopulateSources,
  useQuestionnaireByCanonical,
  useQuestionnaireOptions,
  useQuestionnaireResponse,
  useUpdateQuestionnaireResponse,
} from "../api/queries";
import { problemRefOf } from "../fhir/conditionHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { QuestionnaireResponseForm } from "./QuestionnaireResponseForm";
import { QuestionnaireResponseMetaFields } from "./QuestionnaireResponseMetaFields";
import { TemplateSelect } from "./TemplateSelect";
import { displayJapaneseName } from "../fhir/humanName";
import type { ProblemRef } from "../fhir/conditionHelpers";
import { buildPopulateContext } from "../fhir/populateContext";
import { questionnaireExpressions } from "../fhir/questionnaireHelpers";
import { useProblemOptions } from "../hooks/useProblemOptions";
import { ProblemSelect } from "./ProblemSelect";
import { useLoginAutofillSource } from "../hooks/useLoginAutofillSource";
import { useOrderContext } from "../hooks/useOrderContext";
import { useSelfInstitutionNumber } from "../hooks/useSelfInstitutionNumber";
import {
  DEFAULT_INSTITUTION_NUMBER,
  buildQuestionnaireResponse,
  emptyQuestionnaireResponseMeta,
  parseQuestionnaireResponseMeta,
  questionnaireCanonical,
  questionnaireCanonicalVariants,
  questionnaireResponseProblem,
  validateQuestionnaireResponseMeta,
} from "../fhir/questionnaireResponseHelpers";
import { stripResponseAnnotations } from "../fhir/schemaImage";
import { useEditSnapshot } from "../hooks/useEditSnapshot";

// 複写ボタンに添える「いつの回答か」。日付だけで足りる。
function formatAuthored(authored: string | undefined): string {
  return authored ? localDay(authored) : "日付不明";
}

// テンプレート回答の登録・編集 UI。ページとカルテ画面の右ペインの双方から使う。

interface QuestionnaireResponseCreatePanelProps {
  patientId: string;
  /** 開いた時点で対象にしておくプロブレム(カルテ画面でプロブレムを選んでいる場合)。 */
  defaultProblem?: ProblemRef;
  /**
   * この回答が記述している対象(`basedOn`)。放射線治療の週次レビューは治療処方を指す
   * (`fhir/radiotherapyReviewHelpers.ts`)。
   */
  basedOn?: fhir4.Reference[];
  /** この回答が一部をなす記録(`partOf`)。NCD の症例登録は手術の実施記録を指す(`fhir/ncdHelpers.ts`)。 */
  partOf?: fhir4.Reference[];
  /** 選択済みにしておくテンプレートの canonical(版を省いた url でもよい)。前回と同じ様式で書き始めるときに渡す。 */
  defaultQuestionnaireCanonical?: string;
  /**
   * 書くテンプレートが決まっている入口(看護プロファイルの区画)。テンプレートの選択欄を出さない。
   */
  fixedQuestionnaire?: fhir4.Questionnaire;
  /** 回答が属する入院(看護プロファイル・入院診療計画書)。 */
  encounterId?: string;
  /** 対象プロブレムの欄を出すか。患者の状態を書く入口(看護プロファイル)では出さない。 */
  showProblem?: boolean;
  /** 回答と同じ transaction に足す entry(特定抗菌薬の届出書で通知を閉じるなど)。回答の参照を受け取って作る。 */
  extraEntries?: (responseReference: string) => fhir4.BundleEntry[];
  /** 初期値にする回答(Web 問診で患者が答えたもの)。item だけを読む。 */
  initialResponse?: fhir4.QuestionnaireResponse;
  /** 回答の日時。省くと保存時(Web 問診の取込は患者が答えた日時)。 */
  authored?: string;
  /** 回答に足す拡張(回答の出どころなど)。 */
  extension?: fhir4.Extension[];
  /** 保存後。保存した回答を受け取れる(Web 問診の取込済みの書き戻しに使う)。 */
  onSaved: (saved?: fhir4.QuestionnaireResponse) => void;
}

export function QuestionnaireResponseCreatePanel({
  patientId,
  defaultProblem,
  basedOn,
  partOf,
  extraEntries,
  defaultQuestionnaireCanonical,
  fixedQuestionnaire,
  encounterId,
  showProblem = true,
  initialResponse,
  authored,
  extension,
  onSaved,
}: QuestionnaireResponseCreatePanelProps) {
  const { data: patientResult } = usePatient(patientId);
  const patient = patientResult?.data;

  // 登録対象のテンプレートは「有効」のもののみ選択できる(上流の status 検索で絞る)。
  const {
    questionnaires: activeQuestionnaires,
    isLoading,
    error,
  } = useQuestionnaireOptions({ status: "active" });
  const [questionnaireId, setQuestionnaireId] = useState("");
  const questionnaire =
    fixedQuestionnaire ?? activeQuestionnaires.find((q) => q.id === questionnaireId);

  // 前回と同じ様式で書き始める(週次レビューのように毎回同じテンプレートを使う入口用)。
  // テンプレートの一覧は非同期なので、届いてから、まだ選んでいないときだけ入れる。
  useEffect(() => {
    if (!defaultQuestionnaireCanonical || questionnaireId) return;
    // 版を問わない url で渡されたら、その url のテンプレートを選ぶ(施設設定の入院診療計画書)。
    const match = activeQuestionnaires.find(
      (q) => questionnaireCanonical(q) === defaultQuestionnaireCanonical || q.url === defaultQuestionnaireCanonical,
    );
    if (match?.id) setQuestionnaireId(match.id);
  }, [defaultQuestionnaireCanonical, activeQuestionnaires, questionnaireId]);

  const [meta, setMeta] = useState(emptyQuestionnaireResponseMeta);
  const [validationError, setValidationError] = useState<string | null>(null);
  // 対象プロブレム(POMR)。診療記録・オーダーと同じく、回答 1 件に 1 プロブレム。
  const [problem, setProblem] = useState<ProblemRef | null>(defaultProblem ?? null);
  // 一覧から渡された対象がプロブレムでない病名(院内がん登録の保険病名など)のときは、その病名を選択肢に足して
  // 選んだ状態にする。表示名が無いまま渡されたら病名から埋める。
  const { conditions: karteConditions } = useKarteConditions(patientId);
  const listedProblemOptions = useProblemOptions(patientId);
  const problemOptions = useMemo(() => {
    if (!defaultProblem || listedProblemOptions.some((o) => o.conditionId === defaultProblem.conditionId)) {
      return listedProblemOptions;
    }
    const condition = karteConditions.find((c) => c.id === defaultProblem.conditionId);
    return condition ? [...listedProblemOptions, problemRefOf(condition)] : listedProblemOptions;
  }, [defaultProblem, listedProblemOptions, karteConditions]);
  useEffect(() => {
    if (!problem || problem.display) return;
    const resolved = problemOptions.find((o) => o.conditionId === problem.conditionId);
    if (resolved?.display) setProblem(resolved);
  }, [problem, problemOptions]);
  // 記録した診療科。ヘッダーで選択中の科を焼き付ける(オーダーの依頼科と同じ扱い)。
  const orderContext = useOrderContext();

  // 前回の回答。基礎データのように「前回を見て差分を直す」使い方のために複写できる。
  // 自動では入れない(前回の内容を今回の所見として無自覚に確定してしまうため)。
  const { latest } = useLatestQuestionnaireResponse(
    patientId,
    questionnaire ? questionnaireCanonical(questionnaire) : undefined,
  );
  const [copied, setCopied] = useState<fhir4.QuestionnaireResponse | null>(null);
  // テンプレートを切り替えたら複写は解除する(別のテンプレートの回答が残らないように)。
  useEffect(() => setCopied(null), [questionnaireId]);

  // ログイン中の医療従事者と所属医療機関。テンプレート項目の自動入力(拡張設定)と
  // 記入者名の初期値に使う。
  const loginAutofill = useLoginAutofillSource();

  // 記入者名はログイン中の医療従事者で埋める。セッションと Practitioner の取得は
  // 非同期なので初期値には使えず、未入力のときだけ後から流し込む(手入力の上書き
  // 防止)。administrator や認証不要モードでは紐付く Practitioner が無いため空欄のまま。
  const loginPractitionerName = loginAutofill.source
    ? displayJapaneseName(loginAutofill.source.practitioner.name)
    : "";
  useEffect(() => {
    if (!loginPractitionerName) return;
    setMeta((prev) => (prev.authorName ? prev : { ...prev, authorName: loginPractitionerName }));
  }, [loginPractitionerName]);

  // 保険医療機関番号は自院(管理 > 施設設定)の登録値で埋める。記入者名と同じく
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

  // 初期値式(%conditions / %patient など。populateContext.ts 参照)の実行時
  // コンテキスト。取得完了までフォームを描画しない(初期回答はマウント時に確定するため)。
  const expressions = useMemo(() => questionnaireExpressions(questionnaire), [questionnaire]);
  const canonicals = useMemo(
    () => (questionnaire ? questionnaireCanonicalVariants(questionnaire) : []),
    [questionnaire],
  );
  const focusProcedureId = partOf
    ?.map((reference) => reference.reference?.match(/^Procedure\/(.+)$/)?.[1] ?? "")
    .find(Boolean);
  const populate = usePopulateSources(patientId, {
    expressions,
    focusConditionId: defaultProblem?.conditionId,
    focusProcedureId,
    canonicals,
    encounterId,
  });
  const expressionContext = useMemo(
    () =>
      patient && !populate.isLoading
        ? buildPopulateContext({ patient, ...populate.sources })
        : undefined,
    [patient, populate.isLoading, populate.sources],
  );

  const createResponse = useCreateQuestionnaireResponse();

  const copyPreviousButton = latest && (
    <button
      type="button"
      className="qr-copy-previous"
      onClick={() => setCopied(copied ? null : stripResponseAnnotations(latest))}
    >
      {copied ? (
        "複写取消"
      ) : (
        <>
          前回値複写
          <span className="qr-copy-previous__date">{formatAuthored(latest.authored)}</span>
        </>
      )}
    </button>
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
    createResponse.mutate(
      {
        questionnaire,
        response: buildQuestionnaireResponse({
          questionnaire,
          patient,
          items,
          meta,
          problem,
          basedOn,
          partOf,
          department: orderContext,
          encounterId,
          authored,
          extension,
        }),
        imageEntries,
        extraEntries,
      },
      { onSuccess: (result) => onSaved(result.data) },
    );
  }

  return (
    <>
      <ErrorBanner error={error} />
      <ErrorBanner error={populate.error} />
      <ErrorBanner error={createResponse.error} />
      {validationError && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}

      {fixedQuestionnaire ? (
        latest && (
          <div className="qr-template-select">
            {copyPreviousButton}
          </div>
        )
      ) : isLoading ? (
        <p>読み込み中...</p>
      ) : activeQuestionnaires.length === 0 ? (
        <p className="patient-table__empty">
          有効なテンプレートがありません。先にテンプレートを作成し、ステータスを「有効」にしてください。
        </p>
      ) : (
        <div className="qr-template-select">
          <TemplateSelect
            questionnaires={activeQuestionnaires}
            value={questionnaireId}
            onChange={setQuestionnaireId}
          />
          {/* 複写はテンプレートを選んで初めて意味を持つので、プルダウンの右隣に置く。 */}
          {questionnaire && latest && copyPreviousButton}
        </div>
      )}

      {questionnaire && latest && copied && (
        <p className="qr-copy-previous__note">
          {formatAuthored(latest.authored)}の回答を読み込みました。内容を確認して登録してください。
        </p>
      )}

      {questionnaire &&
        (expressionContext && loginAutofill.ready ? (
          // テンプレート切替時と複写の切替で入力途中の回答を持ち越さないよう key で作り直す。
          <QuestionnaireResponseForm
            key={`${questionnaire.id}:${copied ? "copy" : initialResponse ? "initial" : "new"}`}
            questionnaire={questionnaire}
            initialResponse={copied ?? initialResponse}
            onSubmit={handleSubmit}
            submitLabel="登録"
            submitting={createResponse.isPending}
            expressionContext={expressionContext}
            loginAutofill={loginAutofill.source}
            // テンプレート名と版は上の選択欄に出ている。
            showHeader={false}
          >
            <QuestionnaireResponseMetaFields values={meta} onChange={setMeta} />
            {showProblem && (
              <div className="qp-field">
                <label>
                  <span className="qp-field__label">対象プロブレム</span>
                  <ProblemSelect value={problem} options={problemOptions} onChange={setProblem} />
                </label>
              </div>
            )}
          </QuestionnaireResponseForm>
        ) : (
          <p>読み込み中...</p>
        ))}
    </>
  );
}

interface QuestionnaireResponseEditPanelProps {
  patientId: string;
  qrId: string;
  /** 対象プロブレムの欄を出すか(登録パネルと同じ)。出さないときは保存済みの対象を引き継ぐ。 */
  showProblem?: boolean;
  onSaved: () => void;
}

export function QuestionnaireResponseEditPanel({
  patientId,
  qrId,
  showProblem = true,
  onSaved,
}: QuestionnaireResponseEditPanelProps) {
  const { data: result, isLoading, error } = useEditSnapshot(useQuestionnaireResponse(qrId), qrId);
  const response = result?.data;

  const {
    questionnaire,
    isLoading: questionnaireLoading,
    error: questionnaireError,
  } = useQuestionnaireByCanonical(response?.questionnaire);

  const { data: patientResult } = usePatient(patientId);
  const patient = patientResult?.data;

  return (
    <>
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
            response={response}
            etag={result?.etag ?? ""}
            questionnaire={questionnaire}
            patient={patient}
            showProblem={showProblem}
            onSaved={onSaved}
          />
        )
      )}
    </>
  );
}

// メタ情報の初期値を読み込み済みリソースから作るため、読込完了後にマウントする。
function EditForm({
  response,
  etag,
  questionnaire,
  patient,
  showProblem,
  onSaved,
}: {
  response: fhir4.QuestionnaireResponse;
  etag: string;
  questionnaire: fhir4.Questionnaire;
  patient: fhir4.Patient;
  showProblem: boolean;
  onSaved: () => void;
}) {
  const [meta, setMeta] = useState(() => parseQuestionnaireResponseMeta(response));
  const [validationError, setValidationError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const updateResponse = useUpdateQuestionnaireResponse();
  const [problem, setProblem] = useState<ProblemRef | null>(() =>
    questionnaireResponseProblem(response),
  );
  const problemOptions = useProblemOptions(patient.id ?? "");

  function handleSubmit(
    items: fhir4.QuestionnaireResponseItem[],
    imageEntries: fhir4.BundleEntry[],
  ) {
    const metaError = validateQuestionnaireResponseMeta(meta);
    if (metaError) {
      setValidationError(metaError);
      return;
    }
    setValidationError(null);
    setConflict(false);
    updateResponse.mutate(
      {
        questionnaire,
        response: buildQuestionnaireResponse({
          questionnaire,
          patient,
          items,
          meta,
          problem,
          existing: response,
        }),
        etag,
        imageEntries,
      },
      {
        onSuccess: onSaved,
        onError: (err) => {
          if (err instanceof FhirError && err.status === 412) {
            setConflict(true);
          }
        },
      },
    );
  }

  return (
    <>
      {conflict ? (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">
            この回答は他の操作によって更新されています。画面を再読込してから再度編集してください。
          </p>
        </div>
      ) : (
        <ErrorBanner error={updateResponse.error} />
      )}
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
        {showProblem && (
          <div className="qp-field">
            <label>
              <span className="qp-field__label">対象プロブレム</span>
              <ProblemSelect value={problem} options={problemOptions} onChange={setProblem} />
            </label>
          </div>
        )}
      </QuestionnaireResponseForm>
    </>
  );
}
