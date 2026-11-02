import { useMemo, useState, type FormEvent } from "react";
import { useCurrentPractitioner } from "../api/authQueries";
import { useTransfusionProductOptions } from "../api/masterQueries";
import {
  useAutologousUnits,
  useBloodType,
  useRegisterTransfusionDispense,
  useTransfusionProfile,
  useTransfusionSettings,
  type TransfusionWorklistRow,
} from "../api/queries";
import type { AutologousUnit } from "../fhir/autologousHelpers";
import { ANTIGEN_OPTIONS, antibodyLabel } from "../fhir/transfusionProfileHelpers";
import type { Advisory } from "../fhir/advisoryHelpers";
import { parseIsbt128 } from "../fhir/isbt128";
import { displayName } from "../fhir/patientHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import {
  antibodyScreenAdvisory,
  bloodTypeUnconfirmedAdvisory,
} from "../fhir/transfusionAdvisoryHelpers";
import {
  CROSSMATCH_OPTIONS,
  buildTransfusionDispenseBundle,
  dispenseAdvisories,
  emptyDispenseBag,
  emptyTransfusionDispenseForm,
  patientTypeForDispense,
  type CrossmatchResult,
  type TransfusionDispenseBag,
  type TransfusionDispenseFormValues,
} from "../fhir/transfusionDispenseHelpers";
import {
  ABO_OPTIONS,
  RHD_OPTIONS,
  bloodTypeLabel,
  crossmatchRequiredFor,
  summarizeTransfusionOrder,
  transfusionOrderProducts,
  type AboBloodType,
  type RhdBloodType,
} from "../fhir/transfusionOrderHelpers";
import { nowDateTimeInput } from "../lib/dates";
import { useAdvisoryRuleAdvisories } from "../hooks/useAdvisoryRuleAdvisories";
import { useAdvisorySession } from "../hooks/useAdvisorySession";
import { AdvisoryConfirmModal } from "./AdvisoryConfirmModal";
import { AdvisoryNotice } from "./AdvisoryNotice";
import { BarcodeScanField } from "./BarcodeScanField";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";
import { TransfusionBloodBadge } from "./TransfusionBloodBadge";
import { TrashIcon } from "./icons/TrashIcon";

// 輸血一覧の「出庫」。受付済のオーダーに対して輸血部門が製剤を割り付け、払い出した
// バッグを 1 本ずつ記録する(製剤番号・血液型・有効期限・照射・交差適合試験の結果)。
// 登録すると出庫記録(ハブの Procedure + バッグごとの MedicationDispense)を作り、
// 進捗を出庫済へ進める(組み立ては transfusionDispenseHelpers)。
//
// 割付のチェック(JAHIS 患者安全ガイド 輸血編 7.3.3)は警告の器に載せる:
// 患者の型・依頼の型・依頼の製剤との突き合わせ、有効期限、照射、交差適合試験の結果、
// 血液型の 2 回確定、不規則抗体の有効期限と陽性。確認を要する警告は理由を選んで通す。
// 交差適合試験が不適合のバッグもここで止める(医師と協議のうえ出す場合は理由を残す)。
//
// 日赤の製剤ラベルのバーコード(ISBT 128)は 1 つの読み取り欄で受け、構造ごとに
// 選択中のバッグの製剤番号・製品・血液型・有効期限へ入れる。

interface Props {
  row: TransfusionWorklistRow;
  onClose: () => void;
}

export function TransfusionDispenseModal({ row, onClose }: Props) {
  const { order, patient, task, itemRequests } = row;
  const register = useRegisterTransfusionDispense();
  const { practitionerId, practitioner } = useCurrentPractitioner();
  const products = useTransfusionProductOptions();
  const productItems = useMemo(() => products.data?.items ?? [], [products.data]);
  const settings = useTransfusionSettings();
  const patientId = order.subject?.reference?.split("/").pop();
  const bloodType = useBloodType(patientId);
  // 不規則抗体の特異性(抗原陰性血の確認)と移植後の型、採血済みの自己血(本人の血かの照合)。
  const profile = useTransfusionProfile(patientId);
  const antibodies = useMemo(() => profile.antibody?.antibodies ?? [], [profile.antibody]);
  const autologous = useAutologousUnits(patientId);
  const summary = summarizeTransfusionOrder(order);
  const ordered = useMemo(() => transfusionOrderProducts(itemRequests, order), [itemRequests, order]);

  const [values, setValues] = useState<TransfusionDispenseFormValues>(() =>
    emptyTransfusionDispenseForm(ordered, nowDateTimeInput()),
  );
  /** バーコードを入れる先のバッグ。 */
  const [targetIndex, setTargetIndex] = useState(0);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  const patientType = useMemo(
    () => ({
      ...patientTypeForDispense(bloodType.summary, summary),
      ...(profile.transplant
        ? {
            transplant: {
              rbc: { abo: profile.transplant.rbcAbo, rhd: profile.transplant.rbcRhd },
              plasma: { abo: profile.transplant.plasmaAbo, rhd: profile.transplant.plasmaRhd },
            },
          }
        : {}),
    }),
    [bloodType.summary, summary, profile.transplant],
  );
  const advisoryInput = useMemo<Advisory[]>(() => {
    const list = dispenseAdvisories(values.bags, {
      patient: patientType,
      level: summary.urgencyLevel,
      testType: summary.testType,
      scheduledDate: order.occurrenceDateTime ?? "",
      ordered: ordered.map((line) => ({
        id: line.id,
        productCode: line.productCode,
        productName: line.productName,
        abo: line.abo,
        rhd: line.rhd,
      })),
      productItems,
      antibodyScreen: bloodType.summary?.antibodyScreen?.value ?? "",
      antibodies,
      autologousUnits: autologous.units.map((unit) => unit.lotNumber),
    });
    if (!bloodType.isLoading) {
      const unconfirmed = bloodTypeUnconfirmedAdvisory(bloodType.summary);
      if (unconfirmed) list.push(unconfirmed);
      const antibody = antibodyScreenAdvisory(bloodType.summary, order.occurrenceDateTime ?? "", settings);
      if (antibody) list.push(antibody);
    }
    return list;
  }, [values.bags, patientType, summary, order.occurrenceDateTime, ordered, productItems, bloodType, settings, antibodies, autologous.units]);
  const ruleAdvisories = useAdvisoryRuleAdvisories(patientId ?? "", "transfusion-dispense");
  const sessionInput = useMemo(() => [...advisoryInput, ...ruleAdvisories], [advisoryInput, ruleAdvisories]);
  const session = useAdvisorySession(sessionInput, "transfusion-dispense");
  const [confirmSubmit, setConfirmSubmit] = useState<(() => void) | null>(null);

  function update<K extends keyof TransfusionDispenseFormValues>(
    key: K,
    value: TransfusionDispenseFormValues[K],
  ) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function updateBag(index: number, patch: Partial<TransfusionDispenseBag>) {
    setValues((prev) => ({
      ...prev,
      bags: prev.bags.map((bag, i) => (i === index ? { ...bag, ...patch } : bag)),
    }));
  }

  /** 採血済みの自己血を選んだら、製剤番号・型・有効期限・量をその行に写す。 */
  function handleAutologousSelect(index: number, unit: AutologousUnit) {
    updateBag(index, {
      productCode: unit.productCode || values.bags[index]?.productCode || "",
      productName: unit.productName || values.bags[index]?.productName || "",
      lotNumber: unit.lotNumber,
      abo: unit.abo as TransfusionDispenseBag["abo"],
      rhd: unit.rhd as TransfusionDispenseBag["rhd"],
      expiry: unit.expiry,
      units: unit.volume.replace(/[^\d.]/g, "") || values.bags[index]?.units || "",
    });
  }

  /** 製剤を選び直したときは、コード・名称・単位の呼び方をまとめて入れ替える。 */
  function handleProductChange(index: number, code: string) {
    const item = productItems.find((i) => i.item_code === code);
    if (!item) {
      updateBag(index, { productCode: code });
      return;
    }
    updateBag(index, {
      productCode: item.item_code,
      productName: item.name,
      unitLabel: item.unit_label,
    });
  }

  function addBag() {
    setValues((prev) => ({ ...prev, bags: [...prev.bags, emptyDispenseBag()] }));
    setTargetIndex(values.bags.length);
  }

  function removeBag(index: number) {
    setValues((prev) => ({ ...prev, bags: prev.bags.filter((_, i) => i !== index) }));
    setTargetIndex((t) => Math.max(0, Math.min(t, values.bags.length - 2)));
  }

  /** 読んだバーコードを選択中のバッグに入れる。構造に当てはまらなければ製剤番号として扱う。 */
  function handleScan(raw: string) {
    if (values.bags.length === 0) {
      setScanError("先にバッグを足してください。");
      return;
    }
    const index = Math.min(targetIndex, values.bags.length - 1);
    const field = parseIsbt128(raw);
    setScanError(null);
    if (!field) {
      updateBag(index, { lotNumber: raw });
      return;
    }
    switch (field.kind) {
      case "din":
        updateBag(index, { lotNumber: field.value });
        return;
      case "blood-type":
        updateBag(index, { abo: field.abo, rhd: field.rhd });
        return;
      case "expiry":
        updateBag(index, { expiry: field.date });
        return;
      case "product": {
        const item = productItems.find((i) => i.item_code === field.value);
        if (item) handleProductChange(index, item.item_code);
        else setScanError(`製品コード ${field.value} は製剤マスタにありません。`);
        return;
      }
    }
  }

  function validate(): string | null {
    const bags = values.bags.filter((bag) => bag.productCode);
    if (bags.length === 0) return "払い出すバッグの製剤を 1 本以上選んでください。";
    if (bags.some((bag) => !bag.lotNumber.trim())) return "製剤番号を入れてください。";
    if (bags.some((bag) => !bag.abo || !bag.rhd)) return "バッグの血液型を選んでください。";
    if (!values.dispensedAt) return "出庫日時を入れてください。";
    return null;
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const error = validate();
    setValidationError(error);
    if (error) return;
    if (session.blocked.length > 0) {
      setValidationError(session.blocked.map((advisory) => advisory.message).join(" / "));
      return;
    }
    const submitted: TransfusionDispenseFormValues = {
      ...values,
      dispenserId: practitionerId ?? "",
      dispenserName: practitioner ? practitionerDisplayName(practitioner) : "",
      bags: values.bags.filter((bag) => bag.productCode),
    };
    const submit = () =>
      register.mutate(buildTransfusionDispenseBundle(submitted, order, task), { onSuccess: onClose });
    if (session.pending.length > 0) {
      setConfirmSubmit(() => submit);
      return;
    }
    session.confirm([]);
    submit();
  }

  const crossmatchNeeded = crossmatchRequiredFor(summary.testType);

  return (
    <Modal
      title={`輸血の出庫${patient ? ` - ${displayName(patient)}` : ""}`}
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
        <ErrorBanner error={bloodType.error} />
        <ErrorBanner error={profile.error ?? autologous.error} />
        <AdvisoryNotice advisories={session.advisories} />

        {/* 誰の何型の輸血で、何を依頼されたか。割付の突き合わせの相手なので入力欄より先に出す。 */}
        <p className="rad-perform__items">
          <span className="rad-perform__items-label">患者血液型</span>
          {summary.bloodTypeDisplay ? (
            <TransfusionBloodBadge abo={summary.aboBloodType} rhd={summary.rhdBloodType} />
          ) : (
            "未指定"
          )}
          {bloodType.summary?.tested &&
            bloodTypeLabel(bloodType.summary.abo, bloodType.summary.rhd) !== summary.bloodTypeDisplay && (
              <>
                {" "}
                <span className="rad-perform__items-label">検査結果</span>
                <TransfusionBloodBadge abo={bloodType.summary.abo} rhd={bloodType.summary.rhd} />
              </>
            )}
          {" "}
          <span className="rad-perform__items-label">検査区分</span>
          {summary.testTypeDisplay}
          {summary.urgencyBadge && (
            <>
              {" "}
              <span className="dose-conversion__badge">{summary.urgencyBadge}</span>
            </>
          )}
        </p>
        <ul className="karte-rp__medicines">
          {ordered.map((line, index) => (
            <li key={line.id || index}>
              <span className="karte-rp__number">{index + 1}</span>
              <span className="karte-rp__medicine-name">
                {line.productName}
                {line.units && ` / ${line.units}${line.unitLabel}`}
              </span>
              <TransfusionBloodBadge abo={line.abo} rhd={line.rhd} />
            </li>
          ))}
        </ul>

        <div className="lab-order-item__fields">
          <label>
            出庫日時 *
            <input
              type="datetime-local"
              value={values.dispensedAt}
              onChange={(e) => update("dispensedAt", e.target.value)}
              required
            />
          </label>
          <label>
            出庫者
            <input
              type="text"
              value={practitioner ? practitionerDisplayName(practitioner) : "(未設定)"}
              readOnly
              disabled
            />
          </label>
          <label>
            適合試験者
            <input
              type="text"
              value={values.crossmatchPerformerName}
              onChange={(e) => update("crossmatchPerformerName", e.target.value)}
            />
          </label>
        </div>

        <section className="lab-order-item__section">
          <div className="lab-order-item__section-head">
            <h3>払い出すバッグ *</h3>
            <button type="button" onClick={addBag}>
              バッグ追加
            </button>
          </div>
          {/* 日赤のラベルのバーコード(献血番号・製品・血液型・有効期限)。選択中のバッグに入る。 */}
          <div className="lab-order-item__fields">
            <label>
              バーコード
              <BarcodeScanField onScan={handleScan} ariaLabel="製剤ラベルのバーコード" />
            </label>
            <label>
              入れる先
              <select
                value={Math.min(targetIndex, Math.max(0, values.bags.length - 1))}
                onChange={(e) => setTargetIndex(Number(e.target.value))}
              >
                {values.bags.map((_, index) => (
                  <option key={index} value={index}>
                    バッグ{index + 1}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {scanError && (
            <p className="error-banner__line error-banner__line--error" role="alert">
              {scanError}
            </p>
          )}
          <ul className="transfusion-order__products">
            {values.bags.map((bag, index) => (
              <DispenseBagCard
                key={index}
                index={index}
                bag={bag}
                productItems={productItems}
                crossmatchNeeded={crossmatchNeeded}
                antibodies={antibodies}
                autologousUnits={autologous.units}
                onAutologousSelect={(unit) => handleAutologousSelect(index, unit)}
                onProductChange={(code) => handleProductChange(index, code)}
                onChange={(patch) => updateBag(index, patch)}
                onRemove={() => removeBag(index)}
              />
            ))}
            {values.bags.length === 0 && (
              <li className="order-select__muted">「バッグ追加」から入れてください。</li>
            )}
          </ul>
        </section>

        <div className="lab-order-item__fields">
          <label className="transfusion-perform__comment">
            出庫コメント
            <input
              type="text"
              value={values.comment}
              onChange={(e) => update("comment", e.target.value)}
            />
          </label>
        </div>

        <div className="prescription-form__actions">
          <button type="submit" disabled={register.isPending}>
            {register.isPending ? "送信中..." : "出庫"}
          </button>
          <button type="button" onClick={onClose}>
            取消
          </button>
        </div>
      </form>
      {confirmSubmit && (
        <AdvisoryConfirmModal
          advisories={session.pending}
          submitting={register.isPending}
          onConfirm={(overrides) => {
            session.confirm(overrides);
            setConfirmSubmit(null);
            confirmSubmit();
          }}
          onCancel={() => setConfirmSubmit(null)}
        />
      )}
    </Modal>
  );
}

function DispenseBagCard({
  index,
  bag,
  productItems,
  crossmatchNeeded,
  antibodies,
  autologousUnits,
  onAutologousSelect,
  onProductChange,
  onChange,
  onRemove,
}: {
  index: number;
  bag: TransfusionDispenseBag;
  productItems: { item_code: string; name: string; unit_label: string; category: string }[];
  crossmatchNeeded: boolean;
  /** 患者の不規則抗体の特異性。あれば赤血球のバッグに抗原陰性の確認欄を出す。 */
  antibodies: string[];
  /** 採血済みの自己血。自己血のバッグはここから選ぶ。 */
  autologousUnits: AutologousUnit[];
  onAutologousSelect: (unit: AutologousUnit) => void;
  onProductChange: (code: string) => void;
  onChange: (patch: Partial<TransfusionDispenseBag>) => void;
  onRemove: () => void;
}) {
  const missing =
    bag.productCode && !productItems.some((i) => i.item_code === bag.productCode);
  const category = productItems.find((i) => i.item_code === bag.productCode)?.category;
  const relevantAntibodies = category === "rbc" ? antibodies.filter((c) => c !== "other") : [];

  return (
    <li className="transfusion-order__product">
      <div className="transfusion-order__product-head">
        <span className="transfusion-order__product-number">
          バッグ{index + 1} <TransfusionBloodBadge abo={bag.abo} rhd={bag.rhd} />
        </span>
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

      {/* 自己血は本人の採血記録から選ぶ(製剤番号・型・有効期限が写る)。 */}
      {category === "auto" && (
        <label className="transfusion-order__product-name">
          採血済みの自己血
          <select
            value={autologousUnits.find((u) => u.lotNumber === bag.lotNumber)?.dispenseId ?? ""}
            onChange={(e) => {
              const unit = autologousUnits.find((u) => u.dispenseId === e.target.value);
              if (unit) onAutologousSelect(unit);
            }}
          >
            <option value="">選択してください</option>
            {autologousUnits.map((unit) => (
              <option key={unit.dispenseId} value={unit.dispenseId}>
                {unit.label}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="transfusion-order__product-note">
        製剤番号 *
        <input
          type="text"
          value={bag.lotNumber}
          onChange={(e) => onChange({ lotNumber: e.target.value })}
        />
      </label>

      <label className="transfusion-dispense__field">
        ABO *
        <select value={bag.abo} onChange={(e) => onChange({ abo: e.target.value as AboBloodType | "" })}>
          <option value=""></option>
          {ABO_OPTIONS.map((o) => (
            <option key={o.code} value={o.code}>
              {o.display}
            </option>
          ))}
        </select>
      </label>
      <label className="transfusion-dispense__field">
        RhD *
        <select value={bag.rhd} onChange={(e) => onChange({ rhd: e.target.value as RhdBloodType | "" })}>
          <option value=""></option>
          {RHD_OPTIONS.map((o) => (
            <option key={o.code} value={o.code}>
              {o.display}
            </option>
          ))}
        </select>
      </label>
      <label className="transfusion-dispense__field transfusion-dispense__field--date">
        有効期限
        <input type="date" value={bag.expiry} onChange={(e) => onChange({ expiry: e.target.value })} />
      </label>
      <label className="transfusion-dispense__field">
        交差適合試験{crossmatchNeeded && " *"}
        <select
          value={bag.crossmatch}
          onChange={(e) => onChange({ crossmatch: e.target.value as CrossmatchResult | "" })}
        >
          <option value=""></option>
          {CROSSMATCH_OPTIONS.map((o) => (
            <option key={o.code} value={o.code}>
              {o.display}
            </option>
          ))}
        </select>
      </label>
      <label className="transfusion-dispense__check">
        <input
          type="checkbox"
          checked={bag.irradiated}
          onChange={(e) => onChange({ irradiated: e.target.checked })}
        />
        照射済
      </label>

      {/* 不規則抗体のある患者に出す赤血球。同定した抗体の抗原について陰性を確認した印。 */}
      {relevantAntibodies.length > 0 && (
        <div className="transfusion-order__blood-type transfusion-order__product-blood-type">
          <span className="transfusion-order__blood-type-label">抗原陰性</span>
          <div className="transfusion-order__chips" role="group" aria-label={`バッグ${index + 1}の抗原陰性`}>
            {ANTIGEN_OPTIONS.filter((o) => relevantAntibodies.includes(o.code)).map((option) => {
              const selected = bag.antigenNegative.includes(option.code);
              return (
                <button
                  key={option.code}
                  type="button"
                  aria-pressed={selected}
                  title={antibodyLabel(option.code)}
                  className={`transfusion-chip transfusion-chip--symptom${
                    selected ? " transfusion-chip--selected transfusion-chip--rhd-positive" : ""
                  }`}
                  onClick={() =>
                    onChange({
                      antigenNegative: selected
                        ? bag.antigenNegative.filter((c) => c !== option.code)
                        : [...bag.antigenNegative, option.code],
                    })
                  }
                >
                  {option.display}(-)
                </button>
              );
            })}
          </div>
        </div>
      )}
    </li>
  );
}
