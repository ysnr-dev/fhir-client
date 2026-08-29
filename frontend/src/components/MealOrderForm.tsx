import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMealCategoryOptions, useMealItemOptions } from "../api/masterQueries";
import { refreshProblemDisplay } from "../fhir/conditionHelpers";
import {
  MEAL_SKIPPED,
  MEAL_TIMING_OPTIONS,
  emptyMealStaples,
  mealStapleText,
  mealTimingDisplay,
  previousMealPoint,
  summarizeMealOrder,
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
  /** 送信。closingIds は同時に終了させる継続中オーダーの id。 */
  onSubmit: (values: MealOrderFormValues, closingIds: string[]) => void;
  submitting: boolean;
  submitError?: unknown;
  submitLabel?: string;
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

  const problemOptions = useProblemOptions(patientId);
  const diets = useMealItemOptions("diet");
  const staples = useMealItemOptions("staple");

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

  // 継続中のオーダーは既定で全部終了させる。読み込みが後から届くので id を見て入れ直す。
  const activeIds = activeOrders.map((sr) => sr.id ?? "").join(",");
  useEffect(() => {
    setClosingIds(activeOrders.map((sr) => sr.id ?? "").filter(Boolean));
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
      staples: master.is_fasting ? emptyMealStaples() : prev.staples,
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
      // 食止めは 1 日を通して食事が出ないので、食事ごとの指定も持たない。
      staples: item?.is_fasting ? emptyMealStaples() : prev.staples,
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
    return { ...values, problem: refreshProblemDisplay(values.problem, problemOptions) };
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const error = validate(values.startDate);
    setValidationError(error);
    if (error) return;

    onSubmit(submitValues(), closingIds);
  }

  // 前の食事をいつまでにするか。チェックの説明にそのまま出す。
  const closePoint = previousMealPoint(values.startDate, values.startTiming);
  const closeLabel = `${closePoint.date} ${mealTimingDisplay(closePoint.timing)}まで`;

  return (
    <form className="prescription-form" onSubmit={handleSubmit}>
      {validationError && (
        <div className="error-banner" role="alert" ref={validationErrorRef}>
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}
      <ErrorBanner error={submitError} />
      <ErrorBanner error={diets.error ?? staples.error ?? mealCategories.error} />

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
            return (
              <label key={id} className="meal-active-order">
                <input
                  type="checkbox"
                  checked={closingIds.includes(id)}
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
            placeholder="アレルギー対応・きざみ など"
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
