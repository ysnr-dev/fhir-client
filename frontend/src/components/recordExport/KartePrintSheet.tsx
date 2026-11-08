import type { ReactNode } from "react";

// カルテ印刷の区画 1 つぶんの紙面。見出し(患者・期間)と区画名・列名を thead に置き、
// ブラウザがページごとに繰り返す。2 つ目以降の区画は改ページで始まる(App.css)。
// 列の多い表を幅で分けるときは、2 枚目以降を continued にして改ページせずに続ける。

interface KartePrintSheetProps {
  header: ReactNode;
  title: string;
  /** 列名(ページごとに繰り返す)。 */
  columns?: string[];
  /** 列名を見出しに置かない区画の列数。columns も span も無い区画は 1 列。 */
  span?: number;
  /** 列の幅(col の width)。columns と同じ数だけ。 */
  widths?: string[];
  /** 同じ区画の続き(改ページしない)。 */
  continued?: boolean;
  children: ReactNode;
}

export function KartePrintSheet({
  header,
  title,
  columns,
  span: bodySpan,
  widths,
  continued = false,
  children,
}: KartePrintSheetProps) {
  const span = columns?.length ?? bodySpan ?? 1;
  return (
    <table className={`karte-print__sheet ${continued ? "karte-print__continued" : "karte-print__section"}`}>
      {widths && (
        <colgroup>
          {widths.map((width, index) => (
            <col key={index} style={{ width }} />
          ))}
        </colgroup>
      )}
      <thead>
        <tr>
          <th colSpan={span} className="karte-print__header">
            {header}
          </th>
        </tr>
        <tr>
          <th colSpan={span} className="karte-print__section-title">
            {title}
          </th>
        </tr>
        {columns && (
          <tr>
            {columns.map((column, index) => (
              <th key={index} className="karte-print__column-title">
                {column}
              </th>
            ))}
          </tr>
        )}
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

/** 区画の中の見出し行(「プロブレム」「入退院歴・受診歴」など)。 */
export function KartePrintGroupRow({ span, children }: { span: number; children: ReactNode }) {
  return (
    <tr className="karte-print__group">
      <td colSpan={span}>{children}</td>
    </tr>
  );
}

/** 区画の途中から始まる表の列名(ページごとには繰り返さない)。 */
export function KartePrintColumnRow({ columns }: { columns: string[] }) {
  return (
    <tr>
      {columns.map((column, index) => (
        <th key={index} className="karte-print__column-title">
          {column}
        </th>
      ))}
    </tr>
  );
}

/** 区画の中で出すものが無いときの行。 */
export function KartePrintEmptyRow({ span, children }: { span: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={span} className="karte-print__empty">
        {children}
      </td>
    </tr>
  );
}
