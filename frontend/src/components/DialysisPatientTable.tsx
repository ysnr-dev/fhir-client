import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useDialysisLabItems, useDialysisPatientData, useDialysisSessions, type DialysisWorklistRow } from "../api/queries";
import { dialysisAppointmentDate, dialysisAppointmentShift } from "../fhir/dialysisAppointmentHelpers";
import { summarizeDialysisOrder } from "../fhir/dialysisOrderHelpers";
import {
  buildDialysisPatientRows,
  DIALYSIS_SESSION_LOOKBACK_DAYS,
  dialysisPatientOrders,
  signedKg,
  type DialysisPatientRow,
} from "../fhir/dialysisPatientListHelpers";
import { dialysisMinutesLabel } from "../fhir/dialysisResultHelpers";
import type { DialysisShift } from "../fhir/dialysisShiftHelpers";
import { interpretationClass } from "../fhir/labResultHelpers";
import { displayName } from "../fhir/patientHelpers";
import type { RowPictogramSources } from "../hooks/useRowPictogramSources";
import { addDays, shortDate } from "../lib/dates";
import { useReturnLinkState } from "../returnTo";
import { ErrorBanner } from "./ErrorBanner";
import { RowPictograms } from "./PatientListRowParts";
import { PatientKana, PatientProfileCells, PatientProfileHeadCells } from "./PatientRowCells";
import { TruncatedNotice } from "./TruncatedNotice";

// 透析患者一覧(docs/dialysis-order-design.md §6.2)。透析一覧の「患者」ビュー。
// 基準日に効いている透析室の透析オーダーの患者を 1 人 1 行にし、DW の推移・直近の透析・直近の採血・
// バスキュラーアクセスを並べる。

interface Props {
  /** 透析一覧の行(絞り込み済み)。患者ごとにまとめるのはここで行う。 */
  rows: DialysisWorklistRow[];
  date: string;
  shifts: DialysisShift[];
  pictograms: RowPictogramSources;
  onView: (orderId: string) => void;
  onMemo: (patient: fhir4.Patient) => void;
}

export function DialysisPatientTable({ rows, date, shifts, pictograms, onView, onMemo }: Props) {
  const returnLinkState = useReturnLinkState();
  const targets = useMemo(() => dialysisPatientOrders(rows), [rows]);
  const patientIds = useMemo(() => targets.flatMap((row) => (row.patient?.id ? [row.patient.id] : [])), [targets]);
  const labItems = useDialysisLabItems();
  const data = useDialysisPatientData(patientIds, date, labItems);
  const sessions = useDialysisSessions(addDays(date, -(DIALYSIS_SESSION_LOOKBACK_DAYS - 1)), date);

  const patientRows = useMemo(
    () =>
      buildDialysisPatientRows({
        rows: targets,
        baseDate: date,
        sessions: sessions.data?.sessions ?? [],
        dryWeightsByPatient: data.data?.dryWeightsByPatient ?? new Map(),
        labsByPatient: data.data?.labsByPatient ?? new Map(),
        labItems,
      }),
    [targets, date, sessions.data, data.data, labItems],
  );

  return (
    <>
      <ErrorBanner error={data.error} />
      <ErrorBanner error={sessions.error} />
      <TruncatedNotice show={data.data?.truncated || sessions.data?.truncated} />
      <div className="lab-worklist-wrap sticky-table-wrap">
        <table className="lab-worklist sticky-table dialysis-patients">
          <thead>
            <tr>
              <th className="sticky-table__fix-1">患者番号</th>
              <th className="sticky-table__fix-2">患者氏名</th>
              <PatientProfileHeadCells />
              <th className="lab-worklist__compact">浄化方法</th>
              <th className="lab-worklist__compact">曜日・シフト</th>
              <th className="lab-worklist__compact">アクセス</th>
              <th className="lab-worklist__compact">DW(kg)</th>
              <th className="lab-worklist__compact">直近の透析</th>
              <th className="lab-worklist__compact">体重増加</th>
              <th className="lab-worklist__compact">採血日</th>
              {labItems.map((item) => (
                <th key={item.code} className="lab-worklist__compact dialysis-patients__lab">
                  {item.label}
                </th>
              ))}
              <th className="lab-worklist__compact">次回予約</th>
              <th className="lab-worklist__actions sticky-table__fix-actions"></th>
            </tr>
          </thead>
          <tbody>
            {patientRows.map((row) => {
              const summary = summarizeDialysisOrder(row.order);
              const next = row.appointments[0];
              return (
                <tr key={row.patientId}>
                  <td className="sticky-table__fix-1">{row.patient?.identifier?.[0]?.value ?? "-"}</td>
                  <td className="sticky-table__fix-2">
                    {row.patient ? (
                      <>
                        <Link to={`/patients/${row.patientId}/karte`} state={returnLinkState}>
                          {displayName(row.patient)}
                        </Link>
                        <PatientKana patient={row.patient} />
                        <RowPictograms patientId={row.patientId} {...pictograms} />
                      </>
                    ) : (
                      "-"
                    )}
                  </td>
                  <PatientProfileCells patient={row.patient} />
                  <td className="lab-worklist__compact">{summary.modalityShort || "-"}</td>
                  <td className="lab-worklist__compact">{summary.scheduleLabel || "-"}</td>
                  <td className="lab-worklist__compact">
                    {summary.accessLabel || "-"}
                    {summary.needle && <span className="dialysis-patients__line">{summary.needle}</span>}
                  </td>
                  <td className="lab-worklist__compact">
                    <DryWeightCell row={row} />
                  </td>
                  <td className="lab-worklist__compact">
                    <LatestSessionCell row={row} />
                  </td>
                  <td className="lab-worklist__compact">
                    {row.weightGain ? (
                      <>
                        {signedKg(row.weightGain.kg)}kg
                        <span className="dialysis-patients__line">
                          {[row.weightGain.percent != null ? `${row.weightGain.percent}%` : "", `中${row.weightGain.interval}日`]
                            .filter(Boolean)
                            .join(" ")}
                        </span>
                      </>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="lab-worklist__compact">{row.labs.date ? shortDate(row.labs.date) : "-"}</td>
                  {labItems.map((item) => {
                    const value = row.labs.values[item.code];
                    // 採血日より前の結果(その回に測っていない項目)は日付を添えて区別する。
                    const older = value && value.date !== row.labs.date;
                    return (
                      <td
                        key={item.code}
                        className={interpretationClass(value?.interpretation ?? "", "dialysis-patients__lab")}
                        title={value ? `${item.label} ${value.text}(${shortDate(value.date)})` : undefined}
                      >
                        {value ? value.text : "-"}
                        {older && <span className="dialysis-patients__line">{shortDate(value.date)}</span>}
                      </td>
                    );
                  })}
                  <td className="lab-worklist__compact">
                    {next ? (
                      [shortDate(dialysisAppointmentDate(next)), dialysisAppointmentShift(next, shifts)?.label, next.description]
                        .filter(Boolean)
                        .join(" ")
                    ) : (
                      <span className="order-select__muted">未定</span>
                    )}
                  </td>
                  <td className="lab-worklist__actions sticky-table__fix-actions">
                    <button type="button" onClick={() => onView(row.order.id ?? "")}>
                      表示
                    </button>
                    {row.patient && (
                      <button type="button" onClick={() => row.patient && onMemo(row.patient)}>
                        メモ
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {patientRows.length === 0 && (
              <tr>
                <td colSpan={13 + labItems.length} className="master-search__empty">
                  {rows.length === 0 ? `${date} に透析室で透析を受けている患者はいません` : "絞り込みに該当する患者がいません"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="order-select__muted lab-worklist__count">{patientRows.length} 人</p>
    </>
  );
}

/** 直近の DW(太字)と、その前の値からの推移。 */
function DryWeightCell({ row }: { row: DialysisPatientRow }) {
  const latest = row.dryWeights[row.dryWeights.length - 1];
  if (!latest) return <>-</>;
  const history = row.dryWeights.slice(0, -1);
  return (
    <>
      <strong>{latest.value.toFixed(1)}</strong>
      <span className="dialysis-patients__line">
        {history.length > 0 && `${history.map((dw) => dw.value.toFixed(1)).join(" → ")} → `}
        {shortDate(latest.date)}〜
      </span>
    </>
  );
}

function LatestSessionCell({ row }: { row: DialysisPatientRow }) {
  const latest = row.latest;
  if (!latest) return <>-</>;
  const weights = [
    latest.postWeight != null ? `後 ${latest.postWeight}kg` : "",
    row.postDiff != null ? `(DW${signedKg(row.postDiff)})` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <>
      {[shortDate(latest.date), latest.status === "stopped" ? latest.statusLabel : "", weights].filter(Boolean).join(" ")}
      <span className="dialysis-patients__line">
        {[latest.ultrafiltration != null ? `除水 ${latest.ultrafiltration}L` : "", dialysisMinutesLabel(latest.actualMinutes)]
          .filter(Boolean)
          .join(" / ") || "-"}
      </span>
    </>
  );
}
