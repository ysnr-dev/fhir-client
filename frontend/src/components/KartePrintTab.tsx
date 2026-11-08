import { useState, type CSSProperties } from "react";
import { addMonths, today } from "../lib/dates";
import { ALL_KARTE_PRINT_SECTIONS, KARTE_PRINT_SECTIONS, kartePrintUrl, type KartePrintSection } from "../karteUrl";

// カルテ印刷。期間・束ねる区画・履歴の有無を選び、別タブで開いて印刷する
// (印刷用のページは pages/KartePrintPage)。区画は群ごとに縦に並べ、群の見出しで群ごと切り替える。
// 「履歴を印刷」は経過記録にだけ効くので、経過記録の行の括弧の中に置く。

const SECTION_GROUPS: { label: string; keys: KartePrintSection[] }[] = [
  { label: "診療録", keys: ["cover", "conditions", "summaries", "progress"] },
  { label: "看護", keys: ["nursingOrders", "nursing", "flowsheet"] },
  { label: "検査", keys: ["labs", "reports"] },
];

const SECTION_LABELS = new Map<KartePrintSection, string>(
  KARTE_PRINT_SECTIONS.map((section) => [section.key, section.label]),
);

export function KartePrintTab({ patientId }: { patientId: string }) {
  const [to, setTo] = useState(today);
  const [from, setFrom] = useState(() => addMonths(today(), -1));
  const [sections, setSections] = useState<KartePrintSection[]>(ALL_KARTE_PRINT_SECTIONS);
  const [withHistory, setWithHistory] = useState(false);
  const withProgress = sections.includes("progress");
  const valid = Boolean(from && to && from <= to && sections.length > 0);

  // 定義の順にそろえて持つ(URL と紙面の並びは定義の順)。
  function toggle(keys: KartePrintSection[], checked: boolean) {
    setSections((current) =>
      ALL_KARTE_PRINT_SECTIONS.filter((key) => (keys.includes(key) ? checked : current.includes(key))),
    );
  }

  return (
    <div className="karte-tabpanel">
      <div className="karte-tabpanel__header">
        <h3>カルテ印刷</h3>
      </div>
      <div className="karte-print-form">
        <div className="karte-print-form__dates">
          <label>
            開始日
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            終了日
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
        <div
          className="karte-print-form__sections"
          style={{ "--karte-print-groups": SECTION_GROUPS.length } as CSSProperties}
        >
          {SECTION_GROUPS.map((group) => {
            const count = group.keys.filter((key) => sections.includes(key)).length;
            return (
              <div key={group.label} className="karte-print-form__group" role="group" aria-label={group.label}>
                <label className="karte-print-form__check karte-print-form__group-title">
                  <input
                    type="checkbox"
                    checked={count === group.keys.length}
                    ref={(input) => {
                      if (input) input.indeterminate = count > 0 && count < group.keys.length;
                    }}
                    onChange={(e) => toggle(group.keys, e.target.checked)}
                  />
                  {group.label}
                </label>
                {group.keys.map((key) => (
                  <div key={key} className="karte-print-form__item">
                    <label className="karte-print-form__check">
                      <input
                        type="checkbox"
                        checked={sections.includes(key)}
                        onChange={(e) => toggle([key], e.target.checked)}
                      />
                      {SECTION_LABELS.get(key)}
                    </label>
                    {key === "progress" && (
                      <span className="karte-print-form__sub">
                        （
                        <label className="karte-print-form__check">
                          <input
                            type="checkbox"
                            checked={withProgress && withHistory}
                            disabled={!withProgress}
                            onChange={(e) => setWithHistory(e.target.checked)}
                          />
                          履歴を印刷
                        </label>
                        ）
                      </span>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
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
