import { useState } from "react";
import { useUpdateRegimenStatus } from "../api/queries";
import { adverseEventLabel, adverseEventsOf, type AdverseEventRecord } from "../fhir/adverseEventHelpers";
import {
  cycleProgressOf,
  cycleStartDates,
  discontinuationReasonLabel,
  nextCycleOf,
  regimenStatusLabel,
  type CycleProgress,
  type RegimenApplication,
  type RegimenDayOrder,
} from "../fhir/regimenOrderHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { RegimenRevokeModal } from "./RegimenPanels";

// カルテ左ペイン「化学療法」の「レジメン詳細」ビュー。適用 1 件の中身
// (何を・いつから・どの体格で出したか、クールがどこまで進んだか)を読む。
//
// 暦と同じ左ペインに置くのは、どちらも「その適用を読む」ための面だから。オーダーを
// 作る操作(次クールの登録)は他の種別と同じく右ペインで開き、ここには入口だけ置く。
// 状態を変える操作(休止 / 再開 / 完了 / 中止)はフォームを持たないのでここに置く(§7.6 C-1 / C-2)。

interface RegimenDetailViewProps {
  application: RegimenApplication;
  header: fhir4.ServiceRequest;
  orders: RegimenDayOrder[];
  error?: unknown;
  /** 投与日を暦から開くのと同じ導線(右ペインの投与日パネル)。 */
  onOpenDay: (date: string) => void;
  /** 次クールの登録を右ペインで開く。 */
  onAddCycle: () => void;
  /** 患者の有害事象(適用で絞る前)。 */
  adverseEvents: AdverseEventRecord[];
  /** クールの有害事象の記録を右ペインで開く。 */
  onOpenAdverseEvents: (cycle: number) => void;
}

function progressLabel(p: CycleProgress | undefined): string {
  if (!p) return "";
  if (p.done) return "完了";
  if (p.skipped) return "中止";
  if (p.completed > 0) return `${p.completed}/${p.total} 実施`;
  return "予定";
}

export function RegimenDetailView({
  application,
  header,
  orders,
  error,
  onOpenDay,
  onAddCycle,
  adverseEvents,
  onOpenAdverseEvents,
}: RegimenDetailViewProps) {
  const updateStatus = useUpdateRegimenStatus();
  const [revoking, setRevoking] = useState(false);

  const starts = cycleStartDates(orders);
  const progress = cycleProgressOf(orders);
  const cycles = Array.from(starts.keys()).sort((a, b) => a - b);
  const next = nextCycleOf(application, orders);
  const active = application.status === "active";
  const held = application.status === "on-hold";
  const reachedPlanned = application.plannedCycles !== null && next.cycle > application.plannedCycles;
  const pending = orders.filter((o) => o.status !== "completed" && o.status !== "cancelled");

  function handleComplete() {
    const message =
      pending.length > 0
        ? `${application.name} を完了にします。未実施の ${pending.length} 件のオーダーは中止になります。よろしいですか？`
        : `${application.name} を完了にします。よろしいですか？`;
    if (!window.confirm(message)) return;
    updateStatus.mutate({ header, status: "completed", targets: orders });
  }

  function handleHold(hold: boolean) {
    updateStatus.mutate({ header, status: hold ? "on-hold" : "active", targets: orders });
  }

  return (
    <div className="regimen-detail">
      <ErrorBanner error={error ?? updateStatus.error} />
      <dl className="regimen-detail__summary">
        <dt>レジメン</dt>
        <dd>
          {application.name}
          <span className="lab-order-item__code">（{application.code}）</span>
        </dd>
        <dt>状態</dt>
        <dd>
          <span className={`regimen-status regimen-status--${application.status}`}>
            {regimenStatusLabel(application.status)}
          </span>
          {application.completedOn && <span className="regimen-detail__since">{application.completedOn}</span>}
          {application.discontinuation?.date && (
            <span className="regimen-detail__since">{application.discontinuation.date}</span>
          )}
        </dd>
        <dt>開始日</dt>
        <dd>{application.startDate}</dd>
        <dt>クール</dt>
        <dd>
          {application.cycleDays > 0 ? `${application.cycleDays} 日/クール` : "—"}
          {application.plannedCycles !== null ? ` · 予定 ${application.plannedCycles} クール` : " · 継続"}
        </dd>
        <dt>体格</dt>
        <dd>
          {[
            application.height !== null ? `身長 ${application.height} cm` : "",
            application.weight !== null ? `体重 ${application.weight} kg` : "",
            application.bsa !== null ? `体表面積 ${application.bsa} m²` : "",
          ]
            .filter(Boolean)
            .join(" / ") || "—"}
        </dd>
        {application.problem && (
          <>
            <dt>プロブレム</dt>
            <dd>{application.problem.display}</dd>
          </>
        )}
        {application.comment && (
          <>
            <dt>コメント</dt>
            <dd>{application.comment}</dd>
          </>
        )}
        {application.discontinuation && (
          <>
            <dt>中止理由</dt>
            <dd>
              {discontinuationReasonLabel(application.discontinuation.reason)}
              {application.discontinuation.note && (
                <span className="regimen-detail__since">{application.discontinuation.note}</span>
              )}
            </dd>
          </>
        )}
      </dl>

      <table className="master-search__table regimen-detail__cycles">
        <thead>
          <tr>
            <th className="rad-item__compact">クール</th>
            <th className="rad-item__compact">Day 1</th>
            <th className="rad-item__compact">進捗</th>
            <th>投与日</th>
            <th>有害事象</th>
          </tr>
        </thead>
        <tbody>
          {cycles.map((cycle) => {
            const own = orders.filter((o) => o.ref.cycle === cycle);
            const dates = Array.from(new Set(own.map((o) => o.date))).sort();
            const p = progress.get(cycle);
            return (
              <tr key={cycle}>
                <td className="rad-item__compact">第 {cycle} クール</td>
                <td className="rad-item__compact">{starts.get(cycle)}</td>
                <td className={`rad-item__compact regimen-detail__progress${p?.done ? " regimen-detail__progress--done" : ""}`}>
                  {progressLabel(p)}
                </td>
                <td>
                  <div className="regimen-detail__days">
                  {dates.map((date) => {
                    const statuses = own.filter((o) => o.date === date).map((o) => o.status);
                    const cls = statuses.every((s) => s === "cancelled")
                      ? " regimen-detail__day--cancelled"
                      : statuses.every((s) => s === "completed")
                        ? " regimen-detail__day--completed"
                        : "";
                    return (
                      <button
                        key={date}
                        type="button"
                        className={`regimen-detail__day${cls}`}
                        onClick={() => onOpenDay(date)}
                        title={`${date} のオーダーを開く`}
                      >
                        {date.slice(5).replace("-", "/")}
                      </button>
                    );
                  })}
                  </div>
                </td>
                {/* td 自体を flex にすると table-cell でなくなり罫線がズレるので、中に箱を置く
                    (投与日の列も同じ)。 */}
                <td>
                  <div className="regimen-detail__adverse">
                  {adverseEventsOf(adverseEvents, application.id, cycle).map((ae) => (
                    <span
                      key={ae.id}
                      className={`regimen-adverse__grade regimen-adverse__grade--${ae.grade}`}
                      title={ae.note}
                    >
                      {adverseEventLabel(ae)}
                      {!ae.resolved && <span className="regimen-adverse__ongoing">継続</span>}
                    </span>
                  ))}
                  <button
                    type="button"
                    className="rp-card__compact-button"
                    onClick={() => onOpenAdverseEvents(cycle)}
                    title={`第 ${cycle} クールの有害事象を記録`}
                  >
                    記録
                  </button>
                  </div>
                </td>
              </tr>
            );
          })}
          {cycles.length === 0 && (
            <tr>
              <td colSpan={5} className="master-search__empty">
                登録されたクールがありません
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {(active || held) && (
        <div className="lab-order-item__actions">
          {active && (
            <button type="button" onClick={onAddCycle} disabled={reachedPlanned}>
              第 {next.cycle} クールを登録
            </button>
          )}
          {active ? (
            <button type="button" onClick={() => handleHold(true)} disabled={updateStatus.isPending}>
              休止
            </button>
          ) : (
            <button type="button" onClick={() => handleHold(false)} disabled={updateStatus.isPending}>
              再開
            </button>
          )}
          <button type="button" onClick={handleComplete} disabled={updateStatus.isPending}>
            完了にする
          </button>
          <button type="button" onClick={() => setRevoking(true)} disabled={updateStatus.isPending}>
            レジメンを中止
          </button>
        </div>
      )}
      {reachedPlanned && active && (
        <p className="injection-scope__note">
          予定クール数({application.plannedCycles})まで登録済みです。すべて実施したら「完了にする」で閉じます。
        </p>
      )}
      {held && <p className="injection-scope__note">休止中は次クールを登録できません。登録済みの投与日はそのまま残ります。</p>}

      {revoking && (
        <RegimenRevokeModal
          application={application}
          header={header}
          orders={orders}
          onClose={() => setRevoking(false)}
          onDone={() => setRevoking(false)}
        />
      )}
    </div>
  );
}
