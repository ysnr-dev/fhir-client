import { useOrderProvenance } from "../api/queries";
import { orderProxyEntry, provenancesOf } from "../fhir/provenanceHelpers";
import { dateTimeSecondsLabel } from "../lib/dates";

/**
 * オーダー詳細の「登録日時」行。全種別の詳細で同じラベル・同じ書式にする。
 * 書式は文字列のまま切り出す dateTimeSecondsLabel(YYYY-MM-DD HH:mm:ss)。秒まで出すのは、
 * 同じ分にオーダーを何件も登録するため(どちらが先かが分からないと監査の役に立たない)。
 * 時刻を持たない旧データは日付だけになる(formatDateTime だと日付のみの値を UTC 0 時 = 9:00 と
 * 誤って出す)。
 */
export function RegisteredAtRow({ authoredOn }: { authoredOn: string | undefined }) {
  return (
    <>
      <dt>登録日時</dt>
      <dd>{dateTimeSecondsLabel(authoredOn) || "-"}</dd>
    </>
  );
}

/**
 * オーダー詳細の「代行入力」行。医師以外が指示医師を選んで入力したときだけ出す
 * (入力者 = 依頼医師なら真正性の観点で書くことが無いので何も出さない)。
 * 来歴は詳細を開いたときだけ引く(useOrderProvenance)。
 */
export function EnteredByRow({ serviceRequestId }: { serviceRequestId: string | undefined }) {
  const provenance = useOrderProvenance(serviceRequestId);
  const proxy = orderProxyEntry(provenancesOf(provenance.data?.data));
  if (!proxy) return null;

  return (
    <>
      <dt>代行入力</dt>
      <dd>{`${proxy.entererName}（指示: ${proxy.authorName}）`}</dd>
    </>
  );
}
