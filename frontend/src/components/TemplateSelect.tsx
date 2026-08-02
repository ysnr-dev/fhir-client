import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useQuestionnaireCategories } from "../api/adminQueries";
import { groupTemplatesByCategory } from "../fhir/questionnaireCategory";

// テンプレート(Questionnaire)選択のプルダウン。1つのプルダウンの中で
// 「カテゴリ → テンプレート」と辿る(プルダウンを2つ並べるよりクリックが減る)。
// カテゴリ未設定のテンプレートは、カテゴリと同じ層(先頭階層)に並べる。
//
// ネイティブの <select> + <optgroup> ではなくボタンで組んでいるのは、階層を
// 辿る挙動が <select> では表現できないため。キーボード操作は menu ロールの
// 慣習(上下移動・左右で階層移動・Esc で閉じる)に合わせる。
//
// パネルは body 直下のポータルに fixed で出す。モーダル(.modal は
// overflow-y: auto)の中で使うと、通常の absolute 配置ではモーダルの枠で
// 見切れてしまうため。

interface TemplateSelectProps {
  questionnaires: fhir4.Questionnaire[];
  /** 選択中の Questionnaire.id(未選択は空文字)。 */
  value: string;
  onChange: (questionnaireId: string) => void;
  label?: string;
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
  const grouped = useMemo(
    () => groupTemplatesByCategory(questionnaires, categories),
    [questionnaires, categories],
  );

  const [open, setOpen] = useState(false);
  // 開いているカテゴリの code。null なら先頭階層(カテゴリ一覧)。
  const [openCategory, setOpenCategory] = useState<string | null>(null);
  // ポータルへ出すパネルの位置(トリガーの画面上の位置から毎回計算する)。
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({});

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const labelId = useId();

  const selected = questionnaires.find((q) => q.id === value);
  const currentGroup = grouped.groups.find((g) => g.code === openCategory) ?? null;

  function menuItems(): HTMLButtonElement[] {
    return Array.from(panelRef.current?.querySelectorAll<HTMLButtonElement>("[data-menu-item]") ?? []);
  }

  function close(focusTrigger = true) {
    setOpen(false);
    setOpenCategory(null);
    if (focusTrigger) triggerRef.current?.focus();
  }

  function toggle() {
    if (open) {
      close();
      return;
    }
    // 選択済みならそのテンプレートが属するカテゴリを開いた状態で出す。
    const category = grouped.groups.find((g) => g.questionnaires.some((q) => q.id === value));
    setOpenCategory(category?.code ?? null);
    setOpen(true);
  }

  // パネルはトリガーの直下(下に入りきらなければ直上)へ、トリガーと同じ幅で置く。
  useLayoutEffect(() => {
    if (!open) return;

    function reposition() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const gap = 4;
      const margin = 8;
      const below = window.innerHeight - rect.bottom - gap - margin;
      const above = rect.top - gap - margin;
      const openUp = below < 160 && above > below;
      setPanelStyle({
        left: rect.left,
        width: rect.width,
        maxHeight: Math.min(320, Math.max(120, openUp ? above : below)),
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
  }, [open, openCategory]);

  // 外側クリックで閉じる(フォーカスはボタンへ戻さない)。パネルはポータルで
  // 別 DOM に出ているので、root だけでなくパネル内も「内側」として扱う。
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
      setOpenCategory(null);
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  // 開いた直後と階層移動後は先頭項目へフォーカスを移す(キーボード操作の起点)。
  useEffect(() => {
    if (!open) return;
    menuItems()[0]?.focus();
  }, [open, openCategory]);

  function handlePanelKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const items = menuItems();
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLButtonElement);

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        items[(index + 1) % items.length]?.focus();
        break;
      case "ArrowUp":
        event.preventDefault();
        items[(index - 1 + items.length) % items.length]?.focus();
        break;
      case "ArrowRight": {
        const code = (document.activeElement as HTMLElement | null)?.dataset.categoryCode;
        if (code) {
          event.preventDefault();
          setOpenCategory(code);
        }
        break;
      }
      case "ArrowLeft":
      case "Backspace":
        if (openCategory) {
          event.preventDefault();
          setOpenCategory(null);
        }
        break;
      case "Escape":
        event.preventDefault();
        close();
        break;
      case "Tab":
        // フォーカスはブラウザの既定移動に任せ、メニューだけ畳む。
        setOpen(false);
        setOpenCategory(null);
        break;
      default:
        break;
    }
  }

  function renderTemplateItem(questionnaire: fhir4.Questionnaire) {
    const id = questionnaire.id ?? "";
    return (
      <button
        key={id}
        type="button"
        role="menuitem"
        data-menu-item
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
            {currentGroup ? (
              <>
                <button
                  type="button"
                  role="menuitem"
                  data-menu-item
                  className="template-select__back"
                  onClick={() => setOpenCategory(null)}
                >
                  <span aria-hidden="true">‹</span> 戻る
                </button>
                <div className="template-select__heading">{currentGroup.name}</div>
                {currentGroup.questionnaires.map(renderTemplateItem)}
              </>
            ) : (
              <>
                {grouped.groups.map((group) => (
                  <button
                    key={group.code}
                    type="button"
                    role="menuitem"
                    data-menu-item
                    data-category-code={group.code}
                    aria-haspopup="menu"
                    className="template-select__item template-select__item--category"
                    onClick={() => setOpenCategory(group.code)}
                  >
                    <span>{group.name}</span>
                    <span aria-hidden="true">›</span>
                  </button>
                ))}
                {grouped.groups.length > 0 && grouped.uncategorized.length > 0 && (
                  <div className="template-select__divider">未分類</div>
                )}
                {grouped.uncategorized.map(renderTemplateItem)}
                {grouped.groups.length === 0 && grouped.uncategorized.length === 0 && (
                  <div className="template-select__heading">テンプレートがありません</div>
                )}
              </>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
