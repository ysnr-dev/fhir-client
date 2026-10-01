import { useState } from "react";
import { Link } from "react-router-dom";
import {
  dpcForm1FileUrl,
  useDpcForm1ExportSummary,
  type DpcForm1ExportStatus,
} from "../api/reportsClient";
import { ErrorBanner } from "../components/ErrorBanner";
import { KARTE_OPEN_PARAM, formatKarteOpen } from "../karteUrl";
import { addMonths, today } from "../lib/dates";

// DPC 様式1 の提出ファイル(FF1)の出力。退院月を選ぶと、その月に退院した入院と様式1 の
// 作成状況が並ぶ。ファイルに入るのは確定(修正済みを含む)した様式1 だけで、未作成・下書きの
// 入院は一覧からカルテを開いて仕上げる。

const STATUS_LABELS: Record<DpcForm1ExportStatus, string> = {
  none: "未作成",
  "in-progress": "下書き",
  completed: "確定",
  amended: "修正済み",
};

export function DpcForm1ExportPage() {
  // 提出は退院の翌月に行うので、前月を既定にする。
  const [month, setMonth] = useState(() => addMonths(today(), -1).slice(0, 7));
  const summary = useDpcForm1ExportSummary(month);
  const data = summary.data;

  return (
    <div className="page">
      <div className="page__header">
        <h1>DPC様式1</h1>
        <div className="page__header-actions">
          {data?.filename ? (
            <a href={dpcForm1FileUrl(month)} download={data.filename}>
              ダウンロード
            </a>
          ) : (
            <button type="button" disabled>
              ダウンロード
            </button>
          )}
        </div>
      </div>

      <div className="master-search__form master-search__form--row">
        <label>
          退院月
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </label>
        <button type="button" onClick={() => summary.refetch()} disabled={summary.isFetching}>
          再読込
        </button>
      </div>

      <ErrorBanner error={summary.error} />

      {data && (
        <p className="master-search__count">
          退院 {data.encounters.length} 件 / 出力 {data.exported_count} 件 / 未作成・下書き{" "}
          {data.excluded_count} 件{data.filename ? ` / ${data.filename}` : ""}
        </p>
      )}

      {data && data.warnings.length > 0 && (
        <div className="error-banner" role="alert">
          {data.warnings.map((warning, index) => (
            <p key={index} className="error-banner__line">
              {[warning.patient_display, warning.code, warning.message].filter(Boolean).join(" ")}
            </p>
          ))}
        </div>
      )}

      {summary.isPending ? (
        <p>読み込み中...</p>
      ) : (
        <table className="patient-table">
          <thead>
            <tr>
              <th>患者氏名</th>
              <th>入院日</th>
              <th>退院日</th>
              <th>様式1</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(data?.encounters ?? []).map((row) => (
              <tr key={row.encounter_id}>
                <td>{row.patient_display ?? "-"}</td>
                <td>{row.admit_date ?? "-"}</td>
                <td>{row.discharge_date ?? "-"}</td>
                <td>{STATUS_LABELS[row.form1_status] ?? row.form1_status}</td>
                <td className="patient-table__actions">
                  {/* カルテの右ペインを、この入院の様式1 で開く。 */}
                  <Link
                    to={`/patients/${row.patient_id}/karte?${KARTE_OPEN_PARAM}=${encodeURIComponent(
                      formatKarteOpen({ kind: "dpc-form1", encounterId: row.encounter_id }),
                    )}`}
                  >
                    様式1を開く
                  </Link>
                </td>
              </tr>
            ))}
            {data && data.encounters.length === 0 && (
              <tr>
                <td colSpan={5} className="patient-table__empty">
                  この月に退院した入院はありません。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
