import type { ComponentType } from "react";
import type { HomeCard, HomeCardKind } from "../../fhir/homeCards";
import { BulletinCard } from "./BulletinCard";
import { ChemoRoomCard, ConsultCard, NursingCard, TeamCard } from "./CountCards";
import { DashboardCard } from "./DashboardCard";
import { EmergencyCard } from "./EmergencyCard";
import { FolderCard } from "./FolderCard";
import { HomeWorklistCard } from "./HomeWorklistCard";
import { InpatientCard } from "./InpatientCard";
import { CountersignsCard, DocumentsDueCard, NotificationCard } from "./NotificationCards";
import { NursingSummaryApprovalsCard } from "./NursingSummaryApprovalsCard";
import { OutpatientCard } from "./OutpatientCard";
import { ResultFollowupCard } from "./ResultFollowupCard";
import { ShortcutsCard } from "./ShortcutsCard";
import { WardStatusCard } from "./WardStatusCard";
import type { HomeCardProps } from "./shared";

/** 種類 → カードの部品。種類を fhir/homeCards.ts に足すとここが型エラーになる。 */
const HOME_CARD_COMPONENTS: { [K in HomeCardKind]: ComponentType<HomeCardProps<K>> } = {
  bulletin: BulletinCard,
  notifications: NotificationCard,
  outpatient: OutpatientCard,
  inpatient: InpatientCard,
  worklist: HomeWorklistCard,
  consult: ConsultCard,
  team: TeamCard,
  nursing: NursingCard,
  chemoRoom: ChemoRoomCard,
  emergency: EmergencyCard,
  wardStatus: WardStatusCard,
  countersigns: CountersignsCard,
  documentsDue: DocumentsDueCard,
  resultFollowup: ResultFollowupCard,
  nursingSummaryApprovals: NursingSummaryApprovalsCard,
  dashboard: DashboardCard,
  folder: FolderCard,
  shortcuts: ShortcutsCard,
};

export function HomeCardView({
  card,
  ...rest
}: { card: HomeCard } & Omit<HomeCardProps<HomeCardKind>, "card">) {
  const Card = HOME_CARD_COMPONENTS[card.kind] as ComponentType<HomeCardProps<HomeCardKind>>;
  return <Card card={card} {...rest} />;
}
