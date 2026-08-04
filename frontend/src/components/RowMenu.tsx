import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

// パネルの表示位置。下に開くと見切れる場合だけ上に開く
// (カルテのタイムラインのようにスクロール領域の中に置かれることがある)。
type Placement = "down" | "up";

// 直近のスクロール領域の上下端。見つからなければビューポートを使う。
function clipBounds(element: HTMLElement): { top: number; bottom: number } {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const overflowY = getComputedStyle(node).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") {
      const rect = node.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom };
    }
  }
  return { top: 0, bottom: window.innerHeight };
}

export function RowMenu({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<Placement>("down");
  const ref = useRef<HTMLDivElement>(null);
  const itemsRef = useRef<HTMLDivElement>(null);

  // 開いた直後に実寸で判定する(項目数はメニューごとに違う)。
  useLayoutEffect(() => {
    if (!open) return;
    const trigger = ref.current;
    const items = itemsRef.current;
    if (!trigger || !items) return;
    const triggerRect = trigger.getBoundingClientRect();
    const height = items.offsetHeight + 4;
    const bounds = clipBounds(trigger);
    const fitsBelow = triggerRect.bottom + height <= bounds.bottom;
    const fitsAbove = triggerRect.top - height >= bounds.top;
    setPlacement(!fitsBelow && fitsAbove ? "up" : "down");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="row-menu" ref={ref}>
      <button
        type="button"
        className="row-menu__trigger"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        ⋮
      </button>
      {open && (
        // 項目を押したら閉じる。Link は遷移で消えるが、削除は同じ行に留まるため必要。
        <div
          className={`row-menu__items${placement === "up" ? " row-menu__items--up" : ""}`}
          role="menu"
          ref={itemsRef}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      )}
    </div>
  );
}
