import { Fragment } from "react";
import { useApproveOrderProvenances, useCanApproveOrder, useOrderProvenance } from "../api/queries";
import {
  advisoryOverridesOf,
  orderActivityLabel,
  provenancesOf,
  summarizeOrderProvenance,
} from "../fhir/provenanceHelpers";
import { dateTimeSecondsLabel } from "../lib/dates";
import { ErrorBanner } from "./ErrorBanner";

/**
 * オーダー詳細の「登録日時」行。全種別の詳細で同じラベル・同じ書式にする。
 * 書式は文字列のまま切り出す dateTimeSecondsLabel(YYYY-MM-DD HH:mm:ss)。秒まで出すのは、
 * 同じ分にオーダーを何件も登録するため(どちらが先かが分からないと監査の役に立たない)。
 * 時刻を持たない値は日付だけになる(formatDateTime だと日付のみの値を UTC 0 時 = 9:00 と
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
 * オーダー詳細の来歴の行。全種別の詳細が登録日時の下に置く。来歴は詳細を開いたときだけ引く
 * (useOrderProvenance)。出すのは真正性の観点で意味のある行だけで、医師本人が登録して
 * 編集も無いオーダーでは何も出ない。
 *
 * - 代行入力 … 登録が代行(入力者 ≠ 指示医師)だったとき。入力者と指示医師
 * - 最終更新 … 編集があったとき。最後に編集した人と日時
 * - 承認     … 代行の活動があるとき。承認済なら承認した医師と日時、未承認なら
 *              指示医師本人にだけ「承認」ボタン(登録と編集の承認待ちはまとめて承認する)
 * - 警告の確認 … 警告を無視して登録・編集したとき。誰が・いつ・どの警告をどの理由で(docs/advisory-design.md §2.8)
 */
export function EnteredByRow({ serviceRequestId }: { serviceRequestId: string | undefined }) {
  const provenance = useOrderProvenance(serviceRequestId);
  const provenances = provenancesOf(provenance.data?.data);
  const summary = summarizeOrderProvenance(provenances);
  const overrides = advisoryOverridesOf(provenances);
  const canApprove = useCanApproveOrder(summary);
  const approve = useApproveOrderProvenances();

  const { proxyEntry, lastUpdate, pending, approval } = summary;
  if (!proxyEntry && !lastUpdate && pending.length === 0 && !approval && overrides.length === 0) return null;

  return (
    <>
      {overrides.map((record) => (
        <Fragment key={record.at}>
          <dt>警告の確認</dt>
          <dd>
            {`${record.name}　${dateTimeSecondsLabel(record.at)}`}
            <ul className="order-detail__advisory-overrides">
              {record.reasons.map((reason, index) => (
                <li key={index}>{`${reason.text} — ${reason.reason}`}</li>
              ))}
            </ul>
          </dd>
        </Fragment>
      ))}
      {proxyEntry && (
        <>
          <dt>代行入力</dt>
          <dd>{`${proxyEntry.entererName}（指示: ${proxyEntry.authorName}）`}</dd>
        </>
      )}
      {/* 研修医・学生の活動は指導医のカウンターサインの対象。本人は承認できない。 */}
      {summary.traineeAuthor && (
        <>
          <dt>研修医</dt>
          <dd>{summary.authorReference ? "指導医のカウンターサイン対象" : "-"}</dd>
        </>
      )}
      {lastUpdate && (
        <>
          {/* 編集以外(中止・完了・休止・再開)は何をしたかを見出しに出す。 */}
          <dt>{lastUpdate.activity === "UPDATE" ? "最終更新" : orderActivityLabel(lastUpdate.activity)}</dt>
          <dd>{`${lastUpdate.name}　${dateTimeSecondsLabel(lastUpdate.at)}`}</dd>
        </>
      )}
      {(pending.length > 0 || approval) && (
        <>
          <dt>承認</dt>
          <dd>
            {pending.length > 0 ? (
              <span className="order-approval__pending">
                未承認
                {canApprove && (
                  <button
                    type="button"
                    className="button rp-card__compact-button"
                    disabled={approve.isPending}
                    onClick={() => approve.mutate(pending.map((p) => p.id ?? ""))}
                  >
                    承認
                  </button>
                )}
              </span>
            ) : (
              approval && `${approval.name}　${dateTimeSecondsLabel(approval.at)}`
            )}
            <ErrorBanner error={approve.error} />
          </dd>
        </>
      )}
    </>
  );
}
