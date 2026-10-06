// CSV の出力。Excel でそのまま開けるよう BOM 付き UTF-8・CRLF にする。

function csvCell(value: string | number | null | undefined): string {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** 見出しと行から CSV の Blob を作る。 */
export function csvBlob(header: string[], rows: (string | number | null | undefined)[][]): Blob {
  const lines = [header, ...rows].map((cells) => cells.map(csvCell).join(","));
  return new Blob(["﻿", lines.join("\r\n"), "\r\n"], { type: "text/csv;charset=utf-8" });
}
