import type { ReactNode } from "react";
import { KartePrintEmptyRow, KartePrintSheet } from "./KartePrintSheet";

// 項目 × 日時の表(検歴・経過表)。日時の列が紙の幅に収まらないので、chunk 列ずつの表に分けて
// 縦に続ける。項目名などの固定列はどの表にも出す。

export interface KartePrintMatrixRow {
  key: string;
  /** 固定列の値(fixedColumns と同じ数)。 */
  fixed: string[];
  /** 日時の列ごとの値(columns と同じ数)。 */
  cells: ReactNode[];
}

interface KartePrintMatrixProps {
  header: ReactNode;
  title: string;
  fixedColumns: { label: string; width: string }[];
  columns: string[];
  rows: KartePrintMatrixRow[];
  /** 1 枚の表に並べる日時の列の数。 */
  chunk: number;
  empty: string;
  /** 表の下に添える凡例(印の意味など)。 */
  legend?: string;
}

export function KartePrintMatrix({
  header,
  title,
  fixedColumns,
  columns,
  rows,
  chunk,
  empty,
  legend,
}: KartePrintMatrixProps) {
  if (columns.length === 0) {
    return (
      <KartePrintSheet header={header} title={title}>
        <KartePrintEmptyRow span={1}>{empty}</KartePrintEmptyRow>
      </KartePrintSheet>
    );
  }
  const starts = Array.from({ length: Math.ceil(columns.length / chunk) }, (_, index) => index * chunk);
  const fixedWidth = fixedColumns.reduce((sum, column) => sum + parseFloat(column.width), 0);
  // 最後の表も列の幅をそろえる(列が少なくても間延びさせない)。
  const cellWidth = `${(100 - fixedWidth) / chunk}%`;
  return (
    <>
      {starts.map((start, index) => {
        const shown = columns.slice(start, start + chunk);
        const filler = chunk - shown.length;
        return (
          <KartePrintSheet
            key={start}
            header={header}
            title={starts.length > 1 ? `${title}(${index + 1}/${starts.length})` : title}
            columns={[...fixedColumns.map((column) => column.label), ...shown, ...Array<string>(filler).fill("")]}
            widths={[...fixedColumns.map((column) => column.width), ...Array<string>(chunk).fill(cellWidth)]}
            continued={index > 0}
          >
            {rows.map((row) => (
              <tr key={row.key}>
                {row.fixed.map((value, column) => (
                  <td key={column}>{value}</td>
                ))}
                {row.cells.slice(start, start + chunk).map((cell, column) => (
                  <td key={column} className="karte-print__cell">
                    {cell}
                  </td>
                ))}
                {Array.from({ length: filler }, (_, column) => (
                  <td key={`filler-${column}`} />
                ))}
              </tr>
            ))}
            {legend && (
              <tr>
                <td colSpan={fixedColumns.length + chunk} className="karte-print__legend">
                  {legend}
                </td>
              </tr>
            )}
          </KartePrintSheet>
        );
      })}
    </>
  );
}
