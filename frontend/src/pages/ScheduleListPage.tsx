import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  useLocationOptions,
  usePractitionerOptions,
  useScheduleSearch,
  type ScheduleSearchParams,
} from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { Pagination } from "../components/Pagination";
import { ScheduleTable } from "../components/ScheduleTable";
import { locationDisplayName } from "../fhir/locationHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";

// 予約枠(Schedule)の一覧。1 行 = 枠表 1 件で、実際の時間枠(Slot)は
// 「予約枠カレンダー」から週単位で管理する。

const emptySearch: ScheduleSearchParams = {
  practitionerId: "",
  locationId: "",
  activeOnly: true,
};

export function ScheduleListPage() {
  const [search, setSearch] = useState<ScheduleSearchParams>(emptySearch);
  const [inputs, setInputs] = useState<ScheduleSearchParams>(emptySearch);
  const [offset, setOffset] = useState(0);

  const { practitioners } = usePractitionerOptions();
  const { locations } = useLocationOptions();
  const { schedules, total, count, hasPrevious, hasNext, isLoading, error } = useScheduleSearch(
    search,
    offset,
  );

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    setSearch(inputs);
    setOffset(0);
  }

  function handleReset() {
    setInputs(emptySearch);
    setSearch(emptySearch);
    setOffset(0);
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>予約枠一覧</h1>
        <Link to="/schedules/new" className="button">
          新規登録
        </Link>
      </div>

      <form className="patient-search-form" onSubmit={handleSearch}>
        <label>
          担当医
          <select
            value={inputs.practitionerId}
            onChange={(e) => setInputs({ ...inputs, practitionerId: e.target.value })}
          >
            <option value="">すべて</option>
            {practitioners.map((practitioner) => (
              <option key={practitioner.id} value={practitioner.id}>
                {practitionerDisplayName(practitioner)}
              </option>
            ))}
          </select>
        </label>
        <label>
          診察室・撮影室
          <select
            value={inputs.locationId}
            onChange={(e) => setInputs({ ...inputs, locationId: e.target.value })}
          >
            <option value="">すべて</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {locationDisplayName(location)}
              </option>
            ))}
          </select>
        </label>
        <label className="patient-form__checkbox">
          <input
            type="checkbox"
            checked={inputs.activeOnly ?? false}
            onChange={(e) => setInputs({ ...inputs, activeOnly: e.target.checked })}
          />
          有効な枠表のみ
        </label>
        <div className="patient-search-form__actions">
          <button type="submit">検索</button>
          <button type="button" onClick={handleReset}>
            クリア
          </button>
        </div>
      </form>

      <ErrorBanner error={error} />

      {isLoading ? (
        <p>読み込み中...</p>
      ) : (
        <>
          <ScheduleTable schedules={schedules} />
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
