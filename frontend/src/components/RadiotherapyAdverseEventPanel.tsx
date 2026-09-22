import { useMemo } from "react";
import { useRadiotherapyOrderDetail, useTreatmentAdverseEvents } from "../api/queries";
import { adverseEventsOf } from "../fhir/adverseEventHelpers";
import { summarizeRadiotherapyOrder } from "../fhir/radiotherapyOrderHelpers";
import { AdverseEventEditor } from "./AdverseEventEditor";
import { ErrorBanner } from "./ErrorBanner";

// カルテ右ペインの「放射線治療(有害事象)」。治療コース 1 件に対して記録する
// (docs/radiotherapy-order-design.md §6.3)。
//
// 化学療法と違ってクールの区切りが無いので、コース単位で並べる。何回目の照射の頃に
// 出たかは発現日と照射記録を突き合わせれば追える(記録側には持たせない)。
// 用語の候補は無い —— 放射線治療のマスタに「想定される有害事象」が無いため、CTCAE の
// 検索から選ぶ(部位別の候補は後続)。

interface RadiotherapyAdverseEventPanelProps {
  patientId: string;
  srId: string;
}

export function RadiotherapyAdverseEventPanel({ patientId, srId }: RadiotherapyAdverseEventPanelProps) {
  const detail = useRadiotherapyOrderDetail(srId);
  const events = useTreatmentAdverseEvents(srId);

  const order = useMemo(
    () =>
      (detail.data?.data.entry ?? [])
        .map((entry) => entry.resource)
        .find((r): r is fhir4.ServiceRequest => r?.resourceType === "ServiceRequest" && r.id === srId),
    [detail.data, srId],
  );

  if (detail.isPending) return <p>読み込み中...</p>;
  if (!order) return <ErrorBanner error={detail.error ?? new Error("放射線治療が見つかりません")} />;

  const summary = summarizeRadiotherapyOrder(order);
  const name = `第${summary.courseNumber}コース ${summary.siteLabel}`.trim();

  return (
    <AdverseEventEditor
      patientId={patientId}
      target={{ treatmentSrId: srId, treatmentType: "radiotherapy", name }}
      title={name}
      records={adverseEventsOf(events.data ?? [], srId)}
      error={detail.error ?? events.error}
      emptyMessage="このコースの有害事象はありません"
    />
  );
}
