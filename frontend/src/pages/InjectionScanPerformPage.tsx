import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { usePatientInjectionOrders, usePatientsByNumber } from "../api/queries";
import { BarcodeScanField } from "../components/BarcodeScanField";
import { DateStepper } from "../components/DateStepper";
import { ErrorBanner } from "../components/ErrorBanner";
import { InjectionPerformModal } from "../components/InjectionPerformModal";
import { PatientKana } from "../components/PatientRowCells";
import { TruncatedNotice } from "../components/TruncatedNotice";
import {
  groupInjectionByRp,
  injectionTimesLabel,
  injectionUsageSummary,
  summarizeInjectionServiceRequest,
} from "../fhir/injectionHelpers";
import { injectionPerformsByOrderId, scheduledPerformCount } from "../fhir/injectionPerformHelpers";
import {
  injectionTaskStatus,
  injectionTaskStatusDisplay,
  injectionTasksByOrderId,
} from "../fhir/injectionTaskHelpers";
import {
  EMPTY_SCAN_STATE,
  applyScan,
  injectionOrderKey,
  parseScannedCode,
  type InjectionScanState,
} from "../fhir/injectionVerificationHelpers";
import { calculateAge, displayName, genderLabel, patientNumberOf } from "../fhir/patientHelpers";
import { referenceId } from "../fhir/shared";
import { today } from "../lib/dates";
import { useReturnLinkState } from "../returnTo";

// 注射バーコード実施(docs/injection-order-design.md §6.6)。ベッドサイドで患者番号(リストバンド・注射ラベル)を
// 読むとその患者のその日の注射を並べ、続けて注射ラベルの RP バーコードを読むと、読んだ照合を持って
// 実施入力(InjectionPerformModal)を開く。照合は施設設定に関わらず記録する。
// 患者番号より先に RP を読んでも患者が決まらないので受け付けない。

export function InjectionScanPerformPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const date = searchParams.get("date") || today();
  const returnLinkState = useReturnLinkState();

  const [patientNumber, setPatientNumber] = useState("");
  // 直近の読み取りで止めた理由。
  const [message, setMessage] = useState("");
  const [performing, setPerforming] = useState<{ orderId: string; scan: InjectionScanState } | null>(null);
  // 実施入力を閉じたら読み取り欄に戻す(付け直すと autoFocus が効く)。
  const [scanFieldKey, setScanFieldKey] = useState(0);

  const patients = usePatientsByNumber(patientNumber);
  const patient = patients.data?.length === 1 ? patients.data[0] : undefined;
  const injections = usePatientInjectionOrders(patient?.id, date, date);

  const rows = useMemo(() => {
    const data = injections.data;
    if (!data) return [];
    const tasks = injectionTasksByOrderId(data.tasks);
    const performs = injectionPerformsByOrderId(data.procedures, data.administrations);
    return data.orders.map((order) => {
      const id = order.id ?? "";
      const medicationRequests = data.medicationRequests.filter(
        (mr) => referenceId(mr.basedOn?.[0]?.reference) === id,
      );
      const task = tasks.get(id);
      return {
        order,
        medicationRequests,
        rps: groupInjectionByRp(medicationRequests),
        task,
        status: injectionTaskStatus(task),
        performs: performs.get(id) ?? [],
      };
    });
  }, [injections.data]);

  const notFound =
    patients.data !== undefined && patients.data.length === 0
      ? `患者番号 ${patientNumber} の患者はいません。`
      : patients.data !== undefined && patients.data.length > 1
        ? `患者番号 ${patientNumber} の患者が複数います。`
        : null;

  function handleScan(raw: string) {
    const code = parseScannedCode(raw);
    if (!code) return;
    if (code.kind === "patient") {
      setPatientNumber(raw);
      setMessage("");
      return;
    }
    if (!patient) {
      setMessage("先に患者番号を読んでください。");
      return;
    }
    const row = rows.find((r) => injectionOrderKey(r.order.id ?? "") === code.orderKey);
    if (!row) {
      setMessage(`この患者の ${date} の注射にこのラベルはありません。`);
      return;
    }
    if (row.status === "cancelled") {
      setMessage("この注射は中止されています。");
      return;
    }
    const context = { orderId: row.order.id ?? "", patient, rpNumbers: row.rps.map((rp) => rp.rpNumber) };
    const scan = applyScan(applyScan(EMPTY_SCAN_STATE, patientNumber, context), raw, context);
    if (scan.rpNumbers.length === 0) {
      setMessage(scan.message?.text ?? "");
      return;
    }
    setMessage("");
    setPerforming({ orderId: context.orderId, scan });
  }

  const performingRow = performing && rows.find((r) => r.order.id === performing.orderId);

  return (
    <div className="page">
      <div className="page__header">
        <h1>注射バーコード実施</h1>
        <div className="page__header-actions injection-scan__date">
          <DateStepper value={date} onChange={(value) => setSearchParams({ date: value })} />
        </div>
      </div>

      <section className="injection-scan__panel">
        <ol className="injection-scan__steps">
          <li className={`injection-scan__step injection-scan__step--${patient ? "done" : "active"}`}>
            <span className="injection-scan__step-number">1</span>
            患者番号
          </li>
          <li className={`injection-scan__step${patient ? " injection-scan__step--active" : ""}`}>
            <span className="injection-scan__step-number">2</span>
            注射ラベル
          </li>
        </ol>
        <BarcodeScanField key={scanFieldKey} ariaLabel="バーコードの読み取り" onScan={handleScan} />
        {(message || notFound) && (
          <p className="injection-verify__message injection-verify__message--error" role="alert">
            {message || notFound}
          </p>
        )}
      </section>

      <ErrorBanner error={patients.error} />
      <ErrorBanner error={injections.error} />
      <TruncatedNotice show={injections.data?.truncated} />

      {!patientNumber ? (
        <p className="patient-table__empty">患者番号を読んでください。</p>
      ) : patients.isLoading ? (
        <p>読み込み中...</p>
      ) : (
        patient && (
          <>
            <div className="injection-scan__patient">
              <span className="injection-scan__patient-number">{patientNumberOf(patient)}</span>
              <div className="injection-scan__patient-name">
                <Link to={`/patients/${patient.id}/karte`} state={returnLinkState}>
                  {displayName(patient)}
                </Link>
                <PatientKana patient={patient} />
              </div>
              <span className="injection-scan__patient-profile">
                {[
                  patient.birthDate?.replaceAll("-", "/"),
                  patient.birthDate ? `${calculateAge(patient.birthDate) ?? "-"}歳` : "",
                  genderLabel(patient.gender),
                ]
                  .filter(Boolean)
                  .join("　")}
              </span>
            </div>
            {injections.isLoading ? (
              <p>読み込み中...</p>
            ) : (
              <div className="lab-worklist-wrap">
                <table className="lab-worklist injection-scan__table">
                  <thead>
                    <tr>
                      <th className="lab-worklist__compact">区分</th>
                      <th className="lab-worklist__compact">RP</th>
                      <th>薬剤</th>
                      <th>用法</th>
                      <th className="lab-worklist__compact">実施</th>
                      <th className="lab-worklist__compact">状態</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.flatMap((row) => {
                      const summary = summarizeInjectionServiceRequest(row.order);
                      const done = row.performs.filter((p) => p.counted).length;
                      return row.rps.map((rp, index) => (
                        <tr
                          key={`${row.order.id}-${rp.rpNumber}`}
                          className={index === 0 ? "injection-scan__order-start" : undefined}
                        >
                          {index === 0 && (
                            <td className="lab-worklist__compact" rowSpan={row.rps.length}>
                              {[summary.settingDisplay, summary.categoryDisplay].filter(Boolean).join(" ")}
                            </td>
                          )}
                          <td className="lab-worklist__compact">{`RP${rp.rpNumber}`}</td>
                          <td>
                            {rp.medicines.map((m, i) => (
                              <div key={i}>{m.name}</div>
                            ))}
                          </td>
                          <td>
                            {[injectionUsageSummary(rp), injectionTimesLabel(rp.times)].filter(Boolean).join(" ")}
                          </td>
                          {index === 0 && (
                            <>
                              <td className="lab-worklist__compact" rowSpan={row.rps.length}>
                                {`${done}/${scheduledPerformCount(row.medicationRequests)}`}
                              </td>
                              <td className="lab-worklist__compact" rowSpan={row.rps.length}>
                                <span className={`lab-worklist__status lab-worklist__status--${row.status}`}>
                                  {injectionTaskStatusDisplay(row.status)}
                                </span>
                              </td>
                            </>
                          )}
                        </tr>
                      ));
                    })}
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={6} className="master-search__empty">
                          この日の注射はありません。
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )
      )}

      {performing && performingRow && (
        <InjectionPerformModal
          order={performingRow.order}
          medicationRequests={performingRow.medicationRequests}
          task={performingRow.task}
          performs={performingRow.performs}
          initialScan={performing.scan}
          onClose={() => {
            setPerforming(null);
            setScanFieldKey((key) => key + 1);
          }}
        />
      )}
    </div>
  );
}
