import { useLabInfectionResults, useManualInfections } from "../api/queries";
import { HAS_LAB_MAPPED_TYPES, summarizeInfections } from "../fhir/infectionHelpers";
import { ErrorBanner } from "./ErrorBanner";

/**
 * プロファイルタブの「感染症」区画。
 *
 * 検体検査の結果と手入力の 2 経路をまとめて 1 種類 1 行で出す。検査結果は
 * JLAC11 の分析物コードで拾い、手入力はここで足す。
 * 同じ種類が両方にあれば検査結果を優先する(検査で出た値が正)。
 */
export function PatientInfectionSection({
  patientId,
  onAdd,
  onEdit,
}: {
  patientId: string;
  onAdd: () => void;
  onEdit: (observationId: string) => void;
}) {
  const manual = useManualInfections(patientId);
  // 検査結果から拾える種類が 1 つも無いときは検体検査を引かない。
  const lab = useLabInfectionResults(patientId, HAS_LAB_MAPPED_TYPES);

  const rows = summarizeInfections(manual.observations, lab.observations);

  return (
    <section className="karte-profile__section">
      <div className="karte-tabpanel__header">
        <h3>感染症</h3>
        <div className="karte-tabpanel__actions">
          <button type="button" onClick={onAdd}>
            手入力で追加
          </button>
        </div>
      </div>

      <ErrorBanner error={manual.error ?? lab.error} />

      {manual.isLoading ? (
        <p>読み込み中...</p>
      ) : rows.length === 0 ? (
        <p className="patient-table__empty">感染症の登録がありません。</p>
      ) : (
        <table className="patient-table">
          <thead>
            <tr>
              <th>種類</th>
              <th className="rad-code__compact">結果</th>
              <th className="rad-code__compact">確認日</th>
              <th className="rad-code__compact">情報源</th>
              <th>備考</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.type}>
                <td>{row.typeLabel}</td>
                <td className="rad-code__compact">
                  <span className={resultClass(row.result)}>{row.resultLabel || "-"}</span>
                </td>
                <td className="rad-code__compact">{row.effectiveDate || "-"}</td>
                <td className="rad-code__compact">{row.sourceLabel || "-"}</td>
                <td>{row.note || "-"}</td>
                <td className="patient-table__actions">
                  {/* 検査結果由来の行はここでは直せない(正本は検査結果)。 */}
                  {!row.fromLab && (
                    <button type="button" onClick={() => onEdit(row.observationId)}>
                      編集
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// 陽性は赤、判定不明は「見に行かせる」ための橙。陰性は素のまま。
function resultClass(result: string): string {
  if (result === "positive") return "infection__result--positive";
  if (result === "undetermined") return "infection__result--undetermined";
  return "";
}
