import { useMemo } from "react";
import { usePatientCautions } from "../api/masterQueries";
import { useActiveFlags, usePatientRadiotherapyOrders } from "../api/queries";
import { type Advisory, advisoryKey, severityOf } from "../fhir/advisoryHelpers";
import { summarizeFlag } from "../fhir/flagHelpers";
import {
  overlapsRadiotherapySite,
  summarizeRadiotherapyOrder,
  type RadiotherapyVolumeValues,
} from "../fhir/radiotherapyOrderHelpers";
import { usePregnancyAdvisory } from "../hooks/usePatientStateAdvisories";

// 治療処方の安全確認(docs/radiotherapy-order-design.md §5.3)。処方フォームの先頭に出す。
//
// - 過去の放射線治療(この患者の治療コース)。今回の標的と同じ部位のコースは表で強調し、
//   共通の警告(表示のみ)にも載せる。再照射の気づきのためのもので、隣接部位や累積線量は評価しない。
// - 妊娠・授乳、体内金属・ペースメーカー(患者プロファイルの注意区分)。どれも表示のみ。
//
// 該当が無い項目は何も出さない。他院での照射歴は依頼目的(他科依頼のテンプレート)に
// 書かれるので、フォームの依頼欄で読む。

interface RadiotherapyPreCheckProps {
  patientId: string;
  volumes: RadiotherapyVolumeValues[];
  /** 編集中のオーダー自身は過去コースに数えない。 */
  excludeSrId?: string;
}

function useRadiotherapyCourses(patientId: string, excludeSrId: string | undefined) {
  const orders = usePatientRadiotherapyOrders(patientId || undefined);
  return useMemo(
    () =>
      (orders.data ?? [])
        .filter((sr) => sr.id !== excludeSrId)
        .map((sr) => ({ sr, summary: summarizeRadiotherapyOrder(sr) })),
    [orders.data, excludeSrId],
  );
}

/** 治療処方のフォームに出す警告(妊娠・授乳、体内金属、同一部位の照射歴)。 */
export function useRadiotherapyAdvisories({ patientId, volumes, excludeSrId }: RadiotherapyPreCheckProps): Advisory[] {
  const pregnancy = usePregnancyAdvisory(patientId);
  const courses = useRadiotherapyCourses(patientId, excludeSrId);
  const flags = useActiveFlags(patientId || undefined);
  const cautions = usePatientCautions();

  return useMemo(() => {
    if (!patientId) return [];
    const byCode = new Map((cautions.data?.items ?? []).map((c) => [c.code, c]));
    const implants = flags.flags
      .map((flag) => summarizeFlag(flag, byCode))
      .filter((summary) => summary.pictogram === "implant")
      .map((f) => [f.name, f.text].filter(Boolean).join(" "));
    const overlaps = courses.filter(({ summary }) => overlapsRadiotherapySite(volumes, summary.volumes));
    return [
      ...pregnancy,
      ...(implants.length > 0
        ? [
            {
              key: advisoryKey("implant", ...implants),
              kind: "implant" as const,
              severity: severityOf("implant", false),
              message: implants.join(" / "),
            },
          ]
        : []),
      ...(overlaps.length > 0
        ? [
            {
              key: advisoryKey("reirradiation", ...overlaps.map(({ sr }) => sr.id)),
              kind: "reirradiation" as const,
              severity: severityOf("reirradiation", true),
              message: `同一部位の照射歴: ${overlaps
                .map(({ summary }) => `第${summary.courseNumber}コース ${summary.siteLabel} ${summary.doseLabel}`)
                .join(" / ")}`,
            },
          ]
        : []),
    ];
  }, [patientId, pregnancy, courses, volumes, flags.flags, cautions.data]);
}

/** 過去の放射線治療の表。今回の標的と同じ部位のコースを強調する。 */
export function RadiotherapyHistory({ patientId, volumes, excludeSrId }: RadiotherapyPreCheckProps) {
  const courses = useRadiotherapyCourses(patientId, excludeSrId);
  if (courses.length === 0) return null;

  return (
    <fieldset>
      <legend>過去の放射線治療</legend>
      <table className="master-search__table radiotherapy-order__history">
        <thead>
          <tr>
            <th className="radiotherapy-order__history-fit">コース</th>
            <th className="radiotherapy-order__history-fit">開始</th>
            <th>部位</th>
            <th>線量</th>
            <th className="radiotherapy-order__history-fit">状態</th>
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
              <td className="radiotherapy-order__history-fit">第{summary.courseNumber}</td>
              <td className="radiotherapy-order__history-fit">{summary.startDate}</td>
              <td>{summary.siteLabel}</td>
              <td>{summary.doseLabel}</td>
              <td className="radiotherapy-order__history-fit">{COURSE_STATUS_LABELS[sr.status] ?? sr.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </fieldset>
  );
}

const COURSE_STATUS_LABELS: Record<string, string> = {
  active: "進行中",
  "on-hold": "休止",
  completed: "終了",
  revoked: "中止",
};
