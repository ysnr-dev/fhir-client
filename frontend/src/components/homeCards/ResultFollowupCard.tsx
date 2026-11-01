import { useExplanationRows, useFollowUpRows, useStaleResultCount } from "../../api/queries";
import { EXPLANATION_OVERDUE_DAYS } from "../../fhir/resultExplanationHelpers";
import {
  DEFAULT_STALE_RESULT_DAYS,
  FOLLOW_UP_SOON_DAYS,
  STALE_RESULT_TASK_CODES,
} from "../../fhir/followUpHelpers";
import { ErrorBanner } from "../ErrorBanner";
import { HomeCardFrame, HomeCardLoading, type HomeCardProps } from "./shared";

// 検査結果フォロー(docs/result-followup-design.md)。自分あてのフォロー推奨の件数(期限超過・期限が近いもの)と、
// 確認されないまま 7 日以上経った検査結果の件数、患者に未説明の病理診断レポートの件数(14 日以上・重要度ありの内訳)。
// 内訳は一覧(/result-followup)で見る。

export function ResultFollowupCard({ practitionerId }: HomeCardProps<"resultFollowup">) {
  const followUps = useFollowUpRows("requested", practitionerId);
  const stale = useStaleResultCount(STALE_RESULT_TASK_CODES, DEFAULT_STALE_RESULT_DAYS, practitionerId);
  const rows = followUps.data?.rows ?? [];
  const overdue = rows.filter((row) => row.daysLeft !== null && row.daysLeft < 0).length;
  const soon = rows.filter(
    (row) => row.daysLeft !== null && row.daysLeft >= 0 && row.daysLeft <= FOLLOW_UP_SOON_DAYS,
  ).length;
  const staleCount = stale.data ?? 0;
  const explanations = useExplanationRows("requested", practitionerId);
  const unexplained = explanations.data?.rows ?? [];
  const unexplainedOverdue = unexplained.filter((row) => row.daysSince >= EXPLANATION_OVERDUE_DAYS).length;
  const unexplainedImportant = unexplained.filter((row) => row.importance).length;

  return (
    <HomeCardFrame title="検査結果フォロー" link={{ to: "/result-followup", label: "すべて見る" }}>
      <ErrorBanner error={followUps.error} />
      <ErrorBanner error={stale.error} />
      <ErrorBanner error={explanations.error} />
      {followUps.isPending || stale.isPending || explanations.isPending ? (
        <HomeCardLoading />
      ) : (
        <>
          <p className="home__counts">
            <span className={`home__count home__count--big${overdue > 0 ? " home__count--alert" : ""}`}>
              フォロー推奨 <strong>{rows.length}</strong>
            </span>
            {overdue > 0 && (
              <span className="home__count">
                期限超過 <strong>{overdue}</strong>
              </span>
            )}
            {soon > 0 && (
              <span className="home__count">
                {FOLLOW_UP_SOON_DAYS} 日以内 <strong>{soon}</strong>
              </span>
            )}
          </p>
          <p className="home__counts">
            <span className={`home__count${staleCount > 0 ? " home__count--alert" : ""}`}>
              {DEFAULT_STALE_RESULT_DAYS} 日以上未確認の結果 <strong>{staleCount}</strong>
            </span>
          </p>
          <p className="home__counts">
            <span
              className={`home__count${unexplainedOverdue > 0 || unexplainedImportant > 0 ? " home__count--alert" : ""}`}
            >
              患者未説明 <strong>{unexplained.length}</strong>
            </span>
            {unexplainedOverdue > 0 && (
              <span className="home__count">
                {EXPLANATION_OVERDUE_DAYS} 日以上 <strong>{unexplainedOverdue}</strong>
              </span>
            )}
            {unexplainedImportant > 0 && (
              <span className="home__count">
                重要度あり <strong>{unexplainedImportant}</strong>
              </span>
            )}
          </p>
        </>
      )}
    </HomeCardFrame>
  );
}
