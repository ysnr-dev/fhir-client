import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useRecordDeficiencyItems } from "../../api/queries";
import { aggregateRecordDeficiencies, RECORD_DEFICIENCY_KINDS } from "../../fhir/recordDeficiencyHelpers";
import { today } from "../../lib/dates";
import { ErrorBanner } from "../ErrorBanner";
import { HomeCardFrame, HomeCardLoading, type HomeCardProps } from "./shared";

// 未完了記録一覧(docs/features/notifications.md「未完了記録一覧」)のうち自分あて・自分が記載者の分。種別ごとの件数と
// 期限超過、最も古いものの日数。内訳は未完了記録一覧(/record-deficiencies)で見る。

export function RecordDeficiencyCard({ practitionerId }: HomeCardProps<"recordDeficiencies">) {
  const deficiencies = useRecordDeficiencyItems(practitionerId, Boolean(practitionerId));
  const todayValue = today();
  const row = useMemo(
    () => aggregateRecordDeficiencies(deficiencies.items ?? [], todayValue)[0],
    [deficiencies.items, todayValue],
  );
  const kinds = RECORD_DEFICIENCY_KINDS.filter((kind) => row?.cells.has(kind.code));

  return (
    <HomeCardFrame title="未完了記録" link={{ to: "/record-deficiencies", label: "すべて見る" }}>
      <ErrorBanner error={deficiencies.error} />
      {deficiencies.isPending ? (
        <HomeCardLoading />
      ) : !row ? (
        <p className="home__empty">未完了の記録はありません。</p>
      ) : (
        <>
          <p className="home__counts">
            <span className={`home__count home__count--big${row.overdue > 0 ? " home__count--alert" : ""}`}>
              未完了 <strong>{row.total}</strong>
            </span>
            {row.overdue > 0 && (
              <span className="home__count">
                期限超過 <strong>{row.overdue}</strong>
              </span>
            )}
            <span className="home__count">
              最長 <strong>{row.oldestDays}</strong> 日
            </span>
          </p>
          <div className="home__table-wrap">
            <table className="home__table">
              <thead>
                <tr>
                  <th>種別</th>
                  <th>件数</th>
                  <th>期限超過</th>
                  <th>最長</th>
                </tr>
              </thead>
              <tbody>
                {kinds.map((kind) => {
                  const cell = row.cells.get(kind.code)!;
                  return (
                    <tr key={kind.code}>
                      <td>{kind.link ? <Link to={kind.link}>{kind.label}</Link> : kind.label}</td>
                      <td className="home__cell-compact">{cell.count}</td>
                      <td className="home__cell-compact">{cell.overdue > 0 ? cell.overdue : ""}</td>
                      <td className="home__cell-compact">{cell.oldestDays} 日</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </HomeCardFrame>
  );
}
