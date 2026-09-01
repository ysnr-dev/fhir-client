import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreatePrescription,
  usePatient,
  useTreatmentOrderAppointment,
  useUpdateTreatmentOrder,
} from "../api/queries";
import type { SlotSelection } from "../fhir/appointmentHelpers";
import type { ProblemRef } from "../fhir/conditionHelpers";
import { prescriptionRequester, withOrderWard } from "../fhir/prescriptionHelpers";
import {
  buildDoTreatmentOrderForm,
  buildTreatmentOrderBundle,
  buildTreatmentOrderUpdateBundle,
  emptyTreatmentOrderForm,
  type TreatmentOrderFormValues,
} from "../fhir/treatmentOrderHelpers";
import {
  buildTreatmentOrderWithPerformBundle,
  type TreatmentImmediatePerforms,
} from "../fhir/treatmentResultHelpers";
import { useOrderContext } from "../hooks/useOrderContext";
import { useTreatmentOrderInitialValues } from "../hooks/useTreatmentOrderInitialValues";
import { useDefaultOrderSetting } from "../hooks/useDefaultOrderSetting";
import { ErrorBanner } from "./ErrorBanner";
import { TreatmentOrderForm } from "./TreatmentOrderForm";

// 処置オーダーの登録・編集 UI。カルテ画面の右ペインから使う。
// 送信は処方・注射・検体検査・放射線検査と同じ transaction Bundle の POST なので
// mutation を共用する(無効化キーも ServiceRequest 検索で共通)。

interface TreatmentOrderCreatePanelProps {
  patientId: string;
  /** DO(内容を流用して新規登録)する元の ServiceRequest id。 */
  sourceSrId?: string;
  defaultProblem?: ProblemRef;
  onSaved: () => void;
}

export function TreatmentOrderCreatePanel({
  patientId,
  sourceSrId,
  defaultProblem,
  onSaved,
}: TreatmentOrderCreatePanelProps) {
  const createTreatmentOrder = useCreatePrescription();
  const source = useTreatmentOrderInitialValues(sourceSrId, patientId);
  // 入外区分の初期値は入院中なら「入院」。DO でも DO 元ではなくいまの状態に合わせる。
  const defaultSetting = useDefaultOrderSetting(patientId);
  // DO 元と入院かどうかの読み込み完了を待ってからフォームを描画する
  // (初期値は初回描画時のみ反映される)。
  const waiting = (sourceSrId && !source.ready) || !defaultSetting.ready;
  // DO も新しいオーダーなので、依頼元は DO 元ではなくヘッダーで選択中のものを使う。
  const requester = useOrderContext();
  // 予約必須の処置は予約(Appointment)も同じ transaction で作る。participant に
  // 患者の表示名まで持たせたいので患者リソースを読んでおく。
  const { data: patientResult } = usePatient(patientId);
  const queryClient = useQueryClient();

  const initialValues = useMemo(
    () =>
      source.initialValues
        ? buildDoTreatmentOrderForm(source.initialValues, defaultSetting.setting)
        : emptyTreatmentOrderForm(defaultProblem ?? null, defaultSetting.setting),
    [source.initialValues, defaultProblem, defaultSetting.setting],
  );

  function handleSubmit(
    values: TreatmentOrderFormValues,
    performs: TreatmentImmediatePerforms | null,
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
      ? buildTreatmentOrderWithPerformBundle(values, patientId, attribution, performs)
      : buildTreatmentOrderBundle(values, patientId, attribution, booking);

    createTreatmentOrder.mutate(bundle, {
      onSuccess: () => {
        // 即実施では実施済の Task まで作るので、処置一覧の当日ぶんも読み直す
        // (オーダーの無効化キーは検索(ServiceRequest search)だけを見ている)。
        if (performs) {
          queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "treatment-worklist"] });
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
        <TreatmentOrderForm
          patientId={patientId}
          initialValues={initialValues}
          onSubmit={handleSubmit}
          submitting={createTreatmentOrder.isPending}
          submitError={createTreatmentOrder.error}
        />
      )}
    </>
  );
}

interface TreatmentOrderEditPanelProps {
  patientId: string;
  srId: string;
  onSaved: () => void;
}

export function TreatmentOrderEditPanel({ patientId, srId, onSaved }: TreatmentOrderEditPanelProps) {
  const updateTreatmentOrder = useUpdateTreatmentOrder();
  const { serviceRequest, itemIds, initialValues, ready, patientMismatch, error } =
    useTreatmentOrderInitialValues(srId, patientId);
  // 予約日時の変更もこの画面から行うので、オーダーに紐づく処置予約を読んでおく
  // (予約タブからは変えない。オーダーの実施日時と必ず一緒に動かすため)。
  const booking = useTreatmentOrderAppointment(srId);

  function handleSubmit(
    values: TreatmentOrderFormValues,
    _performs: TreatmentImmediatePerforms | null,
    bookings: Record<string, SlotSelection> | null,
  ) {
    // 別患者のオーダーを更新すると subject が URL の患者に書き換わってしまうので防ぐ。
    if (!serviceRequest || patientMismatch) return;
    // 予約日時を選び直したときだけ、予約の付け替えを同じ transaction に同梱する。
    // 編集は 1 オーダーへの書き戻しなので、予約も選択もそのオーダーの 1 件だけ。
    const selection = bookings ? Object.values(bookings)[0] : undefined;
    const appointment = booking.appointment;

    // 依頼科・依頼医師は登録時のものを引き継ぐ(処方・注射・検体検査の編集と同じ)。
    // 外した処置項目は、元の id との差分で DELETE される。
    updateTreatmentOrder.mutate(
      {
        bundle: buildTreatmentOrderUpdateBundle(
          values,
          patientId,
          serviceRequest,
          itemIds,
          prescriptionRequester(serviceRequest),
        ),
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
          <TreatmentOrderForm
            patientId={patientId}
            initialValues={initialValues}
            onSubmit={handleSubmit}
            submitting={updateTreatmentOrder.isPending}
            submitError={updateTreatmentOrder.error}
            submitLabel="更新"
            editing
            hasBooking={Boolean(booking.appointment)}
          />
        )
      )}
    </>
  );
}
