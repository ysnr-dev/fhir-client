import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useBedWardIndex, useEncountersInRange, usePlannedAdmissions, useWardOptions } from "../../api/queries";
import { wardBedStats, type WardBedStats } from "../../fhir/bedScheduleHelpers";
import { ErrorBanner } from "../ErrorBanner";
import { HomeCardFrame, HomeCardLoading, HomeCardTruncated, type HomeCardProps } from "./shared";

function emptyBeds(stats: WardBedStats): number {
  let sum = 0;
  for (const count of stats.emptyByRoomClass.values()) sum += count;
  return sum;
}

/**
 * 病棟の状況。病床状況の画面と同じ集計(wardBedStats)を今日 1 日ぶんで行い、病棟ごとに
 * 空床・本日の入退院・翌日の入院予定を並べる。設定で 1 病棟に絞れる。
 */
export function WardStatusCard({ card, date }: HomeCardProps<"wardStatus">) {
  const wardId = card.settings.wardId;
  const wardOptions = useWardOptions();
  const bedWards = useBedWardIndex();
  const encounters = useEncountersInRange(date, date);
  const planned = usePlannedAdmissions();

  const statsByWard = useMemo(
    () =>
      wardBedStats({
        encounters: encounters.data?.encounters ?? [],
        plannedAdmissions: planned.data?.encounters ?? [],
        bedPlaces: bedWards.bedWards,
        date,
        periodStart: date,
      }),
    [encounters.data, planned.data, bedWards.bedWards, date],
  );
  const wards = wardOptions.wards.filter(
    (ward) => ward.id && statsByWard.has(ward.id) && (!wardId || ward.id === wardId),
  );
  const isPending = wardOptions.isPending || bedWards.isPending || encounters.isPending || planned.isPending;
  const totalEmpty = wards.reduce((sum, ward) => sum + emptyBeds(statsByWard.get(ward.id ?? "")!), 0);
  const title = wardId ? `病棟の状況(${wardOptions.wards.find((w) => w.id === wardId)?.name ?? ""})` : "病棟の状況";

  return (
    <HomeCardFrame title={title} link={{ to: `/bed-status?date=${date}`, label: "病床状況" }}>
      <ErrorBanner error={wardOptions.error ?? bedWards.error ?? encounters.error ?? planned.error} />
      {isPending ? (
        <HomeCardLoading />
      ) : (
        <>
          <p className="home__counts">
            <span className="home__count home__count--big">
              空床 <strong>{totalEmpty}</strong>
            </span>
          </p>
          {encounters.data?.truncated && <HomeCardTruncated>入院が多いため、一部のみ数えています。</HomeCardTruncated>}
          {wards.length === 0 ? (
            <p className="home__empty">病棟がありません。</p>
          ) : (
            <div className="home__table-wrap">
              <table className="home__table">
                <thead>
                  <tr>
                    <th>病棟</th>
                    <th>在院</th>
                    <th>空床</th>
                    <th>本日入院</th>
                    <th>本日退院</th>
                    <th>翌日入院予定</th>
                    <th>翌日退院予定</th>
                  </tr>
                </thead>
                <tbody>
                  {wards.map((ward) => {
                    const stats = statsByWard.get(ward.id ?? "")!;
                    return (
                      <tr key={ward.id}>
                        <td>
                          <Link className="home__row-link" to={`/inpatients?ward=${ward.id}&date=${date}`}>
                            {ward.name}
                          </Link>
                        </td>
                        <td className="home__cell-compact">
                          {stats.occupied} / {stats.beds - stats.unusable}
                        </td>
                        <td className="home__cell-compact">{emptyBeds(stats)}</td>
                        <td className="home__cell-compact">{stats.admissions}</td>
                        <td className="home__cell-compact">{stats.discharges}</td>
                        <td className="home__cell-compact">{stats.plannedAdmissionsNext}</td>
                        <td className="home__cell-compact">{stats.plannedDischargesNext}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </HomeCardFrame>
  );
}
