import type { ReactNode } from "react";
import { HelpTip } from "./HelpTip";

// 統計・集計の画面の共通部品(見本は病床状況)。上に要約の大きな数字のタイル(StatTiles・StatTile)、
// 下に見出し付きの集計表(StatSection の中に table.lab-worklist.stat-table)を置く。
// 表は数の列を右寄せにし(StatCell)、区分の境に縦線(stat-table__group-start)、0 は薄い「-」にする。
// 合計は tfoot の行に出す。

export function StatTiles({ children }: { children: ReactNode }) {
  return <dl className="stat-tiles">{children}</dl>;
}

interface StatTileProps {
  label: ReactNode;
  /** 見出しの「?」に出す計算式。 */
  help?: string;
  value?: ReactNode;
  /** 値の後ろに小さく添える(「/ 14床」など)。 */
  unit?: ReactNode;
  /** 値の下の補足(内訳・期間など)。 */
  sub?: ReactNode;
  /** 値の下に引く割合の棒(%)。 */
  meter?: number | null;
  /** 値を危険色にする(基準値割れ・感染ありなど)。 */
  alert?: boolean;
  /** 値を 1 つでなく横に並べるとき(本日の入院・退院など)。value・unit・meter は使わない。 */
  counts?: { label: string; value: ReactNode }[];
}

export function StatTile({ label, help, value, unit, sub, meter, alert, counts }: StatTileProps) {
  return (
    <div className="stat-tile">
      <dt>
        {label}
        {help && (
          <>
            {" "}
            <HelpTip text={help} />
          </>
        )}
      </dt>
      {counts ? (
        <dd className="stat-tile__pair">
          {counts.map((count) => (
            <span key={count.label} className="stat-tile__count">
              <span className="stat-tile__sub">{count.label}</span>
              <span className="stat-tile__value">{count.value}</span>
            </span>
          ))}
        </dd>
      ) : (
        <dd>
          <span className={alert ? "stat-tile__value stat-tile__value--alert" : "stat-tile__value"}>
            {value}
            {unit && <small> {unit}</small>}
          </span>
          {meter != null && <StatMeter percent={meter} />}
          {sub && <span className="stat-tile__sub">{sub}</span>}
        </dd>
      )}
    </div>
  );
}

/** 割合の棒。塗りの幅が割合(100% で頭打ち)。 */
export function StatMeter({ percent }: { percent: number }) {
  return (
    <span className="stat-meter" aria-hidden="true">
      <span style={{ width: `${Math.max(0, Math.min(percent, 100))}%` }} />
    </span>
  );
}

/** 集計表のまとまり。見出し(とその右の操作)を付ける。 */
export function StatSection({
  title,
  actions,
  children,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="stat-section">
      {(title || actions) && (
        <div className="stat-section__head">
          {title && <h2 className="stat-section__title">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

/** 集計表を横に並べる(幅が足りなければ折り返す)。 */
export function StatSections({ children }: { children: ReactNode }) {
  return <div className="stat-sections">{children}</div>;
}

/**
 * 数のセル。0・空・「-」は薄い「-」にして、動きのある数だけが目に入るようにする。
 * tone は値の色(alert は危険色、warning は注意色)。
 */
export function StatCell({
  value,
  groupStart,
  strong,
  tone,
  title,
  className,
}: {
  value: ReactNode;
  groupStart?: boolean;
  strong?: boolean;
  tone?: "alert" | "warning";
  title?: string;
  /** 表ごとの列の寸法などを足すとき。 */
  className?: string;
}) {
  const empty = value === 0 || value == null || value === "" || value === "-";
  const classes = ["stat-table__num"];
  if (className) classes.push(className);
  if (groupStart) classes.push("stat-table__group-start");
  if (empty) classes.push("stat-table__zero");
  else if (strong) classes.push("stat-table__strong");
  if (!empty && tone) classes.push(`stat-table__${tone}`);
  return (
    <td className={classes.join(" ")} title={title}>
      {empty ? "-" : value}
    </td>
  );
}
