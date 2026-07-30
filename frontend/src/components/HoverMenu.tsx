import { useState, type ReactNode } from "react";

// マウスオーバーで開くコンテキストメニュー。キーボード操作向けにクリックでも開閉する。
// メニュー項目には row-menu__item のスタイルを流用する。
export function HoverMenu({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <div
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
