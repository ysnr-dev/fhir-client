import { useCoverages } from "../api/queries";
import { useReceiptStatus, useRefreshReceiptPatient } from "../api/receiptQueries";
import { coverageRow } from "../fhir/coverageHelpers";
import { ErrorBanner } from "./ErrorBanner";

/**
 * カルテのプロファイルタブに出す保険・公費の区画。
 *
 * 保険はレセコンが正本なので、ここは登録ではなく参照。カルテが持つのは
 * レセコンから取り込んだ Coverage で、レセコンを直接見に行くことはしない。
 */
export function KarteCoverageSection({ patientId }: { patientId: string }) {
  const status = useReceiptStatus();
  const { coverages, isLoading, error } = useCoverages(patientId);
  const refresh = useRefreshReceiptPatient();

  const rows = coverages.map(coverageRow);
  const active = rows.filter((r) => r.active);
  const expired = rows.filter((r) => !r.active);

  return (
    <section className="karte-profile__section">
      <div className="karte-tabpanel__header">
        <h3>保険・公費</h3>
        {status.data?.enabled && (
          <div className="karte-tabpanel__actions">
            <button
              type="button"
              disabled={refresh.isPending}
              onClick={() => refresh.mutate(patientId)}
            >
              {refresh.isPending ? "取込中..." : "医事会計から再取込"}
            </button>
          </div>
        )}
      </div>

      <ErrorBanner error={refresh.error ?? error} />

      {refresh.data && (
        <p className="connection-settings-form__success" role="status">
          医事会計から取り込みました（保険 {refresh.data.coverages} 件
          {refresh.data.cancelled > 0 ? ` / 失効 ${refresh.data.cancelled} 件` : ""}）
        </p>
      )}

      {isLoading ? (
        <p>読み込み中...</p>
      ) : rows.length === 0 ? (
        <p className="patient-table__empty">保険が登録されていません</p>
      ) : (
        <ul className="profile-list">
          {[...active, ...expired].map((row) => {
            const symbolNumber =
              [row.symbol, row.number].filter(Boolean).join("・") + (row.branch ? `（枝番 ${row.branch}）` : "");
            const meta = [
              row.insurerNumber && `保険者番号 ${row.insurerNumber}`,
              symbolNumber && `記号・番号 ${symbolNumber}`,
            ]
              .filter(Boolean)
              .join(" ・ ");
            const period = [row.start, row.end].filter(Boolean).join(" 〜 ");
            return (
              <li
                key={row.id}
                className={row.active ? "profile-list__item" : "profile-list__item profile-list__item--muted"}
              >
                <span className="profile-list__name">
                  {row.name}
                  {row.active ? "" : "（失効）"}
                </span>
                {row.copayPercent !== null && <span>{row.copayPercent}%</span>}
                {meta && <span className="profile-list__meta">{meta}</span>}
                {period && <span className="profile-list__meta">{period}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
