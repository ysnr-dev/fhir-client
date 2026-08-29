import { useState, type FormEvent } from "react";
import { useCurrentPractitioner } from "../api/authQueries";
import { useTransfusionProductOptions } from "../api/masterQueries";
import { useRegisterTransfusionPerform } from "../api/queries";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import {
  REACTION_OPTIONS,
  buildTransfusionPerformBundle,
  emptyTransfusionPerformForm,
  type TransfusionBagLine,
  type TransfusionPerformFormValues,
  type TransfusionReaction,
} from "../fhir/transfusionResultHelpers";
import { TransfusionBloodBadge } from "./TransfusionBloodBadge";
import { summarizeTransfusionOrder } from "../fhir/transfusionOrderHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

// 輸血の実施入力。手術(SurgeryPerformModal)と同じく、実施記録一式と Task の完了を
// 1 つの transaction で登録する。
//
// **入口が 2 つある**のがこのモーダルの他部門との違い。輸血は出庫するのが輸血部門、
// 投与するのが病棟で、実際に投与した人が記録を書けなければ意味が無い
// (docs/transfusion-order-design.md §5.1)。
// - 輸血一覧の「実施」… 部門が病棟から受けた報告を代わりに入れる
// - カルテカードの「実施入力」… 投与した病棟がその場で入れる
// どちらも同じ Bundle を書くので、送信まで含めてこのコンポーネントで完結させる。
//
// 初期表示はオーダーの製剤をそのままバッグの行にしたもの。実際に出庫されたバッグが
// オーダーと違うこともあるので、行の追加・削除と製剤の選び直しができる。
//
// 製剤はオーダー画面と同じ**製剤マスタのセレクト**にする。名前をそのまま打てるように
// すると、MedicationAdministration の coding に載るコードが選び直しに追従せず、
// 「コードは A 製剤・表示は B 製剤」という記録ができてしまう。製剤番号を必須にして
// 遡及調査の起点にしている以上、製剤コードが実物と食い違ってはいけない。
// マスタに無い製剤を使ったときは、マスタ側を直すのが筋。

function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9L12 4M6.5 6.5v5M9.5 6.5v5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface Props {
  order: fhir4.ServiceRequest;
  /** オーダーの製剤明細。バッグの初期行を作るのに使う。 */
  itemRequests: fhir4.ServiceRequest[];
  task: fhir4.Task | undefined;
  /** 誰の輸血かを見出しに出す。取り違え防止のため。 */
  patientName?: string;
  onClose: () => void;
}

export function TransfusionPerformModal({
  order,
  itemRequests,
  task,
  patientName,
  onClose,
}: Props) {
  const register = useRegisterTransfusionPerform();
  const { practitionerId, practitioner } = useCurrentPractitioner();
  const products = useTransfusionProductOptions();
  const productItems = products.data?.items ?? [];
  const summary = summarizeTransfusionOrder(order);

  const [values, setValues] = useState<TransfusionPerformFormValues>(() =>
    emptyTransfusionPerformForm(itemRequests),
  );
  const [validationError, setValidationError] = useState<string | null>(null);

  function update<K extends keyof TransfusionPerformFormValues>(
    key: K,
    value: TransfusionPerformFormValues[K],
  ) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function updateBag(index: number, patch: Partial<TransfusionBagLine>) {
    setValues((prev) => ({
      ...prev,
      bags: prev.bags.map((bag, i) => (i === index ? { ...bag, ...patch } : bag)),
    }));
  }

  /**
   * 製剤を選び直したときは、コード・名称・単位の呼び方をまとめて入れ替える
   * (バラバラに持つと記録が食い違う)。単位数は上書きしない —— ここは「実際に
   * 何単位入れたか」の記録で、入力済みの値を製剤の既定値で消してはいけない。
   * まだ空の行(手で足したバッグ)にだけ既定値を入れる。
   */
  function handleProductChange(index: number, code: string) {
    const item = productItems.find((i) => i.item_code === code);
    if (!item) {
      // マスタから消えた製剤(選択肢に残してあるもの)を選び直したときは値を保つ。
      updateBag(index, { productCode: code });
      return;
    }
    setValues((prev) => ({
      ...prev,
      bags: prev.bags.map((bag, i) =>
        i === index
          ? {
              ...bag,
              productCode: item.item_code,
              productName: item.name,
              unitLabel: item.unit_label,
              units: bag.units || (item.default_units === null ? "" : String(item.default_units)),
            }
          : bag,
      ),
    }));
  }

  function addBag() {
    setValues((prev) => ({
      ...prev,
      bags: [
        ...prev.bags,
        {
          productCode: "",
          productName: "",
          units: "",
          unitLabel: "単位",
          lotNumber: "",
          startedAt: "",
          endedAt: "",
        },
      ],
    }));
  }

  function removeBag(index: number) {
    setValues((prev) => ({ ...prev, bags: prev.bags.filter((_, i) => i !== index) }));
  }

  function validate(): string | null {
    if (!values.startedAt) return "開始時刻を入れてください。";
    if (values.endedAt && values.endedAt < values.startedAt) {
      return "終了時刻は開始時刻より後にしてください。";
    }
    // 製剤が選ばれていない行は保存しないので、検証も選ばれた行だけで行う。
    const bags = values.bags.filter((bag) => bag.productCode);
    if (bags.length === 0) return "輸血したバッグの製剤を 1 本以上選んでください。";
    // 製剤番号は遡及調査の起点。空のまま登録できると、後から追えなくなる。
    if (bags.some((bag) => !bag.lotNumber.trim())) return "製剤番号を入れてください。";
    // 「観察していない」と「観察して無かった」を区別するため、必ず選ばせる。
    if (!values.reaction) return "副作用の有無を選んでください。";
    if (values.reaction === "present" && !values.reactionNote.trim()) {
      return "副作用の内容を入れてください。";
    }
    return null;
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const error = validate();
    setValidationError(error);
    if (error) return;

    const submitted: TransfusionPerformFormValues = {
      ...values,
      performerId: practitionerId ?? "",
      performerName: practitioner ? practitionerDisplayName(practitioner) : "",
      // 製剤を選んでいない行(足したまま入力しなかった行)は落とす。
      bags: values.bags.filter((bag) => bag.productCode),
    };
    register.mutate(buildTransfusionPerformBundle(submitted, order, task), {
      onSuccess: onClose,
    });
  }

  return (
    <Modal
      title={`輸血の実施入力${patientName ? ` - ${patientName}` : ""}`}
      onClose={onClose}
      className="modal--wide"
    >
      <form className="transfusion-perform" onSubmit={handleSubmit}>
        {validationError && (
          <div className="error-banner" role="alert">
            <p className="error-banner__line error-banner__line--error">{validationError}</p>
          </div>
        )}
        <ErrorBanner error={register.error} />
        <ErrorBanner error={products.error} />

        {/* 誰の何型の輸血なのか。取り違えると別の患者に別の型を入れた記録が残るので、
            入力欄より先に目に入る位置と大きさで出す。 */}
        <p className="rad-perform__items">
          <span className="rad-perform__items-label">血液型</span>
          {summary.bloodTypeDisplay ? (
            <TransfusionBloodBadge abo={summary.aboBloodType} rhd={summary.rhdBloodType} />
          ) : (
            "未指定"
          )}
        </p>

        <div className="lab-order-item__fields">
          <label>
            開始時刻 *
            <input
              type="datetime-local"
              value={values.startedAt}
              onChange={(e) => update("startedAt", e.target.value)}
              required
            />
          </label>
          <label>
            終了時刻
            <input
              type="datetime-local"
              value={values.endedAt}
              onChange={(e) => update("endedAt", e.target.value)}
            />
          </label>
          <label>
            実施者
            <input
              type="text"
              value={practitioner ? practitionerDisplayName(practitioner) : "(未設定)"}
              readOnly
              disabled
            />
          </label>
        </div>

        <section className="lab-order-item__section">
          <div className="lab-order-item__section-head">
            <h3>輸血したバッグ *</h3>
            <button type="button" onClick={addBag}>
              バッグを追加
            </button>
          </div>
          <ul className="transfusion-order__products">
            {values.bags.map((bag, index) => (
              <BagCard
                // バッグは並べ替えず、追加・削除しかしないので index を鍵にしてよい。
                key={index}
                index={index}
                bag={bag}
                productItems={productItems}
                onProductChange={(code) => handleProductChange(index, code)}
                onChange={(patch) => updateBag(index, patch)}
                onRemove={() => removeBag(index)}
              />
            ))}
            {values.bags.length === 0 && (
              <li className="order-select__muted">「バッグを追加」から入れてください。</li>
            )}
          </ul>
        </section>

        {/* 副作用。観察したうえで無かったことも記録として要るので、「なし」も選ばせる。 */}
        <section className="lab-order-item__section">
          <div className="lab-order-item__section-head">
            <h3>副作用 *</h3>
          </div>
          <div className="transfusion-order__blood-type">
            <div className="transfusion-order__chips" role="group" aria-label="副作用の有無">
              {REACTION_OPTIONS.map((option) => {
                const selected = values.reaction === option.code;
                return (
                  <button
                    key={option.code}
                    type="button"
                    aria-pressed={selected}
                    className={`transfusion-chip transfusion-chip--reaction-${option.code}${
                      selected ? " transfusion-chip--selected" : ""
                    }`}
                    onClick={() =>
                      update("reaction", selected ? "" : (option.code as TransfusionReaction))
                    }
                  >
                    {option.display}
                  </button>
                );
              })}
            </div>
            {values.reaction === "present" && (
              <label className="transfusion-perform__reaction-note">
                内容 *
                <input
                  type="text"
                  value={values.reactionNote}
                  onChange={(e) => update("reactionNote", e.target.value)}
                  placeholder="発熱・蕁麻疹 など"
                />
              </label>
            )}
          </div>
        </section>

        <div className="lab-order-item__fields">
          <label className="transfusion-perform__comment">
            実施コメント
            <textarea
              value={values.comment}
              onChange={(e) => update("comment", e.target.value)}
              rows={2}
            />
          </label>
        </div>

        <div className="lab-order-item__actions">
          <button type="submit" disabled={register.isPending}>
            {register.isPending ? "保存中..." : "実施を登録"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// バッグ 1 本。オーダーの製剤から初期値が入るが、実際に出庫されたものが違えば
// マスタから選び直す。
function BagCard({
  index,
  bag,
  productItems,
  onProductChange,
  onChange,
  onRemove,
}: {
  index: number;
  bag: TransfusionBagLine;
  productItems: {
    item_code: string;
    name: string;
    unit_label: string;
    default_units: number | null;
  }[];
  onProductChange: (code: string) => void;
  onChange: (patch: Partial<TransfusionBagLine>) => void;
  onRemove: () => void;
}) {
  // 有効期間切れなどでマスタの選択肢に無い製剤。保存済みの選択を失わせない。
  const missing =
    bag.productCode && !productItems.some((i) => i.item_code === bag.productCode);

  return (
    <li className="transfusion-order__product">
      <div className="transfusion-order__product-head">
        <span className="transfusion-order__product-number">バッグ{index + 1}</span>
        {/* 行を外すボタンはゴミ箱(× はチップの中だけ。SurgeryOrderForm の
            担当スタッフのチップを参照)。 */}
        <button
          type="button"
          className="rp-card__icon-button"
          title="このバッグを削除"
          aria-label={`バッグ${index + 1}を削除`}
          onClick={onRemove}
        >
          <TrashIcon />
        </button>
      </div>

      <label className="transfusion-order__product-name">
        製剤 *
        <select value={bag.productCode} onChange={(e) => onProductChange(e.target.value)}>
          <option value="">選択してください</option>
          {productItems.map((item) => (
            <option key={item.item_code} value={item.item_code}>
              {item.name}
            </option>
          ))}
          {missing && <option value={bag.productCode}>{bag.productName} (無効)</option>}
        </select>
      </label>

      <label className="transfusion-order__product-units">
        単位数
        <input
          type="number"
          min={0}
          step="any"
          value={bag.units}
          onChange={(e) => onChange({ units: e.target.value })}
        />
      </label>
      <span className="transfusion-order__product-unit-label">{bag.unitLabel}</span>

      {/* 遡及調査の起点。バッグごとに違うので必ず 1 本ずつ入れる。 */}
      <label className="transfusion-order__product-note">
        製剤番号 *
        <input
          type="text"
          value={bag.lotNumber}
          onChange={(e) => onChange({ lotNumber: e.target.value })}
          placeholder="バッグのラベル番号"
        />
      </label>

      {/* バッグごとの時刻。空なら輸血全体の開始・終了を使う。 */}
      <label className="transfusion-perform__bag-time">
        開始
        <input
          type="datetime-local"
          value={bag.startedAt}
          onChange={(e) => onChange({ startedAt: e.target.value })}
        />
      </label>
      <label className="transfusion-perform__bag-time">
        終了
        <input
          type="datetime-local"
          value={bag.endedAt}
          onChange={(e) => onChange({ endedAt: e.target.value })}
        />
      </label>
    </li>
  );
}
