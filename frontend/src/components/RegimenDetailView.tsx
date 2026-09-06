import { useRevokeRegimen } from "../api/queries";
import {
  cycleStartDates,
  nextCycleOf,
  regimenStatusLabel,
  type RegimenApplication,
  type RegimenDayOrder,
} from "../fhir/regimenOrderHelpers";
import { ErrorBanner } from "./ErrorBanner";

// カルテ左ペイン「化学療法」の「レジメン詳細」ビュー。適用 1 件の中身
// (何を・いつから・どの体格で出したか、クールがどこまで登録されているか)を読む。
//
// 暦と同じ左ペインに置くのは、どちらも「その適用を読む」ための面だから。オーダーを
// 作る操作(次クールの登録)は他の種別と同じく右ペインで開き、ここには入口だけ置く。

interface RegimenDetailViewProps {
  application: RegimenApplication;
  header: fhir4.ServiceRequest;
  orders: RegimenDayOrder[];
  error?: unknown;
  /** 投与日を暦から開くのと同じ導線(右ペインの投与日パネル)。 */
  onOpenDay: (date: string) => void;
  /** 次クールの登録を右ペインで開く。 */
  onAddCycle: () => void;
}

export function RegimenDetailView({
  application,
  header,
  orders,
  error,
  onOpenDay,
  onAddCycle,
}: RegimenDetailViewProps) {
  const revoke = useRevokeRegimen();

  const starts = cycleStartDates(orders);
  const cycles = Array.from(starts.keys()).sort((a, b) => a - b);
  const next = nextCycleOf(application, orders);
  const active = application.status === "active";
  const reachedPlanned = application.plannedCycles !== null && next.cycle > application.plannedCycles;

  function handleRevoke() {
    const pending = orders.filter((o) => o.status !== "completed" && o.status !== "cancelled");
    const message =
      pending.length > 0
        ? `${application.name} を中止します。未実施の ${pending.length} 件のオーダーも中止になります。よろしいですか？`
        : `${application.name} を中止します。よろしいですか？`;
    if (!window.confirm(message)) return;
    revoke.mutate({ header, targets: orders });
  }

  return (
    <div className="regimen-detail">
      <ErrorBanner error={error ?? revoke.error} />
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
      </dl>

      <table className="master-search__table regimen-detail__cycles">
        <thead>
          <tr>
            <th className="rad-item__compact">クール</th>
            <th className="rad-item__compact">Day 1</th>
            <th>投与日</th>
          </tr>
        </thead>
        <tbody>
          {cycles.map((cycle) => {
            const own = orders.filter((o) => o.ref.cycle === cycle);
            const dates = Array.from(new Set(own.map((o) => o.date))).sort();
            return (
              <tr key={cycle}>
                <td className="rad-item__compact">第 {cycle} クール</td>
                <td className="rad-item__compact">{starts.get(cycle)}</td>
                <td className="regimen-detail__days">
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
                </td>
              </tr>
            );
          })}
          {cycles.length === 0 && (
            <tr>
              <td colSpan={3} className="master-search__empty">
                登録されたクールがありません
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {active && (
        <div className="lab-order-item__actions">
          <button type="button" onClick={onAddCycle} disabled={reachedPlanned}>
            第 {next.cycle} クールを登録
          </button>
          <button type="button" onClick={handleRevoke} disabled={revoke.isPending}>
            レジメンを中止
          </button>
        </div>
      )}
      {reachedPlanned && active && (
        <p className="injection-scope__note">予定クール数({application.plannedCycles})まで登録済みです。</p>
      )}
    </div>
  );
}
