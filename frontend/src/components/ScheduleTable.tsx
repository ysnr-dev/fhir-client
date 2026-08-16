import { Link } from "react-router-dom";
import { useDeleteSchedule } from "../api/queries";
import {
  actorDisplay,
  scheduleName,
  schedulePeriodLabel,
} from "../fhir/scheduleHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { RowMenu } from "./RowMenu";

export function ScheduleTable({ schedules }: { schedules: fhir4.Schedule[] }) {
  const deleteSchedule = useDeleteSchedule();

  function handleDelete(schedule: fhir4.Schedule) {
    if (!schedule.id) return;
    if (
      !window.confirm(
        `${scheduleName(schedule)} を削除します。ぶら下がっている枠もすべて削除されます。よろしいですか?`,
      )
    ) {
      return;
    }
    deleteSchedule.mutate(schedule.id);
  }

  if (schedules.length === 0) {
    return <p className="patient-table__empty">該当する枠表が見つかりませんでした。</p>;
  }

  return (
    <>
      <ErrorBanner error={deleteSchedule.error} />
      <table className="patient-table">
        <thead>
          <tr>
            <th>名称</th>
            <th>担当医</th>
            <th>診察室</th>
            <th>診療科</th>
            <th>有効期間</th>
            <th>状態</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {schedules.map((schedule) => (
            <tr key={schedule.id}>
              <td>{scheduleName(schedule)}</td>
              <td>{actorDisplay(schedule, "Practitioner") || "-"}</td>
              <td>{actorDisplay(schedule, "Location") || "-"}</td>
              <td>{schedule.specialty?.[0]?.text ?? "-"}</td>
              <td>{schedulePeriodLabel(schedule)}</td>
              <td>{schedule.active === false ? "無効" : "有効"}</td>
              <td className="patient-table__actions">
                <RowMenu label={`${scheduleName(schedule)} の操作`}>
                  <Link className="row-menu__item" to={`/schedules/${schedule.id}/slots`}>
                    枠カレンダー
                  </Link>
                  <Link className="row-menu__item" to={`/schedules/${schedule.id}/edit`}>
                    編集
                  </Link>
                  <button
                    type="button"
                    className="row-menu__item row-menu__item--danger"
                    onClick={() => handleDelete(schedule)}
                    disabled={deleteSchedule.isPending}
                  >
                    削除
                  </button>
                </RowMenu>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
