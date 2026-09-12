import { useEffect, useState } from "react";
import { usePatientInjectionOrders, useTransfusionWorklist } from "../api/queries";
import { injectionPerformsByOrderId } from "../fhir/injectionPerformHelpers";
import { injectionTasksByOrderId } from "../fhir/injectionTaskHelpers";
import { orderDay, referenceId } from "../fhir/shared";
import type { KarteDetailTarget } from "../karteUrl";
import { InjectionPerformModal } from "./InjectionPerformModal";
import { KarteDetailModal } from "./KarteCardModals";
import { TransfusionPerformModal } from "./TransfusionPerformModal";

// パスシートのタスクから開くオーダーの詳細。カルテのカードの「詳細表示」と同じ中身を
// モーダルで出し、下に「編集」と(病棟が記録する種別だけ)「実施入力」を添える。
//
// 実施入力を出すのは注射と輸血。カルテのカードと同じ範囲で、撮影・検査・手術のように
// 実施する部門が記録する種別は部門のワークリストに任せる(docs/clinical-pathway-design.md §6)。

interface PathwayOrderModalProps {
  patientId: string;
  order: fhir4.ServiceRequest;
  /** 詳細の種別。orderKindOf の値をそのまま使う。 */
  kind: KarteDetailTarget["kind"];
  problemsById: Map<string, fhir4.Condition>;
  /** 右ペインのオーダー編集を開く。全画面のシートからは全画面を抜けてから開く。 */
  onEdit: () => void;
  onClose: () => void;
}

export function PathwayOrderModal({
  patientId,
  order,
  kind,
  problemsById,
  onEdit,
  onClose,
}: PathwayOrderModalProps) {
  const [performing, setPerforming] = useState(false);

  // Escape は重なりの外側から閉じる(実施入力 → 詳細)。Modal は自分では Escape を見ない。
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (performing) setPerforming(false);
      else onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [performing, onClose]);

  // 中止・誤登録のオーダーには実施を入れさせない(カルテのカードと同じ扱い)。
  const open = order.status !== "revoked" && order.status !== "entered-in-error";
  const canPerform = open && (kind === "injection" || kind === "transfusion-order");

  return (
    <>
      <KarteDetailModal
        patientId={patientId}
        target={{ kind, id: order.id ?? "" }}
        problemsById={problemsById}
        actions={
          <>
            <button type="button" onClick={onEdit}>
              編集
            </button>
            {canPerform && (
              <button type="button" onClick={() => setPerforming(true)}>
                実施入力
              </button>
            )}
          </>
        }
        onClose={onClose}
      />

      {performing && kind === "injection" && (
        <InjectionPerformLoader patientId={patientId} order={order} onClose={() => setPerforming(false)} />
      )}
      {performing && kind === "transfusion-order" && (
        <TransfusionPerformLoader order={order} onClose={() => setPerforming(false)} />
      )}
    </>
  );
}

/**
 * 注射の実施入力。薬剤・進捗・これまでの実施記録が要るので、その注射日ぶんを
 * 経過表と同じ検索(usePatientInjectionOrders)で引いてから開く。
 */
function InjectionPerformLoader({
  patientId,
  order,
  onClose,
}: {
  patientId: string;
  order: fhir4.ServiceRequest;
  onClose: () => void;
}) {
  const date = orderDay(order);
  const injections = usePatientInjectionOrders(patientId, date, date);
  const data = injections.data;
  if (!data) return null;

  const found = data.orders.find((sr) => sr.id === order.id);
  if (!found) return null;

  return (
    <InjectionPerformModal
      order={found}
      medicationRequests={data.medicationRequests.filter(
        (mr) => referenceId(mr.basedOn?.[0]?.reference) === order.id,
      )}
      task={injectionTasksByOrderId(data.tasks).get(order.id ?? "")}
      performs={injectionPerformsByOrderId(data.procedures, data.administrations).get(order.id ?? "") ?? []}
      onClose={onClose}
    />
  );
}

/** 輸血の実施入力。製剤明細と進捗が要るので、その投与予定日の部門一覧から同じ行を引く。 */
function TransfusionPerformLoader({
  order,
  onClose,
}: {
  order: fhir4.ServiceRequest;
  onClose: () => void;
}) {
  const worklist = useTransfusionWorklist(orderDay(order));
  const row = worklist.data?.rows.find((r) => r.order.id === order.id);
  if (!row) return null;

  return (
    <TransfusionPerformModal
      order={row.order}
      itemRequests={row.itemRequests}
      task={row.task}
      onClose={onClose}
    />
  );
}
