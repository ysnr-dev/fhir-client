import { useMemo, useState } from "react";
import { useCurrentPractitioner } from "../api/authQueries";
import { useNursingActLevels } from "../api/masterQueries";
import {
  useAcceptNursingOrders,
  useActiveNursingOrders,
  usePatientNursingOrders,
  useRevokeNursingOrder,
} from "../api/queries";
import { displayJapaneseName } from "../fhir/humanName";
import {
  NURSING_ORDER_STATE_LABELS,
  nursingOrderPeriodLabel,
  nursingOrderState,
  summarizeNursingOrder,
  type NursingOrderGroup,
  type NursingOrderSummary,
} from "../fhir/nursingOrderHelpers";
import {
  nursingTaskOwnerName,
  nursingTaskStatus,
  nursingTaskStatusDisplay,
  nursingTasksByOrderId,
} from "../fhir/nursingTaskHelpers";
import { today } from "../lib/dates";
import { ErrorBanner } from "./ErrorBanner";
import { NursingOrderDetailModal } from "./NursingOrderDetailModal";
import { NursingPerformModal } from "./NursingPerformModal";
import { RowMenu } from "./RowMenu";

interface KarteNursingTabProps {
  patientId: string;
  /** "" = 現在有効な指示の一覧、"history" = 発行単位の履歴。 */
  view: string;
  onViewChange: (view: string) => void;
  onCreate: () => void;
  onEdit: (srId: string) => void;
}

interface Row {
  order: fhir4.ServiceRequest;
  task: fhir4.Task | undefined;
  summary: NursingOrderSummary;
}

// 指示簿。今この患者に効いている看護指示を区分ごとに並べ、看護師が指示受けをする。
// 指示はカルテの時系列カードにしない(いつ出したかより「今なにが有効か」を見る情報)。
export function KarteNursingTab({ patientId, view, onViewChange, onCreate, onEdit }: KarteNursingTabProps) {
  const isHistory = view === "history";
  const at = today();
  const [showEnded, setShowEnded] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // 詳細を開いている指示。一覧は列を絞ってあるので、コード・依頼科・備考はモーダルで見る。
  const [detailId, setDetailId] = useState<string | null>(null);
  // 実施入力。渡すのは今日効いている指示だけ(終了・中止済みには記録させない)。
  const [performing, setPerforming] = useState(false);

  const active = useActiveNursingOrders(patientId, at);
  // 終了・中止も見るとき、履歴のときは全件を引く。
  const all = usePatientNursingOrders(patientId);
  const levels = useNursingActLevels();
  const me = useCurrentPractitioner();
  const accept = useAcceptNursingOrders();
  const revoke = useRevokeNursingOrder();

  const useAll = isHistory || showEnded;
  const source = useAll ? all : active;
  const rows = useMemo<Row[]>(() => {
    const set = source.data;
    if (!set) return [];
    const tasks = nursingTasksByOrderId(set.tasks);
    return set.orders.map((order) => ({
      order,
      task: tasks.get(order.id ?? ""),
      summary: summarizeNursingOrder(order),
    }));
  }, [source.data]);

  const groupName = (group: NursingOrderGroup): string => {
    if (group.kind === "observation") return "観察";
    if (group.kind === "free") return "その他";
    const l1 = levels.data?.levels.find((l) => l.code === group.level1Code);
    const l2 = l1?.children.find((c) => c.code === group.level2Code);
    return [l1?.name, l2?.name].filter(Boolean).join(" / ") || group.level1Code;
  };

  const ownerName = me.practitioner ? displayJapaneseName(me.practitioner.name) : "";
  const canAccept = Boolean(me.practitionerId);
  const pendingRows = rows.filter(
    (row) => row.order.status === "active" && nursingTaskStatus(row.task) === "requested",
  );
  const selectedRows = pendingRows.filter((row) => selected.has(row.order.id ?? ""));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleAccept(target: Row[]) {
    if (!me.practitionerId || target.length === 0) return;
    accept.mutate(
      {
        rows: target.map((row) => ({ order: row.order, task: row.task })),
        owner: { practitionerId: me.practitionerId, display: ownerName },
      },
      { onSuccess: () => setSelected(new Set()) },
    );
  }

  const detailRow = rows.find((row) => row.order.id === detailId) ?? null;

  function handleRevoke(row: Row) {
    if (!window.confirm(`「${row.summary.text}」を中止します。よろしいですか？`)) return;
    revoke.mutate({ order: row.order, task: row.task });
  }

  return (
    <div className="karte-tabpanel">
      <div className="karte-tabpanel__header">
        <h3>指示簿</h3>
        <div className="nursing-tab__toolbar">
          <button type="button" onClick={() => onViewChange(isHistory ? "" : "history")}>
            {isHistory ? "一覧" : "履歴"}
          </button>
          {!isHistory && (
            <label className="nursing-tab__toggle">
              <input
                type="checkbox"
                checked={showEnded}
                onChange={(e) => setShowEnded(e.target.checked)}
              />
              終了・中止も表示
            </label>
          )}
          {!isHistory && (
            <button
              type="button"
              onClick={() => setPerforming(true)}
              disabled={(active.data?.orders.length ?? 0) === 0}
            >
              実施入力
            </button>
          )}
          <button type="button" onClick={onCreate}>
            指示を追加
          </button>
        </div>
      </div>

      <ErrorBanner error={source.error ?? accept.error ?? revoke.error} />

      {source.isPending ? (
        <p>読み込み中...</p>
      ) : isHistory ? (
        <NursingHistory rows={rows} at={at} />
      ) : (
        <>
          {pendingRows.length > 0 && (
            <div className="nursing-tab__accept">
              <span>指示受け待ち {pendingRows.length} 件</span>
              <button
                type="button"
                disabled={!canAccept || accept.isPending || selectedRows.length === 0}
                onClick={() => handleAccept(selectedRows)}
                title={canAccept ? undefined : "医療従事者に紐づくアカウントでログインしてください"}
              >
                選択した {selectedRows.length} 件を指示受け
              </button>
              <button
                type="button"
                disabled={!canAccept || accept.isPending}
                onClick={() => handleAccept(pendingRows)}
              >
                すべて指示受け
              </button>
            </div>
          )}
          <NursingList
            rows={rows}
            at={at}
            groupName={groupName}
            selected={selected}
            onToggle={toggle}
            onView={setDetailId}
            onEdit={onEdit}
            onRevoke={handleRevoke}
          />
        </>
      )}

      {performing && active.data && (
        <NursingPerformModal
          orders={active.data.orders}
          onClose={() => setPerforming(false)}
        />
      )}

      {detailRow && (
        <NursingOrderDetailModal
          order={detailRow.order}
          task={detailRow.task}
          at={at}
          canDeletePerform
          onEdit={
            detailRow.order.status === "active"
              ? () => {
                  const id = detailRow.order.id ?? "";
                  setDetailId(null);
                  onEdit(id);
                }
              : undefined
          }
          onClose={() => setDetailId(null)}
        />
      )}
    </div>
  );
}

function NursingList({
  rows,
  at,
  groupName,
  selected,
  onToggle,
  onView,
  onEdit,
  onRevoke,
}: {
  rows: Row[];
  at: string;
  groupName: (group: NursingOrderGroup) => string;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onView: (srId: string) => void;
  onEdit: (srId: string) => void;
  onRevoke: (row: Row) => void;
}) {
  // 区分(行為の第 1・第 2 階層 / 観察 / その他)でまとめる。区分内は開始日順。
  const groups = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const row of rows) {
      const key = groupName(row.summary.group);
      const list = map.get(key) ?? [];
      list.push(row);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.summary.startDate.localeCompare(b.summary.startDate));
    }
    return [...map.entries()];
  }, [rows, groupName]);

  if (rows.length === 0) return <p className="karte-tabpanel__empty">看護指示はありません。</p>;

  // 列は左ペインの幅に収まる数に絞る(他タブと同じ 6 列)。指示医・発行日・コード・
  // 備考の全文・指示受けの日時は詳細モーダルで見る。
  return (
    <table className="patient-table nursing-tab__table">
      <thead>
        <tr>
          <th></th>
          <th>指示内容</th>
          <th>頻度・条件</th>
          <th>期間</th>
          <th>指示受け</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {groups.map(([name, list]) => (
          <GroupRows
            key={name}
            name={name}
            list={list}
            at={at}
            selected={selected}
            onToggle={onToggle}
            onView={onView}
            onEdit={onEdit}
            onRevoke={onRevoke}
          />
        ))}
      </tbody>
    </table>
  );
}

function GroupRows({
  name,
  list,
  at,
  selected,
  onToggle,
  onView,
  onEdit,
  onRevoke,
}: {
  name: string;
  list: Row[];
  at: string;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onView: (srId: string) => void;
  onEdit: (srId: string) => void;
  onRevoke: (row: Row) => void;
}) {
  return (
    <>
      <tr className="nursing-tab__group">
        <th colSpan={6}>{name}</th>
      </tr>
      {list.map((row) => {
        const id = row.order.id ?? "";
        const state = nursingOrderState(row.order, at);
        const taskStatus = nursingTaskStatus(row.task);
        const pending = state === "active" && taskStatus === "requested";
        return (
          <tr key={id} className={state === "active" ? undefined : "nursing-tab__row--inactive"}>
            <td>
              {pending && (
                <input
                  type="checkbox"
                  checked={selected.has(id)}
                  onChange={() => onToggle(id)}
                  aria-label="指示受けの対象にする"
                />
              )}
            </td>
            <td>
              {row.summary.text}
              {/* 状態の列は持たない。既定の一覧は有効な指示だけなので全行同じ値になる。
                  「終了・中止も表示」で混ざったときだけ、行の減光とバッジで示す。 */}
              {state !== "active" && (
                <span className={`nursing-tab__state nursing-tab__state--${state}`}>
                  {NURSING_ORDER_STATE_LABELS[state]}
                </span>
              )}
              {row.summary.comment && (
                <div className="nursing-tab__comment">{row.summary.comment}</div>
              )}
            </td>
            <td>{row.summary.frequency}</td>
            <td className="nursing-tab__period">{nursingOrderPeriodLabel(row.summary, at)}</td>
            <td>
              {taskStatus !== "cancelled" && (
                <span
                  className={`lab-worklist__status lab-worklist__status--${taskStatus}`}
                  // 受けた人は詳細で見る。一覧では列幅を取らないよう吹き出しに留める。
                  title={nursingTaskOwnerName(row.task) || undefined}
                >
                  {nursingTaskStatusDisplay(taskStatus)}
                </span>
              )}
            </td>
            <td className="patient-table__actions">
              <button type="button" onClick={() => onView(id)}>
                表示
              </button>
              {row.order.status === "active" && (
                <RowMenu label={`${row.summary.text} の操作`} escapesClipping>
                  <button type="button" className="row-menu__item" onClick={() => onEdit(id)}>
                    編集
                  </button>
                  <button
                    type="button"
                    className="row-menu__item row-menu__item--danger"
                    onClick={() => onRevoke(row)}
                  >
                    中止
                  </button>
                </RowMenu>
              )}
            </td>
          </tr>
        );
      })}
    </>
  );
}

// 履歴。同時に出した指示(requisition)ごとに、発行日・指示医と行を並べる。
function NursingHistory({ rows, at }: { rows: Row[]; at: string }) {
  const batches = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const row of rows) {
      const key = row.summary.requisition || row.order.id || "";
      const list = map.get(key) ?? [];
      list.push(row);
      map.set(key, list);
    }
    return [...map.values()].sort((a, b) =>
      b[0].summary.authoredOn.localeCompare(a[0].summary.authoredOn),
    );
  }, [rows]);

  if (batches.length === 0) return <p className="karte-tabpanel__empty">看護指示はありません。</p>;

  return (
    <div className="nursing-tab__history">
      {batches.map((batch) => {
        const head = batch[0].summary;
        return (
          <section key={head.requisition || batch[0].order.id} className="nursing-tab__batch">
            <h4>
              {head.authoredOn.slice(0, 10)}
              {head.requesterName && <span className="nursing-tab__owner"> {head.requesterName}</span>}
              <span className="nursing-tab__owner"> {batch.length} 件</span>
            </h4>
            <ul>
              {batch.map((row) => {
                const state = nursingOrderState(row.order, at);
                return (
                  <li key={row.order.id}>
                    <span className={`nursing-tab__state nursing-tab__state--${state}`}>
                      {NURSING_ORDER_STATE_LABELS[state]}
                    </span>{" "}
                    {row.summary.text}
                    {row.summary.frequency && ` (${row.summary.frequency})`}
                    <span className="nursing-tab__owner">
                      {" "}
                      {row.summary.startDate}
                      {row.summary.endDate ? ` 〜 ${row.summary.endDate}` : " 〜"}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
