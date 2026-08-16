import { Link, useNavigate } from "react-router-dom";
import { useCreateSchedule } from "../api/queries";
import { ScheduleForm, type ScheduleActorNames } from "../components/ScheduleForm";
import { buildSchedule, type ScheduleFormValues } from "../fhir/scheduleHelpers";

export function ScheduleCreatePage() {
  const navigate = useNavigate();
  const createSchedule = useCreateSchedule();

  function handleSubmit(values: ScheduleFormValues, actorNames: ScheduleActorNames) {
    createSchedule.mutate(buildSchedule(values, actorNames), {
      // 枠表を作っただけでは予約できないので、そのまま枠の生成に進ませる。
      onSuccess: (result) =>
        navigate(result.data.id ? `/schedules/${result.data.id}/slots` : "/schedules"),
    });
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>予約枠登録</h1>
        <Link to="/schedules" className="button">
          ← 一覧に戻る
        </Link>
      </div>
      <ScheduleForm
        onSubmit={handleSubmit}
        submitting={createSchedule.isPending}
        submitError={createSchedule.error}
        submitLabel="登録"
      />
    </div>
  );
}
