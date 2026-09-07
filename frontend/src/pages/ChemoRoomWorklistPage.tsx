import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useChemoRoomList, type ChemoRoomRow } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { PatientKana, PatientProfileCells, PatientProfileHeadCells } from "../components/PatientRowCells";
import { appointmentTimeLabel } from "../fhir/appointmentHelpers";
import { groupInjectionByRp } from "../fhir/injectionHelpers";
import { injectionTaskStatus, injectionTaskStatusDisplay } from "../fhir/injectionTaskHelpers";
import { displayName } from "../fhir/patientHelpers";
import { cycleDayLabel, regimenOrderOf } from "../fhir/regimenOrderHelpers";
import { today } from "../lib/dates";
import { useReturnLinkState } from "../returnTo";

// 部門業務の「外来化学療法室」。その日に化学療法室を予約している患者を時間順に並べる
// (docs/chemo-regimen-design.md §7.6 E-7)。
//
// 注射一覧(オーダー軸)と違い**予約軸**にするのは、化学療法室がベッド・椅子の時間割で
// 回る部門だから。誰が何時に来て、どのレジメンの何クール目で、投与が済んだかが 1 行で
// 読めればよい。オーダーの中身(薬剤・投与量)は注射一覧か、カルテの化学療法タブで見る。

export function ChemoRoomWorklistPage() {
  const [date, setDate] = useState(today);

  // 列が多いのでこの画面だけ幅を広げる(他の部門一覧と同じ)。
  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  const list = useChemoRoomList(date);
  const rows = list.data ?? [];

  return (
    <div className="page">
      <h1>外来化学療法室</h1>
      <DateForm date={date} onChange={setDate} />
      <ErrorBanner error={list.error} />

      {list.isPending ? (
        <p>読み込み中...</p>
      ) : (
        <>
          <div className="lab-worklist-wrap sticky-table-wrap">
            <table className="lab-worklist sticky-table">
              <thead>
                <tr>
                  <th className="lab-worklist__compact sticky-table__fix-1">時刻</th>
                  <th className="sticky-table__fix-2">患者氏名</th>
                  <PatientProfileHeadCells />
                  <th>レジメン</th>
                  <th className="rx-worklist__content">投与内容</th>
                  <th className="lab-worklist__compact">ステータス</th>
                  <th className="lab-worklist__actions sticky-table__fix-actions">操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <ChemoRoomTableRow key={row.appointment.id} row={row} />
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="master-search__empty">
                      この日の化学療法室の予約はありません
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="order-select__muted lab-worklist__count">{rows.length} 件</p>
        </>
      )}
    </div>
  );
}

function DateForm({ date, onChange }: { date: string; onChange: (date: string) => void }) {
  const [value, setValue] = useState(date);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onChange(value);
  }

  return (
    <form className="patient-search-form" onSubmit={handleSubmit}>
      <label>
        予約日
        <input type="date" value={value} onChange={(e) => setValue(e.target.value)} />
      </label>
      <div className="patient-search-form__actions">
        <button type="submit">表示</button>
      </div>
    </form>
  );
}

function ChemoRoomTableRow({ row }: { row: ChemoRoomRow }) {
  const returnLinkState = useReturnLinkState();
  const { appointment, patient, order, medicationRequests, task } = row;
  const regimen = order ? regimenOrderOf(order) : null;
  const status = injectionTaskStatus(task);

  // 投与内容は医薬品の名前だけ。用量・用法はカルテか注射一覧で見る。
  const medicineNames = groupInjectionByRp(medicationRequests)
    .flatMap((rp) => rp.medicines.map((m) => m.name))
    .filter(Boolean)
    .join("・");

  return (
    <tr>
      <td className="lab-worklist__compact sticky-table__fix-1">{appointmentTimeLabel(appointment) || "-"}</td>
      <td className="sticky-table__fix-2">
        {patient ? (
          <>
            <Link to={`/patients/${patient.id}/karte?tab=chemo`} state={returnLinkState}>
              {displayName(patient)}
            </Link>
            <PatientKana patient={patient} />
          </>
        ) : (
          "-"
        )}
      </td>
      <PatientProfileCells patient={patient} />
      <td>
        {regimen ? (
          <>
            {`${regimen.name} ${cycleDayLabel(regimen)}`}
            {regimen.reduction && (
              <span className="injection-worklist__reduced" title={regimen.reduction}>
                減量
              </span>
            )}
          </>
        ) : (
          <span className="order-select__muted">-</span>
        )}
      </td>
      <td className="rx-worklist__content">
        {medicineNames ? (
          <span className="rx-worklist__medicines" title={medicineNames}>
            {medicineNames}
          </span>
        ) : (
          <span className="order-select__muted">-</span>
        )}
      </td>
      <td className="lab-worklist__compact">
        <span className={`lab-worklist__status lab-worklist__status--${status}`}>
          {injectionTaskStatusDisplay(status)}
        </span>
      </td>
      <td className="lab-worklist__actions sticky-table__fix-actions">
        {patient && (
          <Link
            className="button rp-card__compact-button"
            to={`/patients/${patient.id}/karte?tab=chemo`}
            state={returnLinkState}
          >
            カルテで確認
          </Link>
        )}
      </td>
    </tr>
  );
}
