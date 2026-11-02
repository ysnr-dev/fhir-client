import { ADVISORY_SEVERITY_RANK } from "../fhir/advisoryHelpers";
import { useAdvisoryRuleAdvisories } from "../hooks/useAdvisoryRuleAdvisories";
import { useAdvisorySession } from "../hooks/useAdvisorySession";
import { AdvisoryNotice } from "./AdvisoryNotice";
import { CautionPictogram } from "./icons/cautionPictograms";
import { PictogramPopover } from "./PictogramPopover";

// 患者帯の「施設の規則」ピクトグラム(docs/advisory-design.md §2.9)。カルテを開いたときに、
// 出す場所に「カルテを開いたとき」を含む規則を評価し、真になった警告を吹き出しに並べる。
// 確認は求めない(重さは色だけ)。発火は台帳に context patient-view で残す。

const HEADER_PICTOGRAM_SIZE = 20;

interface AdvisoryRulePictogramProps {
  patientId: string | undefined;
  size?: number;
  portal?: boolean;
}

export function AdvisoryRulePictogram({ patientId, size = HEADER_PICTOGRAM_SIZE, portal }: AdvisoryRulePictogramProps) {
  const input = useAdvisoryRuleAdvisories(patientId ?? "", "patient-view");
  const { advisories } = useAdvisorySession(input, "patient-view", Boolean(patientId));
  if (!patientId || advisories.length === 0) return null;

  const worst = advisories.reduce(
    (max, advisory) => (ADVISORY_SEVERITY_RANK[advisory.severity] > ADVISORY_SEVERITY_RANK[max] ? advisory.severity : max),
    advisories[0].severity,
  );

  return (
    <span className="patient-header__item patient-header__cautions">
      <PictogramPopover
        label={`施設の規則 ${advisories.length} 件`}
        className={`patient-header__caution--rule-${worst}`}
        icon={<CautionPictogram pictogram="cds" size={size} />}
        count={advisories.length}
        portal={portal}
        closeOnClick={false}
      >
        <AdvisoryNotice advisories={advisories} className="patient-header__rule-notice" />
      </PictogramPopover>
    </span>
  );
}
