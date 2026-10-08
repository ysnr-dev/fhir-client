import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  useBedWardIndex,
  useDischargedAdmissions,
  useDpcRecordsForEncounters,
  useInpatientEncounters,
} from "../api/queries";
import { DpcPeriod2 } from "../components/DpcPeriod2";
import { ErrorBanner } from "../components/ErrorBanner";
import { TruncatedNotice } from "../components/TruncatedNotice";
import { dpcTimingLabel } from "../fhir/dpcCodingRecord";
import { buildDpcPatientRows, DPC_FORM1_STATE_LABELS } from "../fhir/dpcPatientList";
import { ADMISSION_STATUS } from "../fhir/encounterHelpers";
import { KARTE_OPEN_PARAM, formatKarteOpen } from "../karteUrl";
import { csvBlob } from "../lib/csv";
import { addMonths, today } from "../lib/dates";
import { downloadBlob } from "../lib/download";

// DPC 患者一覧。入院中、または退院月を選んで、入院ごとに様式1 の状態・今の診断群分類・
// 在院日数と期間Ⅱの末日を並べる。期間Ⅱを過ぎた入院・末日が近い入院に印を付ける。
// 行からカルテの DPC(診断群分類)を開く。

type Mode = "current" | "discharged";

export function DpcPatientListPage() {
  const [mode, setMode] = useState<Mode>("current");
  const [month, setMonth] = useState(() => today().slice(0, 7));
  const [ward, setWard] = useState("");
  const [undecidedOnly, setUndecidedOnly] = useState(false);
  const [overOnly, setOverOnly] = useState(false);
  const [form1Open, setForm1Open] = useState(false);

  const base = today();
  const inpatients = useInpatientEncounters(mode === "current" ? base : "");
  const discharged = useDischargedAdmissions(mode === "discharged" ? month : "");
  const { bedWards } = useBedWardIndex();

  const source = mode === "current" ? inpatients : discharged;
  const encounters = useMemo(
    () =>
      mode === "current"
        ? (inpatients.data?.encounters ?? []).filter((e) => e.status === ADMISSION_STATUS)
        : (discharged.data?.encounters ?? []),
    [mode, inpatients.data, discharged.data],
  );
  const patientsById = useMemo(
    () =>
      (mode === "current" ? inpatients.data?.patientsById : discharged.data?.patientsById) ??
      new Map<string, fhir4.Patient>(),
    [mode, inpatients.data, discharged.data],
  );
  const records = useDpcRecordsForEncounters(encounters.map((e) => e.id ?? "").filter(Boolean));

  const rows = useMemo(
    () =>
      buildDpcPatientRows({
        encounters,
        patientsById,
        responses: records.data?.responses ?? [],
        wardNameOf: (bedId) => (bedId ? (bedWards.get(bedId)?.wardName ?? "") : ""),
        baseDate: base,
      }).sort((a, b) => a.wardName.localeCompare(b.wardName) || a.admittedOn.localeCompare(b.admittedOn)),
    [encounters, patientsById, records.data, bedWards, base],
  );
  const wards = [...new Set(rows.map((r) => r.wardName).filter(Boolean))].sort();
  const shown = rows.filter(
    (row) =>
      (!ward || row.wardName === ward) &&
      (!undecidedOnly || !row.decision) &&
      (!overOnly || row.overDays > 0) &&
      (!form1Open || row.form1 === "none" || row.form1 === "in-progress"),
  );

  function exportCsv() {
    const header = [
      "患者番号", "氏名", "病棟", "診療科", "入院日", "退院日", "在院日数", "様式1",
      "診断群分類", "名称", "時点", "期間Ⅱ末日", "超過日数",
    ];
    const body = shown.map((row) => [
      row.patientNumber, row.patientName, row.wardName, row.department, row.admittedOn, row.dischargedOn,
      row.stayDays, DPC_FORM1_STATE_LABELS[row.form1], row.decision?.dpcCode ?? "", row.decision?.name ?? "",
      row.decision ? dpcTimingLabel(row.decision.timing) : "", row.period2End, row.overDays || "",
    ]);
    const suffix = mode === "current" ? base : month;
    downloadBlob(csvBlob(header, body), `dpc-patients-${suffix}.csv`);
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>DPC患者</h1>
        <div className="page__header-actions">
          <button type="button" onClick={exportCsv} disabled={!shown.length}>
            CSV
          </button>
        </div>
      </div>

      <div className="master-search__form master-search__form--row">
        <label>
          対象
          <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
            <option value="current">入院中</option>
            <option value="discharged">退院月</option>
          </select>
        </label>
        {mode === "discharged" && (
          <label className="dpc-form1-export__month">
            退院月
            <input
              type="month"
              value={month}
              max={today().slice(0, 7)}
              onChange={(e) => setMonth(e.target.value || addMonths(today(), -1).slice(0, 7))}
            />
          </label>
        )}
        <label>
          病棟
          <select value={ward} onChange={(e) => setWard(e.target.value)}>
            <option value="">すべて</option>
            {wards.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="master-search__checkbox dpc-patients__check">
          <input type="checkbox" checked={undecidedOnly} onChange={(e) => setUndecidedOnly(e.target.checked)} />
          未決定
        </label>
        <label className="master-search__checkbox dpc-patients__check">
          <input type="checkbox" checked={overOnly} onChange={(e) => setOverOnly(e.target.checked)} />
          期間Ⅱ超え
        </label>
        <label className="master-search__checkbox dpc-patients__check">
          <input type="checkbox" checked={form1Open} onChange={(e) => setForm1Open(e.target.checked)} />
          様式1未確定
        </label>
      </div>

      <ErrorBanner error={source.error ?? records.error} />
      <TruncatedNotice
        show={(mode === "current" ? inpatients.data?.truncated : discharged.data?.truncated) || records.data?.truncated}
      />

      {source.isPending ? (
        <p>読み込み中...</p>
      ) : (
        <table className="patient-table dpc-patients">
          <thead>
            <tr>
              <th>患者番号</th>
              <th>氏名</th>
              <th>病棟</th>
              <th>診療科</th>
              <th>入院日</th>
              {mode === "discharged" && <th>退院日</th>}
              <th>在院日数</th>
              <th>様式1</th>
              <th>診断群分類</th>
              <th>期間Ⅱ末日</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.encounterId}>
                <td>{row.patientNumber}</td>
                <td>{row.patientName}</td>
                <td>{row.wardName}</td>
                <td>{row.department}</td>
                <td>{row.admittedOn}</td>
                {mode === "discharged" && <td>{row.dischargedOn}</td>}
                <td>{row.stayDays}</td>
                <td>{DPC_FORM1_STATE_LABELS[row.form1]}</td>
                <td>
                  {row.decision ? (
                    <>
                      <div className="dpc-coding__code">{row.decision.dpcCode}</div>
                      <div className="dpc-coding__note">
                        {dpcTimingLabel(row.decision.timing)} {row.decision.name}
                      </div>
                    </>
                  ) : (
                    <span className="dpc-patients__undecided">未決定</span>
                  )}
                </td>
                <td>
                  <DpcPeriod2 row={row} />
                </td>
                <td className="patient-table__actions">
                  <Link
                    to={`/patients/${row.patientId}/karte?${KARTE_OPEN_PARAM}=${encodeURIComponent(
                      formatKarteOpen({ kind: "dpc-coding", encounterId: row.encounterId }),
                    )}`}
                  >
                    DPC
                  </Link>
                </td>
              </tr>
            ))}
            {!records.isFetching && shown.length === 0 && (
              <tr>
                <td colSpan={mode === "discharged" ? 11 : 10} className="patient-table__empty">
                  該当する入院はありません。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
