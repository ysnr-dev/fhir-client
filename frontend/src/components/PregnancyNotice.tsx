import { usePregnancy } from "../api/queries";
import { summarizePregnancy } from "../fhir/pregnancyHelpers";

/**
 * 妊娠中・授乳中の注意。処方(催奇形性・乳汁移行)と放射線検査(被曝)の
 * オーダー画面に出す。
 *
 * 妊娠していない・授乳していないときは何も出さない。常に出すと読み飛ばされ、
 * 本当に注意が要るときに目に入らなくなるため。オーダーを妨げることもしない
 * (妊婦にも必要な検査・薬はあり、判断は医師のもの)。
 */
export function PregnancyNotice({ patientId }: { patientId: string }) {
  const { observations } = usePregnancy(patientId);
  const summary = summarizePregnancy(observations);

  if (!summary || (!summary.pregnant && !summary.lactating)) return null;

  const states = [
    summary.pregnant ? "妊娠中" : "",
    summary.lactating ? "授乳中" : "",
  ].filter(Boolean);
  const due = summary.pregnant && summary.dueDate ? `分娩予定日 ${summary.dueDate}` : "";
  const confirmed = summary.effectiveDate ? `${summary.effectiveDate} 確認` : "";

  return (
    <p className="pregnancy-notice" role="note">
      {states.join(" / ")}
      {[due, confirmed].filter(Boolean).length > 0 &&
        `（${[due, confirmed].filter(Boolean).join(" ・ ")}）`}
    </p>
  );
}
