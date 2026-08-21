// 日付ユーティリティ。日付はブラウザのローカルタイム基準で扱う
// (toISOString の UTC 基準だと JST の朝9時前に前日へずれる)。

/** Date を YYYY-MM-DD (input[type=date] 形式)にする。 */
export function toDateInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 今日の日付(YYYY-MM-DD)。 */
export function today(): string {
  return toDateInput(new Date());
}

/** ISO 日時をローカル表記(ja-JP)にする。パースできなければそのまま返す。 */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString("ja-JP");
}
