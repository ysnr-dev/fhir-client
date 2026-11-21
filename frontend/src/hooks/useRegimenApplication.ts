import { useMemo } from "react";
import { useRegimenApplications, useRegimenDayOrders } from "../api/queries";
import type { RegimenApplication, RegimenDayOrder } from "../fhir/regimenOrderHelpers";

/**
 * 適用 1 件(ヘッダ)と、その適用から出た日オーダー。
 *
 * 日オーダーは患者の全適用ぶんを 1 検索で引き(requisition のカンマ OR)、読んだ後に
 * 適用で絞る。化学療法タブの詳細ビューと投与日・クール登録のモーダルが同じ形で使う。
 */
export function useRegimenApplication(
  patientId: string,
  regimenSrId: string,
): {
  application: RegimenApplication | null;
  header: fhir4.ServiceRequest | null;
  orders: RegimenDayOrder[];
  isPending: boolean;
  error: unknown;
} {
  const applications = useRegimenApplications(patientId);
  const application = applications.data?.applications.find((a) => a.id === regimenSrId) ?? null;
  const header = applications.data?.headers.find((h) => h.id === regimenSrId) ?? null;
  const instanceIds = useMemo(
    () => (applications.data?.applications ?? []).map((a) => a.instanceId),
    [applications.data],
  );
  const orders = useRegimenDayOrders(patientId, instanceIds);
  const own = useMemo(
    () => (orders.data ?? []).filter((o) => o.ref.regimenSrId === regimenSrId),
    [orders.data, regimenSrId],
  );

  return {
    application,
    header,
    orders: own,
    isPending: applications.isPending || (instanceIds.length > 0 && orders.isPending),
    error: applications.error ?? orders.error,
  };
}
