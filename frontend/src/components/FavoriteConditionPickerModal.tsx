import { useMemo, useState } from "react";
import type { FavoriteCondition } from "../api/masterClient";
import { useFavoriteConditions } from "../api/masterQueries";
import type { FavoriteConditionBody } from "../fhir/conditionHelpers";
import { useDefinitionOwners } from "../hooks/useDefinitionOwners";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

interface FavoriteConditionPickerModalProps {
  onSelect: (body: FavoriteConditionBody) => void;
  onClose: () => void;
}

/** 持ち主の表示(院内共通 / 科名 / 自分)。 */
function favoriteConditionOwnerLabel(item: FavoriteCondition): string {
  if (item.scope === "facility") return "院内共通";
  if (item.scope === "department") return item.owner_name ?? "診療科";
  return "自分";
}

// 頻用病名(院内共通・診療科・自分)をまとめて並べ、1 つ選ぶ。件数が少ない前提で絞り込みは手元で行う。
export function FavoriteConditionPickerModal({ onSelect, onClose }: FavoriteConditionPickerModalProps) {
  const { ready, departmentId, practitionerId } = useDefinitionOwners("自分の頻用病名");
  const list = useFavoriteConditions(departmentId, practitionerId, ready);
  const [filter, setFilter] = useState("");

  const items = useMemo(() => {
    const all = list.data?.items ?? [];
    const needle = filter.trim();
    return needle ? all.filter((item) => item.name.includes(needle)) : all;
  }, [list.data, filter]);

  return (
    <Modal title="頻用病名を選択" onClose={onClose} className="modal--wide">
      <div className="master-search__form">
        <label>
          病名
          <input type="text" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="部分一致で絞り込み" />
        </label>
      </div>
      <ErrorBanner error={list.error} />
      <div className="master-search__table-wrap">
        <table className="master-search__table">
          <thead>
            <tr>
              <th>病名</th>
              <th>ICD10</th>
              <th>持ち主</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.name}</td>
                <td>{item.definition.disease.icd10_2013}</td>
                <td>{favoriteConditionOwnerLabel(item)}</td>
                <td className="master-search__actions">
                  <button type="button" onClick={() => onSelect(item.definition)}>
                    選択
                  </button>
                </td>
              </tr>
            ))}
            {list.data && items.length === 0 && (
              <tr>
                <td colSpan={4} className="master-search__empty">
                  頻用病名がありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
