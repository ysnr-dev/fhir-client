import { useState, type FormEvent } from "react";
import { useTransfusionProductOptions } from "../api/masterQueries";
import { usePretransfusionResults } from "../api/queries";
import { refreshProblemDisplay } from "../fhir/conditionHelpers";
import { SETTING_OPTIONS, type PrescriptionSetting } from "../fhir/prescriptionHelpers";
import {
  ABO_OPTIONS,
  PRIORITY_OPTIONS,
  RHD_OPTIONS,
  TEST_TYPE_OPTIONS,
  emptyTransfusionOrderForm,
  emptyTransfusionProduct,
  type AboBloodType,
  type RhdBloodType,
  type TransfusionOrderFormValues,
  type TransfusionOrderPriority,
  type TransfusionProductValues,
  type TransfusionTestType,
} from "../fhir/transfusionOrderHelpers";
import { makeFieldUpdater } from "../lib/form";
import { useProblemOptions } from "../hooks/useProblemOptions";
import { useValidationError } from "../hooks/useValidationError";
import { ErrorBanner } from "./ErrorBanner";
import { ProblemSelect } from "./ProblemSelect";

// 輸血オーダーの入力フォーム。病理検査と同じく明細(製剤)を可変リストで持つ。
//
// 製剤は施設ごとに数十件で収まるので、病理の臓器のような検索モーダルは作らず
// セレクトに全件並べる(食事の食種と同じ扱い)。製剤を選ぶと、マスタの既定単位数と
// 単位の呼び方をその行に写す。
//
// 検査区分(交差適合試験 / T&S)は輸血部門の作業が変わる軸なので 1 オーダーに 1 つ。
// 製剤マスタに「交差適合試験が要るか」を持たせてあるので、交差適合試験の要らない
// 製剤(血漿・血小板)だけを選んだときは T&S を既定にする。
//
// 血液型は「何型を出すか」を医師が明示して選ぶ。日本赤十字社の製剤ラベルと同じ色を
// 選択中の型に付けて、取り違えに気付きやすくする(docs/transfusion-order-design.md §2.5)。
// 隣に並ぶ検体検査の結果(ABO/RhD/不規則抗体)は参照で、オーダーには保存しない。
// 自動で選択に入れないのは、確認そのものが形骸化しないようにするため。

interface TransfusionOrderFormProps {
  patientId: string;
  initialValues?: TransfusionOrderFormValues;
  onSubmit: (values: TransfusionOrderFormValues) => void;
  submitting: boolean;
  submitError?: unknown;
  submitLabel?: string;
}

export function TransfusionOrderForm({
  patientId,
  initialValues,
  onSubmit,
  submitting,
  submitError,
  submitLabel = "登録",
}: TransfusionOrderFormProps) {
  const [values, setValues] = useState<TransfusionOrderFormValues>(
    initialValues ?? emptyTransfusionOrderForm(""),
  );
  const [validationError, setValidationError, validationErrorRef] = useValidationError();
  const [commentOpen, setCommentOpen] = useState(Boolean(initialValues?.comment));

  const problemOptions = useProblemOptions(patientId);
  const products = useTransfusionProductOptions();
  const pretransfusion = usePretransfusionResults(patientId);

  const productItems = products.data?.items ?? [];
  const update = makeFieldUpdater(setValues);

  function updateProduct(index: number, patch: Partial<TransfusionProductValues>) {
    setValues((v) => ({
      ...v,
      products: v.products.map((product, i) => (i === index ? { ...product, ...patch } : product)),
    }));
  }

  /**
   * 製剤を選んだときは、マスタの既定単位数・単位の呼び方・略称をその行に写す。
   * 単位数を手で入れたあとに製剤を選び直したときも既定値で上書きする(製剤が変われば
   * 適切な単位数も変わるため)。
   */
  function handleProductChange(index: number, code: string) {
    const item = productItems.find((i) => i.item_code === code);
    setValues((v) => {
      const current = v.products[index];
      // マスタから消えた製剤(選択肢に残してあるもの)を選び直したときは値を保つ。
      if (!item) {
        return {
          ...v,
          products: v.products.map((product, i) =>
            i === index ? { ...product, productCode: code } : product,
          ),
        };
      }
      const next: TransfusionProductValues = {
        ...current,
        productCode: item.item_code,
        productName: item.name,
        abbreviation: item.abbreviation ?? "",
        units: item.default_units === null ? "" : String(item.default_units),
        unitLabel: item.unit_label,
      };
      const nextProducts = v.products.map((product, i) => (i === index ? next : product));
      return { ...v, products: nextProducts, testType: defaultTestType(nextProducts, v.testType) };
    });
  }

  /**
   * 選ばれている製剤から決まる検査区分の既定。交差適合試験が要る製剤が 1 つでも
   * あれば交差適合試験、全て不要(血漿・血小板だけ)なら T&S。
   * 製剤が 1 つも選ばれていないうちは今の選択を変えない。
   */
  function defaultTestType(
    nextProducts: TransfusionProductValues[],
    current: TransfusionTestType,
  ): TransfusionTestType {
    const selected = nextProducts
      .map((product) => productItems.find((i) => i.item_code === product.productCode))
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
    if (selected.length === 0) return current;
    return selected.some((item) => item.requires_crossmatch) ? "crossmatch" : "type-screen";
  }

  function addProduct() {
    setValues((v) => ({ ...v, products: [...v.products, emptyTransfusionProduct()] }));
  }

  function removeProduct(index: number) {
    setValues((v) => ({
      ...v,
      // 製剤が 0 件のオーダーは意味を成さないので、最後の 1 件は消させない。
      products: v.products.length <= 1 ? v.products : v.products.filter((_, i) => i !== index),
    }));
  }

  function validate(): string | null {
    const filled = values.products.filter((product) => product.productCode);
    if (filled.length === 0) return "製剤を 1 つ以上選んでください。";
    if (filled.some((product) => !(Number(product.units) > 0))) {
      return "製剤の単位数を入れてください。";
    }
    if (!values.scheduledDateTime) return "投与予定日時を入れてください。";
    // 同意書は輸血の必須要件。未確認のまま出せてしまうと確認そのものが形骸化する。
    if (!values.consentConfirmed) return "輸血同意書の確認にチェックを入れてください。";
    return null;
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const error = validate();
    setValidationError(error);
    if (error) return;

    onSubmit({ ...values, problem: refreshProblemDisplay(values.problem, problemOptions) });
  }

  return (
    <form className="prescription-form" onSubmit={handleSubmit}>
      {validationError && (
        <div className="error-banner" role="alert" ref={validationErrorRef}>
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}
      <ErrorBanner error={submitError} />
      <ErrorBanner error={products.error} />

      <fieldset>
        <legend>血液型</legend>
        {/* 選択中の型は日赤の製剤ラベルと同じ色で塗る。オーダーを読む人が
            文字を読まずに型を掴めるようにするため。 */}
        <div className="transfusion-order__blood-type">
          <span className="transfusion-order__blood-type-label">ABO</span>
          <div className="transfusion-order__chips" role="group" aria-label="ABO血液型">
            {ABO_OPTIONS.map((option) => {
              const selected = values.aboBloodType === option.code;
              return (
                <button
                  key={option.code}
                  type="button"
                  aria-pressed={selected}
                  className={`transfusion-chip transfusion-chip--abo-${option.code.toLowerCase()}${
                    selected ? " transfusion-chip--selected" : ""
                  }`}
                  // もう一度押したら選択を外せる(取り違えて選んだときに戻せる)。
                  onClick={() => update("aboBloodType", selected ? "" : (option.code as AboBloodType))}
                >
                  {option.display}
                </button>
              );
            })}
          </div>

          <span className="transfusion-order__blood-type-label">RhD</span>
          <div className="transfusion-order__chips" role="group" aria-label="RhD血液型">
            {RHD_OPTIONS.map((option) => {
              const selected = values.rhdBloodType === option.code;
              return (
                <button
                  key={option.code}
                  type="button"
                  aria-pressed={selected}
                  className={`transfusion-chip transfusion-chip--rhd-${option.code}${
                    selected ? " transfusion-chip--selected" : ""
                  }`}
                  onClick={() => update("rhdBloodType", selected ? "" : (option.code as RhdBloodType))}
                >
                  {option.display}
                </button>
              );
            })}
          </div>
        </div>

        {/* 検体検査の結果。選んだ型と見比べられるよう、選択欄のすぐ下に置く。 */}
        <ul className="transfusion-order__pretest">
          {(pretransfusion.data ?? []).map((result) => (
            <li key={result.label} className="transfusion-order__pretest-item">
              <span className="transfusion-order__pretest-label">{result.label}</span>
              {result.value ? (
                <>
                  <span className="transfusion-order__pretest-value">{result.value}</span>
                  <span className="transfusion-order__pretest-date">{result.date}</span>
                </>
              ) : (
                <span className="transfusion-order__pretest-missing">未検査</span>
              )}
            </li>
          ))}
        </ul>
      </fieldset>

      <fieldset>
        <legend>依頼共通</legend>
        <label>
          輸血検査区分 *
          <select
            value={values.testType}
            onChange={(e) => update("testType", e.target.value as TransfusionTestType)}
          >
            {TEST_TYPE_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.display}
              </option>
            ))}
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
          至急区分
          <select
            value={values.priority}
            onChange={(e) => update("priority", e.target.value as TransfusionOrderPriority)}
          >
            {PRIORITY_OPTIONS.map((o) => (
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
        <label>
          投与予定日時 *
          <input
            type="datetime-local"
            value={values.scheduledDateTime}
            onChange={(e) => update("scheduledDateTime", e.target.value)}
          />
        </label>
        {commentOpen ? (
          <div className="prescription-form__comment-field">
            <label>
              依頼コメント
              <input
                type="text"
                value={values.comment}
                onChange={(e) => update("comment", e.target.value)}
              />
            </label>
            <button
              type="button"
              className="rp-card__icon-button"
              title="依頼コメントを削除"
              aria-label="依頼コメントを削除"
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
              ＋依頼コメント
            </button>
          </div>
        )}
      </fieldset>

      <fieldset>
        <legend>製剤 *</legend>
        <ul className="transfusion-order__products">
          {values.products.map((product, index) => (
            <ProductCard
              // 製剤は並べ替えず、追加・削除しかしないので index を鍵にしてよい。
              key={index}
              index={index}
              product={product}
              productItems={productItems}
              removable={values.products.length > 1}
              onProductChange={(code) => handleProductChange(index, code)}
              onChange={(patch) => updateProduct(index, patch)}
              onRemove={() => removeProduct(index)}
            />
          ))}
          <li className="transfusion-order__product-add">
            <button type="button" onClick={addProduct}>
              ＋製剤を追加
            </button>
          </li>
        </ul>
      </fieldset>

      {/* 輸血同意書。未確認のまま出せると確認そのものが形骸化するので必須にする。
          未チェックのうちは枠を注意色にして、見落としたまま登録を押させない。 */}
      <fieldset>
        <legend>同意</legend>
        <label
          className={`transfusion-order__consent${
            values.consentConfirmed ? " transfusion-order__consent--done" : ""
          }`}
        >
          <input
            type="checkbox"
            checked={values.consentConfirmed}
            onChange={(e) => update("consentConfirmed", e.target.checked)}
          />
          <span className="transfusion-order__consent-text">輸血同意書を取得済み *</span>
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

// 製剤 1 行。製剤マスタから選び、単位数を入れる。
function ProductCard({
  index,
  product,
  productItems,
  removable,
  onProductChange,
  onChange,
  onRemove,
}: {
  index: number;
  product: TransfusionProductValues;
  productItems: { item_code: string; name: string; unit_label: string }[];
  removable: boolean;
  onProductChange: (code: string) => void;
  onChange: (patch: Partial<TransfusionProductValues>) => void;
  onRemove: () => void;
}) {
  const missing =
    product.productCode && !productItems.some((i) => i.item_code === product.productCode);

  return (
    <li className="transfusion-order__product">
      <div className="transfusion-order__product-head">
        <span className="transfusion-order__product-number">製剤{index + 1}</span>
        {removable && (
          <button
            type="button"
            className="rp-card__icon-button"
            title="この製剤を削除"
            aria-label={`製剤${index + 1}を削除`}
            onClick={onRemove}
          >
            ×
          </button>
        )}
      </div>

      <label className="transfusion-order__product-name">
        製剤
        <select value={product.productCode} onChange={(e) => onProductChange(e.target.value)}>
          <option value="">選択してください</option>
          {productItems.map((item) => (
            <option key={item.item_code} value={item.item_code}>
              {item.name}
            </option>
          ))}
          {/* マスタから消えた(有効期間切れの)製剤でも、保存済みの選択を失わせない。 */}
          {missing && (
            <option value={product.productCode}>{product.productName} (無効)</option>
          )}
        </select>
      </label>

      <label className="transfusion-order__product-units">
        単位数
        <input
          type="number"
          min={1}
          step={1}
          value={product.units}
          onChange={(e) => onChange({ units: e.target.value })}
        />
      </label>
      <span className="transfusion-order__product-unit-label">{product.unitLabel}</span>

      <label className="transfusion-order__product-note">
        備考
        <input
          type="text"
          value={product.note}
          onChange={(e) => onChange({ note: e.target.value })}
          placeholder="放射線照射済 など"
        />
      </label>
    </li>
  );
}
