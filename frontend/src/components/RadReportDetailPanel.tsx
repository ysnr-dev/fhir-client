import { useState } from "react";
import { useRadReportDetail } from "../api/queries";
import {
  parseRadReportForm,
  radReportDateTimeLabel,
  radReportImageRefs,
  radReportStatusDisplay,
  radReportViewerImages,
  splitRadReportBundle,
  type RadReportFormValues,
} from "../fhir/radReportHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { ReportImageViewerModal } from "./ReportImageViewerModal";
import { ResponseSchemaImages, SchemaImageGallery } from "./SchemaImageGallery";

// 読影レポートの内容表示(docs/rad-report-design.md §4.4)。カルテの詳細モーダルと
// 放射線検査一覧の入力モーダルから使う。操作(確認・編集)は呼び出し側が持つ。

/** 報告区分の印。暫定と訂正は目立たせ、最終報告は素の文字で出す。 */
export function RadReportStatusBadge({ status }: { status: string }) {
  if (status === "preliminary" || status === "amended") {
    return <span className="micro-result__badge">{radReportStatusDisplay(status)}</span>;
  }
  return <>{radReportStatusDisplay(status) || "-"}</>;
}

export function RadReportDetailPanel({ reportId }: { reportId: string }) {
  const detail = useRadReportDetail(reportId);
  const { report, observations } = splitRadReportBundle(detail.data?.data);

  if (detail.isLoading) return <p>読み込み中...</p>;
  return (
    <>
      <ErrorBanner error={detail.error} />
      {report && (
        <RadReportContent
          status={report.status}
          issued={report.issued}
          values={parseRadReportForm(report, observations)}
        />
      )}
    </>
  );
}

function RadReportContent({
  status,
  issued,
  values,
}: {
  status: string;
  issued: string | undefined;
  values: RadReportFormValues;
}) {
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const findingsResponseId = values.findingsTemplate?.responseId ?? "";
  const conclusionResponseId = values.conclusionTemplate?.responseId ?? "";

  return (
    <div className="prescription-detail rad-report-detail">
      {values.criticalFinding && (
        <div className="rad-report-detail__critical" role="note">
          <span className="rad-report-detail__critical-label">重要所見</span>
          {values.criticalFindingText}
        </div>
      )}

      <fieldset>
        <legend>読影レポート</legend>
        <dl className="prescription-detail__common">
          <dt>報告区分</dt>
          <dd>
            <RadReportStatusBadge status={status} />
          </dd>
          <dt>撮影内容</dt>
          <dd>{values.examText || "-"}</dd>
          <dt>撮影日時</dt>
          <dd>{radReportDateTimeLabel(values.effectiveDateTime) || "-"}</dd>
          <dt>報告日時</dt>
          <dd>{radReportDateTimeLabel(issued) || "-"}</dd>
          <dt>読影医</dt>
          <dd>{values.interpreterName || "-"}</dd>
        </dl>
      </fieldset>

      <fieldset>
        <legend>所見</legend>
        <p className="rad-report-detail__text">{values.findings || "-"}</p>
        {findingsResponseId && <ResponseSchemaImages responseId={findingsResponseId} />}
      </fieldset>

      <fieldset>
        <legend>診断</legend>
        <p className="rad-report-detail__text">{values.conclusion || "-"}</p>
        {conclusionResponseId && <ResponseSchemaImages responseId={conclusionResponseId} />}
      </fieldset>

      {values.images.length > 0 && (
        <fieldset>
          <legend>画像</legend>
          <SchemaImageGallery refs={radReportImageRefs(values.images)} onOpen={setViewerIndex} />
        </fieldset>
      )}

      {viewerIndex !== null && (
        <ReportImageViewerModal
          images={radReportViewerImages(values.images)}
          initialIndex={viewerIndex}
          onClose={() => setViewerIndex(null)}
        />
      )}
    </div>
  );
}
