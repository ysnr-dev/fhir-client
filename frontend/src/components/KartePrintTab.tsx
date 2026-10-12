import { useState } from "react";
import { addMonths, today } from "../lib/dates";
import { kartePrintUrl } from "../karteUrl";

// カルテ印刷。期間と履歴の有無を選び、2 号用紙を別タブで開いて印刷する
// (印刷用のページは pages/KartePrintPage)。

export function KartePrintTab({ patientId }: { patientId: string }) {
  const [to, setTo] = useState(today);
  const [from, setFrom] = useState(() => addMonths(today(), -1));
  const [withHistory, setWithHistory] = useState(false);
  const valid = Boolean(from && to && from <= to);

  return (
    <div className="karte-tabpanel">
      <div className="karte-tabpanel__header">
        <h3>カルテ印刷</h3>
      </div>
      <div className="karte-print-form">
        <label>
          開始日
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          終了日
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className="karte-print-form__check">
          <input type="checkbox" checked={withHistory} onChange={(e) => setWithHistory(e.target.checked)} />
          履歴を印刷
        </label>
        <button
          type="button"
          disabled={!valid}
          onClick={() => window.open(kartePrintUrl(patientId, from, to, withHistory), "_blank")}
        >
          印刷
        </button>
      </div>
    </div>
  );
}
