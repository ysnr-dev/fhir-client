import type { QueryKey } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { OrderContext } from "../orderContext";
import type { DefaultOrderSetting } from "../hooks/useDefaultOrderSetting";
import type { SlotSelection } from "../fhir/appointmentHelpers";
import {
  ORDER_SET_ORDER_TYPES,
  sanitizeValuesForSet,
  summarizeOrderSetValues,
  type OrderSetOrderType,
} from "../fhir/orderSetHelpers";
import {
  buildDoPrescriptionForm,
  buildPrescriptionBundle,
  emptyPrescriptionForm,
  withOrderWard,
  type PrescriptionFormValues,
  type PrescriptionSetting,
} from "../fhir/prescriptionHelpers";
import {
  buildDoInjectionForm,
  buildInjectionBundle,
  emptyInjectionForm,
  type InjectionFormValues,
} from "../fhir/injectionHelpers";
import {
  buildDoLabOrderForm,
  buildLabOrderBundle,
  emptyLabOrderForm,
  type LabOrderFormValues,
} from "../fhir/labOrderHelpers";
import {
  buildDoRadOrderForm,
  buildRadOrderBundle,
  emptyRadOrderForm,
  type RadOrderFormValues,
} from "../fhir/radOrderHelpers";
import { buildRadOrderWithPerformBundle, type RadImmediatePerforms } from "../fhir/radResultHelpers";
import {
  buildDoPhysioOrderForm,
  buildPhysioOrderBundle,
  emptyPhysioOrderForm,
  type PhysioOrderFormValues,
} from "../fhir/physioOrderHelpers";
import {
  buildPhysioOrderWithPerformBundle,
  type PhysioImmediatePerforms,
} from "../fhir/physioResultHelpers";
import {
  buildDoTreatmentOrderForm,
  buildTreatmentOrderBundle,
  emptyTreatmentOrderForm,
  type TreatmentOrderFormValues,
} from "../fhir/treatmentOrderHelpers";
import {
  buildTreatmentOrderWithPerformBundle,
  type TreatmentImmediatePerforms,
} from "../fhir/treatmentResultHelpers";
import { InjectionForm } from "./InjectionForm";
import { LabOrderForm } from "./LabOrderForm";
import { PhysioOrderForm } from "./PhysioOrderForm";
import { PrescriptionForm } from "./PrescriptionForm";
import { RadOrderForm } from "./RadOrderForm";
import { TreatmentOrderForm } from "./TreatmentOrderForm";

// オーダーセットが扱う種別ごとの対応表。セット登録画面と適用パネルはこの表だけを
// 見て動き、種別の分岐を持たない。fhir/orderSetHelpers.ts(React 非依存)と分けて
// いるのは、ここが Form コンポーネントを import するため。
//
// 値の型は種別ごとに違う異種テーブルなので境界は unknown にし、defineOrderSetType の
// 中だけで型を効かせる。buildBundle は各種別の CreatePanel の handleSubmit と同じ
// 組み立てにする(セットからの登録も個別の登録も、上流に届く Bundle は同じ形)。

export interface OrderSetFormRenderProps {
  /** セット登録画面では ""(患者なし)。適用パネルでは対象患者。 */
  patientId: string;
  initialValues: unknown;
  onSubmit: (values: unknown, ...extra: unknown[]) => void;
  submitting: boolean;
  submitError?: unknown;
  mode: "order" | "set";
  /** セット適用日。適用パネルが「開始日をまとめて入れる」ために渡す。 */
  bulkStartDate?: string;
}

export interface BuildBundleArgs {
  values: unknown;
  /** onSubmit の 2 番目以降の引数(放射線などの即実施・予約)。 */
  extra: unknown[];
  patientId: string;
  requester: OrderContext;
  defaultSetting: DefaultOrderSetting;
  /** 予約を同梱する種別が participant の表示名に使う。 */
  patient?: fhir4.Patient;
}

export interface OrderSetTypeDef {
  label: string;
  renderForm: (props: OrderSetFormRenderProps) => ReactNode;
  /** セットに新しく足すときの空のフォーム値。 */
  emptyValues: (setting: PrescriptionSetting) => unknown;
  /** 保存値 → 画面に出すフォーム値(既存の buildDoXxxForm。日付を当日で埋める)。 */
  buildDoValues: (values: unknown, setting: PrescriptionSetting) => unknown;
  /** 画面のフォーム値 → 保存する値(患者への参照を落とす)。 */
  sanitize: (values: unknown) => unknown;
  /** 一覧に出す 1 行の要約。 */
  summarize: (values: unknown) => string;
  /** フォーム値が持つ入外区分。 */
  settingOf: (values: unknown) => PrescriptionSetting;
  /** onSubmit の引数から transaction Bundle を作る。invalidate は登録後に読み直すキー。 */
  buildBundle: (args: BuildBundleArgs) => { bundle: fhir4.Bundle; invalidate: QueryKey[] };
}

interface TypedDef<V, X extends unknown[]> {
  label: string;
  renderForm: (props: {
    patientId: string;
    initialValues: V;
    onSubmit: (values: V, ...extra: X) => void;
    submitting: boolean;
    submitError?: unknown;
    setMode: boolean;
    bulkStartDate?: string;
  }) => ReactNode;
  emptyValues: (setting: PrescriptionSetting) => V;
  buildDoValues: (values: V, setting: PrescriptionSetting) => V;
  settingOf: (values: V) => PrescriptionSetting;
  buildBundle: (
    values: V,
    extra: X,
    ctx: Omit<BuildBundleArgs, "values" | "extra">,
  ) => { bundle: fhir4.Bundle; invalidate: QueryKey[] };
}

function defineOrderSetType<V, X extends unknown[]>(
  orderType: OrderSetOrderType,
  def: TypedDef<V, X>,
): OrderSetTypeDef {
  return {
    label: def.label,
    renderForm: (props) =>
      def.renderForm({
        ...props,
        setMode: props.mode === "set",
        initialValues: props.initialValues as V,
        onSubmit: (values, ...extra) => props.onSubmit(values, ...extra),
      }),
    emptyValues: def.emptyValues,
    buildDoValues: (values, setting) => def.buildDoValues(values as V, setting),
    sanitize: (values) => sanitizeValuesForSet(orderType, values),
    summarize: (values) => summarizeOrderSetValues(orderType, values),
    settingOf: (values) => def.settingOf(values as V),
    buildBundle: ({ values, extra, ...ctx }) => def.buildBundle(values as V, extra as X, ctx),
  };
}

const prescription = defineOrderSetType<PrescriptionFormValues, []>("prescription", {
  label: "処方",
  renderForm: (props) => (
    <PrescriptionForm
      patientId={props.patientId}
      initialValues={props.initialValues}
      onSubmit={props.onSubmit}
      submitting={props.submitting}
      submitError={props.submitError}
      bulkStartDate={props.bulkStartDate}
      setMode={props.setMode}
      hideSubmit
    />
  ),
  emptyValues: (setting) => emptyPrescriptionForm(null, setting),
  buildDoValues: buildDoPrescriptionForm,
  settingOf: (values) => values.setting,
  buildBundle: (values, _extra, { patientId, requester, defaultSetting }) => ({
    // 新規オーダーには登録時点の入院病棟も焼き付ける(各 CreatePanel と同じ)。
    bundle: buildPrescriptionBundle(
      values,
      patientId,
      withOrderWard(requester, values.setting, defaultSetting),
    ),
    invalidate: [],
  }),
});

const injection = defineOrderSetType<InjectionFormValues, []>("injection", {
  label: "注射",
  renderForm: (props) => (
    <InjectionForm
      patientId={props.patientId}
      initialValues={props.initialValues}
      onSubmit={props.onSubmit}
      submitting={props.submitting}
      submitError={props.submitError}
      bulkStartDate={props.bulkStartDate}
      setMode={props.setMode}
      hideSubmit
    />
  ),
  emptyValues: (setting) => emptyInjectionForm(null, setting),
  buildDoValues: buildDoInjectionForm,
  settingOf: (values) => values.setting,
  buildBundle: (values, _extra, { patientId, requester, defaultSetting }) => ({
    bundle: buildInjectionBundle(
      values,
      patientId,
      withOrderWard(requester, values.setting, defaultSetting),
    ),
    invalidate: [],
  }),
});

const labOrder = defineOrderSetType<LabOrderFormValues, []>("lab-order", {
  label: "検体検査",
  renderForm: (props) => (
    <LabOrderForm
      patientId={props.patientId}
      initialValues={props.initialValues}
      onSubmit={props.onSubmit}
      submitting={props.submitting}
      submitError={props.submitError}
      bulkStartDate={props.bulkStartDate}
      setMode={props.setMode}
      hideSubmit
    />
  ),
  emptyValues: (setting) => emptyLabOrderForm(null, setting),
  buildDoValues: buildDoLabOrderForm,
  settingOf: (values) => values.setting,
  buildBundle: (values, _extra, { patientId, requester, defaultSetting }) => ({
    bundle: buildLabOrderBundle(
      values,
      patientId,
      withOrderWard(requester, values.setting, defaultSetting),
    ),
    invalidate: [],
  }),
});

// 予約を同梱する種別(放射線・生理・処置)は、予約があれば患者リソースが要る
// (participant に患者の表示名まで持たせる。各 CreatePanel と同じ)。
function bookingOf(
  bookings: Record<string, SlotSelection> | null,
  patient: fhir4.Patient | undefined,
): { patient: fhir4.Patient; selections: Record<string, SlotSelection> } | undefined {
  return bookings && Object.keys(bookings).length > 0 && patient
    ? { patient, selections: bookings }
    : undefined;
}

function examInvalidate(worklist: string, performs: unknown, booking: unknown): QueryKey[] {
  return [
    // 即実施では実施済の Task まで作るので、部門一覧の当日ぶんも読み直す。
    ...(performs ? [["ServiceRequest", worklist]] : []),
    // 予約も一緒に書いたので、予約タブと枠カレンダーを読み直させる。
    ...(booking ? [["Appointment"], ["Slot"]] : []),
  ];
}

const radOrder = defineOrderSetType<
  RadOrderFormValues,
  [RadImmediatePerforms | null, Record<string, SlotSelection> | null]
>("rad-order", {
  label: "放射線検査",
  renderForm: (props) => (
    <RadOrderForm
      patientId={props.patientId}
      initialValues={props.initialValues}
      onSubmit={props.onSubmit}
      submitting={props.submitting}
      submitError={props.submitError}
      bulkStartDate={props.bulkStartDate}
      setMode={props.setMode}
      hideSubmit
    />
  ),
  emptyValues: (setting) => emptyRadOrderForm(null, setting),
  buildDoValues: buildDoRadOrderForm,
  settingOf: (values) => values.setting,
  buildBundle: (values, [performs, bookings], { patientId, requester, defaultSetting, patient }) => {
    const attribution = withOrderWard(requester, values.setting, defaultSetting);
    const booking = bookingOf(bookings, patient);
    return {
      bundle: performs
        ? buildRadOrderWithPerformBundle(values, patientId, attribution, performs)
        : buildRadOrderBundle(values, patientId, attribution, booking),
      invalidate: examInvalidate("rad-worklist", performs, booking),
    };
  },
});

const physioOrder = defineOrderSetType<
  PhysioOrderFormValues,
  [PhysioImmediatePerforms | null, Record<string, SlotSelection> | null]
>("physio-order", {
  label: "生理検査",
  renderForm: (props) => (
    <PhysioOrderForm
      patientId={props.patientId}
      initialValues={props.initialValues}
      onSubmit={props.onSubmit}
      submitting={props.submitting}
      submitError={props.submitError}
      bulkStartDate={props.bulkStartDate}
      setMode={props.setMode}
      hideSubmit
    />
  ),
  emptyValues: (setting) => emptyPhysioOrderForm(null, setting),
  buildDoValues: buildDoPhysioOrderForm,
  settingOf: (values) => values.setting,
  buildBundle: (values, [performs, bookings], { patientId, requester, defaultSetting, patient }) => {
    const attribution = withOrderWard(requester, values.setting, defaultSetting);
    const booking = bookingOf(bookings, patient);
    return {
      bundle: performs
        ? buildPhysioOrderWithPerformBundle(values, patientId, attribution, performs)
        : buildPhysioOrderBundle(values, patientId, attribution, booking),
      invalidate: examInvalidate("physio-worklist", performs, booking),
    };
  },
});

const treatmentOrder = defineOrderSetType<
  TreatmentOrderFormValues,
  [TreatmentImmediatePerforms | null, Record<string, SlotSelection> | null]
>("treatment-order", {
  label: "処置",
  renderForm: (props) => (
    <TreatmentOrderForm
      patientId={props.patientId}
      initialValues={props.initialValues}
      onSubmit={props.onSubmit}
      submitting={props.submitting}
      submitError={props.submitError}
      bulkStartDate={props.bulkStartDate}
      setMode={props.setMode}
      hideSubmit
    />
  ),
  emptyValues: (setting) => emptyTreatmentOrderForm(null, setting),
  buildDoValues: buildDoTreatmentOrderForm,
  settingOf: (values) => values.setting,
  buildBundle: (values, [performs, bookings], { patientId, requester, defaultSetting, patient }) => {
    const attribution = withOrderWard(requester, values.setting, defaultSetting);
    const booking = bookingOf(bookings, patient);
    return {
      bundle: performs
        ? buildTreatmentOrderWithPerformBundle(values, patientId, attribution, performs)
        : buildTreatmentOrderBundle(values, patientId, attribution, booking),
      invalidate: examInvalidate("treatment-worklist", performs, booking),
    };
  },
});

/** 対応済みの種別。未対応の種別はここに無く、登録画面の追加ボタンにも出ない。 */
export const ORDER_SET_TYPES: Partial<Record<OrderSetOrderType, OrderSetTypeDef>> = {
  prescription,
  injection,
  "lab-order": labOrder,
  "rad-order": radOrder,
  "physio-order": physioOrder,
  "treatment-order": treatmentOrder,
};

/** 登録画面の「追加」ボタンに出す順(対応済みの種別だけ)。 */
export const ORDER_SET_TYPE_ORDER: OrderSetOrderType[] = ORDER_SET_ORDER_TYPES.filter(
  (type) => ORDER_SET_TYPES[type] !== undefined,
);

/** 全種別の表示名(未対応の種別も一覧では名前を出す)。 */
export const ORDER_SET_TYPE_LABELS: Record<OrderSetOrderType, string> = {
  prescription: "処方",
  injection: "注射",
  "lab-order": "検体検査",
  "micro-order": "細菌検査",
  "patho-order": "病理検査",
  "rad-order": "放射線検査",
  "physio-order": "生理検査",
  "endoscopy-order": "内視鏡",
  "treatment-order": "処置",
  "surgery-order": "手術",
  "meal-order": "食事",
  "transfusion-order": "輸血",
  "rehab-order": "リハビリ",
  "nutrition-guidance-order": "栄養指導",
  "consult-order": "他科依頼",
  "nursing-order": "看護指示",
};
