import { useCdsFeedback, useCdsPatientView } from "../api/cdsQueries";
import { worstIndicator } from "../fhir/cdsCardHelpers";
import { CdsCardList } from "./CdsCardList";
import { CautionPictogram } from "./icons/cautionPictograms";
import { PictogramPopover } from "./PictogramPopover";

// 患者帯の「判断支援」ピクトグラム(docs/cds-hooks-design.md §3.1)。カルテを開いたときに
// 外部の CDS サービスが返したカードを吹き出しに並べる。カードが無ければ何も出さない。

const HEADER_PICTOGRAM_SIZE = 20;

interface CdsPictogramProps {
  patientId: string | undefined;
  size?: number;
  portal?: boolean;
  /** 外来の診察中の受診。起動の文脈として渡す。 */
  encounterId?: string;
}

export function CdsPictogram({ patientId, size = HEADER_PICTOGRAM_SIZE, portal, encounterId }: CdsPictogramProps) {
  const result = useCdsPatientView(patientId, encounterId);
  const feedback = useCdsFeedback(patientId, encounterId);
  const cards = result.data?.cards ?? [];
  if (!patientId || cards.length === 0) return null;

  return (
    <span className="patient-header__item patient-header__cautions">
      <PictogramPopover
        label={`判断支援 ${cards.length} 件`}
        className={`patient-header__caution--cds-${worstIndicator(cards)}`}
        icon={<CautionPictogram pictogram="cds" size={size} />}
        count={cards.length}
        portal={portal}
        closeOnClick={false}
      >
        <CdsCardList
          className="patient-header__popover-list"
          cards={cards}
          patientId={patientId}
          onOverride={(card, reason) =>
            feedback.mutate({
              service_id: card.service.id,
              service: card.service.service,
              card: card.uuid,
              outcome: "overridden",
              override_reason: { code: reason.code, system: reason.system },
            })
          }
        />
      </PictogramPopover>
    </span>
  );
}
