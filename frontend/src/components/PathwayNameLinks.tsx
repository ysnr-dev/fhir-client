import { Link } from "react-router-dom";
import type { PathwayApplicationSummary } from "../api/queries";
import { KARTE_TAB_PARAM } from "../karteUrl";
import type { useReturnLinkState } from "../returnTo";

// 進行中のパスの名前(病棟の一覧の「パス」列と患者ヘッダ)。名前だけを出し、押すとカルテのパスタブを
// その適用で開く(表示はパスタブの既定のオーバービュー)。設計は docs/clinical-pathway-design.md §6(病棟の一覧と患者ヘッダ)。

function pathwayTabLink(patientId: string, applicationId: string): string {
  return `/patients/${patientId}/karte?${KARTE_TAB_PARAM}=pathway&view=${encodeURIComponent(applicationId)}`;
}

export function PathwayNameLinks({
  patientId,
  applications,
  returnLinkState,
}: {
  patientId: string;
  applications: PathwayApplicationSummary[];
  returnLinkState?: ReturnType<typeof useReturnLinkState>;
}) {
  return (
    <>
      {applications.map((application) => (
        <Link
          key={application.id}
          className="pathway-name-link"
          to={pathwayTabLink(patientId, application.id)}
          state={returnLinkState}
          title={application.title}
        >
          {application.title}
        </Link>
      ))}
    </>
  );
}
