import { Link, useNavigate, useParams } from "react-router-dom";
import { useLocation, useRoomBeds, useSaveRoom } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { RoomForm } from "../components/RoomForm";
import { parseRoom, type RoomFormValues } from "../fhir/wardHelpers";

export function WardRoomEditPage() {
  const { wardId, id } = useParams<{ wardId: string; id: string }>();
  const navigate = useNavigate();
  const { data: result, isLoading, error: loadError } = useLocation(id);
  // ベッド数の初期値と、増減の差分を出すために現在のベッドを取る。
  const { beds, isLoading: loadingBeds, error: bedsError } = useRoomBeds(id);
  const saveRoom = useSaveRoom();

  function handleSubmit(values: RoomFormValues) {
    if (!wardId || !id) return;
    // 病室本体とベッドの増減を 1 つの transaction で書くため、単体 PUT
    // (If-Match)ではなく Bundle で送る。枠の一括操作と同じ扱い。
    saveRoom.mutate(
      { values, wardId, roomId: id, existingBeds: beds },
      { onSuccess: () => navigate(`/wards/${wardId}/rooms`) },
    );
  }

  const header = (
    <div className="page__header">
      <h1>病室編集</h1>
      <Link to={`/wards/${wardId}/rooms`} className="button">
        ← 病室一覧に戻る
      </Link>
    </div>
  );

  if (isLoading || loadingBeds) return <div className="page">読み込み中...</div>;

  if (loadError || bedsError || !result) {
    return (
      <div className="page">
        {header}
        <ErrorBanner error={loadError ?? bedsError} />
      </div>
    );
  }

  return (
    <div className="page">
      {header}
      <RoomForm
        initialValues={parseRoom(result.data, beds.length)}
        onSubmit={handleSubmit}
        submitting={saveRoom.isPending}
        submitError={saveRoom.error}
        submitLabel="更新"
        editing
      />
    </div>
  );
}
