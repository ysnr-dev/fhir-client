import {
  collectionPlanStatusClass,
  collectionPlanStatusLabel,
  parseCollectionPlan,
  plannedVolumeOf,
  type CollectionPlanLine,
} from "../fhir/autologousPlanHelpers";

// 自己血の採血予定の表(回・予定日時・予定量・状態)。オーダーの詳細と採血の画面で使う。
// 採血の画面では行を選んで「この予定の採血」として登録する。

interface Props {
  appointments: fhir4.Appointment[];
  /** 選べる(採血の画面)。未採血の予定だけ選べる。 */
  selectedId?: string;
  onSelect?: (appointment: fhir4.Appointment | null) => void;
}

export function AutologousPlanTable({ appointments, selectedId, onSelect }: Props) {
  const lines = parseCollectionPlan(appointments);
  if (lines.length === 0) return <p className="patient-table__empty">採血予定がありません。</p>;
  const byId = new Map(appointments.map((a) => [a.id ?? "", a]));
  return (
    <table className="rp-card__medicines autologous-plan">
      <thead>
        <tr>
          {onSelect && <th></th>}
          <th>回</th>
          <th>予定日時</th>
          <th>予定量</th>
          <th>状態</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line, index) => (
          <PlanRow
            key={line.id || index}
            index={index}
            line={line}
            selected={Boolean(selectedId) && line.id === selectedId}
            onSelect={onSelect ? () => onSelect(byId.get(line.id) ?? null) : undefined}
          />
        ))}
      </tbody>
    </table>
  );
}

function PlanRow({
  index,
  line,
  selected,
  onSelect,
}: {
  index: number;
  line: CollectionPlanLine;
  selected: boolean;
  onSelect?: () => void;
}) {
  const appointmentVolume = line.volume || "";
  return (
    <tr className={selected ? "autologous-plan__row--selected" : undefined}>
      {onSelect && (
        <td>
          <input
            type="radio"
            name="autologous-plan"
            checked={selected}
            disabled={line.status !== "booked"}
            onChange={onSelect}
            aria-label={`${index + 1} 回目の予定を選ぶ`}
          />
        </td>
      )}
      <td>{index + 1}</td>
      <td>{line.plannedAt.replace("T", " ") || "-"}</td>
      <td>{appointmentVolume ? `${appointmentVolume} mL` : "-"}</td>
      <td>
        <span className={`lab-worklist__status lab-worklist__status--${collectionPlanStatusClass(line.status)}`}>
          {collectionPlanStatusLabel(line.status)}
        </span>
      </td>
    </tr>
  );
}

/** 予定量の合計(mL)。取消した予定は数えない。 */
export function plannedTotalOf(appointments: fhir4.Appointment[]): number {
  return appointments
    .filter((a) => a.status !== "cancelled" && a.status !== "entered-in-error")
    .reduce((sum, a) => sum + (Number(plannedVolumeOf(a)) || 0), 0);
}
