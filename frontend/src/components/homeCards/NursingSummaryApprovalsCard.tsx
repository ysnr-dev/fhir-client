import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useWardNursingSummaries, useWardOptions } from "../../api/queries";
import {
  canApproveNursingSummary,
  NURSING_SUMMARY_KIND_OPTIONS,
  nursingSummaryKindOf,
  nursingSummaryStateOf,
} from "../../fhir/nursingSummaryHelpers";
import { displayName } from "../../fhir/patientHelpers";
import { useIsNursingLogin } from "../../hooks/useIsNursingLogin";
import { addDays } from "../../lib/dates";
import { useReturnLinkState } from "../../returnTo";
import { ErrorBanner } from "../ErrorBanner";
import { HomeCardFrame, HomeCardLoading, HomeCardTruncated, type HomeCardProps } from "./shared";

const ROWS = 5;
/** 看護サマリー承認の画面と同じ既定の期間(直近 30 日)。 */
const PERIOD_DAYS = 30;

/** 看護サマリー承認待ち。病棟の確定済みで承認者が居ないサマリーのうち、自分が承認できるもの。 */
export function NursingSummaryApprovalsCard({ card, date, practitionerId }: HomeCardProps<"nursingSummaryApprovals">) {
  const wardId = card.settings.wardId;
  const from = addDays(date, -PERIOD_DAYS);
  const list = useWardNursingSummaries(wardId, from, date);
  const wardOptions = useWardOptions();
  const nursing = useIsNursingLogin();
  const linkState = useReturnLinkState();

  const pending = useMemo(() => {
    const data = list.data?.value;
    if (!data) return [];
    const returnedIds = new Set(
      data.returnedTasks.map((t) => t.focus?.reference?.match(/^Composition\/(.+)$/)?.[1] ?? ""),
    );
    return data.summaries
      .filter((c) => nursingSummaryStateOf(c, returnedIds.has(c.id ?? "")) === "pending")
      .map((composition) => {
        const patientId = composition.subject?.reference?.split("/").pop() ?? "";
        return { composition, patientId, patient: data.patients.get(patientId) };
      });
  }, [list.data]);
  const mine = pending.filter((row) => canApproveNursingSummary(row.composition, practitionerId, nursing.isNursing));
  const wardName = wardOptions.wards.find((w) => w.id === wardId)?.name ?? "";
  const link = `/nursing-summary-approvals?ward=${wardId}`;

  return (
    <HomeCardFrame title={`看護サマリー承認待ち(${wardName})`} link={{ to: link, label: "一覧" }}>
      <ErrorBanner error={list.error} />
      {wardId && list.isPending ? (
        <HomeCardLoading />
      ) : (
        <>
          <p className="home__counts">
            <span className="home__count home__count--big">
              承認待ち <strong>{pending.length}</strong>
            </span>
            {nursing.isNursing && (
              <span className="home__count">
                自分が承認できる <strong>{mine.length}</strong>
              </span>
            )}
          </p>
          {list.data?.truncated && <HomeCardTruncated>件数が多いため、一部のみ数えています。</HomeCardTruncated>}
          {pending.length === 0 ? (
            <p className="home__empty">承認待ちの看護サマリーはありません。</p>
          ) : (
            <div className="home__table-wrap">
              <table className="home__table">
                <thead>
                  <tr>
                    <th>種別</th>
                    <th>患者氏名</th>
                    <th>作成者</th>
                    <th>作成日</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.slice(0, ROWS).map(({ composition, patientId, patient }) => (
                    <tr key={composition.id}>
                      <td className="home__cell-compact">
                        {NURSING_SUMMARY_KIND_OPTIONS.find((o) => o.code === nursingSummaryKindOf(composition))?.display ?? ""}
                      </td>
                      <td>
                        {patient ? (
                          <Link className="home__row-link" to={`/patients/${patientId}/karte`} state={linkState}>
                            {displayName(patient)}
                          </Link>
                        ) : (
                          patientId
                        )}
                      </td>
                      <td className="home__cell-compact">{composition.author?.[0]?.display ?? ""}</td>
                      <td className="home__cell-compact">{(composition.date ?? "").slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {pending.length > ROWS && (
            <p className="home__more">
              <Link to={link}>他 {pending.length - ROWS} 件</Link>
            </p>
          )}
        </>
      )}
    </HomeCardFrame>
  );
}
