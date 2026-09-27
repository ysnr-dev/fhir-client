import { useState } from "react";
import { useExamReportDetail } from "../api/queries";
import {
  examReportDateTimeLabel,
  examReportImageRefs,
  examReportStatusDisplay,
  examReportViewerImages,
  parseExamReportForm,
  splitExamReportBundle,
  type ExamReportConfig,
  type ExamReportFormValues,
} from "../fhir/examReportHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { ReportImageViewerModal } from "./ReportImageViewerModal";
import { ResponseSchemaImages, SchemaImageGallery } from "./SchemaImageGallery";

// 検査レポート(読影・生理検査・内視鏡の所見)の内容表示(docs/rad-report-design.md §4.4)。
// カルテの詳細モーダルと部門一覧の入力モーダルから使う。操作(確認・編集)は呼び出し側が持つ。

/** 報告区分の印。暫定と訂正は目立たせ、最終報告は素の文字で出す。 */
export function ExamReportStatusBadge({ status }: { status: string }) {
  if (status === "preliminary" || status === "amended") {
    return <span className="micro-result__badge">{examReportStatusDisplay(status)}</span>;
  }
  return <>{examReportStatusDisplay(status) || "-"}</>;
}

export function ExamReportDetailPanel({
  config,
  reportId,
}: {
  config: ExamReportConfig;
  reportId: string;
}) {
  const detail = useExamReportDetail(reportId);
  const { report, observations } = splitExamReportBundle(config, detail.data?.data);

  if (detail.isLoading) return <p>読み込み中...</p>;
  return (
    <>
      <ErrorBanner error={detail.error} />
      {report && (
        <ExamReportContent
          config={config}
          status={report.status}
          issued={report.issued}
          values={parseExamReportForm(config, report, observations)}
        />
      )}
    </>
  );
}

function ExamReportContent({
  config,
  status,
  issued,
  values,
}: {
  config: ExamReportConfig;
  status: string;
  issued: string | undefined;
  values: ExamReportFormValues;
}) {
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const findingsResponseId = values.findingsTemplate?.responseId ?? "";
  const conclusionResponseId = values.conclusionTemplate?.responseId ?? "";
  const { labels } = config;

  return (
    <div className="prescription-detail exam-report-detail">
      {values.criticalFinding && (
        <div className="exam-report-detail__critical" role="note">
          <span className="exam-report-detail__critical-label">重要所見</span>
          {values.criticalFindingText}
        </div>
      )}

      <fieldset>
        <legend>{labels.report}</legend>
        <dl className="prescription-detail__common">
          <dt>報告区分</dt>
          <dd>
            <ExamReportStatusBadge status={status} />
          </dd>
          <dt>{labels.exam}内容</dt>
          <dd>{values.examText || "-"}</dd>
          <dt>{labels.exam}日時</dt>
          <dd>{examReportDateTimeLabel(values.effectiveDateTime) || "-"}</dd>
          <dt>報告日時</dt>
          <dd>{examReportDateTimeLabel(issued) || "-"}</dd>
          <dt>{labels.interpreter}</dt>
          <dd>{values.interpreterName || "-"}</dd>
        </dl>
      </fieldset>

      <fieldset>
        <legend>所見</legend>
        <p className="exam-report-detail__text">{values.findings || "-"}</p>
        {findingsResponseId && <ResponseSchemaImages responseId={findingsResponseId} />}
      </fieldset>

      <fieldset>
        <legend>{labels.conclusion}</legend>
        <p className="exam-report-detail__text">{values.conclusion || "-"}</p>
        {conclusionResponseId && <ResponseSchemaImages responseId={conclusionResponseId} />}
      </fieldset>

      {values.images.length > 0 && (
        <fieldset>
          <legend>画像</legend>
          <SchemaImageGallery refs={examReportImageRefs(values.images)} onOpen={setViewerIndex} />
        </fieldset>
      )}

      {viewerIndex !== null && (
        <ReportImageViewerModal
          images={examReportViewerImages(values.images)}
          initialIndex={viewerIndex}
          onClose={() => setViewerIndex(null)}
        />
      )}
    </div>
  );
}
