import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  CHECKED_VALUE,
  fieldStyle,
  fieldsOnPage,
  pageOf,
  pxPerPt,
  type DocumentFormField,
  type DocumentFormLayout,
  type DocumentFormPageMeta,
  type DocumentFormValues,
} from "../../fhir/documentFormLayout";
import { useEscapeClose } from "../../hooks/useEscapeClose";
import { useKarteFullscreenTop } from "../../hooks/useKarteFullscreenTop";
import { DocumentFormPage } from "./DocumentFormPage";
import { OrderTransferModal } from "./OrderTransferModal";

// 様式の見た目のまま入力する画面。ページ画像の上に、デザイナで置いた位置に入力欄を重ねる。
// 幅はペインに合わせて縮め(zoom)、最大化では右ペイン全体(ボタン列の上まで)、全画面では画面幅いっぱいに広げる。

type FillView = "normal" | "maximized" | "fullscreen";

export function DocumentFormFill({
  patientId,
  layout,
  pages,
  imageUrlOf,
  values,
  onChange,
  actions,
}: {
  patientId: string;
  layout: DocumentFormLayout;
  pages: DocumentFormPageMeta[];
  imageUrlOf: (pageNumber: number) => string;
  values: DocumentFormValues;
  onChange: (values: DocumentFormValues) => void;
  /** ツールバーの右端に置くもの(作成 / 更新ボタン)。全画面でも押せるようにここに置く。 */
  actions?: ReactNode;
}) {
  const [currentPage, setCurrentPage] = useState(1);
  const [view, setView] = useState<FillView>("normal");
  const fullscreen = view === "fullscreen";
  const [transferTarget, setTransferTarget] = useState<DocumentFormField | null>(null);
  const [zoom, setZoom] = useState(0.5);
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fullscreenTop = useKarteFullscreenTop(rootRef, fullscreen);
  useEscapeClose(() => setView("normal"), view !== "normal");

  const page = pageOf(pages, currentPage) ?? pages[0];

  // 幅に合わせる。自動化環境では ResizeObserver が発火しないので、初回は同期で測る。
  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (!container || !page) return;
    const measure = () => {
      const width = container.clientWidth - 2;
      if (width > 0) setZoom(Math.min(1.5, width / page.width_px));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [page, view]);

  useEffect(() => {
    if (!pages.some((p) => p.page_number === currentPage)) setCurrentPage(1);
  }, [pages, currentPage]);

  function setValue(id: string, value: string) {
    onChange({ ...values, [id]: value });
  }

  function appendLines(field: DocumentFormField, lines: string[]) {
    const current = values[field.id] ?? "";
    const joiner = field.type === "textarea" ? "\n" : "、";
    const added = lines.join(joiner);
    setValue(field.id, current ? `${current}${joiner}${added}` : added);
  }

  if (!page) return null;
  const scale = pxPerPt(page);

  return (
    <div
      ref={rootRef}
      className={`document-form-fill${view === "normal" ? "" : ` document-form-fill--${view}`}`}
      style={fullscreen ? { top: fullscreenTop } : undefined}
    >
      <div className="document-form-fill__toolbar">
        {pages.length > 1 && (
          <>
            <button
              type="button"
              className="rp-card__compact-button"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((p) => p - 1)}
            >
              ‹
            </button>
            <span>
              {currentPage} / {pages.length}
            </span>
            <button
              type="button"
              className="rp-card__compact-button"
              disabled={currentPage >= pages.length}
              onClick={() => setCurrentPage((p) => p + 1)}
            >
              ›
            </button>
          </>
        )}
        {!fullscreen && (
          <button
            type="button"
            className="rp-card__compact-button"
            onClick={() => setView(view === "maximized" ? "normal" : "maximized")}
          >
            {view === "maximized" ? "元に戻す" : "最大化"}
          </button>
        )}
        <button
          type="button"
          className="rp-card__compact-button"
          onClick={() => setView(fullscreen ? "normal" : "fullscreen")}
        >
          {fullscreen ? "全画面終了" : "全画面"}
        </button>
        <div className="document-form-fill__actions">{actions}</div>
      </div>
      <div ref={scrollRef} className="document-form-fill__scroll">
        <DocumentFormPage page={page} imageUrl={imageUrlOf(page.page_number)} zoom={zoom}>
          {fieldsOnPage(layout, page.page_number).map((field) => (
            <FieldInput
              key={field.id}
              field={field}
              value={values[field.id] ?? ""}
              fontSize={field.font_size * scale}
              onChange={(value) => setValue(field.id, value)}
              onTransfer={() => setTransferTarget(field)}
            />
          ))}
        </DocumentFormPage>
      </div>
      {transferTarget && (
        <OrderTransferModal
          patientId={patientId}
          kinds={transferTarget.transfer_kinds ?? []}
          onAppend={(lines) => appendLines(transferTarget, lines)}
          onClose={() => setTransferTarget(null)}
        />
      )}
    </div>
  );
}

function FieldInput({
  field,
  value,
  fontSize,
  onChange,
  onTransfer,
}: {
  field: DocumentFormField;
  value: string;
  fontSize: number;
  onChange: (value: string) => void;
  onTransfer: () => void;
}) {
  // 箱(外側)が位置と大きさを持ち、入力欄は箱いっぱいに広げる(CSS の inset: 0)。
  const style = { fontSize, textAlign: field.align } as const;
  const className = `document-form-input document-form-input--${field.type}`;
  const transferable = (field.type === "text" || field.type === "textarea") && (field.transfer_kinds?.length ?? 0) > 0;

  return (
    <div
      className={`document-form-input__box${field.mask ? " document-form-input__box--mask" : ""}`}
      style={fieldStyle(field)}
    >
      {field.type === "textarea" ? (
        <textarea
          className={className}
          style={style}
          value={value}
          title={field.label}
          aria-label={field.label}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : field.type === "image" ? (
        value ? (
          <img className={className} src={value} alt={field.label} title={field.label} />
        ) : (
          <div className={className} role="img" aria-label={field.label} title={field.label} />
        )
      ) : field.type === "select" ? (
        <select
          className={className}
          style={style}
          value={value}
          title={field.label}
          aria-label={field.label}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value=""></option>
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : field.type === "checkbox" ? (
        <input
          type="checkbox"
          className={className}
          checked={value === CHECKED_VALUE}
          title={field.label}
          aria-label={field.label}
          onChange={(e) => onChange(e.target.checked ? CHECKED_VALUE : "")}
        />
      ) : (
        <input
          type={field.type === "date" ? "date" : "text"}
          className={className}
          style={style}
          value={value}
          title={field.label}
          aria-label={field.label}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {transferable && (
        <button
          type="button"
          className="document-form-input__transfer"
          title={`${field.label}に転記`}
          aria-label={`${field.label}に転記`}
          onClick={onTransfer}
        >
          転記
        </button>
      )}
    </div>
  );
}
