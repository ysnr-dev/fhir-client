import type { PatientCaution } from "../api/masterClient";
import { FLAG_CATEGORY_OPTIONS, summarizeFlag } from "../fhir/flagHelpers";
import { CautionPictogram } from "./icons/cautionPictograms";

interface FlagTableProps {
  flags: fhir4.Flag[];
  cautionsByCode: Map<string, PatientCaution>;
  /** 表示・編集はページ遷移せずカルテ画面の中で行う。 */
  onView: (flagId: string) => void;
  onEdit: (flagId: string) => void;
}

// 区分の並び順(安全 → 臨床 → 意思 → 事務)。マスタの display_order は区分内の順。
const CATEGORY_ORDER = FLAG_CATEGORY_OPTIONS.map((o) => o.code);

export function FlagTable({ flags, cautionsByCode, onView, onEdit }: FlagTableProps) {
  if (flags.length === 0) {
    return <p className="patient-table__empty">登録されている注意がありません。</p>;
  }

  const rows = flags
    .map((flag) => summarizeFlag(flag, cautionsByCode))
    .sort((a, b) => {
      const byCategory =
        CATEGORY_ORDER.indexOf(a.category as never) - CATEGORY_ORDER.indexOf(b.category as never);
      if (byCategory !== 0) return byCategory;
      const orderA = cautionsByCode.get(a.cautionCode)?.display_order ?? Number.MAX_SAFE_INTEGER;
      const orderB = cautionsByCode.get(b.cautionCode)?.display_order ?? Number.MAX_SAFE_INTEGER;
      return orderA - orderB;
    });

  return (
    <table className="patient-table">
      <thead>
        <tr>
          <th className="rad-code__compact"></th>
          <th>注意</th>
          <th>内容</th>
          <th className="rad-code__compact">区分</th>
          <th className="rad-code__compact">期間</th>
          <th className="rad-code__compact">状態</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <td className="rad-code__compact">
              {row.pictogram && (
                <span className={`flag-table__pictogram flag-table__pictogram--${row.category}`}>
                  <CautionPictogram pictogram={row.pictogram} />
                </span>
              )}
            </td>
            <td>{row.name}</td>
            <td>{row.text || "-"}</td>
            <td className="rad-code__compact">{row.categoryLabel || "-"}</td>
            <td className="rad-code__compact">
              {row.periodStart || row.periodEnd
                ? `${row.periodStart || ""} 〜 ${row.periodEnd || ""}`
                : "-"}
            </td>
            <td className="rad-code__compact">{row.statusLabel || "-"}</td>
            <td className="patient-table__actions">
              <button type="button" onClick={() => onView(row.id)}>
                表示
              </button>
              <button type="button" onClick={() => onEdit(row.id)}>
                編集
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
