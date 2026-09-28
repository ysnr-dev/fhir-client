import { useMemo, useState } from "react";
import type { FormularyEntry, FormularyGroup } from "../api/masterClient";
import { useFormularyGroups } from "../api/masterQueries";
import { dosageFormLabel } from "../fhir/medicineHelpers";
import { ErrorBanner } from "./ErrorBanner";

// 院内フォーミュラリから選ぶモード(docs/formulary-design.md)。医薬品の検索モーダルに足す。
// 薬効群ごとに見出しを置き、その下に推奨順位の順で薬剤を並べる。
// モーダルは全件検索から始まり、フォーミュラリから選びたいときに切り替える。

export interface FormularyPickProps {
  /** 群の剤形での絞り込み(注射オーダーは "4")。指定しなければ全剤形の群。 */
  dosageForm?: string;
}

/** 群名・薬剤名・一般名のどれかにクエリが含まれる群だけ残す(群が当たれば薬剤は全部出す)。 */
function filterGroups(groups: FormularyGroup[], query: string): FormularyGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return groups;
  return groups.flatMap((group) => {
    if (group.name.toLowerCase().includes(q) || group.code.toLowerCase().includes(q)) return [group];
    const entries = group.entries.filter(
      (e) =>
        (e.medicine_name ?? "").toLowerCase().includes(q) ||
        (e.generic_name ?? "").toLowerCase().includes(q),
    );
    return entries.length > 0 ? [{ ...group, entries }] : [];
  });
}

export function FormularyPickTable({
  dosageForm,
  onSelect,
  selecting,
}: FormularyPickProps & {
  onSelect: (entry: FormularyEntry) => void;
  /** 選択後に医薬品マスタを引いている間。二重に選ばせない。 */
  selecting?: boolean;
}) {
  const groups = useFormularyGroups(dosageForm);
  const [query, setQuery] = useState("");
  const visible = useMemo(() => filterGroups(groups.data ?? [], query), [groups.data, query]);

  return (
    <>
      <div className="master-search__form">
        <label>
          薬効群・医薬品名
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="群名・薬剤名で絞り込み"
          />
        </label>
      </div>
      <ErrorBanner error={groups.error} />
      <div className="master-search__table-wrap">
        <table className="master-search__table formulary-pick">
          <thead>
            <tr>
              <th className="rad-item__compact">順位</th>
              <th>名称</th>
              <th>単位</th>
              <th>剤形</th>
              <th>推奨理由・使い分け</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((group) => (
              <GroupRows key={group.id} group={group} onSelect={onSelect} selecting={selecting} />
            ))}
            {groups.data && visible.length === 0 && (
              <tr>
                <td colSpan={6} className="master-search__empty">
                  {groups.data.length === 0
                    ? "フォーミュラリの登録がありません"
                    : "該当する薬効群・医薬品がありません"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function GroupRows({
  group,
  onSelect,
  selecting,
}: {
  group: FormularyGroup;
  onSelect: (entry: FormularyEntry) => void;
  selecting?: boolean;
}) {
  return (
    <>
      <tr className="formulary-pick__group">
        <th colSpan={6}>
          {group.name}
          <span className="lab-order-item__code">{group.code}</span>
          {group.note && <span className="formulary-pick__group-note">{group.note}</span>}
        </th>
      </tr>
      {group.entries.map((entry) => (
        <tr key={entry.id}>
          <td className="rad-item__compact">
            <span className="medicine-caution formulary-mark">第{entry.rank}選択</span>
          </td>
          <td>
            {entry.medicine_name ?? `(マスタに無いコード ${entry.medicine_code})`}
            {entry.generic_name && (
              <span className="lab-order-item__code">{entry.generic_name}</span>
            )}
          </td>
          <td>{entry.medicine_unit_name}</td>
          <td>{dosageFormLabel(entry.medicine_dosage_form)}</td>
          <td className="formulary-pick__note">{entry.note}</td>
          <td className="master-search__actions">
            {entry.yj_code && (
              <a
                className="master-search__medley-link"
                href={`https://medley.life/medicines/prescription/${entry.yj_code}/`}
                target="_blank"
                rel="noopener noreferrer"
              >
                DI
              </a>
            )}
            <button
              type="button"
              onClick={() => onSelect(entry)}
              disabled={selecting || !entry.medicine_name}
            >
              選択
            </button>
          </td>
        </tr>
      ))}
      {group.entries.length === 0 && (
        <tr>
          <td colSpan={6} className="master-search__empty">
            この群に薬剤が登録されていません
          </td>
        </tr>
      )}
    </>
  );
}
