import { useEffect, useRef, useState, type ReactNode } from "react";
import { useEscapeClose } from "../hooks/useEscapeClose";

// マウスオーバーで開くコンテキストメニュー。キーボード操作向けにクリックでも開閉する。
// メニュー項目には row-menu__item のスタイルを流用する。
export function HoverMenu({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEscapeClose(() => setOpen(false), open);

  // クリックで開いたときは、メニューの外を押しても閉じる。
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  return (
    <div
      ref={ref}
      className="hover-menu"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className="hover-menu__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {label} <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="row-menu__items hover-menu__items" role="menu" onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}
