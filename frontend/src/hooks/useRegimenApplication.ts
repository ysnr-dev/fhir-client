import { useMemo } from "react";
import { useRegimenApplications, useRegimenDayOrders } from "../api/queries";
import type { RegimenApplication, RegimenDayOrder } from "../fhir/regimenOrderHelpers";

/**
 * 適用 1 件(ヘッダ)と、その適用から出た日オーダー。
 *
 * 日オーダーは患者ぶんをまとめて引く(上流は拡張で検索できないため)ので、患者の
 * いちばん早い適用の開始日を起点にして、読んだ後に適用で絞る。左ペインの詳細ビューと
 * 右ペインの投与日パネル・クール登録が同じ形で使う。
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
  const earliest = applications.data?.applications.reduce<string | undefined>(
    (min, a) => (min === undefined || a.startDate < min ? a.startDate : min),
    undefined,
  );
  const orders = useRegimenDayOrders(patientId, earliest);
  const own = useMemo(
    () => (orders.data ?? []).filter((o) => o.ref.regimenSrId === regimenSrId),
    [orders.data, regimenSrId],
  );

  return {
    application,
    header,
    orders: own,
    isPending: applications.isPending || (Boolean(earliest) && orders.isPending),
    error: applications.error ?? orders.error,
  };
}
