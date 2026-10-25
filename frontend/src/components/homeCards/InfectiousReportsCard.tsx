import { useMemo } from "react";
import { useFacilitySettings, useInfectiousDiseaseReports, useNotifiableConditions } from "../../api/queries";
import {
  DEFAULT_INFECTIOUS_DISEASE_REPORT,
  defaultInfectiousReportFrom,
  infectiousDiseaseReportRows,
} from "../../fhir/infectiousDiseaseReportHelpers";
import { ErrorBanner } from "../ErrorBanner";
import { HomeCardFrame, HomeCardLoading, type HomeCardProps } from "./shared";

// 感染症の発生届(docs/infectious-disease-report-design.md)。直近 90 日に診断された届出対象の病名のうち、
// 届出が済んでいないものと期限を過ぎたものの件数。内訳は一覧(/infectious-disease-reports)で見る。

export function InfectiousReportsCard({ date }: HomeCardProps<"infectiousReports">) {
  const facility = useFacilitySettings();
  const templateUrl = (facility.data?.infectious_disease_report ?? DEFAULT_INFECTIOUS_DISEASE_REPORT).template;
  const candidates = useNotifiableConditions(defaultInfectiousReportFrom(date), date);
  const conditions = useMemo(() => candidates.data?.conditions ?? [], [candidates.data]);
  const reports = useInfectiousDiseaseReports(
    templateUrl,
    conditions.map((c) => c.subject?.reference?.split("/").pop() ?? ""),
  );
  const rows = useMemo(
    () => infectiousDiseaseReportRows(conditions, reports.data?.responses ?? [], date),
    [conditions, reports.data, date],
  );
  const pending = rows.filter((row) => row.state !== "done");
  const overdue = pending.filter((row) => row.daysLeft !== null && row.daysLeft < 0).length;

  return (
    <HomeCardFrame title="感染症発生届" link={{ to: "/infectious-disease-reports", label: "すべて見る" }}>
      <ErrorBanner error={candidates.error} />
      <ErrorBanner error={reports.error} />
      {candidates.isPending || reports.isPending ? (
        <HomeCardLoading />
      ) : (
        <p className="home__counts">
          <span className={`home__count home__count--big${pending.length > 0 ? " home__count--alert" : ""}`}>
            未届出 <strong>{pending.length}</strong>
          </span>
          {overdue > 0 && (
            <span className="home__count">
              期限超過 <strong>{overdue}</strong>
            </span>
          )}
        </p>
      )}
    </HomeCardFrame>
  );
}
