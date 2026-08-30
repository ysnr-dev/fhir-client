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

/** YYYY-MM-DD に日数を足す(負も可)。 */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return toDateInput(new Date(y, m - 1, d + days));
}

/** 2 つの YYYY-MM-DD の差(to - from)を日数で返す。 */
export function diffDays(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round((new Date(ty, tm - 1, td).getTime() - new Date(fy, fm - 1, fd).getTime()) / 86400000);
}
