import { useEffect, useMemo } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { usePatient, useKartePrintHistory, useKartePrintTimeline } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { KartePrintDocument } from "../components/KartePrintDocument";
import { TruncatedNotice } from "../components/TruncatedNotice";
import { displayName, genderLabel, patientNumberOf } from "../fhir/patientHelpers";
import { dateTimeLabel, nowFhirDateTime } from "../lib/dates";
import { applyTheme, resolveTheme } from "../theme";

// カルテ印刷の別タブ。カルテの「カルテ印刷」タブから期間と履歴の有無を受け取り、
// 2 号用紙を A4 で描いてブラウザの印刷(PDF 保存を含む)に渡す。

export function KartePrintPage() {
  const { patientId } = useParams<{ patientId: string }>();
  const [searchParams] = useSearchParams();
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";
  const withHistory = searchParams.get("history") === "1";

  // 紙面は白地に印字するので、ダークテーマでもこのタブだけライトで描く。
  useEffect(() => {
    applyTheme("light");
    return () => applyTheme(resolveTheme());
  }, []);

  const patient = usePatient(patientId);
  const timeline = useKartePrintTimeline(patientId, from, to);
  const items = useMemo(() => timeline.groups.flatMap((group) => group.items), [timeline.groups]);
  const history = useKartePrintHistory(items, withHistory && !timeline.isPending);
  // 印刷日時は開いた時点で固定する(読み込みのたびに変わらないように)。
  const printedAt = useMemo(() => dateTimeLabel(nowFhirDateTime()), []);

  const historyPending = withHistory && items.length > 0 && history.isPending;
  const ready = !patient.isPending && !timeline.isPending && !historyPending;
  const error = patient.error ?? timeline.error ?? history.error;
  const patientResource = patient.data?.data;

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
      <span>{`印刷 ${printedAt}`}</span>
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
      <TruncatedNotice show={timeline.truncated} />
      {ready && (
        <KartePrintDocument header={header} groups={timeline.groups} history={withHistory ? history.data : undefined} />
      )}
    </div>
  );
}
