import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useCurrentPractitioner } from "../api/authQueries";
import { useAcknowledgePanicTasks, usePanicResults } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { PatientKana } from "../components/PatientRowCells";
import type { PanicTaskRow } from "../fhir/labPanicHelpers";
import { interpretationClass } from "../fhir/labResultHelpers";
import { displayName, patientNumberOf } from "../fhir/patientHelpers";
import { KARTE_TAB_PARAM } from "../karteUrl";
import { dateTimeSecondsLabel } from "../lib/dates";
import { useReturnLinkState } from "../returnTo";

// 緊急異常値(診療業務)。
//
// パニック値の結果が登録されると、依頼医あてに未確認の通知(Task)が立つ。この画面は
// その未確認ぶんを新しい順に並べ、医師が内容を見て確認済みにする。確認すると誰がいつ
// 確認したかが通知に残る(readme「パニック値(緊急異常値)の通知」)。
//
// 既定は自分あてだけ。オーダーに紐付かない結果には宛先が無いので、「すべて」に
// 切り替えると宛先なしのぶんも出る(検査室が電話連絡する運用ならこちらを見る)。
export function LabPanicResultPage() {
  const { practitionerId } = useCurrentPractitioner();
  const [mine, setMine] = useState(true);
  const panic = usePanicResults(mine ? practitionerId : undefined);
  const acknowledge = useAcknowledgePanicTasks();
  const linkState = useReturnLinkState();

  // 医療従事者に紐付かないアカウントでは自分あてが決まらないので、すべてを出す。
  useEffect(() => {
    if (!practitionerId) setMine(false);
  }, [practitionerId]);

  // 列を折り返さないぶん幅が要る(検体検査一覧・オーダー承認と同じ)。
  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  const rows = useMemo(() => panic.data ?? [], [panic.data]);

  function acknowledgeRows(target: PanicTaskRow[]) {
    acknowledge.mutate(target.map((row) => row.task));
  }

  function karteLink(row: PanicTaskRow): string {
    const params = new URLSearchParams();
    params.set(KARTE_TAB_PARAM, "lab");
    if (row.reportId) params.set("view", row.reportId);
    return `/patients/${row.patientId}/karte?${params.toString()}`;
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>緊急異常値</h1>
        <div className="page__header-actions">
          <label className="lab-panic__filter">
            <input
              type="checkbox"
              checked={mine}
              disabled={!practitionerId}
              onChange={(e) => setMine(e.target.checked)}
            />
            自分あてのみ
          </label>
          <button
            type="button"
            disabled={rows.length === 0 || acknowledge.isPending}
            onClick={() => acknowledgeRows(rows)}
          >
            すべて確認済みにする（{rows.length}件）
          </button>
        </div>
      </div>

      <ErrorBanner error={panic.error} />
      <ErrorBanner error={acknowledge.error} />

      {!practitionerId && (
        <p className="order-select__muted">
          医療従事者に紐付いたアカウントでログインすると、自分あての通知だけに絞れます。
        </p>
      )}

      <div className="lab-panic__table-wrap">
        <table className="master-search__table lab-panic">
          <thead>
            <tr>
              <th>登録日時</th>
              <th>採取日</th>
              <th>患者番号</th>
              <th>氏名</th>
              <th>緊急異常値</th>
              <th>宛先</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.task.id}>
                <td>{dateTimeSecondsLabel(row.authoredOn)}</td>
                <td>{row.specimenDate}</td>
                <td>{row.patient ? patientNumberOf(row.patient) : ""}</td>
                <td>
                  {row.patient ? (
                    <>
                      {displayName(row.patient)}
                      <PatientKana patient={row.patient} />
                    </>
                  ) : (
                    row.patientId
                  )}
                </td>
                {/* 項目・値・判定を分けて出す(1 件の通知に複数の項目が入る)。 */}
                <td className="lab-panic__items">
                  {row.items.length > 0
                    ? row.items.map((item, index) => (
                        <span className="lab-panic__item" key={index}>
                          <span className="lab-panic__item-name">{item.name}</span>
                          <span className="lab-panic__item-value">{item.value}</span>
                          <span className="lab-panic__item-unit">{item.unit}</span>
                          <span className={interpretationClass(item.interpretation, "lab-panic__flag")}>
                            {item.interpretation}
                          </span>
                        </span>
                      ))
                    : row.summary}
                </td>
                <td>{row.ownerName || "(宛先なし)"}</td>
                <td className="master-search__actions lab-panic__actions">
                  <Link className="button" to={karteLink(row)} state={linkState}>
                    カルテ
                  </Link>
                  <button
                    type="button"
                    disabled={acknowledge.isPending}
                    onClick={() => acknowledgeRows([row])}
                  >
                    確認
                  </button>
                </td>
              </tr>
            ))}
            {!panic.isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="master-search__empty">
                  未確認の緊急異常値はありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
