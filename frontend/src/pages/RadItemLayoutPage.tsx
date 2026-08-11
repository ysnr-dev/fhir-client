import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  useRadItemLayout,
  useRadItemLayoutCellMutations,
  useRadItemLayoutMutations,
  useRadItemLayouts,
  useRadItemSearch,
} from "../api/masterQueries";
import type { RadItem, RadItemLayoutCell } from "../api/masterClient";
import { ErrorBanner } from "../components/ErrorBanner";
import { Modal } from "../components/Modal";

interface Position {
  row: number;
  column: number;
}

interface LayoutDraft {
  name: string;
  row_count: number;
  column_count: number;
}

export function RadItemLayoutPage() {
  const layouts = useRadItemLayouts();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const layoutMutations = useRadItemLayoutMutations();

  // 初回ロード後は先頭のレイアウトを開いておく。
  useEffect(() => {
    if (selectedId === null && layouts.data && layouts.data.items.length > 0) {
      setSelectedId(layouts.data.items[0].id);
    }
  }, [layouts.data, selectedId]);

  return (
    <div className="page">
      <div className="page__header">
        <h1>放射線オーダーレイアウト</h1>
        <div className="page__header-actions">
          <button type="button" onClick={() => setCreating(true)}>
            レイアウトを追加
          </button>
        </div>
      </div>

      <ErrorBanner error={layouts.error} />

      <div className="order-layout__bar">
        <label>
          レイアウト
          <select
            value={selectedId ?? ""}
            onChange={(e) => setSelectedId(e.target.value ? Number(e.target.value) : null)}
          >
            {layouts.data?.items.map((layout) => (
              <option key={layout.id} value={layout.id}>
                {layout.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {selectedId !== null && (
        <LayoutEditor
          key={selectedId}
          layoutId={selectedId}
          onDeleted={() => setSelectedId(null)}
        />
      )}
      {layouts.data && layouts.data.items.length === 0 && (
        <p className="master-search__empty">レイアウトがありません</p>
      )}

      {creating && (
        <LayoutCreateModal
          pending={layoutMutations.create.isPending}
          error={layoutMutations.create.error}
          onSubmit={async (draft) => {
            const created = await layoutMutations.create.mutateAsync(draft);
            setCreating(false);
            setSelectedId(created.id);
          }}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  );
}

interface LayoutCreateModalProps {
  pending: boolean;
  error: unknown;
  onSubmit: (draft: LayoutDraft) => void;
  onClose: () => void;
}

function LayoutCreateModal({ pending, error, onSubmit, onClose }: LayoutCreateModalProps) {
  const [draft, setDraft] = useState<LayoutDraft>({ name: "", row_count: 10, column_count: 5 });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!draft.name) return;
    onSubmit(draft);
  }

  return (
    <Modal title="レイアウトを追加" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="lab-order-item__fields">
          <label>
            名前
            <input
              type="text"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              required
            />
          </label>
          <label>
            行数
            <input
              type="number"
              min={1}
              max={50}
              value={draft.row_count}
              onChange={(e) => setDraft({ ...draft, row_count: Number(e.target.value) })}
            />
          </label>
          <label>
            列数
            <input
              type="number"
              min={1}
              max={50}
              value={draft.column_count}
              onChange={(e) => setDraft({ ...draft, column_count: Number(e.target.value) })}
            />
          </label>
        </div>
        <ErrorBanner error={error} />
        <div className="lab-order-item__actions">
          <button type="submit" disabled={pending}>
            作成
          </button>
        </div>
      </form>
    </Modal>
  );
}

function LayoutEditor({ layoutId, onDeleted }: { layoutId: number; onDeleted: () => void }) {
  const { data, error } = useRadItemLayout(layoutId);
  const layoutMutations = useRadItemLayoutMutations();
  const cellMutations = useRadItemLayoutCellMutations();
  const [draft, setDraft] = useState<LayoutDraft | null>(null);
  const [selected, setSelected] = useState<Position | null>(null);
  const [draggingCellId, setDraggingCellId] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<Position | null>(null);

  useEffect(() => {
    if (data) {
      setDraft({ name: data.name, row_count: data.row_count, column_count: data.column_count });
    }
  }, [data]);

  const cellsByPosition = useMemo(() => {
    const map = new Map<string, RadItemLayoutCell>();
    for (const cell of data?.cells ?? []) {
      map.set(`${cell.grid_row}-${cell.grid_column}`, cell);
    }
    return map;
  }, [data]);

  if (!data || !draft) {
    return <ErrorBanner error={error} />;
  }

  const selectedCell = selected
    ? (cellsByPosition.get(`${selected.row}-${selected.column}`) ?? null)
    : null;

  async function handleSaveLayout(e: FormEvent) {
    e.preventDefault();
    if (!draft || !data) return;

    // 縮めると範囲外のセルが消える。何マス消えるかを見せてから実行する。
    const removed = data.cells.filter(
      (cell) => cell.grid_row > draft.row_count || cell.grid_column > draft.column_count,
    ).length;
    if (removed > 0 && !window.confirm(`範囲外の ${removed} マスが削除されます。よろしいですか？`)) {
      return;
    }

    await layoutMutations.update.mutateAsync({ id: layoutId, payload: draft });
    setSelected(null);
  }

  async function handleDeleteLayout() {
    if (!data) return;
    if (!window.confirm(`${data.name} を削除しますか？（配置も削除されます）`)) return;

    await layoutMutations.remove.mutateAsync(layoutId);
    onDeleted();
  }

  function handleDrop(target: Position) {
    setDragOver(null);
    if (draggingCellId === null) return;
    const dragged = data?.cells.find((cell) => cell.id === draggingCellId);
    setDraggingCellId(null);
    if (!dragged || (dragged.grid_row === target.row && dragged.grid_column === target.column)) {
      return;
    }
    // 移動先に別のセルが居る場合はサーバー側で位置が入れ替わる。
    cellMutations.update.mutate({
      id: dragged.id,
      payload: { grid_row: target.row, grid_column: target.column },
    });
    setSelected(target);
  }

  const rows = Array.from({ length: data.row_count }, (_, i) => i + 1);
  const columns = Array.from({ length: data.column_count }, (_, i) => i + 1);

  return (
    <>
      <form className="order-layout__bar" onSubmit={handleSaveLayout}>
        <label>
          名前
          <input
            type="text"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            required
          />
        </label>
        <label>
          行数
          <input
            type="number"
            min={1}
            max={50}
            value={draft.row_count}
            onChange={(e) => setDraft({ ...draft, row_count: Number(e.target.value) })}
          />
        </label>
        <label>
          列数
          <input
            type="number"
            min={1}
            max={50}
            value={draft.column_count}
            onChange={(e) => setDraft({ ...draft, column_count: Number(e.target.value) })}
          />
        </label>
        <div className="order-layout__bar-actions">
          <button type="submit" disabled={layoutMutations.update.isPending}>
            保存
          </button>
          <button
            type="button"
            onClick={handleDeleteLayout}
            disabled={layoutMutations.remove.isPending}
          >
            削除
          </button>
        </div>
      </form>

      <ErrorBanner error={error} />
      <ErrorBanner error={layoutMutations.update.error ?? layoutMutations.remove.error} />
      <ErrorBanner
        error={cellMutations.create.error ?? cellMutations.update.error ?? cellMutations.remove.error}
      />

      <div className="order-layout__grid-wrap">
        {/* 列は幅いっぱいに均等割りするが、狭すぎるマスにならないよう最小幅は確保する。 */}
        <table className="order-layout__grid" style={{ minWidth: columns.length * 140 }}>
          <tbody>
            {rows.map((row) => (
              <tr key={row}>
                {columns.map((column) => {
                  const cell = cellsByPosition.get(`${row}-${column}`);
                  const isSelected = selected?.row === row && selected?.column === column;
                  const isDragOver = dragOver?.row === row && dragOver?.column === column;
                  const classes = [
                    "order-layout__cell",
                    cell?.cell_type === "label" ? "order-layout__cell--label" : "",
                    isSelected ? "is-selected" : "",
                    isDragOver ? "is-drag-over" : "",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <td
                      key={column}
                      className={classes}
                      draggable={!!cell}
                      onClick={() => setSelected({ row, column })}
                      onDragStart={() => cell && setDraggingCellId(cell.id)}
                      onDragEnd={() => {
                        setDraggingCellId(null);
                        setDragOver(null);
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragOver({ row, column });
                      }}
                      onDragLeave={() => setDragOver(null)}
                      onDrop={(e) => {
                        e.preventDefault();
                        handleDrop({ row, column });
                      }}
                    >
                      {cell &&
                        (cell.cell_type === "label"
                          ? cell.display_name
                          : (cell.display_name ?? cell.item_name ?? cell.item_code))}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <CellEditor
          layoutId={layoutId}
          position={selected}
          cell={selectedCell}
          mutations={cellMutations}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}

interface CellEditorProps {
  layoutId: number;
  position: Position;
  cell: RadItemLayoutCell | null;
  mutations: ReturnType<typeof useRadItemLayoutCellMutations>;
  onClose: () => void;
}

function CellEditor({ layoutId, position, cell, mutations, onClose }: CellEditorProps) {
  const [displayName, setDisplayName] = useState(cell?.display_name ?? "");
  const [labelText, setLabelText] = useState("");
  const [query, setQuery] = useState("");
  const candidates = useRadItemSearch({ name: query }, 1, query.trim().length > 0);

  // 選択マスが変わったら編集中の値を持ち越さない。
  useEffect(() => {
    setDisplayName(cell?.display_name ?? "");
    setLabelText("");
    setQuery("");
  }, [cell, position.row, position.column]);

  async function handlePlaceItem(item: RadItem) {
    setQuery("");
    await mutations.create.mutateAsync({
      layout_id: layoutId,
      grid_row: position.row,
      grid_column: position.column,
      cell_type: "item",
      item_code: item.item_code,
    });
  }

  async function handlePlaceLabel(e: FormEvent) {
    e.preventDefault();
    if (!labelText) return;
    await mutations.create.mutateAsync({
      layout_id: layoutId,
      grid_row: position.row,
      grid_column: position.column,
      cell_type: "label",
      display_name: labelText,
    });
    setLabelText("");
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!cell) return;
    // item セルは空欄に戻すとオーダー項目の名称に戻る。label は文言必須。
    if (cell.cell_type === "label" && !displayName) return;
    await mutations.update.mutateAsync({
      id: cell.id,
      payload: { display_name: displayName || null },
    });
  }

  function handleRemove() {
    if (!cell) return;
    mutations.remove.mutate(cell.id);
  }

  return (
    <section className="order-layout__editor">
      <div className="lab-order-item__section-head">
        <h3>
          {position.row} 行 {position.column} 列
        </h3>
        <button type="button" onClick={onClose}>
          閉じる
        </button>
      </div>

      {cell ? (
        <form className="order-layout__editor-row" onSubmit={handleSave}>
          <span className="order-layout__editor-kind">
            {cell.cell_type === "label" ? "ラベル" : (cell.item_name ?? cell.item_code)}
          </span>
          <label>
            {cell.cell_type === "label" ? "文言" : "表示名(空ならオーダー項目名)"}
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={cell.cell_type === "item" ? (cell.item_name ?? "") : ""}
            />
          </label>
          <button type="submit" disabled={mutations.update.isPending}>
            保存
          </button>
          <button type="button" onClick={handleRemove} disabled={mutations.remove.isPending}>
            削除
          </button>
        </form>
      ) : (
        <>
          <form className="order-layout__editor-row" onSubmit={handlePlaceLabel}>
            <label>
              ラベルを配置
              <input
                type="text"
                value={labelText}
                onChange={(e) => setLabelText(e.target.value)}
                placeholder="◆ 一般撮影"
              />
            </label>
            <button type="submit" disabled={mutations.create.isPending}>
              追加
            </button>
          </form>
          <div className="order-layout__editor-row">
            <label>
              放射線項目を配置
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="名称で検索"
              />
            </label>
          </div>
          {query.trim().length > 0 && (
            <ul className="lab-order-item__candidates">
              {candidates.data?.items.map((item) => (
                <li key={item.id}>
                  <button type="button" onClick={() => handlePlaceItem(item)}>
                    {item.name}
                    <span className="lab-order-item__code">{item.item_code}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
