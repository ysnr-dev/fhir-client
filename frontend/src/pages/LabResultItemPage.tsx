import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { LabItem, LabReferenceRange, LabResultItemPayload } from "../api/masterClient";
import {
  useLabReferenceRangeMutations,
  useLabResultItem,
  useLabResultItemMutations,
  useLabResultItemSearch,
  useLabSpecimenOptions,
  type LabResultItemFilters,
} from "../api/masterQueries";
import { ErrorBanner } from "../components/ErrorBanner";
import { LabItemSearchModal } from "../components/LabItemSearchModal";
import {
  LAB_CATEGORIES,
  LAB_DATA_TYPE_LABELS,
  LAB_REFERENCE_SEX_LABELS,
} from "../components/labOrderItemOptions";
import { Modal } from "../components/Modal";

// 検体検査の結果項目(施設マスタ)のメンテナンス。検査結果として返ってくる単位で、
// データ型・単位・選択肢を持つ。オーダー項目との対応づけは検査オーダー項目マスタ側で行う。
// 配布の共有項目JLACコードマスタ(JLAC11)から属性を引き当てて登録できる。

// JLAC11 は17桁固定で、10〜12桁目が材料(検体)コード。
const JLAC11_LENGTH = 17;
const SPECIMEN_CODE_START = 9;
const SPECIMEN_CODE_END = 12;

function specimenCodeFromJlac11(code: string): string {
  return code.length === JLAC11_LENGTH ? code.slice(SPECIMEN_CODE_START, SPECIMEN_CODE_END) : "";
}

// 編集フォームの値。input で扱うため全て文字列で持ち、保存時に payload へ変換する。
interface Draft {
  result_item_code: string;
  name: string;
  short_name: string;
  name_kana: string;
  category: string;
  specimen_code: string;
  data_type: string;
  display_unit: string;
  ucum_unit: string;
  code_value_list: string;
  value_code_system: string;
  decimal_places: string;
  jlac11_code: string;
  jlac10_code: string;
  loinc_code: string;
  valid_from: string;
  valid_to: string;
  display_order: string;
  note: string;
}

const emptyDraft: Draft = {
  result_item_code: "",
  name: "",
  short_name: "",
  name_kana: "",
  category: "",
  specimen_code: "",
  data_type: "PQ",
  display_unit: "",
  ucum_unit: "",
  code_value_list: "",
  value_code_system: "",
  decimal_places: "",
  jlac11_code: "",
  jlac10_code: "",
  loinc_code: "",
  valid_from: "",
  valid_to: "",
  display_order: "",
  note: "",
};

function toPayload(draft: Draft): LabResultItemPayload {
  return {
    result_item_code: draft.result_item_code,
    name: draft.name,
    short_name: draft.short_name || null,
    name_kana: draft.name_kana || null,
    category: draft.category || null,
    specimen_code: draft.specimen_code || null,
    data_type: draft.data_type,
    display_unit: draft.display_unit || null,
    ucum_unit: draft.ucum_unit || null,
    code_value_list: draft.code_value_list || null,
    value_code_system: draft.value_code_system || null,
    decimal_places: draft.decimal_places ? Number(draft.decimal_places) : null,
    jlac11_code: draft.jlac11_code || null,
    jlac10_code: draft.jlac10_code || null,
    loinc_code: draft.loinc_code || null,
    valid_from: draft.valid_from || null,
    valid_to: draft.valid_to || null,
    display_order: draft.display_order ? Number(draft.display_order) : null,
    note: draft.note || null,
  };
}

export function LabResultItemPage() {
  const [inputs, setInputs] = useState<LabResultItemFilters>({});
  const [filters, setFilters] = useState<LabResultItemFilters>({});
  const [page, setPage] = useState(1);
  // 編集対象の id。"new" は新規作成モーダル。
  const [editing, setEditing] = useState<number | "new" | null>(null);

  const list = useLabResultItemSearch(filters, page);
  const hasNext = list.data ? page * list.data.per < list.data.total : false;

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    setFilters(inputs);
    setPage(1);
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>検査結果項目マスタ</h1>
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
            {LAB_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </label>
        <label>
          データ型
          <select
            value={inputs.data_type ?? ""}
            onChange={(e) => setInputs({ ...inputs, data_type: e.target.value })}
          >
            <option value="">すべて</option>
            {Object.entries(LAB_DATA_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
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
            <th>材料</th>
            <th className="lab-order-item__compact">型</th>
            <th>単位</th>
            <th>JLAC11</th>
            <th>JLAC10</th>
            <th>有効期間</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.items.map((item) => (
            <tr key={item.id} onClick={() => setEditing(item.id)} className="master-search__row">
              <td>{item.result_item_code}</td>
              <td>{item.name}</td>
              <td>{item.short_name}</td>
              <td>{item.category}</td>
              <td>{item.specimen_name ?? item.specimen_code}</td>
              <td className="lab-order-item__compact">
                {LAB_DATA_TYPE_LABELS[item.data_type] ?? item.data_type}
              </td>
              <td>{item.display_unit}</td>
              <td>{item.jlac11_code}</td>
              <td>{item.jlac10_code}</td>
              <td className="lab-order-item__compact">
                {(item.valid_from || item.valid_to) && `${item.valid_from ?? ""}〜${item.valid_to ?? ""}`}
              </td>
            </tr>
          ))}
          {list.data && list.data.items.length === 0 && (
            <tr>
              <td colSpan={10} className="master-search__empty">
                検査結果項目がありません
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
  const detail = useLabResultItem(itemId);
  const mutations = useLabResultItemMutations();
  const specimens = useLabSpecimenOptions();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [searchingJlac, setSearchingJlac] = useState(false);

  useEffect(() => {
    if (!detail.data) return;
    const d = detail.data;
    setDraft({
      result_item_code: d.result_item_code,
      name: d.name,
      short_name: d.short_name ?? "",
      name_kana: d.name_kana ?? "",
      category: d.category ?? "",
      specimen_code: d.specimen_code ?? "",
      data_type: d.data_type,
      display_unit: d.display_unit ?? "",
      ucum_unit: d.ucum_unit ?? "",
      code_value_list: d.code_value_list ?? "",
      value_code_system: d.value_code_system ?? "",
      decimal_places: d.decimal_places === null ? "" : String(d.decimal_places),
      jlac11_code: d.jlac11_code ?? "",
      jlac10_code: d.jlac10_code ?? "",
      loinc_code: d.loinc_code ?? "",
      valid_from: d.valid_from ?? "",
      valid_to: d.valid_to ?? "",
      display_order: d.display_order === null ? "" : String(d.display_order),
      note: d.note ?? "",
    });
  }, [detail.data]);

  // 選択肢に無い検査分野が保存済みの場合でも、開いただけで値が消えないよう末尾に足す。
  const categoryOptions = useMemo(
    () =>
      draft.category && !LAB_CATEGORIES.includes(draft.category)
        ? [...LAB_CATEGORIES, draft.category]
        : LAB_CATEGORIES,
    [draft.category],
  );

  // 配布の共有項目JLACコードマスタからの引き当て。結果値を表現する属性(データ型・単位・
  // 選択肢)と標準コードは配布側が正なので上書きし、名称・略称は空のときだけ補完する。
  // 材料は JLAC11 の 10〜12 桁目から入れる(検体マスタも同じ JLAC11 材料コードで持つ)。
  function handleSelectLabItem(item: LabItem) {
    setSearchingJlac(false);
    const specimenCode = specimenCodeFromJlac11(item.jlac11_code);
    setDraft((prev) => ({
      ...prev,
      jlac11_code: item.jlac11_code,
      jlac10_code: item.jlac10_code ?? prev.jlac10_code,
      data_type: item.data_type || prev.data_type,
      display_unit: item.display_unit ?? "",
      ucum_unit: item.xml_unit ?? "",
      code_value_list: item.code_value_list ?? "",
      value_code_system: item.code_oid ?? "",
      name: prev.name || (item.fhir_item_name ?? ""),
      short_name: prev.short_name || (item.abbreviation ?? ""),
      category: item.category_name || prev.category,
      specimen_code: specimenCode || prev.specimen_code,
    }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!draft.result_item_code || !draft.name) return;

    if (itemId === null) {
      await mutations.create.mutateAsync(toPayload(draft));
      onClose();
    } else {
      await mutations.update.mutateAsync({ id: itemId, payload: toPayload(draft) });
    }
  }

  async function handleDelete() {
    if (itemId === null || !detail.data) return;
    const orderCount = detail.data.order_items.length;
    const message =
      orderCount > 0
        ? `${detail.data.name} を削除しますか？（オーダー項目 ${orderCount} 件との対応も削除されます）`
        : `${detail.data.name} を削除しますか？`;
    if (!window.confirm(message)) return;

    await mutations.remove.mutateAsync(itemId);
    onClose();
  }

  const saving = mutations.create.isPending || mutations.update.isPending;
  const isCoded = draft.data_type === "CD" || draft.data_type === "CO";

  return (
    <Modal
      title={itemId === null ? "検査結果項目を追加" : "検査結果項目を編集"}
      onClose={onClose}
      className="modal--lab-order-item"
    >
      <form onSubmit={handleSubmit}>
        <div className="lab-order-item__fields">
          <label>
            項目コード
            <input
              type="text"
              value={draft.result_item_code}
              onChange={(e) => setDraft({ ...draft, result_item_code: e.target.value })}
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
            材料
            <select
              value={draft.specimen_code}
              onChange={(e) => setDraft({ ...draft, specimen_code: e.target.value })}
            >
              <option value="">未設定</option>
              {specimens.data?.items.map((specimen) => (
                <option key={specimen.specimen_code} value={specimen.specimen_code}>
                  {specimen.specimen_code} {specimen.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="lab-order-item__fields">
          <label>
            データ型
            <select
              value={draft.data_type}
              onChange={(e) => setDraft({ ...draft, data_type: e.target.value })}
            >
              {Object.entries(LAB_DATA_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            表示単位
            <input
              type="text"
              value={draft.display_unit}
              onChange={(e) => setDraft({ ...draft, display_unit: e.target.value })}
              disabled={draft.data_type !== "PQ"}
            />
          </label>
          <label>
            UCUM単位
            <input
              type="text"
              value={draft.ucum_unit}
              onChange={(e) => setDraft({ ...draft, ucum_unit: e.target.value })}
              disabled={draft.data_type !== "PQ"}
            />
          </label>
          <label>
            小数桁
            <input
              type="number"
              min={0}
              value={draft.decimal_places}
              onChange={(e) => setDraft({ ...draft, decimal_places: e.target.value })}
              disabled={draft.data_type !== "PQ"}
            />
          </label>
          <label>
            選択肢(1：陽性、2：陰性)
            <input
              type="text"
              value={draft.code_value_list}
              onChange={(e) => setDraft({ ...draft, code_value_list: e.target.value })}
              disabled={!isCoded}
            />
          </label>
          <label>
            選択肢のCodeSystem
            <input
              type="text"
              value={draft.value_code_system}
              onChange={(e) => setDraft({ ...draft, value_code_system: e.target.value })}
              disabled={!isCoded}
            />
          </label>
        </div>

        <div className="lab-order-item__fields">
          <label>
            JLAC11
            <input
              type="text"
              value={draft.jlac11_code}
              onChange={(e) => setDraft({ ...draft, jlac11_code: e.target.value })}
            />
          </label>
          <label>
            JLAC10
            <input
              type="text"
              value={draft.jlac10_code}
              onChange={(e) => setDraft({ ...draft, jlac10_code: e.target.value })}
            />
          </label>
          <label>
            LOINC
            <input
              type="text"
              value={draft.loinc_code}
              onChange={(e) => setDraft({ ...draft, loinc_code: e.target.value })}
            />
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

        <ErrorBanner error={detail.error ?? specimens.error} />
        <ErrorBanner error={mutations.create.error ?? mutations.update.error ?? mutations.remove.error} />

        <div className="lab-order-item__actions">
          <button type="submit" disabled={saving}>
            保存
          </button>
          <button type="button" onClick={() => setSearchingJlac(true)}>
            配布JLACマスタから引き当て
          </button>
          {itemId !== null && (
            <button type="button" onClick={handleDelete} disabled={mutations.remove.isPending}>
              削除
            </button>
          )}
        </div>
      </form>

      {/* 基準値は数値型だけ。性別・年齢帯ごとに複数行持てる。 */}
      {itemId !== null && detail.data && draft.data_type === "PQ" && (
        <ReferenceRangesEditor
          resultItemCode={detail.data.result_item_code}
          unit={draft.display_unit}
          ranges={detail.data.reference_ranges}
        />
      )}

      {itemId !== null && detail.data && (
        <section className="lab-order-item__section">
          <div className="lab-order-item__section-head">
            <h3>この項目を返すオーダー項目</h3>
          </div>
          <div className="lab-order-item__table-wrap">
            <table className="master-search__table">
              <thead>
                <tr>
                  <th>オーダー項目</th>
                  <th>コード</th>
                </tr>
              </thead>
              <tbody>
                {detail.data.order_items.map((ref) => (
                  <tr key={ref.id}>
                    <td>{ref.order_item_name ?? ref.order_item_code}</td>
                    <td>{ref.order_item_code}</td>
                  </tr>
                ))}
                {detail.data.order_items.length === 0 && (
                  <tr>
                    <td colSpan={2} className="master-search__empty">
                      対応づけられたオーダー項目がありません。検査オーダー項目マスタから対応づけてください。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {searchingJlac && (
        <LabItemSearchModal onSelect={handleSelectLabItem} onClose={() => setSearchingJlac(false)} />
      )}
    </Modal>
  );
}

interface ReferenceRangesEditorProps {
  resultItemCode: string;
  unit: string;
  ranges: LabReferenceRange[];
}

// 基準値の編集。行ごとに入力欄を持ち、欄を離れたときに保存する(プルダウンは即時)。
// 適用は「性別が一致(または共通)し、採取日の満年齢が年齢帯に入る行のうち表示順の先頭」なので、
// 男女別の行と共通の行を混ぜるときは並びに注意する(labResultHelpers の matchReferenceRange)。
function ReferenceRangesEditor({ resultItemCode, unit, ranges }: ReferenceRangesEditorProps) {
  const mutations = useLabReferenceRangeMutations();

  async function add() {
    await mutations.create.mutateAsync({ result_item_code: resultItemCode, lower_limit: 0 });
  }

  async function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= ranges.length) return;
    const reordered = [...ranges];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    await Promise.all(
      reordered.flatMap((range, position) =>
        range.display_order === position + 1
          ? []
          : [mutations.update.mutateAsync({ id: range.id, payload: { display_order: position + 1 } })],
      ),
    );
  }

  return (
    <section className="lab-order-item__section">
      <div className="lab-order-item__section-head">
        <h3>基準値{unit ? `(${unit})` : ""}</h3>
        <button type="button" onClick={add} disabled={mutations.create.isPending}>
          行を追加
        </button>
      </div>

      <ErrorBanner error={mutations.create.error ?? mutations.update.error ?? mutations.remove.error} />

      <div className="lab-order-item__table-wrap">
        <table className="master-search__table">
          <thead>
            <tr>
              <th className="lab-order-item__compact">性別</th>
              <th className="lab-order-item__compact">年齢(歳)</th>
              <th className="lab-order-item__compact">下限</th>
              <th className="lab-order-item__compact">上限</th>
              <th>備考</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {ranges.map((range, index) => (
              <ReferenceRangeRow
                key={range.id}
                range={range}
                onChange={(payload) => mutations.update.mutate({ id: range.id, payload })}
                onMoveUp={index > 0 ? () => move(index, -1) : undefined}
                onMoveDown={index < ranges.length - 1 ? () => move(index, 1) : undefined}
                onRemove={() => mutations.remove.mutate(range.id)}
              />
            ))}
            {ranges.length === 0 && (
              <tr>
                <td colSpan={6} className="master-search__empty">
                  基準値がありません。「行を追加」で下限・上限を登録すると、結果登録時に H/L を自動判定します。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

interface ReferenceRangeRowProps {
  range: LabReferenceRange;
  onChange: (payload: {
    sex?: string | null;
    age_from?: number | null;
    age_to?: number | null;
    lower_limit?: number | null;
    upper_limit?: number | null;
    note?: string | null;
  }) => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onRemove: () => void;
}

function ReferenceRangeRow({ range, onChange, onMoveUp, onMoveDown, onRemove }: ReferenceRangeRowProps) {
  // 入力中の値。欄を離れたときに保存済みの値と違えば更新する。
  const [draft, setDraft] = useState({
    age_from: range.age_from === null ? "" : String(range.age_from),
    age_to: range.age_to === null ? "" : String(range.age_to),
    lower_limit: range.lower_limit === null ? "" : String(Number(range.lower_limit)),
    upper_limit: range.upper_limit === null ? "" : String(Number(range.upper_limit)),
    note: range.note ?? "",
  });

  useEffect(() => {
    setDraft({
      age_from: range.age_from === null ? "" : String(range.age_from),
      age_to: range.age_to === null ? "" : String(range.age_to),
      lower_limit: range.lower_limit === null ? "" : String(Number(range.lower_limit)),
      upper_limit: range.upper_limit === null ? "" : String(Number(range.upper_limit)),
      note: range.note ?? "",
    });
  }, [range]);

  function commitNumber(field: "age_from" | "age_to" | "lower_limit" | "upper_limit") {
    const raw = draft[field].trim();
    const next = raw === "" ? null : Number(raw);
    if (raw !== "" && Number.isNaN(next)) return;
    const current = range[field] === null ? null : Number(range[field]);
    if (next === current) return;
    onChange({ [field]: next });
  }

  function commitNote() {
    const next = draft.note.trim() || null;
    if (next === (range.note ?? null)) return;
    onChange({ note: next });
  }

  return (
    <tr>
      <td className="lab-order-item__compact">
        <select value={range.sex ?? ""} onChange={(e) => onChange({ sex: e.target.value || null })}>
          {Object.entries(LAB_REFERENCE_SEX_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </td>
      <td className="lab-order-item__compact">
        <span className="lab-order-item__range">
          <input
            type="number"
            min={0}
            value={draft.age_from}
            placeholder="0"
            onChange={(e) => setDraft({ ...draft, age_from: e.target.value })}
            onBlur={() => commitNumber("age_from")}
            aria-label="開始年齢"
          />
          〜
          <input
            type="number"
            min={0}
            value={draft.age_to}
            placeholder="上限なし"
            onChange={(e) => setDraft({ ...draft, age_to: e.target.value })}
            onBlur={() => commitNumber("age_to")}
            aria-label="終了年齢"
          />
        </span>
      </td>
      <td className="lab-order-item__compact">
        <input
          type="number"
          step="any"
          value={draft.lower_limit}
          onChange={(e) => setDraft({ ...draft, lower_limit: e.target.value })}
          onBlur={() => commitNumber("lower_limit")}
          aria-label="下限"
        />
      </td>
      <td className="lab-order-item__compact">
        <input
          type="number"
          step="any"
          value={draft.upper_limit}
          onChange={(e) => setDraft({ ...draft, upper_limit: e.target.value })}
          onBlur={() => commitNumber("upper_limit")}
          aria-label="上限"
        />
      </td>
      <td>
        <input
          type="text"
          value={draft.note}
          onChange={(e) => setDraft({ ...draft, note: e.target.value })}
          onBlur={commitNote}
          aria-label="備考"
        />
      </td>
      <td className="master-search__actions">
        <button type="button" onClick={onMoveUp} disabled={!onMoveUp}>
          ↑
        </button>
        <button type="button" onClick={onMoveDown} disabled={!onMoveDown}>
          ↓
        </button>
        <button type="button" onClick={onRemove}>
          外す
        </button>
      </td>
    </tr>
  );
}
