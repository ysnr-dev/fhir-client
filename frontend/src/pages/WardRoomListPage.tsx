import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useLocation, useRoomSearch } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { Pagination } from "../components/Pagination";
import { RoomTable } from "../components/RoomTable";
import { locationDisplayName, locationStatusLabel } from "../fhir/locationHelpers";

// 1 つの病棟にぶら下がる病室の一覧。病棟 → 病室の親子は予約枠(枠表 → 枠)と
// 同じ形で、病棟一覧の「病室管理」から入る。

export function WardRoomListPage() {
  const { wardId } = useParams<{ wardId: string }>();
  const [offset, setOffset] = useState(0);

  const { data: wardResult, isLoading: loadingWard, error: wardError } = useLocation(wardId);
  const ward = wardResult?.data;
  const { rooms, beds, bedCounts, total, count, hasPrevious, hasNext, isLoading, error } =
    useRoomSearch(wardId, offset);

  if (loadingWard) return <div className="page">読み込み中...</div>;

  if (wardError || !ward) {
    return (
      <div className="page">
        <div className="page__header">
          <h1>病室一覧</h1>
          <Link to="/wards" className="button">
            ← 病棟一覧に戻る
          </Link>
        </div>
        <ErrorBanner error={wardError} />
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>{locationDisplayName(ward)} の病室</h1>
        <div className="page__header-actions">
          <Link to={`/wards/${wardId}/rooms/new`} className="button">
            病室を追加
          </Link>
          <Link to={`/wards/${wardId}/edit`} className="button">
            病棟を編集
          </Link>
          <Link to="/wards" className="button">
            ← 病棟一覧に戻る
          </Link>
        </div>
      </div>

      <p className="slot-calendar__schedule">
        状態 {locationStatusLabel(ward.status)}
        {ward.description ? ` / ${ward.description}` : ""}
      </p>

      <ErrorBanner error={error} />

      {isLoading ? (
        <p>読み込み中...</p>
      ) : (
        <>
          <RoomTable
            wardId={wardId as string}
            rooms={rooms}
            beds={beds}
            bedCounts={bedCounts}
          />
          <Pagination
            offset={offset}
            count={count}
            total={total}
            hasPrevious={hasPrevious}
            hasNext={hasNext}
            onPrevious={() => setOffset((o) => Math.max(0, o - count))}
            onNext={() => setOffset((o) => o + count)}
          />
        </>
      )}
    </div>
  );
}
