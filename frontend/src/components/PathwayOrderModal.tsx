import { useEffect, useState, type ReactNode } from "react";
import {
  useEndoscopyItemsByCodes,
  usePhysioItemsByCodes,
  useRadItemsByCodes,
  useTreatmentItemsByCodes,
} from "../api/masterQueries";
import {
  useEndoscopyWorklist,
  usePatientInjectionOrders,
  usePatientTasks,
  usePhysioWorklist,
  useRadWorklist,
  useSurgeryWorklist,
  useTransfusionWorklist,
  useTreatmentWorklist,
  useUpdateEndoscopyTaskStatus,
  useUpdatePhysioTaskStatus,
  useUpdateRadTaskStatus,
  useUpdateTreatmentTaskStatus,
} from "../api/queries";
import { endoscopyOrderItems } from "../fhir/endoscopyOrderHelpers";
import { injectionPerformsByOrderId } from "../fhir/injectionPerformHelpers";
import { injectionTasksByOrderId } from "../fhir/injectionTaskHelpers";
import { nutritionGuidanceTasksByOrderId } from "../fhir/nutritionGuidanceTaskHelpers";
import type { OrderProgress } from "../fhir/orderProgressHelpers";
import { physioOrderItems } from "../fhir/physioOrderHelpers";
import { radOrderItems } from "../fhir/radOrderHelpers";
import { rehabTasksByOrderId } from "../fhir/rehabTaskHelpers";
import { orderDay, referenceId } from "../fhir/shared";
import { treatmentOrderItems } from "../fhir/treatmentOrderHelpers";
import type { KarteDetailTarget } from "../karteUrl";
import { today } from "../lib/dates";
import { EndoscopyPerformModal } from "./EndoscopyPerformModal";
import { ErrorBanner } from "./ErrorBanner";
import { InjectionPerformModal } from "./InjectionPerformModal";
import { KarteDetailModal } from "./KarteCardModals";
import { Modal } from "./Modal";
import { NutritionGuidancePerformModal } from "./NutritionGuidancePerformModal";
import { PhysioPerformModal } from "./PhysioPerformModal";
import { RadPerformModal } from "./RadPerformModal";
import { RehabPerformModal } from "./RehabPerformModal";
import { SurgeryPerformModal } from "./SurgeryPerformModal";
import { TransfusionPerformModal } from "./TransfusionPerformModal";
import { TreatmentPerformModal } from "./TreatmentPerformModal";

// パスシートのタスクから開くオーダーの詳細。カルテのカードの「詳細表示」と同じ中身を
// モーダルで出し、下に「編集」と「実施入力」を添える。
//
// 実施入力は、注射・輸血と、部門の一覧に実施入力がある種別(放射線・生理・内視鏡・処置・手術・
// リハビリ・栄養指導)。［決定］部門の受付(手術は入室)を済ませていなくても実施できる。実施入力は
// 部門の一覧と同じモーダル・同じ登録で、放射線・生理・内視鏡・処置・手術は Task を実施済にし、
// リハビリ・栄養指導は実施を積み上げる(依頼済なら受付済にする)。設計は docs/clinical-pathway-design.md §6。

type PerformKind = KarteDetailTarget["kind"];

/** 1 回で終わる部門の種別(実施すると Task が実施済になる)。 */
const DEPARTMENT_KINDS = new Set<PerformKind>([
  "rad-order",
  "physio-order",
  "endoscopy-order",
  "treatment-order",
  "surgery-order",
]);
/** 実施を積み上げる種別(Task は受付済のまま、終了は部門が記録する)。 */
const SESSION_KINDS = new Set<PerformKind>(["rehab-order", "nutrition-guidance-order"]);

interface PathwayOrderModalProps {
  patientId: string;
  order: fhir4.ServiceRequest;
  /** 詳細の種別。orderKindOf の値をそのまま使う。 */
  kind: KarteDetailTarget["kind"];
  /** 開いたセルの日付。リハビリ・栄養指導の実施日の初期値にする。 */
  date: string;
  /** オーダーの進み具合(パスの木から)。実施済み・中止なら実施入力を出さない。 */
  progress: OrderProgress | undefined;
  problemsById: Map<string, fhir4.Condition>;
  /** 右ペインのオーダー編集を開く。全画面のシートからは全画面を抜けてから開く。 */
  onEdit: () => void;
  onClose: () => void;
}

function canPerformOrder(order: fhir4.ServiceRequest, kind: PerformKind, progress: OrderProgress | undefined) {
  // 中止・誤登録のオーダーには実施を入れさせない(カルテのカードと同じ扱い)。
  if (order.status === "revoked" || order.status === "entered-in-error") return false;
  if (kind === "injection" || kind === "transfusion-order") return true;
  if (!DEPARTMENT_KINDS.has(kind) && !SESSION_KINDS.has(kind)) return false;
  // 部門の種別は実施済、積み上げる種別は終了(completed)・中止なら出さない。
  return progress?.status !== "completed" && progress?.status !== "cancelled";
}

export function PathwayOrderModal({
  patientId,
  order,
  kind,
  date,
  progress,
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

  const canPerform = canPerformOrder(order, kind, progress);
  const closePerform = () => setPerforming(false);

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
        <InjectionPerformLoader patientId={patientId} order={order} onClose={closePerform} />
      )}
      {performing && kind === "transfusion-order" && <TransfusionPerformLoader order={order} onClose={closePerform} />}
      {performing && kind === "rad-order" && <RadPerformLoader order={order} onClose={closePerform} />}
      {performing && kind === "physio-order" && <PhysioPerformLoader order={order} onClose={closePerform} />}
      {performing && kind === "endoscopy-order" && <EndoscopyPerformLoader order={order} onClose={closePerform} />}
      {performing && kind === "treatment-order" && <TreatmentPerformLoader order={order} onClose={closePerform} />}
      {performing && kind === "surgery-order" && <SurgeryPerformLoader order={order} onClose={closePerform} />}
      {performing && SESSION_KINDS.has(kind) && (
        <SessionPerformLoader patientId={patientId} order={order} kind={kind} date={date} onClose={closePerform} />
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

// ---- 部門の実施入力(放射線・生理・内視鏡・処置・手術) ----
//
// 実施入力は部門の一覧の行(オーダー・明細・進捗)を受け取るので、オーダーの実施日の部門一覧から
// 同じ行を引いて開く。放射線・生理・内視鏡・処置は、項目マスタで実施入力が要らない項目だけなら
// 部門の一覧と同じく記録を作らず Task を実施済にする(ここでは確かめてから)。

interface MasterItem {
  item_code: string;
  kind: string;
  requires_perform_input: boolean;
}

/**
 * 実施入力が要るか(部門の一覧と同じ判定)。セットは依頼の束ね方なので構成項目だけで決め、
 * マスタに無いコードは入力の機会を落とさないよう「要る」に倒す。
 */
function needsPerformInput(codes: string[], masters: MasterItem[] | undefined): boolean {
  const byCode = new Map((masters ?? []).map((item) => [item.item_code, item]));
  const singles = codes.filter((code) => byCode.get(code)?.kind !== "set");
  if (singles.length === 0) return true;
  return singles.some((code) => byCode.get(code)?.requires_perform_input ?? true);
}

function PerformStep({
  department,
  date,
  loading,
  error,
  found,
  needsInput,
  completing,
  onComplete,
  input,
  onClose,
}: {
  department: string;
  /** 部門の一覧を引いた日付。空なら日付が決まっていない。 */
  date: string;
  loading: boolean;
  error: unknown;
  /** 部門の一覧にオーダーの行があったか。 */
  found: boolean;
  needsInput: boolean;
  completing: boolean;
  onComplete: () => void;
  input: () => ReactNode;
  onClose: () => void;
}) {
  const title = `${department}の実施`;
  const missingMessage =
    loading || error || found
      ? null
      : date
        ? `${department}の一覧(${date})にこのオーダーが見つかりません。`
        : "実施日が決まっていないため実施入力できません。";
  if (!loading && !error && found && needsInput) return <>{input()}</>;

  return (
    <Modal title={title} onClose={onClose}>
      <ErrorBanner error={error} />
      {loading ? (
        <p>読み込み中...</p>
      ) : missingMessage ? (
        <p>{missingMessage}</p>
      ) : (
        !error && <p>実施入力の項目はありません。実施済にしますか？</p>
      )}
      <div className="lab-order-item__actions karte-detail__actions">
        {!loading && found && !needsInput && (
          <button type="button" onClick={onComplete} disabled={completing}>
            実施済にする
          </button>
        )}
        <button type="button" onClick={onClose}>
          閉じる
        </button>
      </div>
    </Modal>
  );
}

function RadPerformLoader({ order, onClose }: { order: fhir4.ServiceRequest; onClose: () => void }) {
  const date = orderDay(order);
  const worklist = useRadWorklist(date);
  const row = worklist.data?.rows.find((r) => r.order.id === order.id);
  const codes = row ? radOrderItems(row.order, row.itemRequests).map((item) => item.code) : [];
  const items = useRadItemsByCodes(codes);
  const updateStatus = useUpdateRadTaskStatus();
  return (
    <PerformStep
      department="放射線検査"
      date={date}
      loading={worklist.isLoading || items.isLoading}
      error={worklist.error ?? items.error ?? updateStatus.error}
      found={Boolean(row)}
      needsInput={needsPerformInput(codes, items.data?.items)}
      completing={updateStatus.isPending}
      onComplete={() =>
        row && updateStatus.mutate({ order: row.order, task: row.task, status: "completed" }, { onSuccess: onClose })
      }
      input={() => row && <RadPerformModal row={row} onClose={onClose} />}
      onClose={onClose}
    />
  );
}

function PhysioPerformLoader({ order, onClose }: { order: fhir4.ServiceRequest; onClose: () => void }) {
  const date = orderDay(order);
  const worklist = usePhysioWorklist(date);
  const row = worklist.data?.rows.find((r) => r.order.id === order.id);
  const codes = row ? physioOrderItems(row.order, row.itemRequests).map((item) => item.code) : [];
  const items = usePhysioItemsByCodes(codes);
  const updateStatus = useUpdatePhysioTaskStatus();
  return (
    <PerformStep
      department="生理検査"
      date={date}
      loading={worklist.isLoading || items.isLoading}
      error={worklist.error ?? items.error ?? updateStatus.error}
      found={Boolean(row)}
      needsInput={needsPerformInput(codes, items.data?.items)}
      completing={updateStatus.isPending}
      onComplete={() =>
        row && updateStatus.mutate({ order: row.order, task: row.task, status: "completed" }, { onSuccess: onClose })
      }
      input={() => row && <PhysioPerformModal row={row} onClose={onClose} />}
      onClose={onClose}
    />
  );
}

function EndoscopyPerformLoader({ order, onClose }: { order: fhir4.ServiceRequest; onClose: () => void }) {
  const date = orderDay(order);
  const worklist = useEndoscopyWorklist(date);
  const row = worklist.data?.rows.find((r) => r.order.id === order.id);
  const codes = row ? endoscopyOrderItems(row.order, row.itemRequests).map((item) => item.code) : [];
  const items = useEndoscopyItemsByCodes(codes);
  const updateStatus = useUpdateEndoscopyTaskStatus();
  return (
    <PerformStep
      department="内視鏡"
      date={date}
      loading={worklist.isLoading || items.isLoading}
      error={worklist.error ?? items.error ?? updateStatus.error}
      found={Boolean(row)}
      needsInput={needsPerformInput(codes, items.data?.items)}
      completing={updateStatus.isPending}
      onComplete={() =>
        row && updateStatus.mutate({ order: row.order, task: row.task, status: "completed" }, { onSuccess: onClose })
      }
      input={() => row && <EndoscopyPerformModal row={row} onClose={onClose} />}
      onClose={onClose}
    />
  );
}

function TreatmentPerformLoader({ order, onClose }: { order: fhir4.ServiceRequest; onClose: () => void }) {
  const date = orderDay(order);
  const worklist = useTreatmentWorklist(date);
  const row = worklist.data?.rows.find((r) => r.order.id === order.id);
  const codes = row ? treatmentOrderItems(row.order, row.itemRequests).map((item) => item.code) : [];
  const items = useTreatmentItemsByCodes(codes);
  const updateStatus = useUpdateTreatmentTaskStatus();
  return (
    <PerformStep
      department="処置"
      date={date}
      loading={worklist.isLoading || items.isLoading}
      error={worklist.error ?? items.error ?? updateStatus.error}
      found={Boolean(row)}
      needsInput={needsPerformInput(codes, items.data?.items)}
      completing={updateStatus.isPending}
      onComplete={() =>
        row && updateStatus.mutate({ order: row.order, task: row.task, status: "completed" }, { onSuccess: onClose })
      }
      input={() => row && <TreatmentPerformModal row={row} onClose={onClose} />}
      onClose={onClose}
    />
  );
}

/** 手術の実施入力。手術一覧は予定手術日(occurrencePeriod)で引くので、日程未定の申込は開けない。 */
function SurgeryPerformLoader({ order, onClose }: { order: fhir4.ServiceRequest; onClose: () => void }) {
  const date = order.occurrencePeriod?.start?.slice(0, 10) ?? "";
  const worklist = useSurgeryWorklist(date);
  const row = worklist.data?.rows.find((r) => r.order.id === order.id);
  return (
    <PerformStep
      department="手術"
      date={date}
      loading={worklist.isLoading}
      error={worklist.error}
      found={Boolean(row)}
      needsInput
      completing={false}
      onComplete={() => {}}
      input={() => row && <SurgeryPerformModal row={row} onClose={onClose} />}
      onClose={onClose}
    />
  );
}

/**
 * リハビリ・栄養指導の実施入力。1 回ぶんの実施を積み上げる。受付前なら実施と一緒に受付済にするので、
 * 患者の Task から進捗を引いてから開く。実施日の初期値は開いたセルの日付(先の日なら今日)。
 */
function SessionPerformLoader({
  patientId,
  order,
  kind,
  date,
  onClose,
}: {
  patientId: string;
  order: fhir4.ServiceRequest;
  kind: PerformKind;
  date: string;
  onClose: () => void;
}) {
  const tasks = usePatientTasks(patientId);
  if (!tasks.data) {
    return (
      <Modal title="実施入力" onClose={onClose}>
        <ErrorBanner error={tasks.error} />
        {!tasks.error && <p>読み込み中...</p>}
      </Modal>
    );
  }
  const defaultDate = date && date < today() ? date : today();
  if (kind === "rehab-order") {
    return (
      <RehabPerformModal
        order={order}
        defaultDate={defaultDate}
        acceptTask={{ task: rehabTasksByOrderId(tasks.data).get(order.id ?? "") }}
        onClose={onClose}
      />
    );
  }
  return (
    <NutritionGuidancePerformModal
      order={order}
      patientId={patientId}
      defaultDate={defaultDate}
      acceptTask={{ task: nutritionGuidanceTasksByOrderId(tasks.data).get(order.id ?? "") }}
      onClose={onClose}
    />
  );
}
