import type { RegimenDetail } from "../api/masterClient";
import type { BodyChange, LabCheckSummary, LabCriterionCheck } from "../fhir/regimenCheckHelpers";
import { LAB_RESULT_STALE_DAYS } from "../fhir/regimenCheckHelpers";
import {
  CTCAE_GRADE_OPTIONS,
  REGIMEN_EMETIC_RISK_OPTIONS,
  REGIMEN_LAB_CATEGORY_OPTIONS,
  REGIMEN_PURPOSE_OPTIONS,
  displayOfOption,
} from "../fhir/regimenHelpers";

// 適用フォーム・次クール登録フォームの上に出す「読むための面」。レジメンマスタが
// 持っている適応基準・中止基準・副作用は、これまでマスタ編集画面でしか読めなかった。
// 投与量を決める前に医師が見るものなので、オーダーを作る画面に持ってくる。
// 設計は docs/chemo-regimen-design.md §7.6 A。

/** 投与前チェック(適応基準 × 直近の検査結果)。基準外でも登録は止めない。 */
export function RegimenLabCheck({
  checks,
  summary,
}: {
  checks: LabCriterionCheck[];
  summary: LabCheckSummary;
}) {
  if (checks.length === 0) return null;

  const notes = [
    summary.out > 0 ? `基準外 ${summary.out} 件` : "",
    summary.missing > 0 ? `値なし ${summary.missing} 件` : "",
    summary.stale > 0 ? `${LAB_RESULT_STALE_DAYS} 日より前の結果 ${summary.stale} 件` : "",
  ].filter(Boolean);

  return (
    <fieldset className="regimen-apply__fields">
      <legend>投与前チェック</legend>
      {notes.length > 0 && (
        <p className={`regimen-check__summary${summary.out > 0 ? " regimen-check__summary--out" : ""}`}>
          {notes.join(" · ")}
        </p>
      )}
      <table className="master-search__table regimen-check__table">
        <thead>
          <tr>
            <th>項目</th>
            <th>基準</th>
            <th>直近値</th>
            <th>採取日</th>
            <th>判定</th>
          </tr>
        </thead>
        <tbody>
          {checks.map((check) => (
            <tr key={check.criterion.id}>
              <td>
                {check.criterion.item_name}
                <span className="lab-order-item__code">
                  {displayOfOption(REGIMEN_LAB_CATEGORY_OPTIONS, check.criterion.category)}
                </span>
              </td>
              <td>{check.range}</td>
              <td>
                {check.value !== null ? (
                  <>
                    {check.value}
                    {check.unit && ` ${check.unit}`}
                    {check.derived && <span className="lab-order-item__code">計算値</span>}
                  </>
                ) : (
                  "—"
                )}
              </td>
              <td>
                {check.date || "—"}
                {check.stale && <span className="regimen-check__stale">古い</span>}
              </td>
              <td>
                {check.status === "out" && <span className="regimen-check__verdict--out">基準外</span>}
                {check.status === "ok" && <span className="regimen-check__verdict--ok">適合</span>}
                {check.status === "unknown" && (
                  <span className="regimen-check__verdict--unknown">{check.note || "—"}</span>
                )}
                {check.status !== "unknown" && check.note && (
                  <span className="regimen-check__note">{check.note}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </fieldset>
  );
}

/** レジメンマスタの臨床情報(制吐リスク・適応疾患・中止/減量基準・副作用・参考文献)。 */
export function RegimenInfoView({ regimen }: { regimen: RegimenDetail }) {
  const rows: { label: string; value: React.ReactNode }[] = [];

  const head = [
    displayOfOption(REGIMEN_PURPOSE_OPTIONS, regimen.purpose),
    regimen.emetic_risk ? `制吐リスク ${displayOfOption(REGIMEN_EMETIC_RISK_OPTIONS, regimen.emetic_risk)}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  if (head) rows.push({ label: "分類", value: head });

  if (regimen.indications.length > 0) {
    rows.push({
      label: "適応疾患",
      value: regimen.indications
        .map((i) => (i.icd10 ? `${i.name}（${i.icd10}）` : i.name))
        .join(" / "),
    });
  }
  if (regimen.indication_note) rows.push({ label: "適応の補足", value: regimen.indication_note });
  if (regimen.discontinuation_criteria) {
    rows.push({ label: "中止基準", value: regimen.discontinuation_criteria });
  }
  if (regimen.dose_reduction_criteria) {
    rows.push({ label: "減量基準", value: regimen.dose_reduction_criteria });
  }
  if (regimen.adverse_events.length > 0) {
    rows.push({
      label: "想定される副作用",
      value: (
        <ul className="regimen-info__list">
          {regimen.adverse_events.map((ae) => (
            <li key={ae.id}>
              {ae.term}
              {ae.grade !== null && CTCAE_GRADE_OPTIONS.includes(String(ae.grade)) && (
                <span className="lab-order-item__code">Grade {ae.grade}</span>
              )}
              {ae.note && <span className="regimen-info__note">{ae.note}</span>}
            </li>
          ))}
        </ul>
      ),
    });
  }
  if (regimen.references_note) rows.push({ label: "参考文献", value: regimen.references_note });

  if (rows.length === 0) return null;

  return (
    <fieldset className="regimen-apply__fields">
      <legend>レジメンの情報</legend>
      <dl className="regimen-info">
        {rows.map((row) => (
          <div key={row.label} className="regimen-info__row">
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </fieldset>
  );
}

/** 次クール登録で前回の体格と比べる(体重が動いていれば投与量を見直す)。 */
export function RegimenBodyChange({
  previous,
  change,
}: {
  previous: { height: number | null; weight: number | null; bsa: number | null };
  change: BodyChange | null;
}) {
  const label = [
    previous.height !== null ? `身長 ${previous.height} cm` : "",
    previous.weight !== null ? `体重 ${previous.weight} kg` : "",
    previous.bsa !== null ? `体表面積 ${previous.bsa} m²` : "",
  ]
    .filter(Boolean)
    .join(" / ");
  if (!label) return null;

  return (
    <div className="regimen-editor__derived">
      前回の体格
      <strong>{label}</strong>
      {change && change.deltaKg !== 0 && (
        <span className={change.warn ? "regimen-check__verdict--out" : "regimen-check__note"}>
          {change.deltaKg > 0 ? "+" : ""}
          {change.deltaKg} kg（{Math.round(change.ratio * 1000) / 10}%）
        </span>
      )}
    </div>
  );
}
