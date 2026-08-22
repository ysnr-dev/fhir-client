import { Link, useNavigate, useParams } from "react-router-dom";
import { useSaveRoom } from "../api/queries";
import { RoomForm } from "../components/RoomForm";
import type { RoomFormValues } from "../fhir/wardHelpers";

export function WardRoomCreatePage() {
  const { wardId } = useParams<{ wardId: string }>();
  const navigate = useNavigate();
  const saveRoom = useSaveRoom();

  function handleSubmit(values: RoomFormValues) {
    if (!wardId) return;
    // 病室とベッドは 1 つの transaction で一緒に作る(wardHelpers の
    // buildRoomSaveBundle 参照)。
    saveRoom.mutate(
      { values, wardId },
      { onSuccess: () => navigate(`/wards/${wardId}/rooms`) },
    );
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>病室登録</h1>
        <Link to={`/wards/${wardId}/rooms`} className="button">
          ← 病室一覧に戻る
        </Link>
      </div>
      <RoomForm
        onSubmit={handleSubmit}
        submitting={saveRoom.isPending}
        submitError={saveRoom.error}
        submitLabel="登録"
      />
    </div>
  );
}
