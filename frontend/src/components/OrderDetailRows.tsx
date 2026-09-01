import { dateTimeLabel } from "../lib/dates";

/**
 * オーダー詳細の「登録日時」行。全種別の詳細で同じラベル・同じ書式にする。
 * 書式は文字列のまま切り出す dateTimeLabel(YYYY-MM-DD HH:mm)。時刻を持たない旧データは
 * 日付だけになる(formatDateTime だと日付のみの値を UTC 0 時 = 9:00 と誤って出す)。
 */
export function RegisteredAtRow({ authoredOn }: { authoredOn: string | undefined }) {
  return (
    <>
      <dt>登録日時</dt>
      <dd>{dateTimeLabel(authoredOn) || "-"}</dd>
    </>
  );
}
