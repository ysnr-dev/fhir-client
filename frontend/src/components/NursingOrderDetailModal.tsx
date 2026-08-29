import { departmentOf, wardOf } from "../fhir/prescriptionHelpers";
import {
  NURSING_ORDER_STATE_LABELS,
  nursingOrderState,
  summarizeNursingOrder,
} from "../fhir/nursingOrderHelpers";
import {
  nursingTaskOwnerName,
  nursingTaskStatus,
  nursingTaskStatusDisplay,
} from "../fhir/nursingTaskHelpers";
import { useDeleteNursingPerform, useNursingPerformsOf } from "../api/queries";
import { referenceId } from "../fhir/shared";
import { Modal } from "./Modal";

interface Props {
  order: fhir4.ServiceRequest;
  task: fhir4.Task | undefined;
  /** 状態の判定日(指示簿の基準日)。 */
  at: string;
  /** 誰の指示か。患者をまたぐ一覧(病棟の指示簿)から開くときに渡す。 */
  patientName?: string;
  /** 中止済みの指示では出さない。 */
  onEdit?: () => void;
  /** 実施履歴の取消を出すか。 */
  canDeletePerform?: boolean;
  onClose: () => void;
}

// 指示 1 件の詳細。指示簿の一覧は左ペインの幅に収めるため列を絞ってあるので、
// コード・依頼科・指示受けの日時・備考はここで見せる。
//
// 一覧を背後に残したいのでモーダルにする(病名・アレルギーのように view を切り替えると
// 一覧が消えて、指示を見比べながらの確認ができない)。編集は右ペインに任せて読むだけ。
export function NursingOrderDetailModal({
  order,
  task,
  at,
  patientName,
  onEdit,
  canDeletePerform = false,
  onClose,
}: Props) {
  const summary = summarizeNursingOrder(order);
  const state = nursingOrderState(order, at);
  const taskStatus = nursingTaskStatus(task);
  const department = departmentOf(order).departmentName;
  const ward = wardOf(order).wardName;
  const acceptedAt = task?.executionPeriod?.start ?? "";
  // 実施履歴。Observation には based-on 検索が無いので患者ぶんを引いて指示で絞る。
  const patientId = referenceId(order.subject?.reference);
  const performsQuery = useNursingPerformsOf(patientId);
  const performs = performsQuery.data?.get(order.id ?? "") ?? [];
  const deletePerform = useDeleteNursingPerform();

  function handleDeletePerform(perform: (typeof performs)[number]) {
    if (!window.confirm(`${perform.atLabel} の実施記録を取り消します。よろしいですか？`)) return;
    deletePerform.mutate({ resourceType: perform.resourceType, id: perform.id });
  }

  return (
    <Modal title={patientName ? `看護指示 - ${patientName}` : "看護指示"} onClose={onClose}>
      <dl className="nursing-detail">
        <div>
          <dt>指示内容</dt>
          <dd>{summary.text || "-"}</dd>
        </div>
        <div>
          <dt>頻度・条件</dt>
          <dd>{summary.frequency || "-"}</dd>
        </div>
        <div>
          <dt>期間</dt>
          <dd>
            {summary.startDate || "-"} 〜 {summary.endDate || "(継続)"}
          </dd>
        </div>
        <div>
          <dt>状態</dt>
          <dd>{NURSING_ORDER_STATE_LABELS[state]}</dd>
        </div>
        <div>
          <dt>指示受け</dt>
          <dd>
            {nursingTaskStatusDisplay(taskStatus)}
            {nursingTaskOwnerName(task) && ` / ${nursingTaskOwnerName(task)}`}
            {acceptedAt && ` / ${acceptedAt.slice(0, 16).replace("T", " ")}`}
          </dd>
        </div>
        <div>
          <dt>用語</dt>
          <dd>{itemLabel(summary.item)}</dd>
        </div>
        <div>
          <dt>指示医</dt>
          <dd>{summary.requesterName || "-"}</dd>
        </div>
        <div>
          <dt>依頼科・病棟</dt>
          <dd>{[department, ward].filter(Boolean).join(" / ") || "-"}</dd>
        </div>
        <div>
          <dt>発行日</dt>
          <dd>{summary.authoredOn.slice(0, 10) || "-"}</dd>
        </div>
        <div>
          <dt>対象プロブレム</dt>
          <dd>{order.reasonReference?.[0]?.display || "-"}</dd>
        </div>
        <div>
          <dt>備考</dt>
          <dd>{summary.comment || "-"}</dd>
        </div>
      </dl>

      <section className="nursing-detail__performs">
        <h3>実施履歴{performs.length > 0 && ` (${performs.length} 件)`}</h3>
        {performs.length === 0 ? (
          <p className="patient-table__empty">実施記録がありません。</p>
        ) : (
          <table className="rp-card__medicines">
            <thead>
              <tr>
                <th>日時</th>
                <th>値</th>
                <th>実施者</th>
                <th>備考</th>
                {canDeletePerform && <th />}
              </tr>
            </thead>
            <tbody>
              {performs.map((perform) => (
                <tr key={`${perform.resourceType}/${perform.id}`}>
                  <td>{perform.atLabel}</td>
                  <td>{perform.value || "-"}</td>
                  <td>{perform.performerName || "-"}</td>
                  <td>{perform.note || "-"}</td>
                  {canDeletePerform && (
                    <td>
                      <button
                        type="button"
                        onClick={() => handleDeletePerform(perform)}
                        disabled={deletePerform.isPending}
                      >
                        取消
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {onEdit && (
        <div className="lab-order-item__actions nursing-detail__actions">
          <button type="button" onClick={onEdit}>
            編集
          </button>
        </div>
      )}
    </Modal>
  );
}

// 用語のコード。行為は 16 桁コードと管理番号、観察は観察名称管理番号。
function itemLabel(item: ReturnType<typeof summarizeNursingOrder>["item"]): string {
  if (!item) return "自由記載(マスタ外)";
  if (item.kind === "act") {
    return `看護行為 ${item.display} / ${item.code16}${item.manageNo ? ` (管理番号 ${item.manageNo})` : ""}`;
  }
  return `看護観察 ${item.display} / ${item.manageNo}`;
}
