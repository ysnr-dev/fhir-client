import { useMemo } from "react";
import { usePatientCautions } from "../api/masterQueries";
import { useActiveFlags, usePatientRadiotherapyOrders } from "../api/queries";
import { summarizeFlag } from "../fhir/flagHelpers";
import {
  overlapsRadiotherapySite,
  summarizeRadiotherapyOrder,
  type RadiotherapyVolumeValues,
} from "../fhir/radiotherapyOrderHelpers";
import { PregnancyNotice } from "./PregnancyNotice";

// 治療処方の安全確認(docs/radiotherapy-order-design.md §5.3)。処方フォームの先頭に出す。
//
// - 過去の放射線治療(この患者の治療コース)。今回の標的と同じ部位のコースは強調する。
//   再照射の気づきのためのもので、登録は止めない(隣接部位や累積線量は評価しない)。
// - 妊娠・授乳、体内金属・ペースメーカー(患者プロファイルの注意区分)。
//
// 該当が無い項目は何も出さない(PregnancyNotice と同じ方針)。他院での照射歴は
// 依頼目的(他科依頼のテンプレート)に書かれるので、フォームの依頼欄で読む。

interface RadiotherapyPreCheckProps {
  patientId: string;
  volumes: RadiotherapyVolumeValues[];
  /** 編集中のオーダー自身は過去コースに数えない。 */
  excludeSrId?: string;
}

export function RadiotherapyPreCheck({ patientId, volumes, excludeSrId }: RadiotherapyPreCheckProps) {
  const orders = usePatientRadiotherapyOrders(patientId);
  const flags = useActiveFlags(patientId);
  const cautions = usePatientCautions();

  const courses = useMemo(
    () =>
      (orders.data ?? [])
        .filter((sr) => sr.id !== excludeSrId)
        .map((sr) => ({ sr, summary: summarizeRadiotherapyOrder(sr) })),
    [orders.data, excludeSrId],
  );

  const implants = useMemo(() => {
    const byCode = new Map((cautions.data?.items ?? []).map((c) => [c.code, c]));
    return flags.flags
      .map((flag) => summarizeFlag(flag, byCode))
      .filter((summary) => summary.pictogram === "implant");
  }, [flags.flags, cautions.data]);

  return (
    <>
      <PregnancyNotice patientId={patientId} />
      {implants.length > 0 && (
        <p className="pregnancy-notice" role="note">
          {implants.map((f) => [f.name, f.text].filter(Boolean).join(" ")).join(" / ")}
        </p>
      )}
      {courses.length > 0 && (
        <fieldset>
          <legend>過去の放射線治療</legend>
          <table className="master-search__table radiotherapy-order__history">
            <thead>
              <tr>
                <th>コース</th>
                <th>開始</th>
                <th>部位</th>
                <th>線量</th>
                <th>状態</th>
              </tr>
            </thead>
            <tbody>
              {courses.map(({ sr, summary }) => (
                <tr
                  key={sr.id}
                  className={
                    overlapsRadiotherapySite(volumes, summary.volumes)
                      ? "radiotherapy-order__history-row--overlap"
                      : undefined
                  }
                >
                  <td>第{summary.courseNumber}</td>
                  <td>{summary.startDate}</td>
                  <td>{summary.siteLabel}</td>
                  <td>{summary.doseLabel}</td>
                  <td>{COURSE_STATUS_LABELS[sr.status] ?? sr.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </fieldset>
      )}
    </>
  );
}

const COURSE_STATUS_LABELS: Record<string, string> = {
  active: "進行中",
  "on-hold": "休止",
  completed: "終了",
  revoked: "中止",
};
