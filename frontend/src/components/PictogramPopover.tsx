import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useEscapeClose } from "../hooks/useEscapeClose";
import { createPortal } from "react-dom";

/** 吹き出しとアイコンの間隔(px)。CSS の top: calc(100% + 6px) と合わせる。 */
const POPOVER_GAP = 6;

/**
 * 患者帯のピクトグラムの吹き出し。押すと内容が出て、もう一度押すか外側を押すか
 * Escape で閉じる。
 *
 * ホバーの `title` ではなくクリックにするのは、帯のアイコンは離れた席からも
 * 見るもので、内容を読むのに正確なホバーを要求したくないため。読み上げには
 * 同じ文言を `aria-label` で持たせる(アイコン自体は装飾として読み飛ばさせる)。
 *
 * 一覧の行に並べるときは portal にする。表は横スクロールの入れ物に入っていて、
 * 行の中に開いた吹き出しは縁で切れるので、body 直下へ出してアイコンの位置に
 * 画面座標で重ねる。位置は開いた時点で決めるので、スクロールしたら閉じる。
 */
export function PictogramPopover({
  label,
  className,
  icon,
  count,
  portal = false,
  closeOnClick = true,
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
  /** true なら吹き出しを body 直下に出す(一覧の行に並べるとき)。 */
  portal?: boolean;
  /** false なら中を押しても閉じない(吹き出しの中で選択や入力をするとき)。リンクを押したときは閉じる。 */
  closeOnClick?: boolean;
  /** 吹き出しの中身。 */
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>();
  const ref = useRef<HTMLSpanElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEscapeClose(() => setOpen(false), open);
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (ref.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setOpen(false);
    }
    function close() {
      setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    if (portal) {
      window.addEventListener("scroll", close, true);
      window.addEventListener("resize", close);
    }
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open, portal]);

  // 下に収まらなければアイコンの上に、右にはみ出すなら画面の右端に寄せる。
  useLayoutEffect(() => {
    if (!open || !portal) return;
    const anchor = ref.current?.getBoundingClientRect();
    const popover = popoverRef.current?.getBoundingClientRect();
    if (!anchor || !popover) return;
    const below = anchor.bottom + POPOVER_GAP;
    const top =
      below + popover.height > window.innerHeight
        ? Math.max(0, anchor.top - POPOVER_GAP - popover.height)
        : below;
    const left = Math.max(0, Math.min(anchor.left, window.innerWidth - popover.width - 8));
    setPosition({ top, left });
  }, [open, portal]);

  const countBadge = count !== undefined && count > 1 && (
    <span className="patient-header__caution-count">{count}</span>
  );

  const popover = open && (
    // 中のリンクを押したら閉じる。同じ画面に留まる遷移(既にプロファイル
    // タブを開いている場合)では、閉じないと吹き出しが残ってしまう。
    <div
      ref={popoverRef}
      className={`patient-header__popover${portal ? " patient-header__popover--portal" : ""}`}
      // 位置が決まるまでは見せない(左上に一瞬出るのを防ぐ)。
      style={portal ? (position ?? { visibility: "hidden" }) : undefined}
      role="dialog"
      aria-label={label}
      onClick={(event) => {
        if (closeOnClick || (event.target as HTMLElement).closest("a")) setOpen(false);
      }}
    >
      {children}
    </div>
  );

  return (
    <span className="patient-header__pictogram" ref={ref}>
      <button
        type="button"
        className={`patient-header__caution ${className}`}
        aria-label={label}
        aria-expanded={open}
        onClick={() => {
          setPosition(undefined);
          setOpen((value) => !value);
        }}
      >
        {icon}
        {countBadge}
      </button>
      {portal ? popover && createPortal(popover, document.body) : popover}
    </span>
  );
}

export interface PopoverTag {
  label: string;
  /** danger は赤、warning は橙。無ければ控えめに出す。 */
  tone?: "danger" | "warning";
  title?: string;
}

export interface PopoverRow {
  key: string;
  name: string;
  /** 名前の右に寄せる目印(状態・程度・日数など、拾い読みしたいもの)。 */
  tags?: PopoverTag[];
  /** 名前の下に 1 行ずつ出す詳細。空文字は出さない。 */
  details?: string[];
}

/**
 * 吹き出しの中身の一覧。1 件ごとに罫線で区切り、名前と目印を 1 行目、詳細を下に積む。
 * 目印は折り返さず右端にそろえるので、何件あっても縦に拾い読みできる。
 */
export function PopoverRows({ rows }: { rows: PopoverRow[] }) {
  return (
    <ul className="patient-header__popover-list patient-header__popover-rows">
      {rows.map((row) => {
        const details = (row.details ?? []).filter(Boolean);
        return (
          <li key={row.key} className="patient-header__popover-row">
            <span className="patient-header__popover-head">
              <span className="patient-header__popover-name">{row.name}</span>
              {row.tags && row.tags.length > 0 && (
                <span className="patient-header__popover-tags">
                  {row.tags.map((tag) => (
                    <span
                      key={tag.label}
                      className={`patient-header__popover-tag${tag.tone ? ` patient-header__popover-tag--${tag.tone}` : ""}`}
                      title={tag.title}
                    >
                      {tag.label}
                    </span>
                  ))}
                </span>
              )}
            </span>
            {details.map((detail, index) => (
              <span key={index} className="patient-header__popover-text">
                {detail}
              </span>
            ))}
          </li>
        );
      })}
    </ul>
  );
}
