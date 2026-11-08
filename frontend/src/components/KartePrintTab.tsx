import { useState } from "react";
import { addMonths, today } from "../lib/dates";
import { ALL_KARTE_PRINT_SECTIONS, KARTE_PRINT_SECTIONS, kartePrintUrl, type KartePrintSection } from "../karteUrl";

// カルテ印刷。期間・束ねる区画・履歴の有無を選び、別タブで開いて印刷する
// (印刷用のページは pages/KartePrintPage)。

export function KartePrintTab({ patientId }: { patientId: string }) {
  const [to, setTo] = useState(today);
  const [from, setFrom] = useState(() => addMonths(today(), -1));
  const [sections, setSections] = useState<KartePrintSection[]>(ALL_KARTE_PRINT_SECTIONS);
  const [withHistory, setWithHistory] = useState(false);
  const withProgress = sections.includes("progress");
  const valid = Boolean(from && to && from <= to && sections.length > 0);

  function toggleSection(key: KartePrintSection, checked: boolean) {
    setSections((current) =>
      ALL_KARTE_PRINT_SECTIONS.filter((section) => (section === key ? checked : current.includes(section))),
    );
  }

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
        {KARTE_PRINT_SECTIONS.map((section) => (
          <label key={section.key} className="karte-print-form__check">
            <input
              type="checkbox"
              checked={sections.includes(section.key)}
              onChange={(e) => toggleSection(section.key, e.target.checked)}
            />
            {section.label}
          </label>
        ))}
        <label className="karte-print-form__check">
          <input
            type="checkbox"
            checked={withProgress && withHistory}
            disabled={!withProgress}
            onChange={(e) => setWithHistory(e.target.checked)}
          />
          履歴を印刷
        </label>
        <button
          type="button"
          disabled={!valid}
          onClick={() =>
            window.open(
              kartePrintUrl(patientId, { from, to, sections, history: withProgress && withHistory }),
              "_blank",
            )
          }
        >
          印刷
        </button>
      </div>
    </div>
  );
}
