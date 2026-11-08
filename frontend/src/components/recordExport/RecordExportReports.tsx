import type { ReactNode } from "react";
import { EXAM_REPORT_KINDS, isExamReport } from "../../fhir/examReportHelpers";
import { observationIdsFromReport } from "../../fhir/labResultHelpers";
import { ExamReportView } from "../ExamReportDetailPanel";
import { PathoResultView } from "../PathoResultDetailPanel";
import { KartePrintEmptyRow, KartePrintGroupRow, KartePrintSheet } from "./KartePrintSheet";
import { dateTimeLabel } from "../../lib/dates";

// カルテ印刷のレポート。期間内の所見レポート(放射線・生理・内視鏡)と病理レポートを検査日の順に、
// 各タブの内容表示と同じ描き方で出す。まとめて読んだ結果から、レポートごとに所見と検体を振り分ける。

interface RecordExportReportsProps {
  header: ReactNode;
  /** 検査日の古い順。 */
  reports: fhir4.DiagnosticReport[];
  observations: fhir4.Observation[];
  specimens: fhir4.Specimen[];
}

export function RecordExportReports({ header, reports, observations, specimens }: RecordExportReportsProps) {
  const observationById = new Map(observations.map((observation) => [observation.id ?? "", observation]));
  const specimenById = new Map(specimens.map((specimen) => [specimen.id ?? "", specimen]));
  return (
    <KartePrintSheet header={header} title="レポート">
      {reports.length === 0 ? (
        <KartePrintEmptyRow span={1}>期間内のレポートはありません。</KartePrintEmptyRow>
      ) : (
        reports.map((report) => {
          const own = observationIdsFromReport(report).flatMap((id) => observationById.get(id) ?? []);
          const config = EXAM_REPORT_KINDS.find((kind) => isExamReport(kind, report));
          const ownSpecimens = (report.specimen ?? []).flatMap(
            (reference) => specimenById.get(reference.reference?.split("/").pop() ?? "") ?? [],
          );
          return (
            <ReportRows
              key={report.id}
              title={[config?.labels.report ?? "病理診断レポート", dateTimeLabel(report.effectiveDateTime)]
                .filter(Boolean)
                .join("　")}
            >
              {config ? (
                <ExamReportView config={config} report={report} observations={own} />
              ) : (
                <PathoResultView report={report} observations={own} specimens={ownSpecimens} />
              )}
            </ReportRows>
          );
        })
      )}
    </KartePrintSheet>
  );
}

function ReportRows({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <KartePrintGroupRow span={1}>{title}</KartePrintGroupRow>
      <tr>
        <td>{children}</td>
      </tr>
    </>
  );
}
