import type { CSSProperties, PointerEvent, ReactNode } from "react";
import type { GridTile } from "../../fhir/dashboardLayout";
import { TrashIcon } from "../icons/TrashIcon";

interface Props {
  tile: GridTile;
  title: string;
  /** 見出しの右に小さく添える文字(条件のタブと表示など)。 */
  meta?: ReactNode;
  editing: boolean;
  /** 非編集時に見出しの右端へ置くもの(実行日時・ケバブメニューなど)。 */
  actions?: ReactNode;
  className?: string;
  onRemove: () => void;
  /** 編集モードで見出しを掴んだ(動かす)。 */
  onMoveStart: (event: PointerEvent<HTMLElement>) => void;
  /** 編集モードで右下の角を掴んだ(大きさを変える)。 */
  onResizeStart: (event: PointerEvent<HTMLElement>) => void;
  children: ReactNode;
}

/**
 * マス目に置くタイルの枠。位置と大きさを CSS 変数で grid に伝え、編集モードでは見出しが掴む所、
 * 右下の角が大きさを変える所になる。中身は呼び出し側(分析ダッシュボードの結果・診療ダッシュボードのカルテのタブ)。
 */
export function DashboardTileFrame({
  tile,
  title,
  meta,
  editing,
  actions,
  className,
  onRemove,
  onMoveStart,
  onResizeStart,
  children,
}: Props) {
  const style = { "--tile-x": tile.x, "--tile-y": tile.y, "--tile-w": tile.w, "--tile-h": tile.h } as CSSProperties;
  return (
    <section
      className={`dashboard-tile${editing ? " is-editing" : ""}${className ? ` ${className}` : ""}`}
      style={style}
      aria-label={title}
    >
      <header className="dashboard-tile__header" onPointerDown={editing ? onMoveStart : undefined}>
        <div className="dashboard-tile__heading">
          <h2 className="dashboard-tile__title">{title}</h2>
          {meta && <span className="dashboard-tile__meta">{meta}</span>}
        </div>
        {editing ? (
          <button
            type="button"
            className="rp-card__icon-button"
            title="タイルを削除"
            aria-label="タイルを削除"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onRemove}
          >
            <TrashIcon />
          </button>
        ) : (
          actions && <div className="dashboard-tile__actions">{actions}</div>
        )}
      </header>
      <div className="dashboard-tile__body">{children}</div>
      {editing && (
        <button
          type="button"
          className="dashboard-tile__resize"
          aria-label="大きさを変える"
          title="大きさを変える"
          onPointerDown={onResizeStart}
        />
      )}
    </section>
  );
}
