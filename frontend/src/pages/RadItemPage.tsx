import { useEffect, useMemo, useState, type FormEvent } from "react";
import type {
  RadFrequentCode,
  RadItemDetail,
  RadItemPayload,
  RadJj1017Catalog,
  RadJj1017Code,
  RadJj1017Elements,
} from "../api/masterClient";
import {
  useRadItem,
  useRadItemMutations,
  useRadItemSearch,
  useRadJj1017Catalog,
  useRadJj1017Elements,
  useRadSetItemMutations,
  type RadItemFilters,
} from "../api/masterQueries";
import { ErrorBanner } from "../components/ErrorBanner";
import { Modal } from "../components/Modal";
import { RadFrequentCodeSearchModal } from "../components/RadFrequentCodeSearchModal";

const KIND_LABELS: Record<string, string> = {
  single: "単項目",
  set: "セット",
};

// 種別(モダリティ)コード → 別表2が持つモダリティ別の使用可否フラグ。
// 部位の候補を「その撮影で使う部位」から先に見せるために使う。
// 表に対応する列が無いモダリティ(核医学・治療など)は絞り込まない。
const MODALITY_BODY_PART_FLAG: Record<string, keyof RadJj1017Code> = {
  "1": "use_general",
  "2": "use_general",
  "4": "use_general",
  "5": "use_general",
  "6": "use_ct",
  "7": "use_mr",
  "9": "use_us",
  F: "use_general",
  G: "use_general",
  H: "use_general",
};

// 編集フォームの値。input で扱うため全て文字列で持ち、保存時に payload へ変換する。
interface Draft {
  item_code: string;
  name: string;
  short_name: string;
  name_kana: string;
  kind: string;
  generic_extension_code: string;
  valid_from: string;
  valid_to: string;
  receipt_code: string;
  display_order: string;
  note: string;
}

const emptyDraft: Draft = {
  item_code: "",
  name: "",
  short_name: "",
  name_kana: "",
  kind: "single",
  generic_extension_code: "",
  valid_from: "",
  valid_to: "",
  receipt_code: "",
  display_order: "",
  note: "",
};

// 要素コードは要素名をキーに持つ(列名は保存時に <要素名>_code へ写す)。
type ElementCodes = Record<string, string>;

function toPayload(draft: Draft, elementCodes: ElementCodes, elementNames: string[]): RadItemPayload {
  const payload: RadItemPayload = {
    item_code: draft.item_code,
    name: draft.name,
    short_name: draft.short_name || null,
    name_kana: draft.name_kana || null,
    kind: draft.kind,
    generic_extension_code: draft.generic_extension_code || null,
    valid_from: draft.valid_from || null,
    valid_to: draft.valid_to || null,
    receipt_code: draft.receipt_code || null,
    display_order: draft.display_order ? Number(draft.display_order) : null,
    note: draft.note || null,
  };
  for (const element of elementNames) {
    // セットは撮影そのものではないので要素を持たせない。
    const value = draft.kind === "set" ? "" : (elementCodes[element] ?? "");
    (payload as Record<string, unknown>)[`${element}_code`] = value || null;
  }
  return payload;
}

// 要素コードから32桁コードを組み立てる。桁の割り当ては要素APIが返す
// offset/length をそのまま使い、画面側では持たない。
function composeJj1017Code(
  meta: RadJj1017Elements,
  elementCodes: ElementCodes,
  genericExtension: string,
): string {
  const buffer = Array<string>(meta.code_length).fill("0");

  const place = (offset: number, length: number, value: string) => {
    const padded = value.padStart(length, "0").slice(0, length);
    for (let i = 0; i < length; i += 1) buffer[offset + i] = padded[i];
  };

  for (const element of meta.elements) {
    const value = elementCodes[element.element];
    if (value) place(element.offset, element.length, value);
  }
  if (genericExtension) {
    place(meta.generic_extension.offset, meta.generic_extension.length, genericExtension);
  }
  return buffer.join("");
}

export function RadItemPage() {
  const [inputs, setInputs] = useState<RadItemFilters>({});
  const [filters, setFilters] = useState<RadItemFilters>({});
  const [page, setPage] = useState(1);
  // 編集対象の id。"new" は新規作成モーダル。
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [bulkCreating, setBulkCreating] = useState(false);
  const [bulkResult, setBulkResult] = useState<string | null>(null);

  const list = useRadItemSearch(filters, page);
  const catalog = useRadJj1017Catalog();
  const mutations = useRadItemMutations();
  const bulk = mutations.bulkCreateFromFrequent;

  const hasNext = list.data ? page * list.data.per < list.data.total : false;
  const elementNames = list.data?.elements ?? {};

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    setFilters(inputs);
    setPage(1);
  }

  async function handleBulkCreate(codes: RadFrequentCode[]) {
    const result = await bulk.mutateAsync(codes.map((code) => code.id));
    setBulkCreating(false);
    const parts = [`${result.created} 件を作成しました`];
    if (result.skipped.length > 0) parts.push(`登録済みの ${result.skipped.length} 件は作成しませんでした`);
    if (result.errors.length > 0) parts.push(`${result.errors.length} 件は登録できませんでした`);
    setBulkResult(parts.join(" / "));
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>放射線オーダー項目マスタ</h1>
        <div className="page__header-actions">
          <button
            type="button"
            onClick={() => {
              setBulkResult(null);
              setBulkCreating(true);
            }}
          >
            頻用コード表から一括作成
          </button>
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
          種別(モダリティ)
          <select
            value={inputs.modalityCode ?? ""}
            onChange={(e) => setInputs({ ...inputs, modalityCode: e.target.value })}
          >
            <option value="">すべて</option>
            {catalog.data?.modality?.map((modality) => (
              <option key={modality.code} value={modality.code}>
                {modality.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          区分
          <select
            value={inputs.kind ?? ""}
            onChange={(e) => setInputs({ ...inputs, kind: e.target.value })}
          >
            <option value="">すべて</option>
            <option value="single">単項目</option>
            <option value="set">セット</option>
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
      <ErrorBanner error={bulk.error} />
      {bulkResult && (
        <p className="master-import-form__success" role="status">
          {bulkResult}
        </p>
      )}

      <table className="master-search__table">
        <thead>
          <tr>
            <th>コード</th>
            <th>名称</th>
            <th>略称</th>
            <th>種別</th>
            <th>部位</th>
            <th className="rad-item__compact">区分</th>
            <th className="rad-frequent__code">JJ1017-32</th>
            <th className="rad-item__compact">有効期間</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.items.map((item) => (
            <tr key={item.id} onClick={() => setEditing(item.id)} className="master-search__row">
              <td>{item.item_code}</td>
              <td>{item.name}</td>
              <td>{item.short_name}</td>
              <td>
                {item.modality_code
                  ? (elementNames.modality?.[item.modality_code] ?? item.modality_code)
                  : ""}
              </td>
              <td>
                {item.body_part_code
                  ? (elementNames.body_part?.[item.body_part_code] ?? item.body_part_code)
                  : ""}
              </td>
              <td className="rad-item__compact">{KIND_LABELS[item.kind] ?? item.kind}</td>
              <td className="rad-frequent__code">{item.jj1017_code}</td>
              <td className="rad-item__compact">
                {(item.valid_from || item.valid_to) && `${item.valid_from ?? ""}〜${item.valid_to ?? ""}`}
              </td>
            </tr>
          ))}
          {list.data && list.data.items.length === 0 && (
            <tr>
              <td colSpan={8} className="master-search__empty">
                放射線オーダー項目がありません
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

      {bulkCreating && (
        <RadFrequentCodeSearchModal
          multiple
          pending={bulk.isPending}
          onConfirm={handleBulkCreate}
          onClose={() => setBulkCreating(false)}
        />
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
  const detail = useRadItem(itemId);
  const meta = useRadJj1017Elements();
  const catalog = useRadJj1017Catalog();
  const mutations = useRadItemMutations();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [elementCodes, setElementCodes] = useState<ElementCodes>({});
  const [searchingFrequent, setSearchingFrequent] = useState(false);

  const elementNames = useMemo(
    () => meta.data?.elements.map((element) => element.element) ?? [],
    [meta.data],
  );

  useEffect(() => {
    if (!detail.data) return;
    const d = detail.data;
    setDraft({
      item_code: d.item_code,
      name: d.name,
      short_name: d.short_name ?? "",
      name_kana: d.name_kana ?? "",
      kind: d.kind,
      generic_extension_code: d.generic_extension_code ?? "",
      valid_from: d.valid_from ?? "",
      valid_to: d.valid_to ?? "",
      receipt_code: d.receipt_code ?? "",
      display_order: d.display_order === null ? "" : String(d.display_order),
      note: d.note ?? "",
    });
    setElementCodes(readElementCodes(d));
  }, [detail.data]);

  // 頻用コードを選んだら、その32桁コードの中身をそのまま要素として写す。
  // 名称は空のときだけ埋める(手で付けた名前を上書きしない)。
  function handleSelectFrequent(code: RadFrequentCode) {
    if (!meta.data) return;
    setSearchingFrequent(false);
    const next: ElementCodes = {};
    for (const element of meta.data.elements) {
      const value = code.jj1017_code.slice(element.offset, element.offset + element.length);
      if (value !== "0".repeat(element.length)) next[element.element] = value;
    }
    const generic = code.jj1017_code.slice(
      meta.data.generic_extension.offset,
      meta.data.generic_extension.offset + meta.data.generic_extension.length,
    );
    setElementCodes(next);
    setDraft((prev) => ({
      ...prev,
      name: prev.name || code.name,
      generic_extension_code: generic === "00" ? "" : generic,
    }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!draft.name) return;

    const payload = toPayload(draft, elementCodes, elementNames);
    if (itemId === null) {
      await mutations.create.mutateAsync(payload);
      onClose();
    } else {
      await mutations.update.mutateAsync({ id: itemId, payload });
    }
  }

  async function handleDelete() {
    if (itemId === null || !detail.data) return;
    const message =
      detail.data.kind === "set"
        ? `${detail.data.name} を削除しますか？（セット構成も削除されます）`
        : `${detail.data.name} を削除しますか？`;
    if (!window.confirm(message)) return;

    await mutations.remove.mutateAsync(itemId);
    onClose();
  }

  const saving = mutations.create.isPending || mutations.update.isPending;
  const isSet = draft.kind === "set";
  const preview = meta.data
    ? composeJj1017Code(meta.data, elementCodes, draft.generic_extension_code)
    : "";

  return (
    <Modal
      title={itemId === null ? "放射線オーダー項目を追加" : "放射線オーダー項目を編集"}
      onClose={onClose}
      className="modal--lab-order-item"
    >
      <form onSubmit={handleSubmit}>
        <div className="lab-order-item__fields">
          <label>
            項目コード
            <input
              type="text"
              value={draft.item_code}
              onChange={(e) => setDraft({ ...draft, item_code: e.target.value })}
              placeholder={itemId === null ? "空欄なら自動採番" : undefined}
              disabled={itemId !== null}
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
            区分
            <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>
              <option value="single">単項目</option>
              <option value="set">セット</option>
            </select>
          </label>
        </div>

        <div className="lab-order-item__fields">
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
            レセ電算コード
            <input
              type="text"
              value={draft.receipt_code}
              onChange={(e) => setDraft({ ...draft, receipt_code: e.target.value })}
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

        {isSet ? (
          <p className="rad-code__summary">
            セットは撮影そのものではないため JJ1017 の要素を持ちません。構成する単項目を下で登録してください。
          </p>
        ) : (
          <ElementFields
            meta={meta.data}
            catalog={catalog.data}
            elementCodes={elementCodes}
            genericExtension={draft.generic_extension_code}
            preview={preview}
            onChangeElement={(element, value) =>
              setElementCodes((prev) => ({ ...prev, [element]: value }))
            }
            onChangeGenericExtension={(value) =>
              setDraft((prev) => ({ ...prev, generic_extension_code: value }))
            }
          />
        )}

        <ErrorBanner error={detail.error ?? meta.error ?? catalog.error} />
        <ErrorBanner error={mutations.create.error ?? mutations.update.error ?? mutations.remove.error} />

        <div className="lab-order-item__actions">
          <button type="submit" disabled={saving}>
            保存
          </button>
          {!isSet && (
            <button type="button" onClick={() => setSearchingFrequent(true)}>
              頻用コード表から検索
            </button>
          )}
          {itemId !== null && (
            <button type="button" onClick={handleDelete} disabled={mutations.remove.isPending}>
              削除
            </button>
          )}
        </div>
      </form>

      {itemId !== null && isSet && detail.data && (
        <SetItemsEditor setItemCode={detail.data.item_code} setItems={detail.data.set_items} />
      )}

      {searchingFrequent && (
        <RadFrequentCodeSearchModal
          onSelect={handleSelectFrequent}
          onClose={() => setSearchingFrequent(false)}
        />
      )}
    </Modal>
  );
}

// 保存済みの <要素名>_code 列を、要素名をキーにした形へ読み替える。
function readElementCodes(item: RadItemDetail): ElementCodes {
  const source = item as unknown as Record<string, string | null>;
  const codes: ElementCodes = {};
  for (const [key, value] of Object.entries(source)) {
    if (!key.endsWith("_code") || key === "jj1017_code" || key === "item_code") continue;
    if (key === "receipt_code" || key === "generic_extension_code") continue;
    if (value) codes[key.slice(0, -"_code".length)] = value;
  }
  return codes;
}

interface ElementFieldsProps {
  meta: RadJj1017Elements | undefined;
  catalog: RadJj1017Catalog | undefined;
  elementCodes: ElementCodes;
  genericExtension: string;
  preview: string;
  onChangeElement: (element: string, value: string) => void;
  onChangeGenericExtension: (value: string) => void;
}

// JJ1017 の各要素を部品コードマスタから選ぶ。選んだ内容から組み上がる32桁コードを
// その場に出して、保存前に何が送られるか分かるようにする。
function ElementFields({
  meta,
  catalog,
  elementCodes,
  genericExtension,
  preview,
  onChangeElement,
  onChangeGenericExtension,
}: ElementFieldsProps) {
  const modalityCode = elementCodes.modality ?? "";
  const bodyPartFlag = MODALITY_BODY_PART_FLAG[modalityCode];

  return (
    <section className="lab-order-item__section">
      <div className="lab-order-item__section-head">
        <h3>JJ1017 の要素</h3>
        <code className="rad-item__preview">{preview}</code>
      </div>

      <div className="lab-order-item__fields">
        {meta?.elements.map((element) => (
          <label key={element.element}>
            {element.label}
            <select
              value={elementCodes[element.element] ?? ""}
              onChange={(e) => onChangeElement(element.element, e.target.value)}
            >
              <option value="">未設定</option>
              {renderCodeOptions(
                catalog?.[element.element] ?? [],
                element.element === "body_part" ? bodyPartFlag : undefined,
              )}
            </select>
          </label>
        ))}
        <label>
          拡張(汎用)
          <input
            type="text"
            value={genericExtension}
            onChange={(e) => onChangeGenericExtension(e.target.value.toUpperCase())}
            maxLength={meta?.generic_extension.length ?? 2}
            placeholder="00"
          />
        </label>
      </div>
    </section>
  );
}

// 部位は撮影種別で使うものを先に見せる(別表2のモダリティ別使用可否)。
// 対応する列が無いモダリティのときは素直に全件並べる。
function renderCodeOptions(codes: RadJj1017Code[], flag: keyof RadJj1017Code | undefined) {
  const option = (code: RadJj1017Code) => (
    <option key={code.code} value={code.code}>
      {code.code} {code.name}
      {code.common_name ? `（${code.common_name}）` : ""}
    </option>
  );

  if (!flag) return codes.map(option);

  const preferred = codes.filter((code) => code[flag]);
  if (preferred.length === 0) return codes.map(option);
  const rest = codes.filter((code) => !code[flag]);

  return (
    <>
      <optgroup label="この撮影種別で使う部位">{preferred.map(option)}</optgroup>
      <optgroup label="その他">{rest.map(option)}</optgroup>
    </>
  );
}

interface SetItemsEditorProps {
  setItemCode: string;
  setItems: RadItemDetail["set_items"];
}

function SetItemsEditor({ setItemCode, setItems }: SetItemsEditorProps) {
  const mutations = useRadSetItemMutations();
  const [query, setQuery] = useState("");
  const candidates = useRadItemSearch({ name: query }, 1, query.trim().length > 0);

  const memberCodes = new Set(setItems.map((m) => m.member_item_code));

  return (
    <section className="lab-order-item__section">
      <div className="lab-order-item__section-head">
        <h3>セット構成</h3>
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
            .filter((item) => item.item_code !== setItemCode && !memberCodes.has(item.item_code))
            .map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={async () => {
                    setQuery("");
                    await mutations.create.mutateAsync({
                      set_item_code: setItemCode,
                      member_item_code: item.item_code,
                    });
                  }}
                >
                  {item.name}
                  <span className="lab-order-item__code">{item.item_code}</span>
                </button>
              </li>
            ))}
        </ul>
      )}

      <ErrorBanner error={mutations.create.error ?? mutations.remove.error} />

      <div className="lab-order-item__table-wrap">
        <table className="master-search__table">
          <thead>
            <tr>
              <th>構成項目</th>
              <th>コード</th>
              <th className="rad-frequent__code">JJ1017-32</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {setItems.map((member) => (
              <tr key={member.id}>
                <td>{member.member_name ?? member.member_item_code}</td>
                <td>{member.member_item_code}</td>
                <td className="rad-frequent__code">{member.member_jj1017_code}</td>
                <td className="master-search__actions">
                  <button type="button" onClick={() => mutations.remove.mutate(member.id)}>
                    外す
                  </button>
                </td>
              </tr>
            ))}
            {setItems.length === 0 && (
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
