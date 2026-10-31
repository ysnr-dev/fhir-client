import { useMemo, type ComponentType } from "react";
import { useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { useCreatePrescription, usePatient, useOrderAppointment } from "../api/queries";
import type { RadBookingChange } from "../api/queries/rad";
import { buildExamAppointmentEntries, type SlotSelection } from "../fhir/appointmentHelpers";
import type { ProblemRef } from "../fhir/conditionHelpers";
import { orderRequester, withOrderWard } from "../fhir/orderHeader";
import type { PrescriptionSetting } from "../fhir/prescriptionHelpers";
import { useOrderContext } from "../hooks/useOrderContext";
import type { OrderContext } from "../orderContext";
import { useDefaultOrderSetting } from "../hooks/useDefaultOrderSetting";
import { ErrorBanner } from "./ErrorBanner";

// 検査系の部門オーダー(放射線・生理・内視鏡)の登録・編集 UI。カルテ画面の右ペインから使う。
// 送信は処方・注射・検体検査と同じ transaction Bundle の POST なので mutation を共用する
// (無効化キーも ServiceRequest 検索で共通)。部門の違いは FHIR の組み立て関数・初期値の hook・
// フォーム部品だけなので、それらを設定で受け取って同じ流れを回す。

/** 予約必須の項目に取る予約。キーは項目コード。 */
interface ExamOrderBooking {
  patient: fhir4.Patient;
  selections: Record<string, SlotSelection>;
}

/** 部門のオーダーフォームが受ける props のうち、パネルが渡すもの。 */
export interface ExamOrderFormPanelProps<V, P> {
  patientId: string;
  initialValues?: V;
  onSubmit: (values: V, performs: P | null, bookings: Record<string, SlotSelection> | null) => void;
  submitting: boolean;
  submitError?: unknown;
  submitLabel?: string;
  editing?: boolean;
  hasBooking?: boolean;
}

/** 部門の初期値 hook(use*OrderInitialValues)が返すもの。 */
export interface ExamOrderInitialValues<V> {
  serviceRequest: fhir4.ServiceRequest | undefined;
  itemIds: string[];
  responseIds: string[];
  initialValues: V | undefined;
  ready: boolean;
  patientMismatch: boolean;
  error: unknown;
}

export interface ExamOrderPanelsConfig<V extends { setting: PrescriptionSetting }, P> {
  /** 部門一覧のクエリキー("physio-worklist" など)。即実施で当日ぶんを読み直す。 */
  worklistKey: string;
  useInitialValues: (srId: string | undefined, patientId?: string) => ExamOrderInitialValues<V>;
  useUpdateOrder: () => UseMutationResult<
    unknown,
    Error,
    { bundle: fhir4.Bundle; booking: RadBookingChange | null }
  >;
  emptyForm: (problem: ProblemRef | null, setting: PrescriptionSetting) => V;
  buildDoForm: (values: V, setting: PrescriptionSetting) => V;
  buildOrderBundle: (
    values: V,
    patientId: string,
    requester: OrderContext,
    booking?: ExamOrderBooking,
  ) => fhir4.Bundle;
  buildOrderWithPerformBundle: (
    values: V,
    patientId: string,
    requester: OrderContext,
    performs: P,
  ) => fhir4.Bundle;
  buildOrderUpdateBundle: (
    values: V,
    patientId: string,
    original: fhir4.ServiceRequest,
    originalItemIds: string[],
    originalResponseIds: string[],
    requester: OrderContext,
  ) => fhir4.Bundle;
  Form: ComponentType<ExamOrderFormPanelProps<V, P>>;
}

export interface ExamOrderCreatePanelProps {
  patientId: string;
  /** DO(内容を流用して新規登録)する元の ServiceRequest id。 */
  sourceSrId?: string;
  defaultProblem?: ProblemRef;
  onSaved: () => void;
}

export interface ExamOrderEditPanelProps {
  patientId: string;
  srId: string;
  onSaved: () => void;
}

export function createExamOrderPanels<V extends { setting: PrescriptionSetting }, P>(
  config: ExamOrderPanelsConfig<V, P>,
) {
  const { Form } = config;

  function CreatePanel({ patientId, sourceSrId, defaultProblem, onSaved }: ExamOrderCreatePanelProps) {
    const createOrder = useCreatePrescription();
    const source = config.useInitialValues(sourceSrId, patientId);
    // 入外区分の初期値は入院中なら「入院」。DO でも DO 元ではなくいまの状態に合わせる。
    const defaultSetting = useDefaultOrderSetting(patientId);
    // DO 元と入院かどうかの読み込み完了を待ってからフォームを描画する
    // (初期値は初回描画時のみ反映される)。
    const waiting = (sourceSrId && !source.ready) || !defaultSetting.ready;
    // DO も新しいオーダーなので、依頼元は DO 元ではなくヘッダーで選択中のものを使う。
    const requester = useOrderContext();
    // 予約必須の検査は予約(Appointment)も同じ transaction で作る。participant に
    // 患者の表示名まで持たせたいので患者リソースを読んでおく。
    const { data: patientResult } = usePatient(patientId);
    const queryClient = useQueryClient();

    const initialValues = useMemo(
      () =>
        source.initialValues
          ? config.buildDoForm(source.initialValues, defaultSetting.setting)
          : config.emptyForm(defaultProblem ?? null, defaultSetting.setting),
      [source.initialValues, defaultProblem, defaultSetting.setting],
    );

    function handleSubmit(
      values: V,
      performs: P | null,
      bookings: Record<string, SlotSelection> | null,
    ) {
      const patient = patientResult?.data;
      // 予約は患者リソースが揃ってから同梱できる(読み込みは画面を開いた時点で始まって
      // いるので、通らないのは患者が消えた場合くらい)。
      const booking =
        bookings && Object.keys(bookings).length > 0 && patient
          ? { patient, selections: bookings }
          : undefined;

      // 新規オーダーには登録時点の入院病棟も焼き付ける(部門の一覧が入院を引き直さずに済む)。
      const attribution = withOrderWard(requester, values.setting, defaultSetting);
      const bundle = performs
        ? config.buildOrderWithPerformBundle(values, patientId, attribution, performs)
        : config.buildOrderBundle(values, patientId, attribution, booking);

      createOrder.mutate(bundle, {
        onSuccess: () => {
          // 即実施では実施済の Task まで作るので、部門一覧の当日ぶんも読み直す
          // (オーダーの無効化キーは検索(ServiceRequest search)だけを見ている)。
          if (performs) {
            queryClient.invalidateQueries({ queryKey: ["ServiceRequest", config.worklistKey] });
          }
          // 予約も一緒に書いたので、予約タブと枠カレンダーを読み直させる。
          if (booking) {
            queryClient.invalidateQueries({ queryKey: ["Appointment"] });
            queryClient.invalidateQueries({ queryKey: ["Slot"] });
          }
          onSaved();
        },
      });
    }

    return (
      <>
        <ErrorBanner error={source.error} />

        {waiting ? (
          <p>読み込み中...</p>
        ) : (
          <Form
            patientId={patientId}
            initialValues={initialValues}
            onSubmit={handleSubmit}
            submitting={createOrder.isPending}
            submitError={createOrder.error}
          />
        )}
      </>
    );
  }

  function EditPanel({ patientId, srId, onSaved }: ExamOrderEditPanelProps) {
    const updateOrder = config.useUpdateOrder();
    const { serviceRequest, itemIds, responseIds, initialValues, ready, patientMismatch, error } =
      config.useInitialValues(srId, patientId);
    // 予約日時の変更もこの画面から行うので、オーダーに紐づく検査予約を読んでおく
    // (予約タブからは変えない。オーダーの実施日時と必ず一緒に動かすため)。
    const booking = useOrderAppointment(srId);
    // 日付未定で出したオーダーに予約を取るときは、予約(Appointment)を新しく作る。
    const { data: patientResult } = usePatient(patientId);

    function handleSubmit(
      values: V,
      _performs: P | null,
      bookings: Record<string, SlotSelection> | null,
    ) {
      // 別患者のオーダーを更新すると subject が URL の患者に書き換わってしまうので防ぐ。
      if (!serviceRequest || patientMismatch) return;
      // 予約日時を選び直したときだけ、予約の付け替えを同じ transaction に同梱する。
      // 編集は 1 オーダーへの書き戻しなので、予約も選択もそのオーダーの 1 件だけ。
      const selection = bookings ? Object.values(bookings)[0] : undefined;
      const appointment = booking.appointment;
      const bundle = config.buildOrderUpdateBundle(
        values,
        patientId,
        serviceRequest,
        itemIds,
        responseIds,
        orderRequester(serviceRequest),
      );
      // 予約がまだ無いオーダー(日付未定で出したもの)に枠を選んだときは、予約を同じ transaction で作る。
      const patient = patientResult?.data;
      if (selection && !appointment && patient) {
        bundle.entry = [
          ...(bundle.entry ?? []),
          ...buildExamAppointmentEntries(patient, selection, `ServiceRequest/${serviceRequest.id}`),
        ];
      }

      // 依頼科・依頼医師は登録時のものを引き継ぐ(処方・注射・検体検査の編集と同じ)。
      // 外した項目・参照が外れたテンプレート回答は、元の id との差分で DELETE される。
      updateOrder.mutate(
        {
          bundle,
          booking: selection && appointment ? { appointment, slots: selection.slots } : null,
        },
        { onSuccess: onSaved },
      );
    }

    return (
      <>
        <ErrorBanner error={error} />
        <ErrorBanner error={booking.error} />

        {!ready || booking.isLoading ? (
          <p>読み込み中...</p>
        ) : (
          serviceRequest &&
          initialValues && (
            <Form
              patientId={patientId}
              initialValues={initialValues}
              onSubmit={handleSubmit}
              submitting={updateOrder.isPending}
              submitError={updateOrder.error}
              submitLabel="更新"
              editing
              hasBooking={Boolean(booking.appointment)}
            />
          )
        )}
      </>
    );
  }

  return { CreatePanel, EditPanel };
}
