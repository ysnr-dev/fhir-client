import { useState, type FormEvent } from "react";
import type { BloodPurifier, BloodPurifierPayload, MedicalMaterial } from "../api/masterClient";
import {
  useBloodPurifier,
  useBloodPurifierMutations,
  useBloodPurifierSearch,
  type BloodPurifierFilters,
} from "../api/masterQueries";
import { ErrorBanner } from "../components/ErrorBanner";
import { MasterBackLink } from "../components/MasterBackLink";
import { MedicalMaterialSearchModal } from "../components/MedicalMaterialSearchModal";
import { Modal } from "../components/Modal";
import {
  BLOOD_PURIFIER_KIND_OPTIONS,
  bloodPurifierKindDisplay,
  bloodPurifierMembraneLabel,
} from "../fhir/bloodPurifierHelpers";

// 血液浄化器の施設マスタ。
//
// レセプト電算の特定器材マスタは「ダイアライザー(Ia型)」のような機能区分で収載されており、
// 製品・膜素材・膜面積を持たない。透析の指示では製品を選ぶので、採用している製品をここに登録し、
// 算定に使う特定器材コードを紐付ける(製品 N 件 : 特定器材コード 1 件)。

const MEMBRANE_MATERIALS = ["PS", "PES", "PEPA", "PMMA", "EVOH", "CTA", "PAN"];

// 編集フォームの値。input で扱うため全て文字列で持ち、保存時に payload へ変換する。
interface Draft {
  kind: string;
  name: string;
  name_kana: string;
  maker: string;
  model_number: string;
  membrane_material: string;
  membrane_area: string;
  receipt_material_code: string;
  valid_from: string;
  valid_to: string;
  display_order: string;
  note: string;
}

const emptyDraft: Draft = {
  kind: BLOOD_PURIFIER_KIND_OPTIONS[0].code,
  name: "",
  name_kana: "",
  maker: "",
  model_number: "",
  membrane_material: "",
  membrane_area: "",
  receipt_material_code: "",
  valid_from: "",
  valid_to: "",
  display_order: "",
  note: "",
};

function toPayload(draft: Draft): BloodPurifierPayload {
  return {
    kind: draft.kind,
    name: draft.name,
    name_kana: draft.name_kana || null,
    maker: draft.maker || null,
    model_number: draft.model_number || null,
    membrane_material: draft.membrane_material || null,
    membrane_area: draft.membrane_area || null,
    receipt_material_code: draft.receipt_material_code || null,
    valid_from: draft.valid_from || null,
    valid_to: draft.valid_to || null,
    display_order: draft.display_order ? Number(draft.display_order) : null,
    note: draft.note || null,
  };
}

export function BloodPurifierPage() {
  const [inputs, setInputs] = useState<BloodPurifierFilters>({});
  const [filters, setFilters] = useState<BloodPurifierFilters>({});
  const [page, setPage] = useState(1);
  // 編集対象の id。"new" は新規作成モーダル。
  const [editing, setEditing] = useState<number | "new" | null>(null);

  const list = useBloodPurifierSearch(filters, page);
  const hasNext = list.data ? page * list.data.per < list.data.total : false;

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    setFilters(inputs);
    setPage(1);
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>血液浄化器マスタ</h1>
        <div>
          <button type="button" onClick={() => setEditing("new")}>
            追加
          </button>
          <MasterBackLink />
        </div>
      </div>

      <form className="patient-search-form" onSubmit={handleSearch}>
        <label>
          種別
          <select
            value={inputs.kind ?? ""}
            onChange={(e) => setInputs({ ...inputs, kind: e.target.value })}
          >
            <option value="">すべて</option>
            {BLOOD_PURIFIER_KIND_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.display}
              </option>
            ))}
          </select>
        </label>
        <label>
          製品名・カナ
          <input
            type="text"
            value={inputs.name ?? ""}
            onChange={(e) => setInputs({ ...inputs, name: e.target.value })}
          />
        </label>
        <label>
          メーカー
          <input
            type="text"
            value={inputs.maker ?? ""}
            onChange={(e) => setInputs({ ...inputs, maker: e.target.value })}
          />
        </label>
        <label className="dose-conversion__checkbox">
          <input
            type="checkbox"
            checked={inputs.active ?? false}
            onChange={(e) => setInputs({ ...inputs, active: e.target.checked })}
          />
          採用期間内のみ
        </label>
        {/* 紐付け漏れは算定漏れに直結するので、点検できるようにしておく。 */}
        <label className="dose-conversion__checkbox">
          <input
            type="checkbox"
            checked={inputs.unlinked ?? false}
            onChange={(e) => setInputs({ ...inputs, unlinked: e.target.checked })}
          />
          特定器材コード未紐付けのみ
        </label>
        <div className="patient-search-form__actions">
          <button type="submit">検索</button>
          <button
            type="button"
            onClick={() => {
              setInputs({});
              setFilters({});
              setPage(1);
            }}
          >
            クリア
          </button>
        </div>
      </form>

      <ErrorBanner error={list.error} />

      <table className="master-search__table">
        <thead>
          <tr>
            <th>コード</th>
            <th>種別</th>
            <th>製品名</th>
            <th className="rad-item__compact">膜</th>
            <th>メーカー</th>
            <th>特定器材(算定)</th>
            <th className="rad-item__compact">材料価格</th>
            <th className="rad-item__compact">採用期間</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.items.map((purifier) => (
            <tr key={purifier.id} onClick={() => setEditing(purifier.id)} className="master-search__row">
              <td>{purifier.purifier_code}</td>
              <td>{bloodPurifierKindDisplay(purifier.kind)}</td>
              <td>{purifier.name}</td>
              <td className="rad-item__compact">{bloodPurifierMembraneLabel(purifier)}</td>
              <td>{purifier.maker}</td>
              <td>
                <ReceiptMaterialCell purifier={purifier} />
              </td>
              <td className="rad-item__compact">
                {purifier.receipt_material_price
                  ? `${Number(purifier.receipt_material_price).toLocaleString()} 円`
                  : ""}
              </td>
              <td className="rad-item__compact">
                {(purifier.valid_from || purifier.valid_to) &&
                  `${purifier.valid_from ?? ""}〜${purifier.valid_to ?? ""}`}
              </td>
            </tr>
          ))}
          {list.data && list.data.items.length === 0 && (
            <tr>
              <td colSpan={8} className="master-search__empty">
                血液浄化器がありません
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="master-search__pager">
        <button type="button" onClick={() => setPage((p) => p - 1)} disabled={page <= 1 || list.isFetching}>
          前へ
        </button>
        <span>
          {page} ページ目 (全 {list.data?.total ?? 0} 件)
        </span>
        <button type="button" onClick={() => setPage((p) => p + 1)} disabled={!hasNext || list.isFetching}>
          次へ
        </button>
      </div>

      {editing !== null && (
        <PurifierEditModal purifierId={editing === "new" ? null : editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

// 紐付け先の表示。未紐付けは算定できないので、空欄ではなく印を出す。
function ReceiptMaterialCell({ purifier }: { purifier: BloodPurifier }) {
  if (!purifier.receipt_material_code) {
    return <span className="dose-conversion__badge">未紐付け</span>;
  }
  return (
    <>
      {purifier.receipt_material_name ?? "(マスタ未取込のコード)"}
      <span className="lab-order-item__code">{purifier.receipt_material_code}</span>
    </>
  );
}

function toDraft(purifier: BloodPurifier): Draft {
  return {
    kind: purifier.kind,
    name: purifier.name,
    name_kana: purifier.name_kana ?? "",
    maker: purifier.maker ?? "",
    model_number: purifier.model_number ?? "",
    membrane_material: purifier.membrane_material ?? "",
    membrane_area: purifier.membrane_area ? String(Number(purifier.membrane_area)) : "",
    receipt_material_code: purifier.receipt_material_code ?? "",
    valid_from: purifier.valid_from ?? "",
    valid_to: purifier.valid_to ?? "",
    display_order: purifier.display_order === null ? "" : String(purifier.display_order),
    note: purifier.note ?? "",
  };
}

function PurifierEditModal({ purifierId, onClose }: { purifierId: number | null; onClose: () => void }) {
  const detail = useBloodPurifier(purifierId);
  const title = purifierId === null ? "血液浄化器を追加" : "血液浄化器を編集";

  return (
    <Modal title={title} onClose={onClose} className="modal--lab-order-item">
      <ErrorBanner error={detail.error} />
      {(purifierId === null || detail.data) && (
        <PurifierEditForm purifier={detail.data ?? null} onClose={onClose} />
      )}
    </Modal>
  );
}

function PurifierEditForm({ purifier, onClose }: { purifier: BloodPurifier | null; onClose: () => void }) {
  const mutations = useBloodPurifierMutations();
  const [draft, setDraft] = useState<Draft>(() => (purifier ? toDraft(purifier) : emptyDraft));
  // 選び直した紐付け先の名称。保存前でも何を選んだか分かるように持つ。
  const [pickedName, setPickedName] = useState<string | null>(purifier?.receipt_material_name ?? null);
  const [searching, setSearching] = useState(false);

  function handleSelectReceiptMaterial(material: MedicalMaterial) {
    setSearching(false);
    setDraft((prev) => ({ ...prev, receipt_material_code: material.material_code }));
    setPickedName(material.name);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const payload = toPayload(draft);
    if (purifier) {
      await mutations.update.mutateAsync({ id: purifier.id, payload });
    } else {
      await mutations.create.mutateAsync(payload);
    }
    onClose();
  }

  async function handleDelete() {
    if (!purifier) return;
    if (!window.confirm(`${purifier.name} を削除しますか？`)) return;

    await mutations.remove.mutateAsync(purifier.id);
    onClose();
  }

  const saving = mutations.create.isPending || mutations.update.isPending;

  return (
    <>
      <form onSubmit={handleSubmit}>
        <div className="lab-order-item__fields">
          <label>
            種別
            <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>
              {BLOOD_PURIFIER_KIND_OPTIONS.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.display}
                </option>
              ))}
            </select>
          </label>
          <label>
            製品名
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
              value={draft.name_kana}
              onChange={(e) => setDraft({ ...draft, name_kana: e.target.value })}
            />
          </label>
          <label>
            メーカー
            <input
              type="text"
              value={draft.maker}
              onChange={(e) => setDraft({ ...draft, maker: e.target.value })}
            />
          </label>
          <label>
            型番
            <input
              type="text"
              value={draft.model_number}
              onChange={(e) => setDraft({ ...draft, model_number: e.target.value })}
            />
          </label>
        </div>

        <div className="lab-order-item__fields">
          <label>
            膜素材
            <input
              type="text"
              list="blood-purifier-membranes"
              value={draft.membrane_material}
              onChange={(e) => setDraft({ ...draft, membrane_material: e.target.value })}
            />
            <datalist id="blood-purifier-membranes">
              {MEMBRANE_MATERIALS.map((material) => (
                <option key={material} value={material} />
              ))}
            </datalist>
          </label>
          <label>
            膜面積(㎡)
            <input
              type="number"
              min={0.01}
              max={99.99}
              step={0.01}
              value={draft.membrane_area}
              onChange={(e) => setDraft({ ...draft, membrane_area: e.target.value })}
            />
          </label>
          <label>
            採用開始日
            <input
              type="date"
              value={draft.valid_from}
              onChange={(e) => setDraft({ ...draft, valid_from: e.target.value })}
            />
          </label>
          <label>
            採用終了日
            <input
              type="date"
              value={draft.valid_to}
              onChange={(e) => setDraft({ ...draft, valid_to: e.target.value })}
            />
          </label>
          <label>
            表示順
            <input
              type="number"
              value={draft.display_order}
              onChange={(e) => setDraft({ ...draft, display_order: e.target.value })}
            />
          </label>
          <label>
            備考
            <input
              type="text"
              value={draft.note}
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            />
          </label>
        </div>

        <section className="lab-order-item__section">
          <div className="lab-order-item__section-head">
            <h3>算定に使う特定器材</h3>
          </div>
          <div className="rad-material__link">
            {draft.receipt_material_code ? (
              <>
                <span>{pickedName ?? "(マスタ未取込のコード)"}</span>
                <span className="lab-order-item__code">{draft.receipt_material_code}</span>
                <button type="button" onClick={() => setSearching(true)}>
                  変更
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDraft((prev) => ({ ...prev, receipt_material_code: "" }));
                    setPickedName(null);
                  }}
                >
                  解除
                </button>
              </>
            ) : (
              <>
                <span className="order-select__muted">未紐付け</span>
                <button type="button" onClick={() => setSearching(true)}>
                  選択
                </button>
              </>
            )}
          </div>
        </section>

        <ErrorBanner error={mutations.create.error ?? mutations.update.error ?? mutations.remove.error} />

        <div className="lab-order-item__actions">
          <button type="submit" disabled={saving}>
            保存
          </button>
          {purifier && (
            <button type="button" onClick={handleDelete} disabled={mutations.remove.isPending}>
              削除
            </button>
          )}
        </div>
      </form>

      {searching && (
        <MedicalMaterialSearchModal
          onSelect={handleSelectReceiptMaterial}
          onClose={() => setSearching(false)}
        />
      )}
    </>
  );
}
