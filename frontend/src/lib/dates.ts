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

export const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"] as const;

/** "YYYY-MM-DD" の曜日(0=日 … 6=土)。不正な日付は null。 */
export function weekdayOf(date: string): number | null {
  if (!isDateOnly(date)) return null;
  const [year, month, day] = date.split("-").map(Number);
  // ローカルタイムで作る(UTC 解釈だと日本時間では前日の曜日になる)。
  const parsed = new Date(year, month - 1, day);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getDay();
}

/** YYYY-MM-DD の形(日付だけの値)か。 */
export function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * FHIR の date / dateTime を端末ローカルの YYYY-MM-DD にする。日付だけの値はそのまま返す。
 * UTC("...Z")で書かれた値は文字列の先頭を切り出すと日付がずれるので、時刻を持つ値は
 * 必ずここを通す。
 */
export function localDay(value: string | undefined): string {
  if (!value) return "";
  if (value.length <= 10) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value.slice(0, 10) : toDateInput(date);
}

/**
 * FHIR の date / dateTime をミリ秒にする。日付だけの値はローカルの 0 時
 * (`new Date("2026-08-22")` は UTC 0 時になり、時差のぶんだけ日がずれる)。読めない値は 0。
 */
export function epochOf(value: string): number {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? 0 : time;
}

/**
 * タイムゾーン付きの dateTime を、端末ローカルの「YYYY-MM-DDTHH:mm[:ss]」に直す。
 * タイムゾーンを持たない値(日付だけ・ローカル時刻)はそのまま返す。
 */
function toLocalWallClock(value: string): string {
  if (!/(?:Z|[+-]\d\d:\d\d)$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, "0");
  const seconds = /T\d\d:\d\d:\d\d/.test(value) ? `:${pad(date.getSeconds())}` : "";
  return `${toDateInput(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}${seconds}`;
}

/** ISO 日時をローカル表記(ja-JP)にする。パースできなければそのまま返す。 */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString("ja-JP");
}

/** 「8/29」形式の短い日付。YYYY-MM-DD として読めない値はそのまま返す。 */
export function shortDate(date: string): string {
  const [, month, day] = date.split("-");
  return month && day ? `${Number(month)}/${Number(day)}` : date;
}

/** YYYY-MM-DD に日数を足す(負も可)。 */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return toDateInput(new Date(y, m - 1, d + days));
}

/** YYYY-MM-DD に月数を足す(負も可)。 */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return toDateInput(new Date(y, m - 1 + months, d));
}

/** 2 つの YYYY-MM-DD の差(to - from)を日数で返す。 */
export function diffDays(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round((new Date(ty, tm - 1, td).getTime() - new Date(fy, fm - 1, fd).getTime()) / 86400000);
}

/**
 * FHIR の date / dateTime を一覧向けの「YYYY-MM-DD HH:mm」にする。時刻を持たない値
 * (日付だけの入退院・外出泊)は日付だけ返す。タイムゾーン付きの値は端末のローカル時刻で出す。
 */
export function dateTimeLabel(value: string | undefined): string {
  if (!value) return "";
  const local = toLocalWallClock(value);
  const date = local.slice(0, 10);
  const time = local.slice(11, 16);
  return /^\d\d:\d\d$/.test(time) ? `${date} ${time}` : date;
}

/**
 * FHIR の dateTime を「YYYY-MM-DD HH:mm:ss」にする。秒を持たない値は分まで、時刻を持たない値は
 * 日付だけ返す。オーダーの登録日時のように、同じ分に何件も並びうるものに使う。
 */
export function dateTimeSecondsLabel(value: string | undefined): string {
  const label = dateTimeLabel(value);
  if (!value || label.length <= 10) return label;
  const local = toLocalWallClock(value);
  const time = local.slice(11, 19);
  return /^\d\d:\d\d:\d\d$/.test(time) ? `${local.slice(0, 10)} ${time}` : label;
}

/**
 * FHIR の date / dateTime を input[type=datetime-local] の値(YYYY-MM-DDTHH:mm)にする。
 * 日付だけの値は 00:00 を補う(new Date("YYYY-MM-DD") は UTC 解釈で日付がずれるので使わない)。
 */
export function toDateTimeInputValue(value: string | undefined): string {
  if (!value) return "";
  const local = toLocalWallClock(value);
  const date = local.slice(0, 10);
  const time = local.slice(11, 16);
  return /^\d\d:\d\d$/.test(time) ? `${date}T${time}` : `${date}T00:00`;
}

/** 現在時刻(YYYY-MM-DDTHH:mm、分単位)。 */
export function nowDateTimeInput(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${toDateInput(now)}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/**
 * ローカル時刻の文字列(YYYY-MM-DDTHH:mm または YYYY-MM-DDTHH:mm:ss)に実行環境のオフセットを
 * 付けて FHIR dateTime にする("2026-09-01T10:30:00+09:00")。FHIR の dateTime は時刻を含むなら
 * タイムゾーン必須。分までの入力(datetime-local)には秒 :00 を補う。空文字とタイムゾーン付きの値は
 * そのまま返す。
 */
export function toFhirDateTime(input: string): string {
  if (!input || /(?:Z|[+-]\d\d:\d\d)$/.test(input)) return input;
  const offsetMinutes = -new Date(input).getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${input.length === 16 ? `${input}:00` : input}${sign}${hh}:${mm}`;
}

/**
 * いまの時刻を FHIR dateTime(秒 + オフセット)で返す。オーダーの登録日時(authoredOn)に使う。
 * 秒まで持つのは、同じ日に数分おきに登録したオーダーの日内順序を安定させるため。
 */
export function nowFhirDateTime(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return toFhirDateTime(
    `${toDateInput(now)}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
  );
}

// 元号の開始日(新しい順)。
const ERAS: { name: string; start: string; year: number }[] = [
  { name: "令和", start: "2019-05-01", year: 2019 },
  { name: "平成", start: "1989-01-08", year: 1989 },
  { name: "昭和", start: "1926-12-25", year: 1926 },
  { name: "大正", start: "1912-07-30", year: 1912 },
  { name: "明治", start: "1868-01-25", year: 1868 },
];

/**
 * YYYY-MM-DD を和暦(「令和8年10月1日」)にする。1 年目は「元年」と書く。
 * 明治より前は西暦のまま、日付として読めない値は空文字を返す。
 */
export function toWareki(date: string | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date ?? "");
  if (!match) return "";
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  // 同じ桁数の日付は文字列のまま大小を比べられる。
  const era = ERAS.find((e) => match[0] >= e.start);
  if (!era) return `${year}年${month}月${day}日`;
  const eraYear = year - era.year + 1;
  return `${era.name}${eraYear === 1 ? "元" : eraYear}年${month}月${day}日`;
}
