import { useRegimen } from "../api/masterQueries";
import { usePatientAdverseEvents } from "../api/queries";
import { adverseEventsOf } from "../fhir/adverseEventHelpers";
import { useRegimenApplication } from "../hooks/useRegimenApplication";
import { AdverseEventEditor } from "./AdverseEventEditor";
import { ErrorBanner } from "./ErrorBanner";

// カルテ右ペインの「化学療法(有害事象)」。適用 1 件のクールに対して記録する(§7.6 C-3)。
// 用語はレジメンマスタの「想定される副作用」を候補に出し、自由入力もできる。
//
// 記録は患者の有害事象を全部読んでクールで絞る。治療の id で引けるようになったのは
// 新しい形式(basedOn)だけで、旧形式の記録が残っているため(`useTreatmentAdverseEvents`)。

interface RegimenAdverseEventPanelProps {
  patientId: string;
  regimenSrId: string;
  cycle: number;
}

export function RegimenAdverseEventPanel({ patientId, regimenSrId, cycle }: RegimenAdverseEventPanelProps) {
  const { application, isPending, error } = useRegimenApplication(patientId, regimenSrId);
  const master = useRegimen(application?.code || null);
  const events = usePatientAdverseEvents(patientId);

  if (isPending) return <p>読み込み中...</p>;
  if (!application) return <ErrorBanner error={error ?? new Error("レジメンの適用が見つかりません")} />;

  return (
    <AdverseEventEditor
      patientId={patientId}
      target={{
        treatmentSrId: regimenSrId,
        treatmentType: "chemo-regimen",
        name: application.name,
        cycle,
      }}
      title={`${application.name} 第 ${cycle} クール`}
      records={adverseEventsOf(events.data ?? [], regimenSrId, cycle)}
      candidates={master.data?.adverse_events.map((ae) => ae.term) ?? []}
      error={error ?? events.error}
      emptyMessage="このクールの有害事象はありません"
    />
  );
}
