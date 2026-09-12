import type { QueryKey } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { OrderContext } from "../orderContext";
import type { DefaultOrderSetting } from "../hooks/useDefaultOrderSetting";
import type { SlotSelection } from "../fhir/appointmentHelpers";
import {
  buildConditionBundle,
  buildDoConditionForm,
  emptyConditionForm,
  findActiveSameCondition,
  splitConditions,
  summarizeCondition,
  type ConditionFormValues,
} from "../fhir/conditionHelpers";
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
import {
  buildDoNursingOrderForm,
  buildNursingOrderBundle,
  emptyNursingOrderForm,
  type NursingOrderFormValues,
} from "../fhir/nursingOrderHelpers";
import {
  buildDoMealOrderForm,
  buildMealOrderBundle,
  emptyMealOrderForm,
  type MealOrderFormValues,
} from "../fhir/mealOrderHelpers";
import {
  buildDoSurgeryOrderForm,
  buildSurgeryOrderBundle,
  emptySurgeryOrderForm,
  type SurgeryOrderFormValues,
} from "../fhir/surgeryOrderHelpers";
import {
  buildDoTransfusionOrderForm,
  buildTransfusionOrderBundle,
  emptyTransfusionOrderForm,
  type TransfusionOrderFormValues,
} from "../fhir/transfusionOrderHelpers";
import {
  buildDoRehabOrderForm,
  buildRehabOrderBundle,
  emptyRehabOrderForm,
  type RehabOrderFormValues,
} from "../fhir/rehabOrderHelpers";
import {
  buildDoNutritionGuidanceOrderForm,
  buildNutritionGuidanceOrderBundle,
  emptyNutritionGuidanceOrderForm,
  type NutritionGuidanceOrderFormValues,
} from "../fhir/nutritionGuidanceOrderHelpers";
import {
  buildConsultOrderBundle,
  buildDoConsultOrderForm,
  emptyConsultOrderForm,
  type ConsultOrderFormValues,
} from "../fhir/consultOrderHelpers";
import {
  buildDoMicroOrderForm,
  buildMicroOrderBundle,
  emptyMicroOrderForm,
  type MicroOrderFormValues,
} from "../fhir/microOrderHelpers";
import {
  buildDoPathoOrderForm,
  buildPathoOrderBundle,
  emptyPathoOrderForm,
  type PathoOrderFormValues,
} from "../fhir/pathoOrderHelpers";
import {
  buildDoEndoscopyOrderForm,
  buildEndoscopyOrderBundle,
  emptyEndoscopyOrderForm,
  type EndoscopyOrderFormValues,
} from "../fhir/endoscopyOrderHelpers";
import {
  buildEndoscopyOrderWithPerformBundle,
  type EndoscopyImmediatePerforms,
} from "../fhir/endoscopyResultHelpers";
import { today } from "../lib/dates";
import { ConditionForm } from "./ConditionForm";
import { ConsultOrderForm } from "./ConsultOrderForm";
import { EndoscopyOrderForm } from "./EndoscopyOrderForm";
import { InjectionForm } from "./InjectionForm";
import { LabOrderForm } from "./LabOrderForm";
import { MealOrderForm } from "./MealOrderForm";
import { MicroOrderForm } from "./MicroOrderForm";
import { NursingOrderForm } from "./NursingOrderForm";
import { NutritionGuidanceOrderForm } from "./NutritionGuidanceOrderForm";
import { PathoOrderForm } from "./PathoOrderForm";
import { PhysioOrderForm } from "./PhysioOrderForm";
import { PrescriptionForm } from "./PrescriptionForm";
import { RadOrderForm } from "./RadOrderForm";
import { RehabOrderForm } from "./RehabOrderForm";
import { SurgeryOrderForm } from "./SurgeryOrderForm";
import { TransfusionOrderForm } from "./TransfusionOrderForm";
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
  /** 適用先患者の病名(病名エントリの親プロブレム候補)。セット登録画面では無し。 */
  conditions?: fhir4.Condition[];
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
  /**
   * 入院(Encounter.id)。入院にだけ出す種別(看護指示・食事)がオーダーに焼く。
   * セット適用は入院中の Encounter、パス適用は適用先に選んだ入院(予定)。
   */
  encounterId?: string;
  /**
   * プロブレム区分の病名に付ける番号を 1 つ採る。適用 1 回ぶんのクロージャなので、
   * 同じ適用に病名が複数あっても順に連番になる。
   */
  allocateProblemNumber: () => number;
}

/** 「患者に同じものが既にあるので登録しない」の判定に渡す材料。 */
export interface DuplicateContext {
  conditions: fhir4.Condition[];
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
  /** フォーム値が持つ入外区分。持たない種別(病名)は ""。 */
  settingOf: (values: unknown) => PrescriptionSetting | "";
  /**
   * 適用先の患者に同じものが既にあって登録しない理由。無ければ null。
   * 適用パネルはこれが非 null のエントリを既定で除外し、チェックも入れさせない。
   */
  duplicateNote?: (values: unknown, ctx: DuplicateContext) => string | null;
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
    conditions?: fhir4.Condition[];
  }) => ReactNode;
  emptyValues: (setting: PrescriptionSetting) => V;
  buildDoValues: (values: V, setting: PrescriptionSetting) => V;
  settingOf?: (values: V) => PrescriptionSetting;
  duplicateNote?: (values: V, ctx: DuplicateContext) => string | null;
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
    settingOf: (values) => def.settingOf?.(values as V) ?? "",
    duplicateNote: def.duplicateNote
      ? (values, ctx) => def.duplicateNote!(values as V, ctx)
      : undefined,
    buildBundle: ({ values, extra, ...ctx }) => def.buildBundle(values as V, extra as X, ctx),
  };
}

// 病名はオーダーではないが、セットのエントリとして同列に扱う(「この症状ならこの病名で
// この処方」をひとまとめにする)。入外区分は無いので settingOf を持たない。
const condition = defineOrderSetType<ConditionFormValues, []>("condition", {
  label: "病名",
  renderForm: (props) => (
    <ConditionForm
      initialValues={props.initialValues}
      onSubmit={props.onSubmit}
      submitting={props.submitting}
      submitError={props.submitError}
      bulkStartDate={props.bulkStartDate}
      setMode={props.setMode}
      hideSubmit
      problems={splitConditions(props.conditions ?? []).problems}
    />
  ),
  emptyValues: () => emptyConditionForm(),
  buildDoValues: (values) => buildDoConditionForm(values),
  // 同じ病名が継続中なら登録しない(区分は問わない。別区分で重ねたいときは病名タブから)。
  duplicateNote: (values, { conditions }) => {
    const found = findActiveSameCondition(values, conditions);
    if (!found) return null;
    const { name, startDate } = summarizeCondition(found);
    return `同じ病名「${name}」が継続中のため登録しません${startDate ? `(開始日 ${startDate})` : ""}。`;
  },
  buildBundle: (values, _extra, { patientId, allocateProblemNumber }) => ({
    bundle: buildConditionBundle(
      values,
      patientId,
      values.category === "problem" ? allocateProblemNumber() : undefined,
    ),
    invalidate: [["Condition", "search"]],
  }),
});

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

const endoscopyOrder = defineOrderSetType<
  EndoscopyOrderFormValues,
  [EndoscopyImmediatePerforms | null, Record<string, SlotSelection> | null]
>("endoscopy-order", {
  label: "内視鏡",
  renderForm: (props) => (
    <EndoscopyOrderForm
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
  emptyValues: (setting) => emptyEndoscopyOrderForm(null, setting),
  buildDoValues: buildDoEndoscopyOrderForm,
  settingOf: (values) => values.setting,
  buildBundle: (values, [performs, bookings], { patientId, requester, defaultSetting, patient }) => {
    const attribution = withOrderWard(requester, values.setting, defaultSetting);
    const booking = bookingOf(bookings, patient);
    return {
      bundle: performs
        ? buildEndoscopyOrderWithPerformBundle(values, patientId, attribution, performs)
        : buildEndoscopyOrderBundle(values, patientId, attribution, booking),
      invalidate: examInvalidate("endoscopy-worklist", performs, booking),
    };
  },
});

const microOrder = defineOrderSetType<MicroOrderFormValues, []>("micro-order", {
  label: "細菌検査",
  renderForm: (props) => (
    <MicroOrderForm
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
  emptyValues: (setting) => emptyMicroOrderForm(null, setting),
  buildDoValues: buildDoMicroOrderForm,
  settingOf: (values) => values.setting,
  buildBundle: (values, _extra, { patientId, requester, defaultSetting }) => ({
    bundle: buildMicroOrderBundle(
      values,
      patientId,
      withOrderWard(requester, values.setting, defaultSetting),
    ),
    invalidate: [],
  }),
});

// 採取日時・投与予定日時は DO では空にするが、積んだフォームは外から一括 submit
// されるので、適用日(bulkStartDate)が入るまでの初期値として当日の朝を入れておく。
const DEFAULT_APPLY_TIME = "09:00";

const pathoOrder = defineOrderSetType<PathoOrderFormValues, []>("patho-order", {
  label: "病理検査",
  renderForm: (props) => (
    <PathoOrderForm
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
  emptyValues: (setting) => emptyPathoOrderForm(null, setting),
  buildDoValues: (values, setting) => ({
    ...buildDoPathoOrderForm(values, setting),
    collectionDateTime: `${today()}T${DEFAULT_APPLY_TIME}`,
  }),
  settingOf: (values) => values.setting,
  buildBundle: (values, _extra, { patientId, requester, defaultSetting }) => ({
    bundle: buildPathoOrderBundle(
      values,
      patientId,
      withOrderWard(requester, values.setting, defaultSetting),
    ),
    invalidate: [],
  }),
});

const surgeryOrder = defineOrderSetType<SurgeryOrderFormValues, []>("surgery-order", {
  label: "手術",
  renderForm: (props) => (
    <SurgeryOrderForm
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
  emptyValues: (setting) => emptySurgeryOrderForm(null, setting),
  buildDoValues: buildDoSurgeryOrderForm,
  settingOf: (values) => values.setting,
  buildBundle: (values, _extra, { patientId, requester, defaultSetting }) => ({
    bundle: buildSurgeryOrderBundle(
      values,
      patientId,
      withOrderWard(requester, values.setting, defaultSetting),
    ),
    // 手術カレンダーと手術部の一覧は ServiceRequest の検索キーで読み直される。
    invalidate: [],
  }),
});

// 看護指示・食事は入院にだけ出す種別で、フォーム値に入外区分を持たない。
// セットの入外区分は「入院」として扱い、外来の患者に適用すると注意が出る。
const nursingOrder = defineOrderSetType<NursingOrderFormValues, []>("nursing-order", {
  label: "看護指示",
  renderForm: (props) => (
    <NursingOrderForm
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
  emptyValues: () => emptyNursingOrderForm(),
  buildDoValues: (values) => buildDoNursingOrderForm(values),
  settingOf: () => "inpatient",
  buildBundle: (values, _extra, { patientId, requester, defaultSetting, encounterId }) => ({
    bundle: buildNursingOrderBundle(
      values,
      patientId,
      withOrderWard(requester, "inpatient", defaultSetting),
      encounterId,
    ),
    invalidate: [],
  }),
});

// 食事は「いま出ている食事の終了・再開」をここでは扱わず、新しい指示だけ登録する
// (終了・再開は食事タブから)。
const mealOrder = defineOrderSetType<MealOrderFormValues, [string[], string[]]>("meal-order", {
  label: "食事",
  renderForm: (props) => (
    <MealOrderForm
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
  emptyValues: () => emptyMealOrderForm(),
  buildDoValues: (values) => buildDoMealOrderForm(values),
  settingOf: () => "inpatient",
  buildBundle: (values, _extra, { patientId, requester, defaultSetting, encounterId }) => ({
    bundle: buildMealOrderBundle(
      values,
      patientId,
      withOrderWard(requester, "inpatient", defaultSetting),
      [],
      [],
      encounterId,
    ),
    invalidate: [],
  }),
});

const transfusionOrder = defineOrderSetType<TransfusionOrderFormValues, []>("transfusion-order", {
  label: "輸血",
  renderForm: (props) => (
    <TransfusionOrderForm
      patientId={props.patientId}
      initialValues={props.initialValues}
      onSubmit={props.onSubmit}
      submitting={props.submitting}
      submitError={props.submitError}
      // 患者に出すときは検査で確定した血液型を初期値に入れる(新規登録と同じ)。
      prefillBloodType={!props.setMode}
      bulkStartDate={props.bulkStartDate}
      setMode={props.setMode}
      hideSubmit
    />
  ),
  emptyValues: (setting) => emptyTransfusionOrderForm(setting),
  buildDoValues: (values, setting) => ({
    ...buildDoTransfusionOrderForm(values, setting),
    scheduledDateTime: `${today()}T${DEFAULT_APPLY_TIME}`,
  }),
  settingOf: (values) => values.setting,
  buildBundle: (values, _extra, { patientId, requester, defaultSetting }) => ({
    bundle: buildTransfusionOrderBundle(
      values,
      patientId,
      withOrderWard(requester, values.setting, defaultSetting),
    ),
    invalidate: [],
  }),
});

const rehabOrder = defineOrderSetType<RehabOrderFormValues, []>("rehab-order", {
  label: "リハビリ",
  renderForm: (props) => (
    <RehabOrderForm
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
  emptyValues: (setting) => emptyRehabOrderForm(setting),
  buildDoValues: buildDoRehabOrderForm,
  settingOf: (values) => values.setting,
  buildBundle: (values, _extra, { patientId, requester, defaultSetting }) => ({
    bundle: buildRehabOrderBundle(
      values,
      patientId,
      withOrderWard(requester, values.setting, defaultSetting),
    ),
    invalidate: [],
  }),
});

const nutritionGuidanceOrder = defineOrderSetType<NutritionGuidanceOrderFormValues, []>(
  "nutrition-guidance-order",
  {
    label: "栄養指導",
    renderForm: (props) => (
      <NutritionGuidanceOrderForm
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
    emptyValues: (setting) => emptyNutritionGuidanceOrderForm(setting),
    buildDoValues: buildDoNutritionGuidanceOrderForm,
    settingOf: (values) => values.setting,
    buildBundle: (values, _extra, { patientId, requester, defaultSetting }) => ({
      bundle: buildNutritionGuidanceOrderBundle(
        values,
        patientId,
        withOrderWard(requester, values.setting, defaultSetting),
      ),
      invalidate: [],
    }),
  },
);

const consultOrder = defineOrderSetType<ConsultOrderFormValues, []>("consult-order", {
  label: "他科依頼",
  renderForm: (props) => (
    <ConsultOrderForm
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
  emptyValues: (setting) => emptyConsultOrderForm(setting),
  buildDoValues: buildDoConsultOrderForm,
  settingOf: (values) => values.setting,
  buildBundle: (values, _extra, { patientId, requester, defaultSetting }) => ({
    bundle: buildConsultOrderBundle(
      values,
      patientId,
      withOrderWard(requester, values.setting, defaultSetting),
    ),
    invalidate: [],
  }),
});

/** 種別ごとの対応表。ORDER_SET_ORDER_TYPES の全種別を持つ。 */
export const ORDER_SET_TYPES: Partial<Record<OrderSetOrderType, OrderSetTypeDef>> = {
  condition,
  prescription,
  injection,
  "lab-order": labOrder,
  "micro-order": microOrder,
  "patho-order": pathoOrder,
  "rad-order": radOrder,
  "physio-order": physioOrder,
  "endoscopy-order": endoscopyOrder,
  "treatment-order": treatmentOrder,
  "surgery-order": surgeryOrder,
  "meal-order": mealOrder,
  "transfusion-order": transfusionOrder,
  "rehab-order": rehabOrder,
  "nutrition-guidance-order": nutritionGuidanceOrder,
  "consult-order": consultOrder,
  "nursing-order": nursingOrder,
};

/** 登録画面の「追加」ボタンに出す順。 */
export const ORDER_SET_TYPE_ORDER: OrderSetOrderType[] = ORDER_SET_ORDER_TYPES.filter(
  (type) => ORDER_SET_TYPES[type] !== undefined,
);

/** 全種別の表示名(このクライアントより新しい種別のエントリでも一覧では名前を出す)。 */
export const ORDER_SET_TYPE_LABELS: Record<OrderSetOrderType, string> = {
  condition: "病名",
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
