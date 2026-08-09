import { useState, type ReactNode } from "react";

// HoverMenu のパネル内に入れ子にするサブメニュー。マウスオーバーで右側に開く。
// 見た目を揃えるためトリガー自身も row-menu__item のスタイルを使う。
export function SubMenu({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="sub-menu"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className="row-menu__item sub-menu__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        // 親パネルは onClick で閉じるため、開閉のクリックは伝播させない。
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        {label} <span aria-hidden="true">▸</span>
      </button>
      {open && (
        <div className="row-menu__items sub-menu__items" role="menu">
          {children}
        </div>
      )}
    </div>
  );
}
