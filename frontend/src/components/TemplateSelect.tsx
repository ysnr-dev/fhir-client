import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useQuestionnaireCategories } from "../api/adminQueries";
import { groupTemplatesByCategory } from "../fhir/questionnaireCategory";

// テンプレート(Questionnaire)選択のプルダウン。パネルはテンプレート一覧と同じく
// 左にカテゴリ、右に選んだカテゴリのテンプレートを並べる。カテゴリ未設定の
// テンプレートは左の末尾の「未分類」にまとめる。
//
// キーボード操作は menu ロールの慣習(上下で列内の移動・左右で列の移動・Esc で閉じる)
// に合わせ、左の列はフォーカスしたカテゴリをそのまま右に開く。
//
// パネルは body 直下のポータルに fixed で出す。モーダル(.modal は
// overflow-y: auto)の中で使うと、通常の absolute 配置ではモーダルの枠で
// 見切れてしまうため。

// カテゴリ未設定のテンプレートを表す左の列の項目。
const UNCATEGORIZED = "uncategorized";

const PANEL_MIN_WIDTH = 520;
const PANEL_MAX_HEIGHT = 360;

interface TemplateSelectProps {
  questionnaires: fhir4.Questionnaire[];
  /** 選択中の Questionnaire.id(未選択は空文字)。 */
  value: string;
  onChange: (questionnaireId: string) => void;
  label?: string;
}

interface CategoryNavItem {
  key: string;
  label: string;
  questionnaires: fhir4.Questionnaire[];
}

function templateLabel(questionnaire: fhir4.Questionnaire): string {
  const title = questionnaire.title ?? questionnaire.name ?? "(名称未設定)";
  return questionnaire.version ? `${title} (v${questionnaire.version})` : title;
}

export function TemplateSelect({
  questionnaires,
  value,
  onChange,
  label = "テンプレート",
}: TemplateSelectProps) {
  const { data: categories = [] } = useQuestionnaireCategories();
  const navItems = useMemo<CategoryNavItem[]>(() => {
    const grouped = groupTemplatesByCategory(questionnaires, categories);
    const items: CategoryNavItem[] = grouped.groups.map((group) => ({
      key: group.code,
      label: group.name,
      questionnaires: group.questionnaires,
    }));
    if (grouped.uncategorized.length > 0) {
      items.push({ key: UNCATEGORIZED, label: "未分類", questionnaires: grouped.uncategorized });
    }
    return items;
  }, [questionnaires, categories]);

  const [open, setOpen] = useState(false);
  // 右に開いているカテゴリ(navItems の key)。
  const [activeKey, setActiveKey] = useState<string | null>(null);
  // ポータルへ出すパネルの位置(トリガーの画面上の位置から毎回計算する)。
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({});

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const labelId = useId();

  const selected = questionnaires.find((q) => q.id === value);
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
    const item = navItems.find((nav) => nav.questionnaires.some((q) => q.id === value));
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
          {selected ? templateLabel(selected) : "選択してください"}
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
                      <span className="template-select__count">{item.questionnaires.length}</span>
                    </button>
                  ))}
                </div>
                <div className="template-select__templates">
                  {activeItem.questionnaires.map((questionnaire) => {
                    const id = questionnaire.id ?? "";
                    return (
                      <button
                        key={id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={id === value}
                        data-menu-column="template"
                        className={
                          id === value
                            ? "template-select__item template-select__item--selected"
                            : "template-select__item"
                        }
                        onClick={() => {
                          onChange(id);
                          close();
                        }}
                      >
                        {templateLabel(questionnaire)}
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="template-select__empty">テンプレートがありません</div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
