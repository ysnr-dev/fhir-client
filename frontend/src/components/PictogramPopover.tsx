import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * 患者帯のピクトグラムの吹き出し。押すと内容が出て、もう一度押すか外側を押すか
 * Escape で閉じる。
 *
 * ホバーの `title` ではなくクリックにするのは、帯のアイコンは離れた席からも
 * 見るもので、内容を読むのに正確なホバーを要求したくないため。読み上げには
 * 同じ文言を `aria-label` で持たせる(アイコン自体は装飾として読み飛ばさせる)。
 */
export function PictogramPopover({
  label,
  className,
  icon,
  count,
  children,
}: {
  /** 読み上げに使う文言。中身と同じことを 1 行で表す。 */
  label: string;
  /** 色分けのクラス(区分ごと)。 */
  className: string;
  /** ピクトグラム本体。 */
  icon: ReactNode;
  /** 2 以上のときだけアイコンの右肩に出す件数。 */
  count?: number;
  /** 吹き出しの中身。 */
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

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
    <span className="patient-header__pictogram" ref={ref}>
      <button
        type="button"
        className={`patient-header__caution ${className}`}
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {icon}
        {count !== undefined && count > 1 && (
          <span className="patient-header__caution-count">{count}</span>
        )}
      </button>
      {open && (
        // 中のリンクを押したら閉じる。同じ画面に留まる遷移(既にプロファイル
        // タブを開いている場合)では、閉じないと吹き出しが残ってしまう。
        <div
          className="patient-header__popover"
          role="dialog"
          aria-label={label}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      )}
    </span>
  );
}
