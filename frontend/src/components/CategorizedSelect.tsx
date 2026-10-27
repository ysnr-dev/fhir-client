import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

// 左にカテゴリ、右に選んだカテゴリの選択肢を並べるプルダウン(テンプレート選択・文書作成)。
// テンプレート一覧と同じ並べ方で、件数の多い選択肢をカテゴリから辿る。
//
// キーボード操作は menu ロールの慣習(上下で列内の移動・左右で列の移動・Esc で閉じる)
// に合わせ、左の列はフォーカスしたカテゴリをそのまま右に開く。
//
// パネルは body 直下のポータルに fixed で出す。モーダル(.modal は
// overflow-y: auto)の中で使うと、通常の absolute 配置ではモーダルの枠で
// 見切れてしまうため。

const PANEL_MIN_WIDTH = 520;
const PANEL_MAX_HEIGHT = 360;

export interface CategorizedOption {
  id: string;
  label: string;
  /** 右の列で続けて並ぶ同じ値の選択肢の上に見出しを出す(任意)。 */
  section?: string;
}

/** 左の列の 1 項目。選択肢の無いカテゴリは渡さない。 */
export interface CategorizedSelectCategory {
  key: string;
  label: string;
  options: CategorizedOption[];
}

interface CategorizedSelectProps {
  categories: CategorizedSelectCategory[];
  /** 選択中の選択肢の id(未選択は空文字)。 */
  value: string;
  onChange: (id: string) => void;
  label: string;
  emptyLabel?: string;
}

export function CategorizedSelect({
  categories: navItems,
  value,
  onChange,
  label,
  emptyLabel = "テンプレートがありません",
}: CategorizedSelectProps) {

  const [open, setOpen] = useState(false);
  // 右に開いているカテゴリ(navItems の key)。
  const [activeKey, setActiveKey] = useState<string | null>(null);
  // ポータルへ出すパネルの位置(トリガーの画面上の位置から毎回計算する)。
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({});

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const labelId = useId();

  const selected = navItems.flatMap((item) => item.options).find((option) => option.id === value);
  const activeItem = navItems.find((item) => item.key === activeKey) ?? navItems[0] ?? null;

  function columnItems(column: "category" | "template"): HTMLButtonElement[] {
    return Array.from(
      panelRef.current?.querySelectorAll<HTMLButtonElement>(`[data-menu-column="${column}"]`) ?? [],
    );
  }

  function close(focusTrigger = true) {
    setOpen(false);
    if (focusTrigger) triggerRef.current?.focus();
  }

  function toggle() {
    if (open) {
      close();
      return;
    }
    // 選択済みならそのテンプレートが属するカテゴリを開いた状態で出す。
    const item = navItems.find((nav) => nav.options.some((option) => option.id === value));
    setActiveKey(item?.key ?? null);
    setOpen(true);
  }

  // パネルはトリガーの直下(下に入りきらなければ直上)へ置く。2 列が読めるよう
  // トリガーより狭くはせず、画面の右端からはみ出す分は左へずらす。
  useLayoutEffect(() => {
    if (!open) return;

    function reposition() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const gap = 4;
      const margin = 8;
      const below = window.innerHeight - rect.bottom - gap - margin;
      const above = rect.top - gap - margin;
      const openUp = below < 200 && above > below;
      const width = Math.min(Math.max(rect.width, PANEL_MIN_WIDTH), window.innerWidth - margin * 2);
      const left = Math.max(margin, Math.min(rect.left, window.innerWidth - margin - width));
      setPanelStyle({
        left,
        width,
        height: Math.min(PANEL_MAX_HEIGHT, Math.max(160, openUp ? above : below)),
        ...(openUp
          ? { bottom: window.innerHeight - rect.top + gap }
          : { top: rect.bottom + gap }),
      });
    }

    reposition();
    window.addEventListener("resize", reposition);
    // モーダル本体のスクロールも拾うので capture で購読する。
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open]);

  // 外側クリックで閉じる(フォーカスはボタンへ戻さない)。パネルはポータルで
  // 別 DOM に出ているので、root だけでなくパネル内も「内側」として扱う。
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  // 開いた直後は選択中のテンプレート(無ければ開いたカテゴリ)へフォーカスを移す(キーボード操作の起点)。
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const target =
      panel?.querySelector<HTMLButtonElement>('[data-menu-column="template"][aria-checked="true"]') ??
      panel?.querySelector<HTMLButtonElement>('[data-menu-column="category"].is-active');
    target?.focus();
    target?.scrollIntoView({ block: "nearest" });
  }, [open]);

  function handlePanelKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const focused = document.activeElement as HTMLButtonElement | null;
    const column = focused?.dataset.menuColumn as "category" | "template" | undefined;

    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp": {
        if (!column) return;
        event.preventDefault();
        const items = columnItems(column);
        const index = items.indexOf(focused as HTMLButtonElement);
        const step = event.key === "ArrowDown" ? 1 : -1;
        const next = items[(index + step + items.length) % items.length];
        next?.focus();
        if (column === "category" && next?.dataset.categoryKey) {
          setActiveKey(next.dataset.categoryKey);
        }
        break;
      }
      case "ArrowRight":
        if (column === "category") {
          event.preventDefault();
          columnItems("template")[0]?.focus();
        }
        break;
      case "ArrowLeft":
        if (column === "template") {
          event.preventDefault();
          panelRef.current
            ?.querySelector<HTMLButtonElement>('[data-menu-column="category"].is-active')
            ?.focus();
        }
        break;
      case "Escape":
        event.preventDefault();
        close();
        break;
      case "Tab":
        // フォーカスはブラウザの既定移動に任せ、メニューだけ畳む。
        setOpen(false);
        break;
      default:
        break;
    }
  }

  return (
    <div className="qp-field template-select" ref={rootRef}>
      <span className="qp-field__label" id={labelId}>
        {label}
      </span>
      <button
        type="button"
        ref={triggerRef}
        className="template-select__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-labelledby={labelId}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            toggle();
          }
        }}
      >
        <span
          className={
            selected ? "template-select__value" : "template-select__value template-select__value--empty"
          }
        >
          {selected ? selected.label : "選択してください"}
        </span>
        <span aria-hidden="true">▾</span>
      </button>

      {open &&
        createPortal(
          <div
            className="template-select__panel"
            style={panelStyle}
            role="menu"
            ref={panelRef}
            onKeyDown={handlePanelKeyDown}
          >
            {activeItem ? (
              <>
                <div className="template-select__categories">
                  {navItems.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      role="menuitem"
                      data-menu-column="category"
                      data-category-key={item.key}
                      className={
                        item === activeItem
                          ? "template-select__category is-active"
                          : "template-select__category"
                      }
                      onClick={() => setActiveKey(item.key)}
                    >
                      <span className="template-select__category-name">{item.label}</span>
                      <span className="template-select__count">{item.options.length}</span>
                    </button>
                  ))}
                </div>
                <div className="template-select__templates">
                  {activeItem.options.map((option, index) => (
                    <Fragment key={option.id}>
                      {option.section && option.section !== activeItem.options[index - 1]?.section && (
                        <div className="template-select__section">{option.section}</div>
                      )}
                      <button
                        type="button"
                        role="menuitemradio"
                        aria-checked={option.id === value}
                        data-menu-column="template"
                        className={
                          option.id === value
                            ? "template-select__item template-select__item--selected"
                            : "template-select__item"
                        }
                        onClick={() => {
                          onChange(option.id);
                          close();
                        }}
                      >
                        {option.label}
                      </button>
                    </Fragment>
                  ))}
                </div>
              </>
            ) : (
              <div className="template-select__empty">{emptyLabel}</div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
