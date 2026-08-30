import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMealCategoryOptions, useMealItemOptions } from "../api/masterQueries";
import { refreshProblemDisplay } from "../fhir/conditionHelpers";
import {
  MEAL_FASTING_REASON_OPTIONS,
  MEAL_SKIPPED,
  MEAL_TIMING_OPTIONS,
  emptyMealStaples,
  mealOrderHasFasting,
  mealOrderResumable,
  mealStapleText,
  mealTimingDisplay,
  nextMealPoint,
  parseSaltLimit,
  previousMealPoint,
  summarizeMealOrder,
  type MealFastingReason,
  type MealOrderFormValues,
  type MealStapleChoice,
  type MealTiming,
} from "../fhir/mealOrderHelpers";
import { useProblemOptions } from "../hooks/useProblemOptions";
import { useValidationError } from "../hooks/useValidationError";
import { ErrorBanner } from "./ErrorBanner";
import { ProblemSelect } from "./ProblemSelect";

// 食事オーダーの入力フォーム。他の部門オーダーと違い伝票レイアウトも明細も無く、
// 食種 1 つ(+主食 1 つ)を選ぶだけなので 1 枚のフォームで完結する。
//
// 入外区分の選択欄は無い。食事は入院患者にだけ出すオーダーなので、パネル側で
// 入院中かどうかを確かめてからこのフォームを描いている。

interface MealOrderFormProps {
  patientId: string;
  initialValues: MealOrderFormValues;
  /** 継続中の食事オーダー。食事変更で終了させる候補として出す。 */
  activeOrders?: fhir4.ServiceRequest[];
  /**
   * 送信。closingIds は同時に終了させる継続中オーダーの id、resumeIds はこの
   * オーダーの終了後に元の食事へ戻す(再開オーダーを作る)オーダーの id。
   */
  onSubmit: (values: MealOrderFormValues, closingIds: string[], resumeIds: string[]) => void;
  submitting: boolean;
  submitError?: unknown;
  submitLabel?: string;
}

/**
 * 食止めの食種を選んだときに落とす「食事の中身」。1 日を通して食事が出ないので、
 * 主食・欠食も副食形態も塩分制限も指示する先が無い。
 */
function clearedMealContent() {
  return { staples: emptyMealStaples(), sideDishForm: null, saltLimit: "" } as const;
}

/** 開始・終了の前後比較に使う並び順の番号。 */
function timingIndex(timing: MealTiming): number {
  return MEAL_TIMING_OPTIONS.findIndex((t) => t.code === timing);
}

export function MealOrderForm({
  patientId,
  initialValues,
  activeOrders = [],
  onSubmit,
  submitting,
  submitError,
  submitLabel = "登録",
}: MealOrderFormProps) {
  const [values, setValues] = useState<MealOrderFormValues>(initialValues);
  const [validationError, setValidationError, validationErrorRef] = useValidationError();
  // 食事変更で終了させるオーダー。既定は全て終了(食事は同時に 1 本が原則)。
  const [closingIds, setClosingIds] = useState<string[]>([]);
  // このオーダーの終了後に元の食事へ戻すオーダー。既定は戻す(外泊中の食止めのように
  // 期限付きの食事を挟んだあとは、元の食事に戻るのがふつう)。
  const [resumeIds, setResumeIds] = useState<string[]>([]);

  const problemOptions = useProblemOptions(patientId);
  const diets = useMealItemOptions("diet");
  const staples = useMealItemOptions("staple");
  // 副食形態(きざみ・ミキサー など)。主食と違い朝昼夕の軸が無いのでセレクト 1 つ。
  const sideDishForms = useMealItemOptions("side_dish_form");

  const dietItems = useMemo(() => diets.data?.items ?? [], [diets.data]);
  // 食種の種別(一般食・特別食 など)。セレクトを種別ごとにまとめて選びやすくする。
  const mealCategories = useMealCategoryOptions();
  const dietGroups = useMemo(() => {
    const categories = mealCategories.data?.items ?? [];
    const groups = categories.map((category) => ({
      label: category.name,
      items: dietItems.filter((item) => item.category_code === category.category_code),
    }));
    // 種別が付いていない食種(消した種別を指したままの食種も含む)は最後にまとめる。
    const classified = new Set(categories.map((c) => c.category_code));
    const rest = dietItems.filter(
      (item) => !item.category_code || !classified.has(item.category_code),
    );
    if (rest.length > 0) groups.push({ label: "その他", items: rest });
    return groups.filter((group) => group.items.length > 0);
  }, [dietItems, mealCategories.data]);
  // 種別を 1 件も登録していない施設では、まとめても見出しが 1 つ増えるだけなので出さない。
  const groupDiets = (mealCategories.data?.items ?? []).length > 0;
  const stapleItems = staples.data?.items ?? [];
  const sideDishFormItems = sideDishForms.data?.items ?? [];

  // 継続中のオーダーは既定で全部終了させる。読み込みが後から届くので id を見て入れ直す。
  const activeIds = activeOrders.map((sr) => sr.id ?? "").join(",");
  useEffect(() => {
    const ids = activeOrders.map((sr) => sr.id ?? "").filter(Boolean);
    setClosingIds(ids);
    setResumeIds(ids);
    // activeOrders は毎回新しい配列で届くので、id の並びが変わったときだけ入れ直す。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIds]);

  // 食止めかどうかはマスタ側の属性で、オーダーには写していない。編集で開いた
  // ときはマスタが届いてから主食欄の可否を決め直す。
  useEffect(() => {
    if (!values.diet || dietItems.length === 0) return;
    const master = dietItems.find((item) => item.item_code === values.diet?.code);
    if (!master || master.is_fasting === values.dietIsFasting) return;
    setValues((prev) => ({
      ...prev,
      dietIsFasting: master.is_fasting,
      ...(master.is_fasting ? clearedMealContent() : null),
    }));
  }, [dietItems, values.diet, values.dietIsFasting]);

  function update<K extends keyof MealOrderFormValues>(key: K, value: MealOrderFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function handleDietChange(code: string) {
    const item = dietItems.find((i) => i.item_code === code);
    setValues((prev) => ({
      ...prev,
      diet: item ? { code: item.item_code, name: item.name } : null,
      dietIsFasting: item?.is_fasting ?? false,
      // 食止めは 1 日を通して食事が出ないので、食事の中身の指定も持たない。
      ...(item?.is_fasting ? clearedMealContent() : null),
    }));
  }

  function handleSideDishFormChange(code: string) {
    const item = sideDishFormItems.find((i) => i.item_code === code);
    setValues((prev) => ({
      ...prev,
      // マスタから消えた副食形態は選択肢に残してあるので、選び直せるようにする。
      sideDishForm: item
        ? { code: item.item_code, name: item.name }
        : prev.sideDishForm?.code === code
          ? prev.sideDishForm
          : null,
    }));
  }

  function handleStapleChange(timing: MealTiming, value: string) {
    setValues((prev) => {
      const current = prev.staples[timing];
      let choice: MealStapleChoice = null;
      if (value === MEAL_SKIPPED) {
        choice = MEAL_SKIPPED;
      } else if (value) {
        const item = stapleItems.find((i) => i.item_code === value);
        // マスタから消えた主食は選択肢に残してあるので、選び直せるようにする。
        choice = item
          ? { code: item.item_code, name: item.name }
          : current && current !== MEAL_SKIPPED && current.code === value
            ? current
            : null;
      }
      return { ...prev, staples: { ...prev.staples, [timing]: choice } };
    });
  }

  /** セレクトに出す値。null は「指定なし」の空文字。 */
  function stapleValue(choice: MealStapleChoice): string {
    if (choice === MEAL_SKIPPED) return MEAL_SKIPPED;
    return choice?.code ?? "";
  }

  /**
   * 入力の検証。startDate は「そのオーダーが始まる日」で、食事変更として登録する
   * ときだけ暦で押した日に差し替わる(終了との前後もその日で見る)。
   */
  function validate(startDate: string): string {
    if (!values.diet) return "食種を選んでください。";
    // 1 日を通して食事が出ないなら、それは欠食ではなく食止めの食種。
    if (
      !values.dietIsFasting &&
      MEAL_TIMING_OPTIONS.every((t) => values.staples[t.code] === MEAL_SKIPPED)
    ) {
      return "すべての食事が欠食のときは、食種で「食止め」を選んでください。";
    }
    // 数値でない・負の入力は保存で黙って落ちてしまうので、ここで止める。
    if (values.saltLimit.trim() && parseSaltLimit(values.saltLimit) === undefined) {
      return "塩分制限は 0 以上の数値で入れてください。";
    }
    if (!startDate) return "開始日を入れてください。";
    if (values.endDate) {
      const beforeStart =
        values.endDate < startDate ||
        (values.endDate === startDate &&
          timingIndex(values.endTiming) < timingIndex(values.startTiming));
      if (beforeStart) return "終了は開始と同じか、それより後にしてください。";
    }
    return "";
  }

  function submitValues(): MealOrderFormValues {
    return {
      ...values,
      // 食事が出るだけのオーダーに欠食理由は付かない(食種を食止めから戻したときに
      // 理由だけ残らないよう落とす)。ただし食種マスタが届く前は食止めかどうかを
      // 判定できないので、そのときは元の値をそのまま保つ。
      fastingReason:
        dietItems.length === 0 || mealOrderHasFasting(values) ? values.fastingReason : "",
      // 食止めでは食事が出ないので、副食形態・塩分制限は持たせない(欄も無効にして
      // あるが、食種を食止めに変える前に入れた値がここに残っているため)。
      ...(values.dietIsFasting ? clearedMealContent() : null),
      problem: refreshProblemDisplay(values.problem, problemOptions),
    };
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const error = validate(values.startDate);
    setValidationError(error);
    if (error) return;

    // 終了させないオーダーは戻す対象にもならない(チェックも出ていない)。
    onSubmit(submitValues(), closingIds, resumeIds.filter((id) => closingIds.includes(id)));
  }

  // 欠食理由を出すか。食止めの食種か、1 食でも欠食があるときだけ(食事が出るだけの
  // オーダーには付かない項目なので、欄ごと出さない)。
  const needsFastingReason = mealOrderHasFasting(values);

  // 前の食事をいつまでにするか。チェックの説明にそのまま出す。
  const closePoint = previousMealPoint(values.startDate, values.startTiming);
  const closeLabel = `${closePoint.date} ${mealTimingDisplay(closePoint.timing)}まで`;
  // このオーダーが終わったあと、元の食事に戻す点(終了の次の食事)。終了を決めて
  // いなければ戻す先が無いので、チェックごと出さない。
  const resumePoint = values.endDate ? nextMealPoint(values.endDate, values.endTiming) : null;
  const resumeLabel = resumePoint
    ? `${resumePoint.date} ${mealTimingDisplay(resumePoint.timing)}から`
    : "";

  return (
    <form className="prescription-form" onSubmit={handleSubmit}>
      {validationError && (
        <div className="error-banner" role="alert" ref={validationErrorRef}>
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}
      <ErrorBanner error={submitError} />
      <ErrorBanner
        error={diets.error ?? staples.error ?? sideDishForms.error ?? mealCategories.error}
      />

      <fieldset>
        <legend>食事内容</legend>
        <label>
          食種
          <select
            value={values.diet?.code ?? ""}
            onChange={(e) => handleDietChange(e.target.value)}
            required
          >
            <option value="">選択してください</option>
            {groupDiets
              ? dietGroups.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.items.map((item) => (
                      <option key={item.item_code} value={item.item_code}>
                        {item.name}
                      </option>
                    ))}
                  </optgroup>
                ))
              : dietItems.map((item) => (
                  <option key={item.item_code} value={item.item_code}>
                    {item.name}
                  </option>
                ))}
            {/* マスタから消えた食種でも、保存済みの選択を失わせない。 */}
            {values.diet && !dietItems.some((i) => i.item_code === values.diet?.code) && (
              <option value={values.diet.code}>{values.diet.name} (無効)</option>
            )}
          </select>
        </label>
        {/* 副食形態(きざみ・ミキサー など)。主食と違い朝昼夕で変えることが無いので
            セレクト 1 つで全食に効く。食止めでは食事が出ないので無効にする。 */}
        <label>
          副食形態
          <select
            value={values.sideDishForm?.code ?? ""}
            onChange={(e) => handleSideDishFormChange(e.target.value)}
            disabled={values.dietIsFasting}
          >
            <option value="">(指定なし)</option>
            {sideDishFormItems.map((item) => (
              <option key={item.item_code} value={item.item_code}>
                {item.name}
              </option>
            ))}
            {/* マスタから消えた副食形態でも、保存済みの選択を失わせない。 */}
            {values.sideDishForm &&
              !sideDishFormItems.some((i) => i.item_code === values.sideDishForm?.code) && (
                <option value={values.sideDishForm.code}>
                  {values.sideDishForm.name} (無効)
                </option>
              )}
          </select>
        </label>
        {/* 塩分制限(g/日)。食種名に含意されないことがあるので独立した欄で持つ。 */}
        <label>
          塩分制限(g/日)
          <input
            type="number"
            min="0"
            step="0.1"
            value={values.saltLimit}
            onChange={(e) => update("saltLimit", e.target.value)}
            disabled={values.dietIsFasting}
            placeholder="制限なしなら空欄"
          />
        </label>
        {/* 欠食理由。給食部門のはい膳表に出す前提の項目で、なぜ食事を出さないかを
            食種・主食とは別に持つ(参考仕様の欠食理由)。外出泊による食止めは
            入退院側の連動が「外泊」を自動で入れるので、ここで選ぶのは手で出す
            食止め・欠食のとき。 */}
        {needsFastingReason && (
          <label>
            欠食理由
            <select
              value={values.fastingReason}
              onChange={(e) => update("fastingReason", e.target.value as MealFastingReason)}
            >
              <option value="">(入力せず)</option>
              {MEAL_FASTING_REASON_OPTIONS.map((reason) => (
                <option key={reason.code} value={reason.code}>
                  {reason.display}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          対象プロブレム
          <ProblemSelect
            value={values.problem}
            options={problemOptions}
            onChange={(problem) => update("problem", problem)}
          />
        </label>
      </fieldset>

      {/* 主食は朝・昼・夕で変わることがある(米飯 → 全粥、昼だけ検査で欠食 など)ので
          常に 3 食ぶん並べる。SS-MIX2 の ODS-2(サービス時間帯)ごとの指定にあたる。
          食止めの食種は 1 日を通して食事が出ないため、まとめて無効にする。 */}
      <fieldset>
        <legend>主食</legend>
        {MEAL_TIMING_OPTIONS.map((timing) => {
          const choice = values.staples[timing.code];
          const missing =
            choice && choice !== MEAL_SKIPPED && !stapleItems.some((i) => i.item_code === choice.code)
              ? choice
              : null;
          return (
            <label key={timing.code}>
              {timing.display}
              <select
                value={stapleValue(choice)}
                onChange={(e) => handleStapleChange(timing.code, e.target.value)}
                disabled={values.dietIsFasting}
              >
                <option value="">(指定なし)</option>
                {stapleItems.map((item) => (
                  <option key={item.item_code} value={item.item_code}>
                    {item.name}
                  </option>
                ))}
                {/* マスタから消えた主食でも、保存済みの選択を失わせない。 */}
                {missing && (
                  <option value={missing.code}>{missing.name} (無効)</option>
                )}
                {/* 欠食は主食ではなく「その食事は出さない」指示。並びを分けたいので末尾。 */}
                <option value={MEAL_SKIPPED}>欠食</option>
              </select>
            </label>
          );
        })}
        {values.dietIsFasting && (
          <p className="order-select__muted">
            食止めの食種では 1 日を通して食事が出ないので、主食は指定しません。
          </p>
        )}
      </fieldset>

      {/* 食事は「何日の何食から」始まって「何日の何食まで」続く。終了を入れなければ
          継続で、次の食事オーダーを出したときに終わる。 */}
      <fieldset>
        <legend>期間</legend>
        <label>
          開始日
          <input
            type="date"
            value={values.startDate}
            onChange={(e) => update("startDate", e.target.value)}
            required
          />
        </label>
        <label>
          開始
          <select
            value={values.startTiming}
            onChange={(e) => update("startTiming", e.target.value as MealTiming)}
          >
            {MEAL_TIMING_OPTIONS.map((t) => (
              <option key={t.code} value={t.code}>
                {t.display}食から
              </option>
            ))}
          </select>
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
        <label>
          終了
          <select
            value={values.endTiming}
            onChange={(e) => update("endTiming", e.target.value as MealTiming)}
            disabled={!values.endDate}
          >
            {MEAL_TIMING_OPTIONS.map((t) => (
              <option key={t.code} value={t.code}>
                {t.display}食まで
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      {/* 食事変更。新しい食事を出すと同時に、いま出ている食事を直前の食事で
          終える(2 本が並んで出続けるのを防ぐ)。 */}
      {activeOrders.length > 0 && (
        <fieldset>
          <legend>いま出ている食事</legend>
          {activeOrders.map((sr) => {
            const summary = summarizeMealOrder(sr);
            const id = sr.id ?? "";
            const closing = closingIds.includes(id);
            // 終了を決めたオーダー(外泊中の食止め など)は、終わったあとに元の食事へ
            // 戻さないと食事が無い日が続いてしまう。戻す余地があるときだけ出す。
            const canResume =
              closing && mealOrderResumable(sr, values.endDate, values.endTiming);
            return (
              <div key={id} className="meal-active-order-group">
                <label className="meal-active-order">
                  <input
                    type="checkbox"
                    checked={closing}
                    onChange={(e) =>
                      setClosingIds((prev) =>
                        e.target.checked ? [...prev, id] : prev.filter((x) => x !== id),
                      )
                    }
                  />
                  {summary.dietName}
                  {mealStapleText(summary) && `(${mealStapleText(summary)})`} {summary.startLabel}〜
                  を {closeLabel} で終了する
                </label>
                {canResume && (
                  <label className="meal-active-order meal-active-order--resume">
                    <input
                      type="checkbox"
                      checked={resumeIds.includes(id)}
                      onChange={(e) =>
                        setResumeIds((prev) =>
                          e.target.checked ? [...prev, id] : prev.filter((x) => x !== id),
                        )
                      }
                    />
                    このオーダーの終了後、{resumeLabel} この食事に戻す
                  </label>
                )}
              </div>
            );
          })}
        </fieldset>
      )}

      <fieldset>
        <legend>コメント</legend>
        {/* fieldset が flex なので、明示しないと入力欄が内容幅で止まる(surgery-comment と同じ)。 */}
        <label className="meal-comment">
          給食部門への指示
          <textarea
            value={values.comment}
            onChange={(e) => update("comment", e.target.value)}
            rows={2}
            placeholder="アレルギー対応・配膳先 など"
          />
        </label>
      </fieldset>

      <div className="prescription-form__actions">
        <button type="submit" disabled={submitting}>
          {submitting ? "保存中..." : submitLabel}
        </button>
      </div>
    </form>
  );
}
