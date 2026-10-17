import { downloadBlob } from "../lib/download";
import { buildError, masterFetch } from "./masterClient/core";

// 口腔状態スナップショットの CSV(.oes)。frontend が組み立てたレコードを backend が Shift_JIS(Windows-31J)の
// ファイルにして返す(変換できない文字は全角の「？」)。
export async function downloadOralExamFile(filename: string, records: string[][]): Promise<void> {
  const res = await masterFetch("/reports/oral_exam_file", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, records }),
  });
  if (!res.ok) throw await buildError(res);
  downloadBlob(await res.blob(), filename);
}
