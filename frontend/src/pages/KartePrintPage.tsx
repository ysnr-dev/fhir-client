import { useEffect, useMemo } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useCurrentPractitioner } from "../api/authQueries";
import {
  useKartePrintHistory,
  useKartePrintTimeline,
  usePatient,
  useRecordExportConditions,
  useRecordExportEncounters,
  useRecordExportSummaries,
  useSelfOrganization,
} from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { KartePrintDocument } from "../components/KartePrintDocument";
import { RecordExportConditions } from "../components/recordExport/RecordExportConditions";
import { RecordExportCover } from "../components/recordExport/RecordExportCover";
import { RecordExportSummaries } from "../components/recordExport/RecordExportSummaries";
import { TruncatedNotice } from "../components/TruncatedNotice";
import { displayName, genderLabel, patientNumberOf } from "../fhir/patientHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { KARTE_PRINT_SECTIONS, parseKartePrintSections } from "../karteUrl";
import { dateTimeLabel, nowFhirDateTime } from "../lib/dates";
import { applyTheme, resolveTheme } from "../theme";

// カルテ印刷の別タブ。カルテの「カルテ印刷」タブから期間・区画・履歴の有無を受け取り、
// 表紙・病名・退院時サマリー・診療経過記録(2 号用紙)を A4 で続けて描いてブラウザの印刷
// (PDF 保存を含む)に渡す。区画ごとに改ページし、見出しはページごとに繰り返す
// (docs/record-export-design.md)。履歴ありでは削除した記録も並べる。

export function KartePrintPage() {
  const { patientId } = useParams<{ patientId: string }>();
  const [searchParams] = useSearchParams();
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";
  const sections = parseKartePrintSections(searchParams.get("sections"));
  const withCover = sections.includes("cover");
  const withConditions = sections.includes("conditions");
  const withSummaries = sections.includes("summaries");
  const withProgress = sections.includes("progress");
  const withHistory = withProgress && searchParams.get("history") === "1";

  // 紙面は白地に印字するので、ダークテーマでもこのタブだけライトで描く。
  useEffect(() => {
    applyTheme("light");
    return () => applyTheme(resolveTheme());
  }, []);

  const patient = usePatient(patientId);
  const self = useSelfOrganization();
  const current = useCurrentPractitioner();
  // サマリーは期間に重なる入院のものを出すので、表紙を外しても受診は読む。
  const encounters = useRecordExportEncounters(patientId, from, to, withCover || withSummaries);
  const conditions = useRecordExportConditions(patientId, withConditions);
  const summaries = useRecordExportSummaries(encounters.data?.encounters, withSummaries);
  const timeline = useKartePrintTimeline(patientId, withProgress ? from : "", withProgress ? to : "", withHistory);
  const items = useMemo(() => timeline.groups.flatMap((group) => group.items), [timeline.groups]);
  const history = useKartePrintHistory(items, withHistory && !timeline.isPending);
  // 印刷日時は開いた時点で固定する(読み込みのたびに変わらないように)。
  const printedAt = useMemo(() => dateTimeLabel(nowFhirDateTime()), []);

  const historyPending = withHistory && items.length > 0 && history.isPending;
  const pending = [
    patient.isPending,
    self.isLoading,
    withCover && current.practitionerLoading,
    (withCover || withSummaries) && encounters.isPending,
    withConditions && conditions.isPending,
    withSummaries && summaries.isPending,
    withProgress && timeline.isPending,
    historyPending,
  ];
  const ready = !pending.some(Boolean);
  const error =
    patient.error ??
    encounters.error ??
    conditions.error ??
    summaries.error ??
    (withProgress ? timeline.error : null) ??
    history.error;
  const patientResource = patient.data?.data;
  const facilityName = self.organization?.name ?? "";
  const printedBy = current.practitioner ? practitionerDisplayName(current.practitioner) : (current.user?.login_id ?? "");

  const header = (
    <div className="karte-print__header-row">
      <span>
        {patientResource
          ? [
              patientNumberOf(patientResource) && `患者番号 ${patientNumberOf(patientResource)}`,
              displayName(patientResource),
              patientResource.birthDate && `${patientResource.birthDate} 生`,
              genderLabel(patientResource.gender),
            ]
              .filter(Boolean)
              .join("　")
          : ""}
      </span>
      <span>{`期間 ${from} 〜 ${to}${withHistory ? "(履歴あり)" : ""}`}</span>
      <span>{[facilityName, `印刷 ${printedAt}`].filter(Boolean).join("　")}</span>
    </div>
  );

  return (
    <div className="karte-print">
      <div className="karte-print__toolbar">
        <button type="button" disabled={!ready} onClick={() => window.print()}>
          印刷
        </button>
        {!ready && <span>読み込み中...</span>}
      </div>
      <ErrorBanner error={error} />
      <TruncatedNotice show={Boolean(withCover && encounters.data?.truncated)}>
        受診の件数が多いため、表紙の入退院歴・受診歴は一部のみ印刷します。
      </TruncatedNotice>
      <TruncatedNotice show={Boolean(withConditions && conditions.data?.truncated)}>
        病名の件数が多いため、一部のみ印刷します。
      </TruncatedNotice>
      <TruncatedNotice show={Boolean(withSummaries && summaries.data?.truncated)}>
        退院時サマリーの件数が多いため、一部のみ印刷します。
      </TruncatedNotice>
      <TruncatedNotice show={withProgress && timeline.truncated}>
        記録の件数が多いため、診療経過記録は一部のみ印刷します。
      </TruncatedNotice>
      {ready && patientResource && (
        <>
          {withCover && (
            <RecordExportCover
              header={header}
              facilityName={facilityName}
              patient={patientResource}
              from={from}
              to={to}
              printedAt={printedAt}
              printedBy={printedBy}
              sectionLabels={KARTE_PRINT_SECTIONS.filter((section) => sections.includes(section.key)).map(
                (section) => section.label,
              )}
              encounters={encounters.data?.encounters ?? []}
              appointments={encounters.data?.appointments ?? []}
            />
          )}
          {withConditions && <RecordExportConditions header={header} conditions={conditions.data?.conditions ?? []} />}
          {withSummaries && <RecordExportSummaries header={header} summaries={summaries.data?.summaries ?? []} />}
          {withProgress && (
            <KartePrintDocument
              header={header}
              groups={timeline.groups}
              history={withHistory ? history.data : undefined}
              deletions={timeline.deletions}
            />
          )}
        </>
      )}
    </div>
  );
}
