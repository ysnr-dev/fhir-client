import { Fragment, useEffect, useMemo, type ReactNode } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useCurrentPractitioner } from "../api/authQueries";
import { useLabResultItemsByJlac11Codes } from "../api/masterQueries";
import {
  useKartePrintHistory,
  useKartePrintTimeline,
  useNursingProfileSettings,
  usePatient,
  useRecordExportConditions,
  useRecordExportEncounters,
  useRecordExportLabs,
  useRecordExportNursing,
  useRecordExportNursingOrders,
  useRecordExportReports,
  useRecordExportSummaries,
  useSelfOrganization,
  useVitalFlowsheet,
  useVitalThresholds,
} from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { KartePrintDocument } from "../components/KartePrintDocument";
import { RecordExportConditions } from "../components/recordExport/RecordExportConditions";
import { RecordExportCover } from "../components/recordExport/RecordExportCover";
import { RecordExportFlowsheet } from "../components/recordExport/RecordExportFlowsheet";
import { RecordExportLabs } from "../components/recordExport/RecordExportLabs";
import { RecordExportNursing } from "../components/recordExport/RecordExportNursing";
import { RecordExportNursingOrders } from "../components/recordExport/RecordExportNursingOrders";
import { RecordExportReports } from "../components/recordExport/RecordExportReports";
import { RecordExportSummaries } from "../components/recordExport/RecordExportSummaries";
import { TruncatedNotice } from "../components/TruncatedNotice";
import { ADMISSION_CLASS_CODE } from "../fhir/encounterHelpers";
import { legacyJlac11CodesOf, resultItemAliases } from "../fhir/labResultHelpers";
import { displayName, genderLabel, patientNumberOf } from "../fhir/patientHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { KARTE_PRINT_SECTIONS, parseKartePrintSections, type KartePrintSection } from "../karteUrl";
import { dateTimeLabel, nowFhirDateTime, today } from "../lib/dates";
import { applyTheme, resolveTheme } from "../theme";

// カルテ印刷の別タブ。カルテの「カルテ印刷」タブから期間・区画・履歴の有無を受け取り、
// 選んだ区画(表紙・病名・退院時サマリー・診療経過記録・指示簿・看護・経過表・検歴・レポート)を
// A4 で続けて描いてブラウザの印刷(PDF 保存を含む)に渡す。区画ごとに改ページし、
// 見出しはページごとに繰り返す(docs/record-export-design.md)。履歴ありでは削除した記録も並べる。

export function KartePrintPage() {
  const { patientId } = useParams<{ patientId: string }>();
  const [searchParams] = useSearchParams();
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";
  const sections = parseKartePrintSections(searchParams.get("sections"));
  const has = (key: KartePrintSection) => sections.includes(key);
  const withHistory = has("progress") && searchParams.get("history") === "1";
  // サマリー・看護は期間に重なる入院のものを出すので、表紙を外しても受診は読む。
  const needsEncounters = has("cover") || has("summaries") || has("nursing");
  // 期間が年をまたぐときは、表の列の日付に年を付ける。
  const withYear = from.slice(0, 4) !== to.slice(0, 4);

  // 紙面は白地に印字するので、ダークテーマでもこのタブだけライトで描く。
  useEffect(() => {
    applyTheme("light");
    return () => applyTheme(resolveTheme());
  }, []);

  const patient = usePatient(patientId);
  const self = useSelfOrganization();
  const current = useCurrentPractitioner();
  const encounters = useRecordExportEncounters(patientId, from, to, needsEncounters);
  const admissions = useMemo(
    () => encounters.data?.encounters.filter((encounter) => encounter.class?.code === ADMISSION_CLASS_CODE),
    [encounters.data],
  );
  const conditions = useRecordExportConditions(patientId, has("conditions"));
  const summaries = useRecordExportSummaries(admissions, has("summaries"));
  const timeline = useKartePrintTimeline(patientId, has("progress") ? from : "", has("progress") ? to : "", withHistory);
  const items = useMemo(() => timeline.groups.flatMap((group) => group.items), [timeline.groups]);
  const history = useKartePrintHistory(items, withHistory && !timeline.isPending);
  const nursingOrders = useRecordExportNursingOrders(patientId, from, to, has("nursingOrders"));
  const nursing = useRecordExportNursing(patientId, admissions, from, to, has("nursing"));
  const profileSettings = useNursingProfileSettings();
  const vitals = useVitalFlowsheet(patientId, has("flowsheet") ? from : "", has("flowsheet") ? to : "");
  const thresholds = useVitalThresholds();
  const labs = useRecordExportLabs(patientId, from, to, has("labs"));
  // 施設コードを持たない結果(JLAC11 のみ)を同じ結果項目の行に合流させる(時系列表示と同じ)。
  const legacyCodes = useMemo(() => legacyJlac11CodesOf(labs.data?.observations ?? []), [labs.data]);
  const legacyItems = useLabResultItemsByJlac11Codes(legacyCodes);
  const aliases = useMemo(() => resultItemAliases(legacyItems.data?.items ?? []), [legacyItems.data]);
  const reports = useRecordExportReports(patientId, from, to, has("reports"));
  // 印刷日時は開いた時点で固定する(読み込みのたびに変わらないように)。
  const printedAt = useMemo(() => dateTimeLabel(nowFhirDateTime()), []);

  const pending = [
    patient.isPending,
    self.isLoading,
    has("cover") && current.practitionerLoading,
    needsEncounters && encounters.isPending,
    has("conditions") && conditions.isPending,
    has("summaries") && summaries.isPending,
    has("progress") && timeline.isPending,
    withHistory && items.length > 0 && history.isPending,
    has("nursingOrders") && nursingOrders.isPending,
    has("nursing") && (nursing.isPending || profileSettings.isLoading),
    has("flowsheet") && vitals.isPending,
    has("labs") && (labs.isPending || legacyItems.isLoading),
    has("reports") && reports.isPending,
  ];
  const ready = !pending.some(Boolean);
  const error =
    patient.error ??
    encounters.error ??
    conditions.error ??
    summaries.error ??
    (has("progress") ? timeline.error : null) ??
    history.error ??
    nursingOrders.error ??
    nursing.error ??
    vitals.error ??
    labs.error ??
    legacyItems.error ??
    reports.error;
  const patientResource = patient.data?.data;
  const facilityName = self.organization?.name ?? "";
  const printedBy = current.practitioner ? practitionerDisplayName(current.practitioner) : (current.user?.login_id ?? "");
  // 看護計画の目標は、終了日(今日より後なら今日)時点のものを出す。
  const nursingAt = to < today() ? to : today();

  const truncations: [boolean, string][] = [
    [Boolean(has("cover") && encounters.data?.truncated), "受診の件数が多いため、表紙の入退院歴・受診歴は一部のみ印刷します。"],
    [Boolean(has("conditions") && conditions.data?.truncated), "病名の件数が多いため、一部のみ印刷します。"],
    [Boolean(has("summaries") && summaries.data?.truncated), "退院時サマリーの件数が多いため、一部のみ印刷します。"],
    [has("progress") && timeline.truncated, "記録の件数が多いため、診療経過記録は一部のみ印刷します。"],
    [Boolean(has("nursingOrders") && nursingOrders.data?.truncated), "看護指示の件数が多いため、指示簿は一部のみ印刷します。"],
    [Boolean(has("nursing") && nursing.data?.truncated), "看護の記録の件数が多いため、一部のみ印刷します。"],
    [has("flowsheet") && vitals.truncated, "測定の件数が多いため、経過表は一部のみ印刷します。"],
    [Boolean(has("labs") && labs.data?.truncated), "検査結果の件数が多いため、検歴は一部のみ印刷します。"],
    [Boolean(has("reports") && reports.data?.truncated), "レポートの件数が多いため、一部のみ印刷します。"],
  ];

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

  function renderSection(key: KartePrintSection, patientResource: fhir4.Patient): ReactNode {
    switch (key) {
      case "cover":
        return (
          <RecordExportCover
            header={header}
            facilityName={facilityName}
            patient={patientResource}
            from={from}
            to={to}
            printedAt={printedAt}
            printedBy={printedBy}
            sectionLabels={KARTE_PRINT_SECTIONS.filter((section) => has(section.key)).map((section) => section.label)}
            encounters={encounters.data?.encounters ?? []}
            appointments={encounters.data?.appointments ?? []}
          />
        );
      case "conditions":
        return <RecordExportConditions header={header} conditions={conditions.data?.conditions ?? []} />;
      case "summaries":
        return <RecordExportSummaries header={header} summaries={summaries.data?.summaries ?? []} />;
      case "progress":
        return (
          <KartePrintDocument
            header={header}
            groups={timeline.groups}
            history={withHistory ? history.data : undefined}
            deletions={timeline.deletions}
          />
        );
      case "nursingOrders":
        return <RecordExportNursingOrders header={header} orders={nursingOrders.data?.orders ?? []} />;
      case "nursing":
        return (
          <RecordExportNursing
            header={header}
            problems={nursing.data?.problems ?? []}
            summaries={nursing.data?.summaries ?? []}
            admissions={admissions ?? []}
            profileResponses={nursing.data?.profileResponses ?? []}
            profileQuestionnaires={nursing.data?.profileQuestionnaires ?? []}
            profileSettings={profileSettings.settings}
            at={nursingAt}
          />
        );
      case "flowsheet":
        return (
          <RecordExportFlowsheet header={header} observations={vitals.data ?? []} thresholds={thresholds} withYear={withYear} />
        );
      case "labs":
        return (
          <RecordExportLabs
            header={header}
            reports={labs.data?.reports ?? []}
            observations={labs.data?.observations ?? []}
            aliases={aliases}
            withYear={withYear}
          />
        );
      case "reports":
        return (
          <RecordExportReports
            header={header}
            reports={reports.data?.reports ?? []}
            observations={reports.data?.observations ?? []}
            specimens={reports.data?.specimens ?? []}
          />
        );
    }
  }

  return (
    <div className="karte-print">
      <div className="karte-print__toolbar">
        <button type="button" disabled={!ready} onClick={() => window.print()}>
          印刷
        </button>
        {!ready && <span>読み込み中...</span>}
      </div>
      <ErrorBanner error={error} />
      {truncations.map(([show, message]) => (
        <TruncatedNotice key={message} show={show}>
          {message}
        </TruncatedNotice>
      ))}
      {ready &&
        patientResource &&
        sections.map((key) => <Fragment key={key}>{renderSection(key, patientResource)}</Fragment>)}
    </div>
  );
}
