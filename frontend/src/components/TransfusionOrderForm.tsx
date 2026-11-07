import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useTransfusionProductOptions } from "../api/masterQueries";
import {
  useActiveFlags,
  useBloodType,
  useTransfusionLocationOptions,
  useTransfusionProfile,
  useTransfusionReactionHistory,
  useTransfusionSettings,
} from "../api/queries";
import {
  transplantAdvisory,
  type TransplantBloodTypeSummary,
} from "../fhir/transfusionProfileHelpers";
import type { Advisory } from "../fhir/advisoryHelpers";
import { firstCollectionExpiryAdvisory } from "../fhir/autologousPlanHelpers";
import {
  bloodTypeUnconfirmedLabel,
  type BloodTypeSummary,
  type LabBloodTypeComponent,
} from "../fhir/bloodTypeHelpers";
import { refreshProblemDisplay } from "../fhir/conditionHelpers";
import { locationDisplayName } from "../fhir/locationHelpers";
import { SETTING_OPTIONS, type PrescriptionSetting } from "../fhir/prescriptionHelpers";
import {
  antibodyScreenAdvisory,
  bloodTypeUnconfirmedAdvisory,
  differentBloodTypeAdvisories,
  reactionHistoryAdvisory,
  transfusionRefusalAdvisory,
} from "../fhir/transfusionAdvisoryHelpers";
import {
  ABO_OPTIONS,
  RHD_OPTIONS,
  TEST_TYPE_OPTIONS,
  TRANSFUSION_PRIORITY_OPTIONS,
  UNKNOWN_BLOOD_TYPE,
  bloodTypeLabel,
  compatibleAbo,
  compatibleRhd,
  defaultProductBloodType,
  emptyTransfusionOrderForm,
  emptyTransfusionProduct,
  productNeedsBloodType,
  rhdDisplay,
  urgencyLevelOf,
  type AboBloodType,
  type PatientBloodTypeForOrder,
  type RhdBloodType,
  type TransfusionOrderFormValues,
  type TransfusionOrderPriority,
  type TransfusionProductValues,
  type TransfusionTestType,
} from "../fhir/transfusionOrderHelpers";
import { makeFieldUpdater } from "../lib/form";
import type { ValidationFailure } from "../lib/validation";
import { useAdvisoryRuleAdvisories } from "../hooks/useAdvisoryRuleAdvisories";
import { useAdvisorySession } from "../hooks/useAdvisorySession";
import { useBulkStartDate } from "../hooks/useBulkStartDate";
import { useProblemOptions } from "../hooks/useProblemOptions";
import { useValidationError } from "../hooks/useValidationError";
import { AdvisoryConfirmModal } from "./AdvisoryConfirmModal";
import { AdvisoryNotice } from "./AdvisoryNotice";
import { CollectionPlanFieldset } from "./CollectionPlanFieldset";
import { ErrorBanner } from "./ErrorBanner";
import { shownValidationError, useFieldAlert } from "./FieldAlert";
import { ProblemSelect } from "./ProblemSelect";
import { TransfusionBloodBadge } from "./TransfusionBloodBadge";

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
// 血液型(docs/transfusion-order-design.md §2.5):
// - 患者の型は検査結果(2 回一致)から読み、医師は手で入れない。確定していなければ
//   ヘッダに「不明」を明示して保存する。
// - 製剤の型は製剤ごとに持つ。患者の型・製剤区分・緊急度から既定を入れ、適合する型だけを
//   選ばせる(型が不明なら赤血球は O、血漿・血小板は AB)。選ぶのは先頭の「血液型」のチップで、
//   選んだ型は適合するすべての製剤に入る(製剤ごとに違う型になる場合はカードの型を読む)。
//   日本赤十字社の製剤ラベルと同じ色を選択中の型に付けて、取り違えに気付きやすくする。
// 輸血拒否・血液型の未確定・不規則抗体の期限・異型適合・副作用歴は警告の器
// (fhir/transfusionAdvisoryHelpers.ts)で先頭に出す。

interface TransfusionOrderFormProps {
  patientId: string;
  initialValues?: TransfusionOrderFormValues;
  onSubmit: (values: TransfusionOrderFormValues) => void;
  submitting: boolean;
  submitError?: unknown;
  submitLabel?: string;
  /**
   * 患者の血液型から製剤の型の既定を入れる。新規登録のときだけ真にする
   * (編集では保存済みの製剤の型を書き換えない)。
   */
  prefillBloodType?: boolean;
  /** オーダーセットの適用日。外から投与予定日をまとめて入れるときに渡す(時刻は保つ)。 */
  bulkStartDate?: string;
  /** セットの内容として入力する(患者と日付に依存する入力を出さず、その検証も外す)。 */
  setMode?: boolean;
  /** 送信ボタンを出さない(積んだフォームを外から一括 submit する画面で使う)。 */
  hideSubmit?: boolean;
}

/**
 * 検査で確定した型だけを、製剤の型を決める材料にする。造血幹細胞移植後の患者は、
 * 登録した「輸血に使う型」(赤血球と血漿・血小板で別)を患者の型より優先する。
 */
function patientForOrder(
  summary: BloodTypeSummary | null,
  transplant: TransplantBloodTypeSummary | null,
): PatientBloodTypeForOrder {
  const base: PatientBloodTypeForOrder = summary?.tested
    ? { abo: summary.abo as AboBloodType, rhd: summary.rhd as RhdBloodType }
    : { abo: "", rhd: "" };
  if (!transplant) return base;
  return {
    ...base,
    transplant: {
      rbc: { abo: transplant.rbcAbo, rhd: transplant.rbcRhd },
      plasma: { abo: transplant.plasmaAbo, rhd: transplant.plasmaRhd },
    },
  };
}

/** 検証で弾いた項目の鍵。フォームのラベルの印(FieldAlert)の宛先。 */
type TransfusionOrderField =
  | "products"
  | `product:${number}:units`
  | "bloodType"
  | "scheduledDateTime"
  | `collection:${number}`
  | "consentConfirmed";

function validateTransfusionOrder(
  values: TransfusionOrderFormValues,
  {
    setMode,
    showCollections,
    categoryOf,
  }: {
    setMode: boolean;
    showCollections: boolean;
    categoryOf: (code: string) => string | undefined;
  },
): ValidationFailure<TransfusionOrderField> | null {
  const fail = (field: TransfusionOrderField, message: string) => ({ field, message });
  const filled = values.products.filter((product) => product.productCode);
  if (filled.length === 0) return fail("products", "製剤を 1 つ以上選んでください。");
  const unitless = values.products.findIndex(
    (product) => product.productCode && !(Number(product.units) > 0),
  );
  if (unitless >= 0) return fail(`product:${unitless}:units`, "製剤の単位数を入れてください。");
  // セットの内容としての入力では日時・同意の確認・血液型を持たない(適用時に入れる)。
  if (setMode) return null;
  const untyped = values.products.findIndex(
    (product) =>
      product.productCode &&
      productNeedsBloodType(categoryOf(product.productCode)) &&
      !product.abo,
  );
  if (untyped >= 0) return fail("bloodType", "血液型を選んでください。");
  if (!values.scheduledDateTime) return fail("scheduledDateTime", "投与予定日時を入れてください。");
  if (showCollections) {
    const unplanned = values.collections.findIndex((line) => !line.plannedAt);
    if (unplanned >= 0) return fail(`collection:${unplanned}`, "採血予定の日時を入れてください。");
    const late = values.collections.findIndex(
      (line) => line.status === "booked" && line.plannedAt >= values.scheduledDateTime,
    );
    if (late >= 0) return fail(`collection:${late}`, "採血予定は投与予定日時より前にしてください。");
  }
  // 同意書は輸血の必須要件。未確認のまま出せてしまうと確認そのものが形骸化する。
  if (!values.consentConfirmed) {
    return fail("consentConfirmed", "輸血同意書の確認にチェックを入れてください。");
  }
  return null;
}

export function TransfusionOrderForm({
  patientId,
  initialValues,
  onSubmit,
  submitting,
  submitError,
  submitLabel = "登録",
  prefillBloodType = false,
  bulkStartDate,
  setMode = false,
  hideSubmit = false,
}: TransfusionOrderFormProps) {
  const [values, setValues] = useState<TransfusionOrderFormValues>(
    initialValues ?? emptyTransfusionOrderForm(""),
  );
  const [validationError, setValidationError, validationErrorRef, invalidField] =
    useValidationError<TransfusionOrderField>();
  const [commentOpen, setCommentOpen] = useState(Boolean(initialValues?.comment));

  const problemOptions = useProblemOptions(patientId);
  useBulkStartDate(bulkStartDate, (date) =>
    setValues((v) => ({
      ...v,
      scheduledDateTime: `${date}T${v.scheduledDateTime.slice(11, 16) || "09:00"}`,
    })),
  );
  const products = useTransfusionProductOptions();
  const locations = useTransfusionLocationOptions();
  const settings = useTransfusionSettings();
  const bloodType = useBloodType(setMode ? undefined : patientId);
  const patientBloodType = bloodType.summary;
  const profile = useTransfusionProfile(setMode ? undefined : patientId);
  const patient = useMemo(
    () => patientForOrder(patientBloodType, profile.transplant),
    [patientBloodType, profile.transplant],
  );
  const level = urgencyLevelOf(values.priority);
  const prefilled = useRef(false);
  // 先頭のチップで選んだ「出す型」。製剤を足したときの既定にも使う。
  const [requested, setRequested] = useState<{ abo: AboBloodType | ""; rhd: RhdBloodType | "" }>(
    () => commonProductType(initialValues?.products ?? []),
  );

  const productItems = useMemo(() => products.data?.items ?? [], [products.data]);
  const categoryOf = useCallback(
    (code: string) => productItems.find((i) => i.item_code === code)?.category,
    [productItems],
  );
  const update = makeFieldUpdater(setValues);

  // 自己血(貯血式)の製剤。選んでいるときだけ採血予定の欄を出す(セットの内容では持たない)。
  const autoProducts = values.products.filter((product) => categoryOf(product.productCode) === "auto");
  const autoItem = productItems.find((i) => i.item_code === autoProducts[0]?.productCode);
  const autoVolume = autoProducts.reduce((sum, product) => sum + (Number(product.units) || 0), 0);
  const showCollections = !setMode && autoProducts.length > 0;

  // 患者の型(確定していなければ「不明」)をヘッダに写す。検査結果が変わっても追う
  // (オーダー時点の型を焼き付けるのが目的なので、保存時点の最新を入れる)。
  useEffect(() => {
    if (setMode || bloodType.isLoading) return;
    const abo = patient.abo || UNKNOWN_BLOOD_TYPE;
    const rhd = patient.rhd || UNKNOWN_BLOOD_TYPE;
    setValues((v) =>
      v.patientAbo === abo && v.patientRhd === rhd ? v : { ...v, patientAbo: abo, patientRhd: rhd },
    );
  }, [setMode, bloodType.isLoading, patient.abo, patient.rhd]);

  // 新規登録では、型の入っていない製剤に既定の型を入れる。一度入れたら追わない
  // (医師が変えた型を書き戻さない)。製剤マスタと患者の型の両方が読めてから行う。
  useEffect(() => {
    if (!prefillBloodType || setMode || prefilled.current) return;
    if (bloodType.isLoading || productItems.length === 0) return;
    prefilled.current = true;
    setRequested((r) => (r.abo || r.rhd ? r : { abo: patient.abo, rhd: patient.rhd }));
    setValues((v) => ({
      ...v,
      products: v.products.map((product) =>
        product.productCode && !product.abo && !product.rhd
          ? {
              ...product,
              ...defaultProductBloodType(
                patient,
                productItems.find((i) => i.item_code === product.productCode)?.category,
                level,
              ),
            }
          : product,
      ),
    }));
  }, [prefillBloodType, setMode, bloodType.isLoading, productItems, patient, level]);

  /** 型の要る製剤(選択済み)。先頭のチップで選べる型は、これら全部に適合するものだけ。 */
  const typedProducts = values.products.filter(
    (product) => product.productCode && productNeedsBloodType(categoryOf(product.productCode)),
  );
  const allowedAbo = ABO_OPTIONS.map((o) => o.code).filter((abo) =>
    typedProducts.every((product) => compatibleAbo(patient, categoryOf(product.productCode)).includes(abo)),
  );
  const allowedRhd = RHD_OPTIONS.map((o) => o.code).filter((rhd) =>
    typedProducts.every((product) =>
      compatibleRhd(patient, categoryOf(product.productCode), level).includes(rhd),
    ),
  );

  /** 先頭のチップで型を選ぶ。適合する製剤すべてに入れる(適合しない製剤は今の型のまま)。 */
  function selectRequested(patch: { abo?: AboBloodType | ""; rhd?: RhdBloodType | "" }) {
    setRequested((r) => ({ ...r, ...patch }));
    setValues((v) => ({
      ...v,
      products: v.products.map((product) => {
        if (!product.productCode) return product;
        const category = categoryOf(product.productCode);
        if (!productNeedsBloodType(category)) return product;
        const next = { ...product };
        if (patch.abo !== undefined && (!patch.abo || compatibleAbo(patient, category).includes(patch.abo))) {
          next.abo = patch.abo;
        }
        if (
          patch.rhd !== undefined &&
          (!patch.rhd || compatibleRhd(patient, category, level).includes(patch.rhd))
        ) {
          next.rhd = patch.rhd;
        }
        return next;
      }),
    }));
  }

  // ---- 警告 ----
  const flags = useActiveFlags(setMode ? undefined : patientId);
  const reactions = useTransfusionReactionHistory(setMode ? undefined : patientId);
  const advisoryInput = useMemo<Advisory[]>(() => {
    if (setMode) return [];
    const list: Advisory[] = [];
    const refusal = transfusionRefusalAdvisory(flags.flags);
    if (refusal) list.push(refusal);
    if (!bloodType.isLoading) {
      const unconfirmed = bloodTypeUnconfirmedAdvisory(patientBloodType);
      if (unconfirmed) list.push(unconfirmed);
      const antibody = antibodyScreenAdvisory(patientBloodType, values.scheduledDateTime, settings);
      if (antibody) list.push(antibody);
    }
    list.push(...differentBloodTypeAdvisories(values.products, patient));
    const transplant = transplantAdvisory(profile.transplant);
    if (transplant) list.push(transplant);
    const history = reactionHistoryAdvisory(reactions.history);
    if (history) list.push(history);
    if (showCollections) {
      const expiry = firstCollectionExpiryAdvisory(
        values.collections,
        autoItem?.shelf_life_days,
        values.scheduledDateTime,
      );
      if (expiry) list.push(expiry);
    }
    return list;
  }, [
    setMode,
    flags.flags,
    bloodType.isLoading,
    patientBloodType,
    values.scheduledDateTime,
    values.products,
    values.collections,
    showCollections,
    autoItem?.shelf_life_days,
    settings,
    patient,
    profile.transplant,
    reactions.history,
  ]);
  const ruleAdvisories = useAdvisoryRuleAdvisories(setMode ? "" : patientId, "transfusion-order");
  const sessionInput = useMemo(() => [...advisoryInput, ...ruleAdvisories], [advisoryInput, ruleAdvisories]);
  const session = useAdvisorySession(sessionInput, "transfusion-order", !setMode);
  /** 確認を要する警告の理由を選んだあとに行う登録。 */
  const [confirmSubmit, setConfirmSubmit] = useState<(() => void) | null>(null);

  function updateProduct(index: number, patch: Partial<TransfusionProductValues>) {
    setValues((v) => ({
      ...v,
      products: v.products.map((product, i) => (i === index ? { ...product, ...patch } : product)),
    }));
  }

  /**
   * 製剤を選んだときは、マスタの既定単位数・単位の呼び方・略称と、既定の血液型をその行に写す。
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
        ...(setMode
          ? { abo: "", rhd: "" }
          : requestedOrDefault(item.category, urgencyLevelOf(v.priority))),
      };
      const nextProducts = v.products.map((product, i) => (i === index ? next : product));
      return { ...v, products: nextProducts, testType: defaultTestType(nextProducts, v.testType) };
    });
  }

  /** 製剤を足したときの型。先頭で選んだ型が適合すればそれ、でなければ区分ごとの既定。 */
  function requestedOrDefault(category: string | undefined, nextLevel: number) {
    const fallback = defaultProductBloodType(patient, category, nextLevel);
    if (!productNeedsBloodType(category)) return fallback;
    return {
      abo: requested.abo && compatibleAbo(patient, category).includes(requested.abo) ? requested.abo : fallback.abo,
      rhd:
        requested.rhd && compatibleRhd(patient, category, nextLevel).includes(requested.rhd)
          ? requested.rhd
          : fallback.rhd,
    };
  }

  /**
   * 緊急度を変えると選べる型が変わる(レベルⅠなら RhD 陰性の患者に陽性も可)。
   * 選べなくなった型は既定に戻す。選べたままの型は医師の選択として保つ。
   */
  function handlePriorityChange(priority: TransfusionOrderPriority) {
    const nextLevel = urgencyLevelOf(priority);
    setValues((v) => ({
      ...v,
      priority,
      products: setMode
        ? v.products
        : v.products.map((product) => {
            if (!product.productCode) return product;
            const category = categoryOf(product.productCode);
            const abos = compatibleAbo(patient, category);
            const rhds = compatibleRhd(patient, category, nextLevel);
            const ok =
              (!product.abo || abos.includes(product.abo)) &&
              (!product.rhd || rhds.includes(product.rhd));
            return ok
              ? product
              : { ...product, ...defaultProductBloodType(patient, category, nextLevel) };
          }),
    }));
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

  function handleLocationChange(id: string) {
    const location = locations.locations.find((l) => l.id === id);
    setValues((v) => ({
      ...v,
      locationId: id,
      locationName: location ? locationDisplayName(location) : id ? v.locationName : "",
    }));
  }

  // 弾いた項目が直されたら(同じ規則が通るようになったら)、バナーと印を消す。
  const liveFailure = useMemo(
    () => validateTransfusionOrder(values, { setMode, showCollections, categoryOf }),
    [values, setMode, showCollections, categoryOf],
  );
  const shownError = shownValidationError(validationError, invalidField, liveFailure);
  const fieldAlert = useFieldAlert<TransfusionOrderField>(invalidField, shownError);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const failure = validateTransfusionOrder(values, { setMode, showCollections, categoryOf });
    if (failure) {
      setValidationError(failure.message, failure.field);
      return;
    }
    setValidationError(null);
    if (session.blocked.length > 0) {
      setValidationError(session.blocked.map((advisory) => advisory.message).join(" / "));
      return;
    }

    const submit = () =>
      onSubmit({ ...values, problem: refreshProblemDisplay(values.problem, problemOptions) });
    // 確認を要する警告があれば理由を選んでから登録する。
    if (session.pending.length > 0) {
      setConfirmSubmit(() => submit);
      return;
    }
    session.confirm([]);
    submit();
  }

  const unconfirmed = bloodTypeUnconfirmedLabel(patientBloodType);

  return (
    <form className="prescription-form" onSubmit={handleSubmit} noValidate={hideSubmit}>
      {shownError && (
        <div className="error-banner" role="alert" ref={validationErrorRef}>
          <p className="error-banner__line error-banner__line--error">{shownError}</p>
        </div>
      )}
      <ErrorBanner error={submitError} />
      <ErrorBanner error={products.error} />
      <AdvisoryNotice advisories={session.advisories} />

      {!setMode && (
        <fieldset>
          <legend>{fieldAlert.label("bloodType", "血液型")}</legend>
          {/* 出す型。選択中の型は日赤の製剤ラベルと同じ色で塗る。オーダーを読む人が
              文字を読まずに型を掴めるようにするため。患者の型に適合しない型は押せない。 */}
          <div className="transfusion-order__blood-type">
            <span className="transfusion-order__blood-type-label">ABO</span>
            <div className="transfusion-order__chips" role="group" aria-label="ABO血液型">
              {ABO_OPTIONS.map((option) => {
                const selected = requested.abo === option.code;
                const allowed = allowedAbo.includes(option.code);
                return (
                  <button
                    key={option.code}
                    type="button"
                    aria-pressed={selected}
                    disabled={!allowed}
                    title={allowed ? undefined : "患者の型に適合しません"}
                    className={`transfusion-chip transfusion-chip--abo-${option.code.toLowerCase()}${
                      selected ? " transfusion-chip--selected" : ""
                    }`}
                    // もう一度押したら選択を外せる(取り違えて選んだときに戻せる)。
                    onClick={() => selectRequested({ abo: selected ? "" : option.code })}
                  >
                    {option.display}
                  </button>
                );
              })}
            </div>

            <span className="transfusion-order__blood-type-label">RhD</span>
            <div className="transfusion-order__chips" role="group" aria-label="RhD血液型">
              {RHD_OPTIONS.map((option) => {
                const selected = requested.rhd === option.code;
                const allowed = allowedRhd.includes(option.code);
                return (
                  <button
                    key={option.code}
                    type="button"
                    aria-pressed={selected}
                    disabled={!allowed}
                    title={allowed ? undefined : "患者の型に適合しません"}
                    className={`transfusion-chip transfusion-chip--rhd-${option.code}${
                      selected ? " transfusion-chip--selected" : ""
                    }`}
                    onClick={() => selectRequested({ rhd: selected ? "" : option.code })}
                  >
                    {option.display}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 患者の型(検査で確定した型だけをオーダーに写す。確定していなければ「不明」)。 */}
          <p className="transfusion-order__patient-blood-type">
            患者: <TransfusionBloodBadge abo={values.patientAbo} rhd={values.patientRhd} />
            {profile.transplant && <span className="dose-conversion__badge">移植後</span>}
            {unconfirmed && (
              <span
                className={`blood-type__unconfirmed${
                  patientBloodType?.labStatus === "conflict"
                    ? " blood-type__unconfirmed--conflict"
                    : ""
                }`}
              >
                {unconfirmed}
              </span>
            )}
          </p>

          {/* 検査結果と申告。製剤の型と見比べられるよう、表で置く。 */}
          <table className="transfusion-order__pretest">
            <thead>
              <tr>
                <th>項目</th>
                <th>結果</th>
                <th>検査日</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <PretestRow
                label="ABO血液型"
                component={patientBloodType?.lab.abo ?? null}
                format={(value) => `${value}型`}
              />
              <PretestRow
                label="RhD血液型"
                component={patientBloodType?.lab.rhd ?? null}
                format={(value) => `RhD${rhdDisplay(value)}`}
              />
              <tr>
                <th scope="row">不規則抗体</th>
                {patientBloodType?.antibodyScreen ? (
                  <>
                    <td className="transfusion-order__pretest-value">
                      {patientBloodType.antibodyScreen.value}
                    </td>
                    <td>{patientBloodType.antibodyScreen.date}</td>
                    <td></td>
                  </>
                ) : (
                  <>
                    <td className="transfusion-order__pretest-missing">未検査</td>
                    <td></td>
                    <td></td>
                  </>
                )}
              </tr>
              {patientBloodType?.manual && (
                <tr>
                  <th scope="row">申告</th>
                  <td className="transfusion-order__pretest-value">
                    {bloodTypeLabel(patientBloodType.manual.abo, patientBloodType.manual.rhd)}
                  </td>
                  <td>{patientBloodType.manual.effectiveDate}</td>
                  <td>{patientBloodType.manual.sourceLabel}</td>
                </tr>
              )}
            </tbody>
          </table>
        </fieldset>
      )}

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
        {!setMode && (
          <label>
            対象プロブレム
            <ProblemSelect
              value={values.problem}
              options={problemOptions}
              onChange={(problem) => update("problem", problem)}
            />
          </label>
        )}
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
          緊急度
          <select
            value={values.priority}
            onChange={(e) => handlePriorityChange(e.target.value as TransfusionOrderPriority)}
          >
            {TRANSFUSION_PRIORITY_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.display}
              </option>
            ))}
          </select>
        </label>
        <label className={fieldAlert.className("scheduledDateTime")}>
          {fieldAlert.label("scheduledDateTime", "投与予定日時 *")}
          <input
            type="datetime-local"
            value={values.scheduledDateTime}
            onChange={(e) => update("scheduledDateTime", e.target.value)}
          />
        </label>
        {!setMode && (
          <label>
            使用場所
            <select
              value={values.locationId}
              onChange={(e) => handleLocationChange(e.target.value)}
            >
              <option value="">未指定</option>
              {locations.locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {locationDisplayName(location)}
                </option>
              ))}
              {/* 一覧に無い場所(無効にした病棟など)でも、保存済みの選択を失わせない。 */}
              {values.locationId &&
                !locations.locations.some((l) => l.id === values.locationId) && (
                  <option value={values.locationId}>
                    {values.locationName || values.locationId}
                  </option>
                )}
            </select>
          </label>
        )}
        <label>
          使用目的
          <input
            type="text"
            value={values.purpose}
            onChange={(e) => update("purpose", e.target.value)}
            placeholder="術中出血・貧血 など"
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
        <legend>{fieldAlert.label("products", "製剤 *")}</legend>
        <ul className="transfusion-order__products">
          {values.products.map((product, index) => {
            const category = categoryOf(product.productCode);
            return (
              <ProductCard
                // 製剤は並べ替えず、追加・削除しかしないので index を鍵にしてよい。
                key={index}
                index={index}
                product={product}
                productItems={productItems}
                removable={values.products.length > 1}
                bloodType={
                  setMode || !productNeedsBloodType(category)
                    ? null
                    : {
                        different: Boolean(
                          patient.abo && product.abo && product.abo !== patient.abo,
                        ),
                      }
                }
                onProductChange={(code) => handleProductChange(index, code)}
                onChange={(patch) => updateProduct(index, patch)}
                onRemove={() => removeProduct(index)}
                unitsLabel={fieldAlert.label(`product:${index}:units`, "単位数")}
                unitsClassName={fieldAlert.className(
                  `product:${index}:units`,
                  "transfusion-order__product-units",
                )}
              />
            );
          })}
          <li className="transfusion-order__product-add">
            <button type="button" onClick={addProduct}>
              ＋製剤追加
            </button>
          </li>
        </ul>
      </fieldset>

      {showCollections && (
        <CollectionPlanFieldset
          // 自己血の製剤を選び直したら既定値(回数・1 回量)を引き直す。
          key={autoItem?.item_code ?? ""}
          lines={values.collections}
          onChange={(collections) => update("collections", collections)}
          scheduledDateTime={values.scheduledDateTime}
          orderedVolume={autoItem?.unit_label === "mL" ? autoVolume : 0}
          defaultVolume={autoItem?.default_units}
          rowAlert={(index) => fieldAlert.icon(`collection:${index}`)}
        />
      )}

      {/* 輸血同意書。未確認のまま出せると確認そのものが形骸化するので必須にする。
          未チェックのうちは枠を注意色にして、見落としたまま登録を押させない。 */}
      {!setMode && (
        <fieldset>
          <legend>同意</legend>
          <label
            className={fieldAlert.className(
              "consentConfirmed",
              `transfusion-order__consent${
                values.consentConfirmed ? " transfusion-order__consent--done" : ""
              }`,
            )}
          >
            <input
              type="checkbox"
              checked={values.consentConfirmed}
              onChange={(e) => update("consentConfirmed", e.target.checked)}
            />
            <span className="transfusion-order__consent-text">
              {fieldAlert.label("consentConfirmed", "輸血同意書を取得済み *")}
            </span>
          </label>
        </fieldset>
      )}

      {!hideSubmit && (
        <div className="prescription-form__actions">
          <button type="submit" disabled={submitting}>
            {submitting ? "送信中..." : submitLabel}
          </button>
        </div>
      )}
      {confirmSubmit && (
        <AdvisoryConfirmModal
          advisories={session.pending}
          submitting={submitting}
          onConfirm={(overrides) => {
            session.confirm(overrides);
            setConfirmSubmit(null);
            confirmSubmit();
          }}
          onCancel={() => setConfirmSubmit(null)}
        />
      )}
    </form>
  );
}

/**
 * 検査結果の血液型 1 行。2 回一致で確定、1 回だけ・食い違いは印を付ける。
 * 検査結果が無ければ「未検査」を目立たせる(輸血前検査が無いまま出すのは例外なので)。
 */
function PretestRow({
  label,
  component,
  format,
}: {
  label: string;
  component: LabBloodTypeComponent | null;
  format: (value: string) => string;
}) {
  return (
    <tr>
      <th scope="row">{label}</th>
      {component ? (
        <>
          <td className="transfusion-order__pretest-value">
            {component.value ? format(component.value) : component.raw}
          </td>
          <td>{component.dates.join("、")}</td>
          <td>
            {component.conflict ? (
              <span className="blood-type__unconfirmed blood-type__unconfirmed--conflict">
                不一致
              </span>
            ) : (
              !component.confirmed && <span className="blood-type__unconfirmed">1回</span>
            )}
          </td>
        </>
      ) : (
        <>
          <td className="transfusion-order__pretest-missing">未検査</td>
          <td></td>
          <td></td>
        </>
      )}
    </tr>
  );
}

/** 製剤の血液型の表示。null なら型を出さない(区分「その他」・セットの内容)。 */
interface ProductBloodTypeChoice {
  /** 患者の型と違う型を選んでいる(異型適合)。 */
  different: boolean;
}

/** 製剤すべてが同じ型なら、その型。製剤ごとに違う(または無い)なら空。 */
function commonProductType(products: TransfusionProductValues[]): {
  abo: AboBloodType | "";
  rhd: RhdBloodType | "";
} {
  const typed = products.filter((product) => product.productCode && (product.abo || product.rhd));
  if (typed.length === 0) return { abo: "", rhd: "" };
  const abo = typed.every((p) => p.abo === typed[0].abo) ? typed[0].abo : "";
  const rhd = typed.every((p) => p.rhd === typed[0].rhd) ? typed[0].rhd : "";
  return { abo, rhd };
}

function ProductCard({
  index,
  product,
  productItems,
  removable,
  bloodType,
  onProductChange,
  onChange,
  onRemove,
  unitsLabel,
  unitsClassName,
}: {
  index: number;
  product: TransfusionProductValues;
  productItems: { item_code: string; name: string; unit_label: string }[];
  removable: boolean;
  bloodType: ProductBloodTypeChoice | null;
  onProductChange: (code: string) => void;
  onChange: (patch: Partial<TransfusionProductValues>) => void;
  onRemove: () => void;
  /** 単位数のラベルと label 要素の class。検証で弾かれたときの印(FieldAlert)はここに乗る。 */
  unitsLabel: ReactNode;
  unitsClassName: string | undefined;
}) {
  const missing =
    product.productCode && !productItems.some((i) => i.item_code === product.productCode);

  return (
    <li className="transfusion-order__product">
      <div className="transfusion-order__product-head">
        <span className="transfusion-order__product-number">
          製剤{index + 1}
          {/* 出す型。先頭のチップで選んだ型が入る(区分ごとに適合する型が違えば製剤ごとに変わる)。 */}
          {bloodType && product.productCode && (
            <>
              {" "}
              <TransfusionBloodBadge abo={product.abo} rhd={product.rhd} />
              {bloodType.different && <span className="blood-type__unconfirmed">異型</span>}
            </>
          )}
        </span>
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

      <label className={unitsClassName}>
        {unitsLabel}
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
