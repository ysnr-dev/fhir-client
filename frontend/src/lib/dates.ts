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

/**
 * FHIR の date / dateTime を一覧向けの「YYYY-MM-DD HH:mm」にする。時刻を持たない値
 * (時刻を付ける前に登録した入退院・外出泊)は日付だけ返す。タイムゾーンは変換しない
 * (入退院の日時はローカル時刻 + オフセットで書いているので、文字列のまま切り出せる)。
 */
export function dateTimeLabel(value: string | undefined): string {
  if (!value) return "";
  const date = value.slice(0, 10);
  const time = value.slice(11, 16);
  return /^\d\d:\d\d$/.test(time) ? `${date} ${time}` : date;
}

/**
 * FHIR の date / dateTime を input[type=datetime-local] の値(YYYY-MM-DDTHH:mm)にする。
 * 日付だけの値は 00:00 を補う(new Date("YYYY-MM-DD") は UTC 解釈で日付がずれるので使わない)。
 */
export function toDateTimeInputValue(value: string | undefined): string {
  if (!value) return "";
  const date = value.slice(0, 10);
  const time = value.slice(11, 16);
  return /^\d\d:\d\d$/.test(time) ? `${date}T${time}` : `${date}T00:00`;
}

/** 現在時刻(YYYY-MM-DDTHH:mm、分単位)。 */
export function nowDateTimeInput(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${toDateInput(now)}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}
