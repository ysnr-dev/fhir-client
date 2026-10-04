import { useState } from "react";
import { useCreatePrescription, useInjectionSeriesLater } from "../api/queries";
import {
  buildInjectionSeriesExtendBundle,
  injectionDayOf,
  injectionExtensionDates,
  injectionSeriesOf,
  parseInjectionForm,
} from "../fhir/injectionHelpers";
import { withOrderWard } from "../fhir/orderHeader";
import { referenceId } from "../fhir/shared";
import { addDays } from "../lib/dates";
import { useDefaultOrderSetting } from "../hooks/useDefaultOrderSetting";
import { useOrderContext } from "../hooks/useOrderContext";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

// 注射カレンダーの行の「継続」。行の最後の注射が属する束ねを、終了日まで延ばす
// (docs/injection-order-design.md §9.3)。足す日の内容は束ねの最終日と同じで、
// 束ね(requisition・開始日・パターン)もそのまま引き継ぐ。
//
// 表示中の最後の日が束ねの最終日とは限らない(期間の外に続きがある)ので、後続日を
// 読んでから最終日を決める。

interface InjectionContinueModalProps {
  patientId: string;
  /** 行の中で最後の日のオーダー。 */
  order: fhir4.ServiceRequest;
  medicationRequests: fhir4.MedicationRequest[];
  onClose: () => void;
}

export function InjectionContinueModal({
  patientId,
  order,
  medicationRequests,
  onClose,
}: InjectionContinueModalProps) {
  const later = useInjectionSeriesLater(order);
  const create = useCreatePrescription();
  const requester = useOrderContext();
  const defaultSetting = useDefaultOrderSetting(patientId);

  const series = injectionSeriesOf(order);
  const laterTargets = later.data ?? [];
  const last = laterTargets[laterTargets.length - 1] ?? {
    serviceRequest: order,
    medicationRequests,
  };
  const lastDay = injectionDayOf(last.serviceRequest);
  // 既定は束ねの最終日から 1 週間。最終日は後続日を読むまで決まらないので、触るまでは都度計算する。
  const [pickedEnd, setPickedEnd] = useState<string | null>(null);
  const endDate = pickedEnd ?? addDays(lastDay, 7);
  const dates = series ? injectionExtensionDates(series, lastDay, endDate) : [];

  function handleContinue() {
    if (!series || dates.length === 0) return;
    if (referenceId(last.serviceRequest.subject?.reference) !== patientId) return;
    const values = parseInjectionForm(last.serviceRequest, last.medicationRequests);
    const attribution = withOrderWard(requester, values.setting, defaultSetting);
    create.mutate(
      buildInjectionSeriesExtendBundle(values, patientId, attribution, series, dates),
      { onSuccess: onClose },
    );
  }

  const waiting = later.isLoading || !defaultSetting.ready;

  return (
    <Modal title="注射の継続" onClose={onClose}>
      <ErrorBanner error={later.error ?? create.error} />
      {waiting ? (
        <p>読み込み中...</p>
      ) : (
        <>
          <div className="injection-continue">
            <label>
              終了日
              <input
                type="date"
                value={endDate}
                min={addDays(lastDay, 1)}
                onChange={(e) => setPickedEnd(e.target.value)}
              />
            </label>
            <span className="injection-continue__count">
              {dates.length > 0 ? `${dates[0]}〜${dates[dates.length - 1]} ${dates.length} 日分` : "追加なし"}
            </span>
          </div>
          <div className="plain-text-modal__actions">
            <button type="button" onClick={onClose} disabled={create.isPending}>
              キャンセル
            </button>
            <button
              type="button"
              onClick={handleContinue}
              disabled={!series || dates.length === 0 || create.isPending}
            >
              継続
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
