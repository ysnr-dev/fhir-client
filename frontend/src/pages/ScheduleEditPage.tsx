import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { FhirError } from "../api/fhirClient";
import { useSchedule, useUpdateSchedule } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { ScheduleForm, type ScheduleActorNames } from "../components/ScheduleForm";
import { buildSchedule, parseSchedule, type ScheduleFormValues } from "../fhir/scheduleHelpers";

export function ScheduleEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: result, isLoading, error: loadError } = useSchedule(id);
  const updateSchedule = useUpdateSchedule();
  const [conflict, setConflict] = useState(false);

  function handleSubmit(values: ScheduleFormValues, actorNames: ScheduleActorNames) {
    if (!id || !result?.etag) return;
    setConflict(false);
    updateSchedule.mutate(
      { schedule: buildSchedule(values, actorNames, id), etag: result.etag },
      {
        onSuccess: () => navigate("/schedules"),
        onError: (error) => {
          if (error instanceof FhirError && error.status === 412) {
            setConflict(true);
          }
        },
      },
    );
  }

  if (isLoading) return <div className="page">読み込み中...</div>;

  if (loadError || !result) {
    return (
      <div className="page">
        <div className="page__header">
          <h1>予約枠編集</h1>
          <Link to="/schedules" className="button">
            ← 一覧に戻る
          </Link>
        </div>
        <ErrorBanner error={loadError} />
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>予約枠編集</h1>
        <div className="page__header-actions">
          <Link to={`/schedules/${id}/slots`} className="button">
            予約枠カレンダー
          </Link>
          <Link to="/schedules" className="button">
            ← 一覧に戻る
          </Link>
        </div>
      </div>
      {conflict && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">
            この枠表は他の操作によって更新されています。画面を再読込してから再度編集してください。
          </p>
        </div>
      )}
      <ScheduleForm
        initialValues={parseSchedule(result.data)}
        onSubmit={handleSubmit}
        submitting={updateSchedule.isPending}
        submitError={conflict ? undefined : updateSchedule.error}
        submitLabel="更新"
      />
    </div>
  );
}
