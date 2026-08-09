import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { LabItem, LabOrderItemPayload } from "../api/masterClient";
import {
  useLabContainers,
  useLabOrderItem,
  useLabOrderItemMutations,
  useLabOrderItemSearch,
  useLabPanelItemMutations,
  useLabSpecimenOptions,
  type LabOrderItemFilters,
} from "../api/masterQueries";
import { ErrorBanner } from "../components/ErrorBanner";
import { LabItemSearchModal } from "../components/LabItemSearchModal";
import { Modal } from "../components/Modal";

const KIND_LABELS: Record<string, string> = {
  single: "単項目",
  panel: "パネル",
};

// 検査分野の選択肢。前半は共有項目JLACコードマスタ(JLAC11)の区分名称に合わせ、
// 同マスタが扱わない分野(微生物・遺伝子・病理)を後ろに足している。
const CATEGORIES = [
  "尿・糞便等検査",
  "血液学的検査",
  "生化学検査",
  "免疫学的検査",
  "免疫血液学的検査",
  "内分泌学的検査",
  "感染症関連検査",
  "微生物学的検査",
  "遺伝子関連・染色体検査",
  "病理学的検査",
  "その他",
];

const MEMBER_TYPE_LABELS: Record<string, string> = {
  required: "必須",
  optional: "任意",
  conditional: "条件付き",
};

// 編集フォームの値。input で扱うため全て文字列で持ち、保存時に payload へ変換する。
interface Draft {
  order_item_code: string;
  name: string;
  short_name: string;
  name_kana: string;
  category: string;
  specimen_code: string;
  container_code: string;
  kind: string;
  jlac_code: string;
  jlac_code_system: string;
  valid_from: string;
  valid_to: string;
  execution_type: string;
  receipt_code: string;
  display_order: string;
  note: string;
}

const emptyDraft: Draft = {
  order_item_code: "",
  name: "",
  short_name: "",
  name_kana: "",
  category: "",
  specimen_code: "",
  container_code: "",
  kind: "single",
  jlac_code: "",
  jlac_code_system: "",
  valid_from: "",
  valid_to: "",
  execution_type: "",
  receipt_code: "",
  display_order: "",
  note: "",
};

function toPayload(draft: Draft): LabOrderItemPayload {
  return {
    order_item_code: draft.order_item_code,
    name: draft.name,
    short_name: draft.short_name || null,
    name_kana: draft.name_kana || null,
    category: draft.category || null,
    specimen_code: draft.specimen_code || null,
    container_code: draft.container_code || null,
    kind: draft.kind,
    jlac_code: draft.jlac_code || null,
    jlac_code_system: draft.jlac_code_system || null,
    valid_from: draft.valid_from || null,
    valid_to: draft.valid_to || null,
    execution_type: draft.execution_type || null,
    receipt_code: draft.receipt_code || null,
    display_order: draft.display_order ? Number(draft.display_order) : null,
    note: draft.note || null,
  };
}

export function LabOrderItemPage() {
  const [inputs, setInputs] = useState<LabOrderItemFilters>({});
  const [filters, setFilters] = useState<LabOrderItemFilters>({});
  const [page, setPage] = useState(1);
  // 編集対象の id。0 は新規作成モーダル。
  const [editing, setEditing] = useState<number | "new" | null>(null);

  const list = useLabOrderItemSearch(filters, page);
  const specimens = useLabSpecimenOptions();
  const containers = useLabContainers();

  const specimenNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of specimens.data?.items ?? []) map.set(s.specimen_code, s.name);
    return map;
  }, [specimens.data]);

  // 項目の採取管指定が無い行は、検体の既定採取管を表示する。
  const defaultContainers = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of specimens.data?.items ?? []) {
      if (s.default_container_code) map.set(s.specimen_code, s.default_container_code);
    }
    return map;
  }, [specimens.data]);

  const containerNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of containers.data?.items ?? []) map.set(c.container_code, c.name);
    return map;
  }, [containers.data]);

  const hasNext = list.data ? page * list.data.per < list.data.total : false;

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    setFilters(inputs);
    setPage(1);
  }

  function containerLabel(itemContainer: string | null, specimenCode: string | null): string {
    const code = itemContainer || (specimenCode ? defaultContainers.get(specimenCode) : null);
    if (!code) return "";
    return containerNames.get(code) ?? code;
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>検査オーダー項目マスタ</h1>
        <div className="page__header-actions">
          <button type="button" onClick={() => setEditing("new")}>
            項目を追加
          </button>
        </div>
      </div>

      <form className="patient-search-form" onSubmit={handleSearch}>
        <label>
          名称・略称・カナ
          <input
            type="text"
            value={inputs.name ?? ""}
            onChange={(e) => setInputs({ ...inputs, name: e.target.value })}
          />
        </label>
        <label>
          検査分野
          <select
            value={inputs.category ?? ""}
            onChange={(e) => setInputs({ ...inputs, category: e.target.value })}
          >
            <option value="">すべて</option>
            {CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </label>
        <label>
          種別
          <select
            value={inputs.kind ?? ""}
            onChange={(e) => setInputs({ ...inputs, kind: e.target.value })}
          >
            <option value="">すべて</option>
            <option value="single">単項目</option>
            <option value="panel">パネル</option>
          </select>
        </label>
        <label className="dose-conversion__checkbox">
          <input
            type="checkbox"
            checked={inputs.active ?? false}
            onChange={(e) => setInputs({ ...inputs, active: e.target.checked })}
          />
          有効期間内のみ
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
            <th>名称</th>
            <th>略称</th>
            <th>検査分野</th>
            <th className="lab-order-item__compact">種別</th>
            <th>検体</th>
            <th>採取管</th>
            <th>JLACコード</th>
            <th>有効期間</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.items.map((item) => (
            <tr key={item.id} onClick={() => setEditing(item.id)} className="master-search__row">
              <td>{item.order_item_code}</td>
              <td>{item.name}</td>
              <td>{item.short_name}</td>
              <td>{item.category}</td>
              <td className="lab-order-item__compact">{KIND_LABELS[item.kind] ?? item.kind}</td>
              <td>
                {item.specimen_code
                  ? (specimenNames.get(item.specimen_code) ?? item.specimen_code)
                  : ""}
              </td>
              <td>{containerLabel(item.container_code, item.specimen_code)}</td>
              <td>{item.jlac_code}</td>
              <td className="lab-order-item__compact">
                {(item.valid_from || item.valid_to) && `${item.valid_from ?? ""}〜${item.valid_to ?? ""}`}
              </td>
            </tr>
          ))}
          {list.data && list.data.items.length === 0 && (
            <tr>
              <td colSpan={9} className="master-search__empty">
                検査オーダー項目がありません
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
        <ItemEditModal itemId={editing === "new" ? null : editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

interface ItemEditModalProps {
  // null は新規作成。
  itemId: number | null;
  onClose: () => void;
}

function ItemEditModal({ itemId, onClose }: ItemEditModalProps) {
  const detail = useLabOrderItem(itemId);
  const mutations = useLabOrderItemMutations();
  const specimens = useLabSpecimenOptions();
  const containers = useLabContainers();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [searchingJlac, setSearchingJlac] = useState(false);

  useEffect(() => {
    if (!detail.data) return;
    const d = detail.data;
    setDraft({
      order_item_code: d.order_item_code,
      name: d.name,
      short_name: d.short_name ?? "",
      name_kana: d.name_kana ?? "",
      category: d.category ?? "",
      specimen_code: d.specimen_code ?? "",
      container_code: d.container_code ?? "",
      kind: d.kind,
      jlac_code: d.jlac_code ?? "",
      jlac_code_system: d.jlac_code_system ?? "",
      valid_from: d.valid_from ?? "",
      valid_to: d.valid_to ?? "",
      execution_type: d.execution_type ?? "",
      receipt_code: d.receipt_code ?? "",
      display_order: d.display_order === null ? "" : String(d.display_order),
      note: d.note ?? "",
    });
  }, [detail.data]);

  // 選択肢に無い検査分野が保存済みの場合でも、開いただけで値が消えないよう末尾に足す。
  const categoryOptions = useMemo(
    () =>
      draft.category && !CATEGORIES.includes(draft.category)
        ? [...CATEGORIES, draft.category]
        : CATEGORIES,
    [draft.category],
  );

  // 検体の既定採取管(採取管を上書きしないときに使われるもの)の表示用。
  const defaultContainerName = useMemo(() => {
    const specimen = specimens.data?.items.find((s) => s.specimen_code === draft.specimen_code);
    if (!specimen?.default_container_code) return null;
    const container = containers.data?.items.find(
      (c) => c.container_code === specimen.default_container_code,
    );
    return container?.name ?? specimen.default_container_code;
  }, [containers.data, draft.specimen_code, specimens.data]);

  // 共有項目JLACコードマスタの材料名(「血清」など)から検体マスタのコードを引く。
  // どちらも JLAC11 の材料表が元なので名称で一致する。
  const specimenCodesByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const specimen of specimens.data?.items ?? []) {
      if (!map.has(specimen.name)) map.set(specimen.name, specimen.specimen_code);
    }
    return map;
  }, [specimens.data]);

  // 共有項目JLACコードマスタからの選択。コードと体系を埋め、名称が空なら補完する。
  // 検査分野・検体は JLAC マスタが正なので、選び直したら選択に合わせて入れ替える
  // (JLAC マスタ側が空、または対応する検体がマスタに無いときだけ元の選択を残す)。
  function handleSelectLabItem(item: LabItem) {
    setSearchingJlac(false);
    const specimenCode = item.jlac11_specimen
      ? (specimenCodesByName.get(item.jlac11_specimen) ?? "")
      : "";
    setDraft((prev) => ({
      ...prev,
      jlac_code: item.jlac11_code,
      jlac_code_system: "jlac11",
      name: prev.name || (item.fhir_item_name ?? ""),
      short_name: prev.short_name || (item.abbreviation ?? ""),
      category: item.category_name || prev.category,
      specimen_code: specimenCode || prev.specimen_code,
      // 検体が変わると既定の採取管も変わるため、項目側の上書きは外す。
      container_code:
        specimenCode && specimenCode !== prev.specimen_code ? "" : prev.container_code,
    }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!draft.order_item_code || !draft.name) return;

    if (itemId === null) {
      await mutations.create.mutateAsync(toPayload(draft));
      onClose();
    } else {
      await mutations.update.mutateAsync({ id: itemId, payload: toPayload(draft) });
    }
  }

  async function handleDelete() {
    if (itemId === null || !detail.data) return;
    const message =
      detail.data.kind === "panel"
        ? `${detail.data.name} を削除しますか？（パネル構成も削除されます）`
        : `${detail.data.name} を削除しますか？`;
    if (!window.confirm(message)) return;

    await mutations.remove.mutateAsync(itemId);
    onClose();
  }

  const saving = mutations.create.isPending || mutations.update.isPending;

  return (
    <Modal
      title={itemId === null ? "検査オーダー項目を追加" : "検査オーダー項目を編集"}
      onClose={onClose}
      className="modal--lab-order-item"
    >
      <form onSubmit={handleSubmit}>
        <div className="lab-order-item__fields">
          <label>
            項目コード
            <input
              type="text"
              value={draft.order_item_code}
              onChange={(e) => setDraft({ ...draft, order_item_code: e.target.value })}
              disabled={itemId !== null}
              required
            />
          </label>
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
            略称
            <input
              type="text"
              value={draft.short_name}
              onChange={(e) => setDraft({ ...draft, short_name: e.target.value })}
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
            検査分野
            <select
              value={draft.category}
              onChange={(e) => setDraft({ ...draft, category: e.target.value })}
            >
              <option value="">未設定</option>
              {categoryOptions.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>
          <label>
            種別
            <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>
              <option value="single">単項目</option>
              <option value="panel">パネル</option>
            </select>
          </label>
        </div>

        <div className="lab-order-item__fields">
          <label>
            検体
            <select
              value={draft.specimen_code}
              onChange={(e) => setDraft({ ...draft, specimen_code: e.target.value, container_code: "" })}
            >
              <option value="">未設定</option>
              {specimens.data?.items.map((specimen) => (
                <option key={specimen.specimen_code} value={specimen.specimen_code}>
                  {specimen.specimen_code} {specimen.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            採取管
            <select
              value={draft.container_code}
              onChange={(e) => setDraft({ ...draft, container_code: e.target.value })}
            >
              <option value="">
                {defaultContainerName ? `検体の既定(${defaultContainerName})` : "未設定"}
              </option>
              {containers.data?.items.map((container) => (
                <option key={container.container_code} value={container.container_code}>
                  {container.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            実施区分
            <select
              value={draft.execution_type}
              onChange={(e) => setDraft({ ...draft, execution_type: e.target.value })}
            >
              <option value="">未設定</option>
              <option value="in_house">院内</option>
              <option value="outsourced">外注</option>
            </select>
          </label>
          <label>
            レセ電算コード
            <input
              type="text"
              value={draft.receipt_code}
              onChange={(e) => setDraft({ ...draft, receipt_code: e.target.value })}
            />
          </label>
        </div>

        <div className="lab-order-item__fields">
          <label>
            JLACコード
            <input
              type="text"
              value={draft.jlac_code}
              onChange={(e) => setDraft({ ...draft, jlac_code: e.target.value })}
            />
          </label>
          <label>
            コード体系
            <select
              value={draft.jlac_code_system}
              onChange={(e) => setDraft({ ...draft, jlac_code_system: e.target.value })}
            >
              <option value="">未設定</option>
              <option value="jlac11">JLAC11</option>
              <option value="jlac10">JLAC10</option>
            </select>
          </label>
          <label>
            有効開始日
            <input
              type="date"
              value={draft.valid_from}
              onChange={(e) => setDraft({ ...draft, valid_from: e.target.value })}
            />
          </label>
          <label>
            有効終了日
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
        <ErrorBanner error={mutations.create.error ?? mutations.update.error ?? mutations.remove.error} />

        <div className="lab-order-item__actions">
          <button type="submit" disabled={saving}>
            保存
          </button>
          <button type="button" onClick={() => setSearchingJlac(true)}>
            JLACマスタから検索
          </button>
          {itemId !== null && (
            <button type="button" onClick={handleDelete} disabled={mutations.remove.isPending}>
              削除
            </button>
          )}
        </div>
      </form>

      {itemId !== null && draft.kind === "panel" && detail.data && (
        <PanelItemsEditor
          panelItemCode={detail.data.order_item_code}
          panelItems={detail.data.panel_items}
        />
      )}

      {searchingJlac && (
        <LabItemSearchModal onSelect={handleSelectLabItem} onClose={() => setSearchingJlac(false)} />
      )}
    </Modal>
  );
}

interface PanelItemsEditorProps {
  panelItemCode: string;
  panelItems: NonNullable<ReturnType<typeof useLabOrderItem>["data"]>["panel_items"];
}

function PanelItemsEditor({ panelItemCode, panelItems }: PanelItemsEditorProps) {
  const mutations = useLabPanelItemMutations();
  const [query, setQuery] = useState("");
  const candidates = useLabOrderItemSearch({ name: query }, 1, query.trim().length > 0);

  const memberCodes = new Set(panelItems.map((m) => m.member_item_code));

  return (
    <section className="lab-order-item__section">
      <div className="lab-order-item__section-head">
        <h3>パネル構成</h3>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="追加する項目を名称で検索"
        />
      </div>

      {query.trim().length > 0 && (
        <ul className="lab-order-item__candidates">
          {candidates.data?.items
            .filter((item) => item.order_item_code !== panelItemCode && !memberCodes.has(item.order_item_code))
            .map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={async () => {
                    setQuery("");
                    await mutations.create.mutateAsync({
                      panel_item_code: panelItemCode,
                      member_item_code: item.order_item_code,
                    });
                  }}
                >
                  {item.name}
                  <span className="lab-order-item__code">{item.order_item_code}</span>
                </button>
              </li>
            ))}
        </ul>
      )}

      <ErrorBanner error={mutations.create.error ?? mutations.update.error ?? mutations.remove.error} />

      <div className="lab-order-item__table-wrap">
        <table className="master-search__table">
          <thead>
            <tr>
              <th>構成項目</th>
              <th>コード</th>
              <th className="lab-order-item__compact">区分</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {panelItems.map((member) => (
              <tr key={member.id}>
                <td>{member.member_name ?? member.member_item_code}</td>
                <td>{member.member_item_code}</td>
                <td className="lab-order-item__compact">
                  <select
                    value={member.member_type}
                    onChange={(e) =>
                      mutations.update.mutate({ id: member.id, payload: { member_type: e.target.value } })
                    }
                  >
                    {Object.entries(MEMBER_TYPE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="master-search__actions">
                  <button type="button" onClick={() => mutations.remove.mutate(member.id)}>
                    外す
                  </button>
                </td>
              </tr>
            ))}
            {panelItems.length === 0 && (
              <tr>
                <td colSpan={4} className="master-search__empty">
                  構成項目がありません。名称で検索して追加してください。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
