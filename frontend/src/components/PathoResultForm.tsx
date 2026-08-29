import { makeFieldUpdater } from "../lib/form";
import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import type { LabOrderCandidate } from "../api/queries";
import { usePathoOrderDetail, useSelfDepartments } from "../api/queries";
import { serviceRequestsOf } from "../fhir/labOrderHelpers";
import { SETTING_OPTIONS, type LabResultSetting } from "../fhir/labResultHelpers";
import {
  EXAM_CATEGORY_OPTIONS,
  isCytologyCategory,
  pathoOrderExamCategory,
  pathoOrderItemRequests,
  pathoOrderSpecimens,
  type PathoExamCategory,
} from "../fhir/pathoOrderHelpers";
import {
  CYTO_JUDGEMENT_OPTIONS,
  REPORT_STATUS_OPTIONS,
  emptyPathoResultForm,
  emptyPathoResultSpecimen,
  resultSpecimenLabel,
  willBecomeAmended,
  type PathoResultFormValues,
  type PathoResultSpecimenValues,
} from "../fhir/pathoResultHelpers";
import { ErrorBanner } from "./ErrorBanner";

// 病理診断レポートの入力フォーム。カルテの病理タブと病理部門一覧の双方から使う。
//
// 項目立ては JAHIS 病理診断レポート構造化記述規約 のセクションに合わせる
// (肉眼所見 / 顕微鏡所見 / 診断 / 採取法・検体処理法)。診断欄だけは検査区分で形が
// 変わり、組織診・術中迅速は自由文、細胞診は「判定 + 推定病変」になる。
//
// 検体はオーダーを選んだときに転記する。病理では 1 オーダーに複数検体があるので、
// 転記した各検体に実際の採取日を入れられるようにする(オーダー側は予定日 1 つ)。

interface PathoResultFormProps {
  initialValues?: PathoResultFormValues;
  onSubmit: (values: PathoResultFormValues) => void;
  submitting: boolean;
  submitError?: unknown;
  submitLabel?: string;
  /** 紐付けられる病理検査オーダー(レポートが未登録のもの)。 */
  orderCandidates: LabOrderCandidate[];
  orderCandidatesLoading: boolean;
  /** 部門一覧から開いたときの固定オーダー。指定すると選択欄を出さない。 */
  fixedOrderId?: string;
}

export function PathoResultForm({
  initialValues,
  onSubmit,
  submitting,
  submitError,
  submitLabel = "登録",
  orderCandidates,
  orderCandidatesLoading,
  fixedOrderId,
}: PathoResultFormProps) {
  const [values, setValues] = useState<PathoResultFormValues>(
    initialValues ?? emptyPathoResultForm(),
  );
  const [validationError, setValidationError] = useState<string | null>(null);

  const { departments } = useSelfDepartments();
  const update = makeFieldUpdater(setValues);
  const isCytology = isCytologyCategory(values.examCategory);

  // 画面上でオーダーを選び直したときだけ、オーダーの検体と検査区分を転記する
  // (初期表示時の紐付け済みオーダーで、保存済みの内容を上書きしないようにする)。
  const [expandingOrderId, setExpandingOrderId] = useState(
    // 部門一覧から「そのオーダーのレポート」を新規で書くときは、開いた時点で転記する。
    fixedOrderId && !initialValues?.specimens.length ? fixedOrderId : "",
  );
  const orderDetail = usePathoOrderDetail(expandingOrderId || undefined);

  useEffect(() => {
    if (!expandingOrderId || orderDetail.isLoading) return;
    const orderId = expandingOrderId;
    setExpandingOrderId("");

    const serviceRequests = serviceRequestsOf(orderDetail.data?.data);
    const header = serviceRequests.find((sr) => sr.id === orderId);
    if (!header) return;

    const specimens = pathoOrderSpecimens(pathoOrderItemRequests(serviceRequests, orderId));
    setValues((v) => ({
      ...v,
      examCategory: pathoOrderExamCategory(header),
      specimens: specimens.map((specimen) => ({
        organCode: specimen.organCode,
        organName: specimen.organName,
        typeCode: specimen.typeCode,
        typeName: specimen.typeName,
        // 採取日の既定はオーダーの採取(予定)日。実際と違えば入力し直す。
        collectedDate: header.occurrenceDateTime?.slice(0, 10) ?? v.reportDate,
      })),
    }));
  }, [expandingOrderId, orderDetail.data, orderDetail.isLoading]);

  function handleOrderChange(orderId: string) {
    const candidate = orderCandidates.find((c) => c.id === orderId);
    setValues((v) => ({
      ...v,
      orderId,
      ...(candidate
        ? { departmentId: candidate.departmentId, departmentName: candidate.departmentName }
        : {}),
    }));
    setExpandingOrderId(orderId);
  }

  function handleDepartmentChange(departmentId: string) {
    const department = departments.find((d) => d.id === departmentId);
    setValues((v) => ({ ...v, departmentId, departmentName: department?.name ?? "" }));
  }

  function updateSpecimen(index: number, patch: Partial<PathoResultSpecimenValues>) {
    setValues((v) => ({
      ...v,
      specimens: v.specimens.map((specimen, i) =>
        i === index ? { ...specimen, ...patch } : specimen,
      ),
    }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!values.reportDate) {
      setValidationError("報告日を入力してください。");
      return;
    }
    // 診断は規約でレポートに必須のセクション。ただし中間報告は診断が固まる前の
    // 途中経過なので、最終報告のときだけ required にする。
    if (values.reportStatus === "final") {
      const hasDiagnosis = isCytology ? Boolean(values.cytoJudgement) : Boolean(values.diagnosis.trim());
      if (!hasDiagnosis) {
        setValidationError(
          isCytology
            ? "最終報告には判定が必要です(まだなら報告区分を中間報告にしてください)。"
            : "最終報告には診断が必要です(まだなら報告区分を中間報告にしてください)。",
        );
        return;
      }
    }
    setValidationError(null);
    onSubmit(values);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLFormElement>) {
    // input 上での Enter による暗黙の form submit を抑止する(他フォームと同じ)。
    if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
      e.preventDefault();
    }
  }

  return (
    <form className="prescription-form" onSubmit={handleSubmit} onKeyDown={handleKeyDown}>
      {validationError && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}
      <ErrorBanner error={submitError} />

      <fieldset>
        <legend>報告共通</legend>
        <label>
          報告日
          <input
            type="date"
            value={values.reportDate}
            onChange={(e) => update("reportDate", e.target.value)}
          />
        </label>
        <label>
          入外区分
          <select
            value={values.setting}
            onChange={(e) => update("setting", e.target.value as LabResultSetting)}
          >
            <option value="">選択してください</option>
            {SETTING_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.display}
              </option>
            ))}
          </select>
        </label>
        <label>
          診療科
          <select
            value={values.departmentId}
            onChange={(e) => handleDepartmentChange(e.target.value)}
          >
            <option value="">選択してください</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          検査区分
          <select
            value={values.examCategory}
            onChange={(e) => update("examCategory", e.target.value as PathoExamCategory)}
          >
            {EXAM_CATEGORY_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.display}
              </option>
            ))}
          </select>
        </label>
        <label>
          報告区分
          <select
            value={values.reportStatus}
            onChange={(e) =>
              update("reportStatus", e.target.value as PathoResultFormValues["reportStatus"])
            }
          >
            {REPORT_STATUS_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.display}
              </option>
            ))}
          </select>
        </label>
        {/* 確定済みのレポートを直すと修正報告になることを、保存前に知らせる。 */}
        {willBecomeAmended(values) && (
          <p className="lab-result-form__notice">
            確定済みのレポートです。保存すると修正報告になります。
          </p>
        )}
        {!fixedOrderId && (
          <label>
            病理検査オーダー
            <select
              value={values.orderId}
              onChange={(e) => handleOrderChange(e.target.value)}
              disabled={orderCandidatesLoading}
            >
              <option value="">紐付けなし</option>
              {orderCandidatesLoading && values.orderId && (
                <option value={values.orderId}>読み込み中...</option>
              )}
              {orderCandidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.label}
                </option>
              ))}
              {/* 紐付け先のオーダーが削除されている場合に、選択が空へ化けないようにする。 */}
              {!orderCandidatesLoading &&
                values.orderId &&
                !orderCandidates.some((candidate) => candidate.id === values.orderId) && (
                  <option value={values.orderId}>(削除済みのオーダー)</option>
                )}
            </select>
          </label>
        )}
        {expandingOrderId && <p className="lab-result-form__notice">オーダーの検体を転記中...</p>}
      </fieldset>

      <fieldset>
        <legend>検体情報</legend>
        {values.specimens.length === 0 ? (
          <p className="order-select__muted">
            病理検査オーダーを選ぶと検体が転記されます。
            <button
              type="button"
              className="comment-add-button"
              onClick={() =>
                setValues((v) => ({ ...v, specimens: [emptyPathoResultSpecimen()] }))
              }
            >
              ＋検体を手入力
            </button>
          </p>
        ) : (
          <table className="rp-card__medicines rp-card__medicines--patho">
            <thead>
              <tr>
                <th>№</th>
                <th>臓器・検体</th>
                <th className="rp-card__patho-date">採取日</th>
              </tr>
            </thead>
            <tbody>
              {values.specimens.map((specimen, index) => (
                <tr key={specimen.id ?? index}>
                  <td>{index + 1}</td>
                  <td>{resultSpecimenLabel(specimen)}</td>
                  <td className="rp-card__patho-date">
                    <input
                      type="date"
                      value={specimen.collectedDate}
                      aria-label={`検体${index + 1}の採取日`}
                      onChange={(e) => updateSpecimen(index, { collectedDate: e.target.value })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </fieldset>

      <fieldset>
        <legend>所見</legend>
        <label className="patho-long-text">
          肉眼所見
          <textarea
            rows={5}
            value={values.gross}
            onChange={(e) => update("gross", e.target.value)}
            placeholder="検体の大きさ・割面の性状など"
          />
        </label>
        <label className="patho-long-text">
          顕微鏡所見
          <textarea
            rows={8}
            value={values.microscopic}
            onChange={(e) => update("microscopic", e.target.value)}
            placeholder="組織像・細胞像"
          />
        </label>
      </fieldset>

      <fieldset>
        <legend>診断</legend>
        {isCytology ? (
          <>
            <label>
              判定
              <select
                value={values.cytoJudgement}
                onChange={(e) => update("cytoJudgement", e.target.value)}
              >
                <option value="">選択してください</option>
                {CYTO_JUDGEMENT_OPTIONS.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.display}
                  </option>
                ))}
              </select>
            </label>
            <label>
              推定病変
              <input
                type="text"
                value={values.estimatedLesion}
                onChange={(e) => update("estimatedLesion", e.target.value)}
                placeholder="Papillary carcinoma など"
              />
            </label>
          </>
        ) : (
          <label className="patho-long-text">
            診断
            <textarea
              rows={8}
              value={values.diagnosis}
              onChange={(e) => update("diagnosis", e.target.value)}
              placeholder="診断名・取扱い規約や UICC の病期など"
            />
          </label>
        )}
      </fieldset>

      <fieldset>
        <legend>採取法／検体処理法</legend>
        <label className="patho-long-text">
          追加染色・検体処理
          <textarea
            rows={3}
            value={values.procedureStep}
            onChange={(e) => update("procedureStep", e.target.value)}
            placeholder="大腸 ブロックNo.10 D2-40 など"
          />
        </label>
      </fieldset>

      <div className="prescription-form__submit">
        <button type="submit" disabled={submitting}>
          {submitting ? "送信中..." : submitLabel}
        </button>
      </div>
    </form>
  );
}
