import type { DpcPatientRow } from "../fhir/dpcPatientList";

/** 期間Ⅱの末日がこの日数以内なら「間近」。 */
const NEAR_DAYS = 2;

/** 期間Ⅱの末日。過ぎていれば超過日数を添えて赤く、末日が近ければ印を付ける。 */
export function DpcPeriod2({ row }: { row: DpcPatientRow }) {
  if (!row.period2End) return <>-</>;
  if (row.overDays > 0) {
    return (
      <span className="dpc-patients__over">
        {row.period2End}(+{row.overDays}日)
      </span>
    );
  }
  const near = row.daysLeft !== null && row.daysLeft <= NEAR_DAYS && !row.dischargedOn;
  return <span className={near ? "dpc-patients__near" : undefined}>{row.period2End}</span>;
}
