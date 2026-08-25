import { useEffect, useState, type FormEvent } from "react";
import type {
  Medicine,
  MedicalMaterial,
  MedicalProcedure,
  TreatmentDatasetDetail,
  TreatmentDatasetDetailType,
  TreatmentDatasetPayload,
} from "../api/masterClient";
import {
  useTreatmentDataset,
  useTreatmentDatasetDetailMutations,
  useTreatmentDatasetMutations,
  useTreatmentDatasetSearch,
} from "../api/masterQueries";
import { ErrorBanner } from "../components/ErrorBanner";
import { MedicalProcedureSearchModal } from "../components/MedicalProcedureSearchModal";
import { MedicineSearchModal } from "../components/MedicineSearchModal";
import { Modal } from "../components/Modal";
import { MedicalMaterialSearchModal } from "../components/MedicalMaterialSearchModal";
import { TREATMENT_ROUTE_OPTIONS } from "../fhir/treatmentResultHelpers";

// 処置の実施入力用データセット。
//
// 実施入力で毎回登録することになる手技料・薬剤・器材の組み合わせに名前を付けて
// おき、処置オーダー項目マスタに紐付ける。実施入力モーダルは、
// オーダーに載っている処置項目に紐付く全データセットの明細をマージして初期表示する。
//
// 放射線と違い、器材は施設内の器材マスタを挟まず特定保険医療材料そのものを指す。

function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9L12 4M6.5 6.5v5M9.5 6.5v5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface Draft {
  dataset_code: string;
  name: string;
  name_kana: string;
  valid_from: string;
  valid_to: string;
  display_order: string;
  note: string;
}

const emptyDraft: Draft = {
  dataset_code: "",
  name: "",
  name_kana: "",
  valid_from: "",
  valid_to: "",
  display_order: "",
  note: "",
};

function toPayload(draft: Draft): TreatmentDatasetPayload {
  return {
    dataset_code: draft.dataset_code,
    name: draft.name,
    name_kana: draft.name_kana || null,
    valid_from: draft.valid_from || null,
    valid_to: draft.valid_to || null,
    display_order: draft.display_order ? Number(draft.display_order) : null,
    note: draft.note || null,
  };
}

export function TreatmentDatasetPage() {
  const [input, setInput] = useState("");
  const [filters, setFilters] = useState<{ name?: string; active?: boolean }>({});
  const [activeOnly, setActiveOnly] = useState(false);
  const [page, setPage] = useState(1);
  // 編集対象の id。"new" は新規作成モーダル。
  const [editing, setEditing] = useState<number | "new" | null>(null);

  const list = useTreatmentDatasetSearch(filters, page);
  const hasNext = list.data ? page * list.data.per < list.data.total : false;

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    setFilters({ name: input, active: activeOnly });
    setPage(1);
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>実施入力データセット</h1>
        <button type="button" onClick={() => setEditing("new")}>
          データセットを追加
        </button>
      </div>

      <form className="patient-search-form" onSubmit={handleSearch}>
        <label>
          名称・カナ
          <input type="text" value={input} onChange={(e) => setInput(e.target.value)} />
        </label>
        <label className="dose-conversion__checkbox">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(e) => setActiveOnly(e.target.checked)}
          />
          運用期間内のみ
        </label>
        <div className="patient-search-form__actions">
          <button type="submit">検索</button>
          <button
            type="button"
            onClick={() => {
              setInput("");
              setActiveOnly(false);
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
            <th>名称</th>
            <th className="rad-item__compact">運用期間</th>
            <th>備考</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.items.map((dataset) => (
            <tr key={dataset.id} onClick={() => setEditing(dataset.id)} className="master-search__row">
              <td>{dataset.dataset_code}</td>
              <td>{dataset.name}</td>
              <td className="rad-item__compact">
                {(dataset.valid_from || dataset.valid_to) &&
                  `${dataset.valid_from ?? ""}〜${dataset.valid_to ?? ""}`}
              </td>
              <td>{dataset.note}</td>
            </tr>
          ))}
          {list.data && list.data.items.length === 0 && (
            <tr>
              <td colSpan={4} className="master-search__empty">
                データセットがありません
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
        <DatasetEditModal
          datasetId={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

interface DatasetEditModalProps {
  // null は新規作成。
  datasetId: number | null;
  onClose: () => void;
}

function DatasetEditModal({ datasetId, onClose }: DatasetEditModalProps) {
  const detail = useTreatmentDataset(datasetId);
  const mutations = useTreatmentDatasetMutations();
  const [draft, setDraft] = useState<Draft>(emptyDraft);

  useEffect(() => {
    if (!detail.data) return;
    const d = detail.data;
    setDraft({
      dataset_code: d.dataset_code,
      name: d.name,
      name_kana: d.name_kana ?? "",
      valid_from: d.valid_from ?? "",
      valid_to: d.valid_to ?? "",
      display_order: d.display_order === null ? "" : String(d.display_order),
      note: d.note ?? "",
    });
  }, [detail.data]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!draft.name) return;

    const payload = toPayload(draft);
    if (datasetId === null) {
      await mutations.create.mutateAsync(payload);
      onClose();
    } else {
      await mutations.update.mutateAsync({ id: datasetId, payload });
    }
  }

  async function handleDelete() {
    if (datasetId === null || !detail.data) return;
    if (!window.confirm(`${detail.data.name} を削除しますか？（明細と処置項目への紐付けも削除されます）`))
      return;

    await mutations.remove.mutateAsync(datasetId);
    onClose();
  }

  const saving = mutations.create.isPending || mutations.update.isPending;

  return (
    <Modal
      title={datasetId === null ? "データセットを追加" : "データセットを編集"}
      onClose={onClose}
      className="modal--lab-order-item"
    >
      <form onSubmit={handleSubmit}>
        <div className="lab-order-item__fields">
          <label>
            データセットコード
            <input
              type="text"
              value={draft.dataset_code}
              onChange={(e) => setDraft({ ...draft, dataset_code: e.target.value })}
              placeholder={datasetId === null ? "空欄なら自動採番" : undefined}
              disabled={datasetId !== null}
            />
          </label>
          <label>
            名称
            <input
              type="text"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="創傷処置標準セット など"
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
        </div>

        <div className="lab-order-item__fields">
          <label>
            運用開始日
            <input
              type="date"
              value={draft.valid_from}
              onChange={(e) => setDraft({ ...draft, valid_from: e.target.value })}
            />
          </label>
          <label>
            運用終了日
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

        <ErrorBanner error={detail.error} />
        <ErrorBanner
          error={mutations.create.error ?? mutations.update.error ?? mutations.remove.error}
        />

        <div className="lab-order-item__actions">
          <button type="submit" disabled={saving}>
            保存
          </button>
          {datasetId !== null && (
            <button type="button" onClick={handleDelete} disabled={mutations.remove.isPending}>
              削除
            </button>
          )}
        </div>
      </form>

      {/* 明細は保存済みのデータセットにだけぶら下がる。フォームの外に置くのは、
          Modal がポータルではなく、入れ子の form が外側の submit を誘発するため。 */}
      {datasetId !== null && detail.data && (
        <DatasetDetailsEditor datasetCode={detail.data.dataset_code} details={detail.data.details} />
      )}
    </Modal>
  );
}

// 明細セクションの定義。3種とも「参照先マスタから選ぶ → 既定数量を入れる」で同じ形。
const SECTIONS: {
  type: TreatmentDatasetDetailType;
  title: string;
  addLabel: string;
  /** 数量欄を出すか(手技料は数量を持たない)。 */
  quantity: boolean;
}[] = [
  {
    type: "procedure",
    title: "手技料",
    addLabel: "診療行為を追加",
    quantity: false,
  },
  {
    type: "medicine",
    title: "薬剤",
    addLabel: "薬剤を追加",
    quantity: true,
  },
  {
    type: "material",
    title: "特定器材",
    addLabel: "器材を追加",
    quantity: true,
  },
];

function DatasetDetailsEditor({
  datasetCode,
  details,
}: {
  datasetCode: string;
  details: TreatmentDatasetDetail[];
}) {
  const mutations = useTreatmentDatasetDetailMutations();
  const [adding, setAdding] = useState<TreatmentDatasetDetailType | null>(null);

  function add(payload: { detail_type: TreatmentDatasetDetailType; code: string; default_quantity?: string }) {
    setAdding(null);
    mutations.create.mutate({ dataset_code: datasetCode, ...payload });
  }

  return (
    <>
      <ErrorBanner error={mutations.create.error ?? mutations.update.error ?? mutations.remove.error} />

      {SECTIONS.map((section) => {
        const rows = details.filter((d) => d.detail_type === section.type);
        return (
          <section key={section.type} className="lab-order-item__section">
            <div className="lab-order-item__section-head">
              <h3>{section.title}</h3>
              <button type="button" onClick={() => setAdding(section.type)}>
                {section.addLabel}
              </button>
            </div>

            <div className="lab-order-item__table-wrap">
              {/* 3 種で列構成が違う(数量・経路の有無)ので、行末の初期値と削除だけは
                  幅を固定してセクション間で位置を揃える。 */}
              <table className="master-search__table rad-dataset__details">
                <thead>
                  <tr>
                    <th>名称</th>
                    <th>コード</th>
                    {section.quantity && <th className="rad-item__compact">既定数量</th>}
                    {section.type === "medicine" && <th className="rad-item__compact">経路</th>}
                    {/* 実施入力に最初から出す明細。外しておくと実施入力には出ず、
                        使ったときだけ技師が検索して足すことになる。 */}
                    <th className="rad-dataset__default">初期値</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <DetailRow key={row.id} detail={row} section={section} />
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={section.type === "medicine" ? 6 : 5} className="master-search__empty">
                        登録がありません
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      {adding === "procedure" && (
        <MedicalProcedureSearchModal
          defaultSection="J"
          onSelect={(p: MedicalProcedure) => add({ detail_type: "procedure", code: p.procedure_code })}
          onClose={() => setAdding(null)}
        />
      )}
      {/* 処置で使う薬剤は造影剤に限らない(局所麻酔・消毒・外用薬など)ので、
          放射線のように造影剤区分で絞らず全医薬品から選ぶ。 */}
      {adding === "medicine" && (
        <MedicineSearchModal
          title="薬剤を選択"
          onSelect={(m: Medicine) => add({ detail_type: "medicine", code: m.medicine_code })}
          onClose={() => setAdding(null)}
        />
      )}
      {adding === "material" && (
        <MedicalMaterialSearchModal
          onSelect={(m: MedicalMaterial) =>
            add({ detail_type: "material", code: m.material_code, default_quantity: "1" })
          }
          onClose={() => setAdding(null)}
        />
      )}
    </>
  );
}

// 明細1行。数量は入力途中で保存すると桁ごとに走ってしまうので、離れたときに保存する。
function DetailRow({
  detail,
  section,
}: {
  detail: TreatmentDatasetDetail;
  section: (typeof SECTIONS)[number];
}) {
  const mutations = useTreatmentDatasetDetailMutations();
  const [quantity, setQuantity] = useState(detail.default_quantity ?? "");

  useEffect(() => {
    setQuantity(detail.default_quantity ?? "");
  }, [detail.default_quantity]);

  function saveQuantity() {
    const next = quantity.trim();
    if (next === (detail.default_quantity ?? "")) return;
    mutations.update.mutate({ id: detail.id, payload: { default_quantity: next || null } });
  }

  // 単位は参照先マスタのもの(薬剤は医薬品マスタの製剤単位、器材は材料マスタ)。
  const unit = detail.resolved_unit_name ?? "";

  return (
    <tr>
      <td>{detail.resolved_name ?? "(マスタ未取込のコード)"}</td>
      {/* 器材の code はレセ電算の特定器材コードそのもの(施設内コードを挟まない)。 */}
      <td>{detail.code}</td>
      {section.quantity && (
        <td className="rad-item__compact">
          <input
            type="number"
            className="rad-quantity-input"
            step="0.01"
            min="0"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            onBlur={saveQuantity}
          />
          {unit}
        </td>
      )}
      {section.type === "medicine" && (
        <td className="rad-item__compact">
          <select
            className="rad-route-select"
            value={detail.route_code ?? ""}
            onChange={(e) =>
              mutations.update.mutate({
                id: detail.id,
                payload: { route_code: e.target.value || null },
              })
            }
          >
            <option value="">未指定</option>
            {TREATMENT_ROUTE_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.display}
              </option>
            ))}
          </select>
        </td>
      )}
      <td className="rad-dataset__default">
        <input
          type="checkbox"
          checked={detail.default_selected}
          aria-label="初期値にする"
          onChange={(e) =>
            mutations.update.mutate({
              id: detail.id,
              payload: { default_selected: e.target.checked },
            })
          }
        />
      </td>
      <td className="master-search__actions">
        <button
          type="button"
          className="rp-card__icon-button"
          title="外す"
          aria-label="外す"
          onClick={() => mutations.remove.mutate(detail.id)}
        >
          <TrashIcon />
        </button>
      </td>
    </tr>
  );
}
