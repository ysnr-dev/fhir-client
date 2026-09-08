import {
  cycleProgressOf,
  discontinuationReasonLabel,
  lastAdministrationDate,
  regimenStatusLabel,
  type RegimenApplication,
  type RegimenDayOrder,
} from "../fhir/regimenOrderHelpers";

// カルテ左ペイン「化学療法」の「治療歴」ビュー(§7.6 C-4)。患者の全適用(完了・中止を含む)を
// 「レジメン / 期間 / クール / 状態 / 中止理由」で並べる。暦と詳細は 1 つの適用を読む面で、
// 「これまでに何をどこまでやったか」は並べないと読めないので、別のビューにした。
// 行を押すとその適用のレジメン詳細に切り替わる。

interface RegimenHistoryViewProps {
  applications: RegimenApplication[];
  /** 患者の全日オーダー(適用で絞る前)。 */
  orders: RegimenDayOrder[];
  onSelect: (regimenSrId: string) => void;
}

/** 新しい開始日が上。同じ日なら適用中を先。 */
function byStartDesc(a: RegimenApplication, b: RegimenApplication): number {
  return b.startDate.localeCompare(a.startDate) || (a.status === "active" ? -1 : 1);
}

export function RegimenHistoryView({ applications, orders, onSelect }: RegimenHistoryViewProps) {
  const rows = [...applications].sort(byStartDesc);

  return (
    <table className="master-search__table regimen-history">
      <thead>
        <tr>
          <th>レジメン</th>
          <th>期間</th>
          <th className="rad-item__compact">クール</th>
          <th className="rad-item__compact">状態</th>
          <th>中止理由</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((a) => {
          const own = orders.filter((o) => o.ref.regimenSrId === a.id);
          const progress = Array.from(cycleProgressOf(own).values());
          const registered = progress.length;
          const done = progress.filter((p) => p.done).length;
          const last = lastAdministrationDate(own);
          const end = a.status === "revoked" ? a.discontinuation?.date || last : a.status === "completed" ? a.completedOn || last : "";
          const planned = a.plannedCycles !== null ? `/${a.plannedCycles}` : "";
          return (
            <tr key={a.id} className="regimen-history__row" onClick={() => onSelect(a.id)}>
              <td>
                <button type="button" className="regimen-history__name">
                  {a.name}
                </button>
                <span className="lab-order-item__code">（{a.code}）</span>
              </td>
              <td className="regimen-history__period">
                {a.startDate}
                {end ? ` 〜 ${end}` : a.status === "active" || a.status === "on-hold" ? " 〜" : ""}
              </td>
              <td className="rad-item__compact">
                {registered > 0 ? `${done} 実施 / ${registered} 登録${planned}` : `—${planned}`}
              </td>
              <td className="rad-item__compact">
                <span className={`regimen-status regimen-status--${a.status}`}>{regimenStatusLabel(a.status)}</span>
              </td>
              <td>
                {a.discontinuation ? (
                  <>
                    {discontinuationReasonLabel(a.discontinuation.reason)}
                    {a.discontinuation.note && (
                      <span className="regimen-history__note">{a.discontinuation.note}</span>
                    )}
                  </>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          );
        })}
        {rows.length === 0 && (
          <tr>
            <td colSpan={5} className="master-search__empty">
              化学療法の記録がありません
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
