import { useEffect, useState, type FormEvent } from "react";
import type { MedicalMaterial, RadMaterial, RadMaterialPayload } from "../api/masterClient";
import {
  useRadMaterial,
  useRadMaterialMutations,
  useRadMaterialSearch,
  type RadMaterialFilters,
} from "../api/masterQueries";
import { ErrorBanner } from "../components/ErrorBanner";
import { MedicalMaterialSearchModal } from "../components/MedicalMaterialSearchModal";
import { Modal } from "../components/Modal";

// 放射線検査で使う器材の施設マスタ。
//
// レセプト電算の特定器材マスタは「中心静脈用カテーテル（標準・シングルルーメン）」の
// ような概念的な区分で収載されており、棚にある製品名とは一致しない。実施入力では
// 技師が手に取った製品を選びたいので、採用している製品をここに登録し、算定に使う
// 特定器材コードを紐付ける(製品 N 件 : 特定器材コード 1 件)。

// 編集フォームの値。input で扱うため全て文字列で持ち、保存時に payload へ変換する。
interface Draft {
  material_code: string;
  name: string;
  name_kana: string;
  maker: string;
  model_number: string;
  receipt_material_code: string;
  unit_name: string;
  valid_from: string;
  valid_to: string;
  display_order: string;
  note: string;
}

const emptyDraft: Draft = {
  material_code: "",
  name: "",
  name_kana: "",
  maker: "",
  model_number: "",
  receipt_material_code: "",
  unit_name: "",
  valid_from: "",
  valid_to: "",
  display_order: "",
  note: "",
};

function toPayload(draft: Draft): RadMaterialPayload {
  return {
    material_code: draft.material_code,
    name: draft.name,
    name_kana: draft.name_kana || null,
    maker: draft.maker || null,
    model_number: draft.model_number || null,
    receipt_material_code: draft.receipt_material_code || null,
    unit_name: draft.unit_name || null,
    valid_from: draft.valid_from || null,
    valid_to: draft.valid_to || null,
    display_order: draft.display_order ? Number(draft.display_order) : null,
    note: draft.note || null,
  };
}

export function RadMaterialPage() {
  const [inputs, setInputs] = useState<RadMaterialFilters>({});
  const [filters, setFilters] = useState<RadMaterialFilters>({});
  const [page, setPage] = useState(1);
  // 編集対象の id。"new" は新規作成モーダル。
  const [editing, setEditing] = useState<number | "new" | null>(null);

  const list = useRadMaterialSearch(filters, page);
  const hasNext = list.data ? page * list.data.per < list.data.total : false;

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    setFilters(inputs);
    setPage(1);
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>放射線器材マスタ</h1>
        <button type="button" onClick={() => setEditing("new")}>
          器材を追加
        </button>
      </div>

      <form className="patient-search-form" onSubmit={handleSearch}>
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
            <th>製品名</th>
            <th>メーカー</th>
            <th>型番</th>
            <th>特定器材(算定)</th>
            <th className="rad-item__compact">材料価格</th>
            <th className="rad-item__compact">採用期間</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.items.map((material) => (
            <tr
              key={material.id}
              onClick={() => setEditing(material.id)}
              className="master-search__row"
            >
              <td>{material.material_code}</td>
              <td>{material.name}</td>
              <td>{material.maker}</td>
              <td>{material.model_number}</td>
              <td>
                <ReceiptMaterialCell material={material} />
              </td>
              <td className="rad-item__compact">
                {material.receipt_material_price
                  ? `${Number(material.receipt_material_price).toLocaleString()} 円`
                  : ""}
              </td>
              <td className="rad-item__compact">
                {(material.valid_from || material.valid_to) &&
                  `${material.valid_from ?? ""}〜${material.valid_to ?? ""}`}
              </td>
            </tr>
          ))}
          {list.data && list.data.items.length === 0 && (
            <tr>
              <td colSpan={7} className="master-search__empty">
                放射線器材がありません
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
        <MaterialEditModal
          materialId={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

// 紐付け先の表示。未紐付けは算定できないので、空欄ではなく印を出す。
// 配布マスタを取り込む前・廃止されたコードでは名称が引けないため、その旨を出す。
function ReceiptMaterialCell({ material }: { material: RadMaterial }) {
  if (!material.receipt_material_code) {
    return <span className="dose-conversion__badge">未紐付け</span>;
  }
  return (
    <>
      {material.receipt_material_name ?? "(マスタ未取込のコード)"}
      <span className="lab-order-item__code">{material.receipt_material_code}</span>
    </>
  );
}

interface MaterialEditModalProps {
  // null は新規作成。
  materialId: number | null;
  onClose: () => void;
}

function MaterialEditModal({ materialId, onClose }: MaterialEditModalProps) {
  const detail = useRadMaterial(materialId);
  const mutations = useRadMaterialMutations();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  // 選び直した紐付け先の名称。保存前でも何を選んだか分かるように持つ。
  const [pickedName, setPickedName] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!detail.data) return;
    const d = detail.data;
    setDraft({
      material_code: d.material_code,
      name: d.name,
      name_kana: d.name_kana ?? "",
      maker: d.maker ?? "",
      model_number: d.model_number ?? "",
      receipt_material_code: d.receipt_material_code ?? "",
      unit_name: d.unit_name ?? "",
      valid_from: d.valid_from ?? "",
      valid_to: d.valid_to ?? "",
      display_order: d.display_order === null ? "" : String(d.display_order),
      note: d.note ?? "",
    });
    setPickedName(d.receipt_material_name);
  }, [detail.data]);

  function handleSelectReceiptMaterial(material: MedicalMaterial) {
    setSearching(false);
    setDraft((prev) => ({ ...prev, receipt_material_code: material.material_code }));
    setPickedName(material.name);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!draft.name) return;

    const payload = toPayload(draft);
    if (materialId === null) {
      await mutations.create.mutateAsync(payload);
      onClose();
    } else {
      await mutations.update.mutateAsync({ id: materialId, payload });
    }
  }

  async function handleDelete() {
    if (materialId === null || !detail.data) return;
    if (!window.confirm(`${detail.data.name} を削除しますか？`)) return;

    await mutations.remove.mutateAsync(materialId);
    onClose();
  }

  const saving = mutations.create.isPending || mutations.update.isPending;

  return (
    <Modal
      title={materialId === null ? "放射線器材を追加" : "放射線器材を編集"}
      onClose={onClose}
      className="modal--lab-order-item"
    >
      <form onSubmit={handleSubmit}>
        <div className="lab-order-item__fields">
          <label>
            器材コード
            <input
              type="text"
              value={draft.material_code}
              onChange={(e) => setDraft({ ...draft, material_code: e.target.value })}
              placeholder={materialId === null ? "空欄なら自動採番" : undefined}
              disabled={materialId !== null}
            />
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
            カナ(検索用)
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
            型番・規格
            <input
              type="text"
              value={draft.model_number}
              onChange={(e) => setDraft({ ...draft, model_number: e.target.value })}
            />
          </label>
        </div>

        <div className="lab-order-item__fields">
          <label>
            単位
            <input
              type="text"
              value={draft.unit_name}
              onChange={(e) => setDraft({ ...draft, unit_name: e.target.value })}
              placeholder="本・個・組"
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

        <ReceiptMaterialField
          code={draft.receipt_material_code}
          name={pickedName}
          onSearch={() => setSearching(true)}
          onClear={() => {
            setDraft((prev) => ({ ...prev, receipt_material_code: "" }));
            setPickedName(null);
          }}
        />

        <ErrorBanner error={detail.error} />
        <ErrorBanner
          error={mutations.create.error ?? mutations.update.error ?? mutations.remove.error}
        />

        <div className="lab-order-item__actions">
          <button type="submit" disabled={saving}>
            保存
          </button>
          {materialId !== null && (
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
    </Modal>
  );
}

// 算定に使う特定器材コードの紐付け。コードは手で覚えるものではないので、
// 収載名で探して選ぶ形にする。
function ReceiptMaterialField({
  code,
  name,
  onSearch,
  onClear,
}: {
  code: string;
  name: string | null;
  onSearch: () => void;
  onClear: () => void;
}) {
  return (
    <section className="lab-order-item__section">
      <div className="lab-order-item__section-head">
        <h3>算定に使う特定器材</h3>
        <span className="rad-code__summary">
          レセプト電算の特定器材マスタから選ぶ。未紐付けだと材料料を算定できない
        </span>
      </div>

      <div className="rad-material__link">
        {code ? (
          <>
            <span>{name ?? "(マスタ未取込のコード)"}</span>
            <span className="lab-order-item__code">{code}</span>
            <button type="button" onClick={onSearch}>
              選び直す
            </button>
            <button type="button" onClick={onClear}>
              紐付けを外す
            </button>
          </>
        ) : (
          <>
            <span className="order-select__muted">未紐付け</span>
            <button type="button" onClick={onSearch}>
              特定器材を検索
            </button>
          </>
        )}
      </div>
    </section>
  );
}
