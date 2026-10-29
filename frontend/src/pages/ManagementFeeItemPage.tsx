import { useState, type FormEvent } from "react";
import type { ManagementFeeAddition, ManagementFeeItem, MedicalProcedure } from "../api/masterClient";
import { useManagementFeeItemMutations, useManagementFeeItems } from "../api/masterQueries";
import { ErrorBanner } from "../components/ErrorBanner";
import { MasterBackLink } from "../components/MasterBackLink";
import { MedicalProcedureSearchModal } from "../components/MedicalProcedureSearchModal";
import { Modal } from "../components/Modal";
import { TrashIcon } from "../components/icons/TrashIcon";
import { formatPoints } from "../fhir/medicalManagementOrderHelpers";

// 指導・管理料の項目マスタ(docs/medical-management-order-design.md §2)。
// 診療行為マスタの B 章(医学管理等)・C 章(在宅)から、施設が算定するものだけを登録する。
// 加算はカルテのフォームで項目の下に候補として出す。
export function ManagementFeeItemPage() {
  const [editing, setEditing] = useState<ManagementFeeItem | "new" | null>(null);
  const list = useManagementFeeItems();

  return (
    <div className="page">
      <div className="page__header">
        <h1>指導・管理料項目</h1>
        <div className="page__header-actions">
          <button type="button" onClick={() => setEditing("new")}>
            追加
          </button>
          <MasterBackLink />
        </div>
      </div>

      <ErrorBanner error={list.error} />

      <table className="master-search__table">
        <thead>
          <tr>
            <th>名称</th>
            <th className="rad-code__compact">レセ電算コード</th>
            <th className="rad-code__compact">点数</th>
            <th>加算</th>
            <th className="rad-code__compact">入外</th>
            <th className="rad-code__compact">月上限</th>
            <th className="rad-code__compact">表示順</th>
            <th className="rad-code__compact">有効</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.items.map((item) => (
            <tr key={item.id} className="master-search__row" onClick={() => setEditing(item)}>
              <td>{item.name}</td>
              <td className="rad-code__compact">{item.receipt_code}</td>
              <td className="rad-code__compact">{formatPoints(item.receipt_points)}</td>
              <td>{(item.additions ?? []).map((a) => a.name ?? a.code).join("、")}</td>
              <td className="rad-code__compact">{settingLabel(item)}</td>
              <td className="rad-code__compact">{item.monthly_limit ?? ""}</td>
              <td className="rad-code__compact">{item.display_order ?? ""}</td>
              <td className="rad-code__compact">{item.active ? "○" : ""}</td>
            </tr>
          ))}
          {list.data && list.data.items.length === 0 && (
            <tr>
              <td colSpan={8} className="master-search__empty">
                項目がありません。
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {editing !== null && (
        <ItemEditModal item={editing === "new" ? null : editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function settingLabel(item: ManagementFeeItem): string {
  if (item.inpatient && item.outpatient) return "入外";
  return item.inpatient ? "入院" : "外来";
}

/** 診療行為マスタの上限(「0」は上限なし)を項目の月上限の初期値にする。 */
function limitOf(procedure: MedicalProcedure): string {
  const times = Number(procedure.max_times ?? "0");
  return times > 0 ? String(times) : "";
}

interface ItemEditModalProps {
  // null は新規作成。
  item: ManagementFeeItem | null;
  onClose: () => void;
}

function ItemEditModal({ item, onClose }: ItemEditModalProps) {
  const mutations = useManagementFeeItemMutations();
  const [draft, setDraft] = useState({
    name: item?.name ?? "",
    nameKana: item?.name_kana ?? "",
    receiptCode: item?.receipt_code ?? "",
    receiptName: item?.receipt_procedure_name ?? "",
    additions: item?.additions ?? ([] as ManagementFeeAddition[]),
    inpatient: item?.inpatient ?? true,
    outpatient: item?.outpatient ?? true,
    monthlyLimit: item?.monthly_limit != null ? String(item.monthly_limit) : "",
    displayOrder: item?.display_order != null ? String(item.display_order) : "",
    active: item?.active ?? true,
  });
  // 手技の検索モーダルの用途。項目本体のコードか、加算の追加か。
  const [searching, setSearching] = useState<"receipt" | "addition" | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  function handleSelect(procedure: MedicalProcedure) {
    const name = procedure.name ?? procedure.procedure_code;
    if (searching === "receipt") {
      setDraft((d) => ({
        ...d,
        receiptCode: procedure.procedure_code,
        receiptName: name,
        name: d.name || name,
        nameKana: d.nameKana || (procedure.name_kana ?? ""),
        monthlyLimit: d.monthlyLimit || limitOf(procedure),
      }));
    } else if (!draft.additions.some((a) => a.code === procedure.procedure_code)) {
      setDraft((d) => ({
        ...d,
        additions: [...d.additions, { code: procedure.procedure_code, name, points: procedure.points }],
      }));
    }
    setSearching(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!draft.name.trim()) return;
    if (!draft.receiptCode) {
      setValidationError("レセ電算コードを選択してください。");
      return;
    }
    if (!draft.inpatient && !draft.outpatient) {
      setValidationError("入院・外来のどちらかを選択してください。");
      return;
    }
    setValidationError(null);

    const payload = {
      name: draft.name.trim(),
      name_kana: draft.nameKana.trim() || null,
      receipt_code: draft.receiptCode,
      addition_codes: draft.additions.map((a) => a.code),
      inpatient: draft.inpatient,
      outpatient: draft.outpatient,
      monthly_limit: draft.monthlyLimit ? Number(draft.monthlyLimit) : null,
      display_order: draft.displayOrder ? Number(draft.displayOrder) : null,
      active: draft.active,
    };
    if (item === null) {
      await mutations.create.mutateAsync(payload);
    } else {
      await mutations.update.mutateAsync({ id: item.id, payload });
    }
    onClose();
  }

  async function handleDelete() {
    if (item === null) return;
    if (!window.confirm(`${item.name} を削除しますか？`)) return;

    await mutations.remove.mutateAsync(item.id);
    onClose();
  }

  return (
    <Modal title={item === null ? "項目を追加" : "項目を編集"} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {validationError && (
          <div className="error-banner" role="alert">
            <p className="error-banner__line error-banner__line--error">{validationError}</p>
          </div>
        )}
        <div className="lab-order-item__fields">
          <div className="management-fee-item__receipt">
            <span>レセ電算コード</span>
            <div className="management-fee-item__receipt-body">
              {draft.receiptCode ? (
                <span>
                  {draft.receiptCode} {draft.receiptName}
                </span>
              ) : (
                <span className="order-select__muted">未選択</span>
              )}
              <button type="button" onClick={() => setSearching("receipt")}>
                選択
              </button>
            </div>
          </div>
          <label>
            名称
            <input
              type="text"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              required
            />
          </label>
          <label>
            カナ
            <input
              type="text"
              value={draft.nameKana}
              onChange={(e) => setDraft({ ...draft, nameKana: e.target.value })}
            />
          </label>
          <div className="management-fee-item__additions">
            <span>加算</span>
            <ul>
              {draft.additions.map((addition) => (
                <li key={addition.code}>
                  <span>
                    {addition.code} {addition.name ?? ""}
                  </span>
                  <button
                    type="button"
                    className="rp-card__icon-button"
                    title={`${addition.name ?? addition.code}を削除`}
                    aria-label={`${addition.name ?? addition.code}を削除`}
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        additions: d.additions.filter((a) => a.code !== addition.code),
                      }))
                    }
                  >
                    <TrashIcon />
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="rp-card__compact-button"
              onClick={() => setSearching("addition")}
            >
              追加
            </button>
          </div>
          <label className="management-fee-item__check">
            <input
              type="checkbox"
              checked={draft.outpatient}
              onChange={(e) => setDraft({ ...draft, outpatient: e.target.checked })}
            />
            外来
          </label>
          <label className="management-fee-item__check">
            <input
              type="checkbox"
              checked={draft.inpatient}
              onChange={(e) => setDraft({ ...draft, inpatient: e.target.checked })}
            />
            入院
          </label>
          <label>
            月の上限回数
            <input
              type="number"
              min={1}
              value={draft.monthlyLimit}
              onChange={(e) => setDraft({ ...draft, monthlyLimit: e.target.value })}
            />
          </label>
          <label>
            表示順
            <input
              type="number"
              value={draft.displayOrder}
              onChange={(e) => setDraft({ ...draft, displayOrder: e.target.value })}
            />
          </label>
          <label className="management-fee-item__check">
            <input
              type="checkbox"
              checked={draft.active}
              onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
            />
            有効
          </label>
        </div>

        <ErrorBanner
          error={mutations.create.error ?? mutations.update.error ?? mutations.remove.error}
        />

        <div className="lab-order-item__actions">
          <button type="submit" disabled={mutations.create.isPending || mutations.update.isPending}>
            保存
          </button>
          {item !== null && (
            <button type="button" onClick={handleDelete} disabled={mutations.remove.isPending}>
              削除
            </button>
          )}
        </div>
      </form>

      {/* 検索モーダルは自前の form を持つので、外側の form の外に置く。 */}
      {searching && (
        <MedicalProcedureSearchModal
          defaultSection="B"
          onSelect={handleSelect}
          onClose={() => setSearching(null)}
        />
      )}
    </Modal>
  );
}
