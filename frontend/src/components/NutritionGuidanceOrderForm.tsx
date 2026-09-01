import { useMemo, useState, type FormEvent } from "react";
import { useMealCategoryOptions, useMealDietOptions } from "../api/masterQueries";
import { useActiveMealOrders } from "../api/queries";
import type { MealDiet } from "../api/masterClient";
import { refreshProblemDisplay } from "../fhir/conditionHelpers";
import { mealOrderDietRef } from "../fhir/mealOrderHelpers";
import { SETTING_OPTIONS, type PrescriptionSetting } from "../fhir/prescriptionHelpers";
import {
  questionnaireResponsePlainText,
  type TemplateBinding,
} from "../fhir/questionnaireResponseHelpers";
import {
  GUIDANCE_FORMAT_OPTIONS,
  emptyNutritionGuidanceOrderForm,
  validateNutritionGuidanceOrderForm,
  type NutritionGuidanceFormat,
  type NutritionGuidanceOrderFormValues,
} from "../fhir/nutritionGuidanceOrderHelpers";
import { makeFieldUpdater } from "../lib/form";
import { useProblemOptions } from "../hooks/useProblemOptions";
import { useValidationError } from "../hooks/useValidationError";
import { ConditionPickerModal } from "./ConditionPickerModal";
import { ErrorBanner } from "./ErrorBanner";
import { MealDietPickerModal } from "./MealDietPickerModal";
import { ProblemSelect } from "./ProblemSelect";
import { TemplateEntryModal } from "./TemplateEntryModal";
import { TemplateTextField } from "./TemplateTextField";

// 栄養指導オーダーの入力フォーム。リハビリと同じく明細も伝票レイアウトも無いので
// 1 枚のフォームで完結する。
//
// 指導形態(個別/集団)は診療報酬上の固定の分類で施設ごとに増減しないため、DB マスタを
// 持たずフロントの定数から選択肢を出す(docs/nutrition-guidance-order-design.md §2.3)。
//
// リハビリと違い療法種別・単位数・起算日・週頻度は持たない。栄養指導は療法の種類で
// 作業が分かれず、算定は実施ごとの「回数と指導時間」で決まるため。
//
// 対象疾患名は登録病名から選べる(放射線の依頼病名と同じ作り)。指示食種は食事オーダーと
// 同じ食種マスタから選ぶ。指導目的はテンプレートからも書ける(放射線の検査目的と同じ)。
//
// 時刻の入力欄は持たない。何時に指導するかは予約(Appointment)と実施記録(Procedure)の
// 担当で、オーダーは「いつからいつまで、何を対象に」を決める。

interface NutritionGuidanceOrderFormProps {
  patientId: string;
  initialValues?: NutritionGuidanceOrderFormValues;
  onSubmit: (values: NutritionGuidanceOrderFormValues) => void;
  submitting: boolean;
  submitError?: unknown;
  submitLabel?: string;
}

export function NutritionGuidanceOrderForm({
  patientId,
  initialValues,
  onSubmit,
  submitting,
  submitError,
  submitLabel = "登録",
}: NutritionGuidanceOrderFormProps) {
  const [values, setValues] = useState<NutritionGuidanceOrderFormValues>(
    initialValues ?? emptyNutritionGuidanceOrderForm(""),
  );
  const [validationError, setValidationError, validationErrorRef] = useValidationError();
  const [commentOpen, setCommentOpen] = useState(Boolean(initialValues?.comment));
  const [pickingDiet, setPickingDiet] = useState(false);
  const [pickingCondition, setPickingCondition] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);

  const problemOptions = useProblemOptions(patientId);
  const update = makeFieldUpdater(setValues);

  // 指示食種は食事オーダーと同じ食種マスタから選ぶ。件数が多く主成分量を比べて
  // 選ぶものなので、セレクトではなく食種選択の表を使う(食事オーダーと同じ)。
  const diets = useMealDietOptions();
  const mealCategories = useMealCategoryOptions();
  const dietItems = useMemo(() => diets.data?.items ?? [], [diets.data]);

  // 入院中なら今出ている食事オーダーの食種を参考に見せる。指示食種を選び直す手間を
  // 省くためのもので、押したときに同じ食種を写す(食事が出ていなければ帯ごと出ない)。
  const activeMealOrders = useActiveMealOrders(patientId, values.startDate);
  const currentDiet = activeMealOrders.data?.map(mealOrderDietRef).find(Boolean) ?? null;

  function handleDietSelect(diet: MealDiet) {
    update("targetDiet", { code: diet.item_code, name: diet.name });
    setPickingDiet(false);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const error = validateNutritionGuidanceOrderForm(values);
    setValidationError(error);
    if (error) return;

    onSubmit({ ...values, problem: refreshProblemDisplay(values.problem, problemOptions) });
  }

  return (
    <>
      <form className="prescription-form nutrition-guidance-form" onSubmit={handleSubmit}>
        {validationError && (
          <div className="error-banner" role="alert" ref={validationErrorRef}>
            <p className="error-banner__line error-banner__line--error">{validationError}</p>
          </div>
        )}
        <ErrorBanner error={submitError} />
        <ErrorBanner error={diets.error ?? mealCategories.error} />

        <fieldset>
          <legend>指導内容</legend>
          <label>
            指導形態 *
            <select
              value={values.format}
              onChange={(e) => update("format", e.target.value as NutritionGuidanceFormat)}
              required
            >
              <option value="">選択してください</option>
              {GUIDANCE_FORMAT_OPTIONS.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.display}
                </option>
              ))}
            </select>
          </label>
          <div className="nutrition-guidance-form__wide">
            <TemplateTextField
              label="指導目的"
              value={values.purpose}
              template={values.purposeTemplate}
              onChange={(purpose) => update("purpose", purpose)}
              onOpenTemplate={() => setTemplateOpen(true)}
              onClearTemplate={() => update("purposeTemplate", null)}
            />
          </div>
        </fieldset>

        {/* 期間。終了日を入れなければ継続で、部門一覧の「終了」か退院で終わる。 */}
        <fieldset>
          <legend>期間</legend>
          <label>
            開始日 *
            <input
              type="date"
              value={values.startDate}
              onChange={(e) => update("startDate", e.target.value)}
              required
            />
          </label>
          <label>
            終了日
            <input
              type="date"
              value={values.endDate}
              onChange={(e) => update("endDate", e.target.value)}
              placeholder="空欄なら継続"
            />
          </label>
        </fieldset>

        {/* 対象疾患名は特別食加算の算定要件そのものなので必須。 */}
        <fieldset>
          <legend>対象</legend>
          <label>
            対象疾患名 *
            <div className="rad-gp__reason">
              <input
                type="text"
                value={values.targetDisease}
                placeholder="病名を直接入力"
                // 手で書き換えたら登録病名との紐付けは外す(別の文言になるため)。
                onChange={(e) =>
                  setValues((v) => ({
                    ...v,
                    targetDisease: e.target.value,
                    targetConditionId: "",
                  }))
                }
                aria-label="対象疾患名"
                required
              />
              {/* 登録済みの病名から写す。候補が数十件になっても選べるよう、
                  絞り込みのできるモーダルで選ぶ(放射線の依頼病名と同じ)。 */}
              <div className="rad-gp__reason-actions">
                <button
                  type="button"
                  onClick={() => setPickingCondition(true)}
                  title="登録されている病名から選ぶ"
                >
                  病名
                </button>
              </div>
            </div>
          </label>

          {/* 指示食種。食種マスタの表で選び、選んだ食種を名称で見せる。 */}
          <div className="meal-diet-field">
            <span className="meal-diet-field__label">指示食種</span>
            <div className="meal-diet-field__body">
              <div className="meal-diet-field__name">
                {values.targetDiet ? (
                  <strong>{values.targetDiet.name}</strong>
                ) : (
                  <span className="meal-diet-field__placeholder">選択してください</span>
                )}
                <button type="button" onClick={() => setPickingDiet(true)}>
                  {values.targetDiet ? "変更" : "食種を選択"}
                </button>
                {values.targetDiet && (
                  <button type="button" onClick={() => update("targetDiet", null)}>
                    解除
                  </button>
                )}
              </div>
              {/* いま出ている食事と違う食種を指導することもあるので、上書きはせず
                  「写す」ボタンで選ばせる。 */}
              {currentDiet && currentDiet.code !== values.targetDiet?.code && (
                <p className="order-select__muted">
                  現在の食事オーダー: {currentDiet.name}
                  <button
                    type="button"
                    className="nutrition-guidance-form__diet-copy"
                    onClick={() => update("targetDiet", currentDiet)}
                  >
                    指示食種に写す
                  </button>
                </p>
              )}
            </div>
          </div>

          <label>
            対象プロブレム
            <ProblemSelect
              value={values.problem}
              options={problemOptions}
              onChange={(problem) => update("problem", problem)}
            />
          </label>
        </fieldset>

        <fieldset>
          <legend>依頼共通</legend>
          <label>
            入外区分
            <select
              value={values.setting}
              onChange={(e) => update("setting", e.target.value as PrescriptionSetting)}
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
            依頼日
            <input
              type="date"
              value={values.authoredDate}
              onChange={(e) => update("authoredDate", e.target.value)}
            />
          </label>
          {commentOpen ? (
            <div className="prescription-form__comment-field">
              <label>
                栄養部門への指示
                <input
                  type="text"
                  value={values.comment}
                  onChange={(e) => update("comment", e.target.value)}
                  placeholder="ベッドサイドでお願いします など"
                />
              </label>
              <button
                type="button"
                className="rp-card__icon-button"
                title="栄養部門への指示を削除"
                aria-label="栄養部門への指示を削除"
                onClick={() => {
                  setCommentOpen(false);
                  update("comment", "");
                }}
              >
                ×
              </button>
            </div>
          ) : (
            <div className="prescription-form__comment-toggle">
              <button
                type="button"
                className="comment-add-button"
                onClick={() => setCommentOpen(true)}
              >
                ＋栄養部門への指示
              </button>
            </div>
          )}
        </fieldset>

        <div className="prescription-form__actions">
          <button type="submit" disabled={submitting}>
            {submitting ? "保存中..." : submitLabel}
          </button>
        </div>
      </form>

      {/* モーダルはどれも独自の入力を持つので form の外に置く
          — form の入れ子は不正で、送信が外へ漏れる。 */}
      {pickingDiet && (
        <MealDietPickerModal
          diets={dietItems}
          categories={mealCategories.data?.items ?? []}
          error={diets.error}
          selectedCode={values.targetDiet?.code}
          onSelect={handleDietSelect}
          onClose={() => setPickingDiet(false)}
        />
      )}

      {pickingCondition && (
        <ConditionPickerModal
          patientId={patientId}
          title="対象疾患名を選択"
          onSelect={({ conditionId, name }) => {
            setValues((v) => ({ ...v, targetDisease: name, targetConditionId: conditionId }));
            setPickingCondition(false);
          }}
          onClose={() => setPickingCondition(false)}
        />
      )}

      {templateOpen && (
        <TemplateEntryModal
          patientId={patientId}
          draft={values.purposeTemplate?.draft ?? null}
          responseId={values.purposeTemplate?.responseId ?? null}
          onSubmit={(draft) => {
            // 保存済みの回答を再編集した場合は同じ id へ書き戻す(id は保存時に使う)。
            const binding: TemplateBinding = {
              responseId: values.purposeTemplate?.responseId ?? null,
              draft,
            };
            setValues((current) => ({
              ...current,
              purpose: questionnaireResponsePlainText(draft.questionnaire, draft.response),
              purposeTemplate: binding,
            }));
            setTemplateOpen(false);
          }}
          onClose={() => setTemplateOpen(false)}
        />
      )}
    </>
  );
}
