import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  documentTemplatePageUrl,
  type DocumentTemplatePagePayload,
  type DocumentTemplateSummary,
} from "../../api/adminClient";
import { useFileCategories } from "../../api/adminQueries";
import { useSaveDocumentFormTemplate } from "../../api/queries";
import {
  FIELD_TYPE_LABELS,
  FIELD_TYPES,
  RESIZE_EDGES,
  addField,
  clientToPage,
  emptyLayout,
  fieldsOnPage,
  fieldStyle,
  moveFields,
  newField,
  normalizeLayout,
  pageOf,
  prepareLayoutForSave,
  pxPerPt,
  removeFields,
  resizeField,
  updateField,
  validateLayout,
  type DocumentFormField,
  type DocumentFormFieldType,
  type DocumentFormLayout,
  type DocumentFormPageMeta,
  type ResizeEdge,
} from "../../fhir/documentFormLayout";
import { formatFileSize } from "../../fhir/patientFileHelpers";
import { useCardDrag, type DragState } from "../../hooks/useCardDrag";
import { useUndoableState } from "../../hooks/useUndoableState";
import { ErrorBanner } from "../ErrorBanner";
import { TrashIcon } from "../icons/TrashIcon";
import { DocumentFormFieldProperties } from "./DocumentFormFieldProperties";
import { DocumentFormPage } from "./DocumentFormPage";

// 様式テンプレートのデザイナ。PDF / 画像をページ画像にし、その上にフィールドを置く。
// 配置は病棟マップ編集と同じ DOM 方式(絶対配置 + scale、useCardDrag で移動・リサイズ、useUndoableState で取り消し)。

type DragItem = { kind: "move"; ids: string[] } | { kind: "resize"; id: string; edge: ResizeEdge };

interface PageSource {
  metas: DocumentFormPageMeta[];
  /** page_number → 画像 URL(登録済みはサーバー、選び直したら dataURL)。 */
  images: Map<number, string>;
  /** 選び直したときだけ送る本体。 */
  payload?: DocumentTemplatePagePayload[];
  fileName: string;
  contentType: string;
}

function initialSource(template: DocumentTemplateSummary | undefined): PageSource {
  if (!template) return { metas: [], images: new Map(), fileName: "", contentType: "" };
  return {
    metas: template.pages,
    images: new Map(template.pages.map((page) => [page.page_number, documentTemplatePageUrl(template, page.page_number)])),
    fileName: template.file_name,
    contentType: template.content_type,
  };
}

export default function DocumentFormDesigner({
  template,
  onSaved,
  onCancel,
}: {
  template?: DocumentTemplateSummary;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(template?.name ?? "");
  const [categoryId, setCategoryId] = useState(template?.file_category_id ? String(template.file_category_id) : "");
  const [source, setSource] = useState<PageSource>(() => initialSource(template));
  const [rasterizing, setRasterizing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pendingType, setPendingType] = useState<DocumentFormFieldType | null>(null);
  const [zoomMode, setZoomMode] = useState<"fit" | "actual">("fit");
  const [fitZoom, setFitZoom] = useState(0.5);

  const { data: categories = [] } = useFileCategories();
  const save = useSaveDocumentFormTemplate();

  const { present: layout, set, commit, undo, redo, canUndo, canRedo } = useUndoableState<DocumentFormLayout>(
    template?.layout ? normalizeLayout(template.layout) : emptyLayout(),
  );
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const pagesRef = useRef(source.metas);
  pagesRef.current = source.metas;

  const page = pageOf(source.metas, currentPage);
  const zoom = zoomMode === "fit" ? fitZoom : 1;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  // 幅に合わせるズーム。スクロール領域の幅からページ幅を割る。
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || !page) return;
    const measure = () => {
      const width = container.clientWidth - 16;
      if (width > 0) setFitZoom(Math.min(1, width / page.width_px));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [page]);

  // ---- ドラッグ(移動・リサイズ) ----
  const dragBase = useRef<DocumentFormLayout | null>(null);
  const lastDelta = useRef({ dx: 0, dy: 0 });

  function applyDrag(base: DocumentFormLayout, item: DragItem, dx: number, dy: number): DocumentFormLayout {
    return item.kind === "move"
      ? moveFields(base, item.ids, dx, dy, pagesRef.current)
      : resizeField(base, item.id, item.edge, dx, dy, pagesRef.current);
  }

  function handleDrop(state: DragState<DragItem>) {
    const base = dragBase.current;
    dragBase.current = null;
    if (!base) return;
    const dx = Math.round((state.x - state.startX) / zoomRef.current);
    const dy = Math.round((state.y - state.startY) / zoomRef.current);
    commit(base, applyDrag(base, state.item, dx, dy));
  }

  const { drag, start, consumeClick } = useCardDrag<DragItem>({ onDrop: handleDrop });

  useEffect(() => {
    if (!drag) {
      // Escape で取りやめたときは掴む前の形に戻す(クリックだけなら dragBase は捨てる)。
      if (dragBase.current && lastDelta.current.dx + lastDelta.current.dy !== 0) set(dragBase.current);
      dragBase.current = null;
      return;
    }
    const base = dragBase.current;
    if (!base || !drag.moved) return;
    const dx = Math.round((drag.x - drag.startX) / zoomRef.current);
    const dy = Math.round((drag.y - drag.startY) / zoomRef.current);
    if (dx === lastDelta.current.dx && dy === lastDelta.current.dy) return;
    lastDelta.current = { dx, dy };
    set(applyDrag(base, drag.item, dx, dy));
  }, [drag, set]);

  function beginDrag(item: DragItem, event: React.PointerEvent) {
    dragBase.current = layoutRef.current;
    lastDelta.current = { dx: 0, dy: 0 };
    start(item, event);
  }

  function handleFieldPointerDown(event: React.PointerEvent, field: DocumentFormField) {
    if (event.button !== 0) return;
    event.stopPropagation();
    let ids: Set<string>;
    if (event.shiftKey) {
      ids = new Set(selectedIds);
      if (ids.has(field.id)) ids.delete(field.id);
      else ids.add(field.id);
    } else {
      ids = selectedIds.has(field.id) ? selectedIds : new Set([field.id]);
    }
    setSelectedIds(ids);
    setPendingType(null);
    beginDrag({ kind: "move", ids: [...ids] }, event);
  }

  function handleHandlePointerDown(event: React.PointerEvent, id: string, edge: ResizeEdge) {
    if (event.button !== 0) return;
    event.stopPropagation();
    beginDrag({ kind: "resize", id, edge }, event);
  }

  function handleCanvasPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || consumeClick()) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || !page) return;
    if (pendingType) {
      const point = clientToPage(rect, zoom, event.clientX, event.clientY);
      const field = newField(pendingType, page.page_number, point.x, point.y);
      set(addField(layoutRef.current, field, source.metas), { record: true });
      setSelectedIds(new Set([field.id]));
      setPendingType(null);
      return;
    }
    setSelectedIds(new Set());
  }

  // ---- キーボード ----
  const removeSelected = useCallback(() => {
    if (selectedIds.size === 0) return;
    set(removeFields(layoutRef.current, selectedIds), { record: true });
    setSelectedIds(new Set());
  }, [selectedIds, set]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      const meta = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (meta && key === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (selectedIds.size === 0) return;
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        removeSelected();
        return;
      }
      const step = event.shiftKey ? 10 : 1;
      const arrows: Record<string, [number, number]> = {
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
      };
      const delta = arrows[event.key];
      if (!delta) return;
      event.preventDefault();
      set((current) => moveFields(current, selectedIds, delta[0], delta[1], pagesRef.current), { record: true });
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedIds, set, undo, redo, removeSelected]);

  // ---- 様式のファイル ----
  async function handleFile(file: File | undefined) {
    if (!file) return;
    setMessage(null);
    setRasterizing(true);
    try {
      const { rasterizeTemplateFile, pagesSizeError } = await import("../../fhir/documentFormRaster");
      const pages = await rasterizeTemplateFile(file);
      const sizeError = pagesSizeError(pages);
      if (sizeError) {
        setMessage(sizeError);
        return;
      }
      const lost = layoutRef.current.fields.filter((field) => field.page > pages.length);
      if (lost.length > 0) {
        if (!window.confirm(`ページ数が ${pages.length} に減るため、${lost.length} 件の項目が消えます。よろしいですか?`)) {
          return;
        }
        set(removeFields(layoutRef.current, lost.map((f) => f.id)), { record: true });
      }
      setSource({
        metas: pages.map(({ dataUrl: _dataUrl, data: _data, ...meta }) => meta),
        images: new Map(pages.map((p) => [p.page_number, p.dataUrl])),
        payload: pages.map(({ dataUrl: _dataUrl, ...payload }) => payload),
        fileName: file.name,
        contentType: file.type === "image/jpeg" ? "image/jpeg" : file.type === "image/png" ? "image/png" : "application/pdf",
      });
      setCurrentPage(1);
      if (!name) setName(file.name.replace(/\.[^.]+$/, ""));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "ファイルを読み込めませんでした。");
    } finally {
      setRasterizing(false);
    }
  }

  async function handleSave() {
    setMessage(null);
    if (!name.trim()) return setMessage("名称を入力してください。");
    const prepared = prepareLayoutForSave(layout);
    const error = validateLayout(prepared, source.metas);
    if (error) return setMessage(error);
    try {
      await save.mutateAsync({
        template,
        name: name.trim(),
        fileCategoryId: categoryId ? Number(categoryId) : null,
        fileName: source.fileName,
        contentType: source.contentType,
        layout: prepared,
        pages: source.payload,
      });
      onSaved();
    } catch {
      // mutation の error を ErrorBanner に出す
    }
  }

  const selectedField = useMemo(
    () => (selectedIds.size === 1 ? layout.fields.find((f) => selectedIds.has(f.id)) : undefined),
    [layout, selectedIds],
  );
  const totalBytes = source.metas.reduce((sum, p) => sum + p.byte_size, 0);
  const saving = save.isPending;

  return (
    <div className="document-form-designer">
      <div className="document-form-designer__head">
        <label>
          名称
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          カテゴリ
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">(未設定)</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          様式
          <input
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
            disabled={rasterizing}
            onChange={(e) => void handleFile(e.target.files?.[0])}
          />
        </label>
        {source.metas.length > 0 && (
          <span className="document-form-designer__source">
            {source.fileName} / {source.metas.length} ページ / {formatFileSize(totalBytes)}
          </span>
        )}
        <div className="document-form-designer__actions">
          <button type="button" disabled={saving || rasterizing} onClick={() => void handleSave()}>
            {saving ? "保存中..." : "保存"}
          </button>
          <button type="button" onClick={onCancel}>
            キャンセル
          </button>
        </div>
      </div>

      {message && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{message}</p>
        </div>
      )}
      <ErrorBanner error={save.error} />
      {rasterizing && <p>ページ画像を作成中...</p>}

      {page && (
        <div className="document-form-designer__body">
          <div className="document-form-designer__main">
            <div className="document-form-designer__toolbar">
              {FIELD_TYPES.map((type) => (
                <button
                  type="button"
                  key={type}
                  className={`rp-card__compact-button${pendingType === type ? " is-selected" : ""}`}
                  aria-pressed={pendingType === type}
                  onClick={() => setPendingType(pendingType === type ? null : type)}
                >
                  {FIELD_TYPE_LABELS[type]}
                </button>
              ))}
              <span className="document-form-designer__sep" />
              <button type="button" className="rp-card__compact-button" disabled={!canUndo} onClick={undo}>
                元に戻す
              </button>
              <button type="button" className="rp-card__compact-button" disabled={!canRedo} onClick={redo}>
                やり直す
              </button>
              <button
                type="button"
                className="rp-card__icon-button"
                disabled={selectedIds.size === 0}
                title="選択した項目を削除"
                aria-label="選択した項目を削除"
                onClick={removeSelected}
              >
                <TrashIcon />
              </button>
              <span className="document-form-designer__sep" />
              {/* ページ切替と表示倍率はまとめて折り返す(途中で行が分かれないように)。 */}
              <span className="document-form-designer__group">
                <button
                  type="button"
                  className="rp-card__compact-button"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage((p) => p - 1)}
                >
                  ‹
                </button>
                <span>
                  {currentPage} / {source.metas.length}
                </span>
                <button
                  type="button"
                  className="rp-card__compact-button"
                  disabled={currentPage >= source.metas.length}
                  onClick={() => setCurrentPage((p) => p + 1)}
                >
                  ›
                </button>
                <span className="document-form-designer__sep" />
                <button
                  type="button"
                  className="rp-card__compact-button"
                  onClick={() => setZoomMode(zoomMode === "fit" ? "actual" : "fit")}
                >
                  {zoomMode === "fit" ? "原寸" : "幅に合わせる"}
                </button>
              </span>
            </div>
            <div
              ref={scrollRef}
              className={`document-form-designer__scroll${pendingType ? " is-placing" : ""}`}
            >
              <DocumentFormPage
                page={page}
                imageUrl={source.images.get(page.page_number) ?? ""}
                zoom={zoom}
                innerRef={canvasRef}
                onPointerDown={handleCanvasPointerDown}
              >
                {fieldsOnPage(layout, page.page_number).map((field) => {
                  const selected = selectedIds.has(field.id);
                  return (
                    <div
                      key={field.id}
                      className={`document-form-field document-form-field--${field.type}${field.mask ? " document-form-field--mask" : ""}${
                        selected ? " is-selected" : ""
                      }`}
                      style={{ ...fieldStyle(field), fontSize: field.font_size * pxPerPt(page) }}
                      onPointerDown={(event) => handleFieldPointerDown(event, field)}
                    >
                      <span className="document-form-field__label">{field.label}</span>
                      {selected &&
                        RESIZE_EDGES.map((edge) => (
                          <span
                            key={edge}
                            className={`document-form-field__handle document-form-field__handle--${edge}`}
                            onPointerDown={(event) => handleHandlePointerDown(event, field.id, edge)}
                          />
                        ))}
                    </div>
                  );
                })}
              </DocumentFormPage>
            </div>
          </div>
          <aside className="document-form-designer__side">
            {selectedField ? (
              <DocumentFormFieldProperties
                field={selectedField}
                pages={source.metas}
                onChange={(next) =>
                  set(updateField(layoutRef.current, next.id, next, pagesRef.current), { record: true })
                }
              />
            ) : (
              <p className="order-select__muted">
                {selectedIds.size > 1 ? `${selectedIds.size} 件を選択中` : "項目を選択してください"}
              </p>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
