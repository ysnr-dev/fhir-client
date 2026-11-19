import { useEffect, useMemo, type FormEvent, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  useBedWardIndex,
  useEncountersInRange,
  usePlannedAdmissions,
  useWardOptions,
} from "../api/queries";
import { DateStepper } from "../components/DateStepper";
import { ErrorBanner } from "../components/ErrorBanner";
import { HelpTip } from "../components/HelpTip";
import { StatCell, StatMeter, StatSection, StatTile, StatTiles } from "../components/StatSummary";
import { TruncatedNotice } from "../components/TruncatedNotice";
import {
  averageStay,
  occupancyRate,
  wardBedStats,
  type WardBedStats,
} from "../fhir/bedScheduleHelpers";
import { locationDisplayName } from "../fhir/locationHelpers";
import { ROOM_CLASS_OPTIONS, roomClassLabel } from "../fhir/wardHelpers";
import { addDays, today } from "../lib/dates";

// 病床状況。上に病院全体の要約(在院・空床・本日・翌日の予定・期間の指標)をタイルで出し、下の表に
// 病棟ごとの在院・空床(病室の区分別)・入退院・転出入・翌日の予定と、期間の病床利用率・平均在院日数を
// 並べる。集計は fhir/bedScheduleHelpers.ts の wardBedStats(docs/bed-management-design.md §3)。
//
// 在院はその日の 24 時に居る患者(退院日は数えない)。病床利用率と平均在院日数は期間の
// 在院患者延日数(夜の数)から出す簡易計算で、届出の様式の計算(除外する患者など)とは別物。

// 指標の計算式(見出しの「?」に出す)。
const FORMULA = {
  occupancy: "在院 ÷ (病床数 − 休止)。在院はその日の 24 時に居る患者。",
  rate: "期間の在院患者延日数 ÷ ((病床数 − 休止) × 日数)。延日数は毎日 24 時の在院患者数の合計(退院日は数えない)。",
  stay: "期間の在院患者延日数 ÷ ((新入棟 + 新退棟) ÷ 2)。病棟は転入・転出を含め、合計は入院と退院だけで数える。",
};

const PERIOD_OPTIONS = [
  { days: 30, label: "直近30日" },
  { days: 90, label: "直近90日" },
];

export function BedStatusPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const date = searchParams.get("date") || today();
  const periodDays = PERIOD_OPTIONS.some((o) => String(o.days) === searchParams.get("period"))
    ? Number(searchParams.get("period"))
    : PERIOD_OPTIONS[0].days;
  const periodStart = addDays(date, -(periodDays - 1));
  const periodLabel = PERIOD_OPTIONS.find((o) => o.days === periodDays)?.label ?? "";

  // 列が多いのでこの画面だけ幅を広げる(他の一覧と同じ)。
  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  const wardOptions = useWardOptions();
  const bedWards = useBedWardIndex();
  const encounters = useEncountersInRange(periodStart, date);
  const planned = usePlannedAdmissions();

  function setParams(next: Record<string, string>) {
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    setSearchParams(params);
  }

  const statsByWard = useMemo(
    () =>
      wardBedStats({
        encounters: encounters.data?.encounters ?? [],
        plannedAdmissions: planned.data?.encounters ?? [],
        bedPlaces: bedWards.bedWards,
        date,
        periodStart,
      }),
    [encounters.data, planned.data, bedWards.bedWards, date, periodStart],
  );

  const wards = wardOptions.wards.filter((ward) => ward.id && statsByWard.has(ward.id));
  const total = useMemo(() => sumStats([...statsByWard.values()]), [statsByWard]);
  // 空床の列は、どこかの病棟に空床がある区分だけ(区分の並びは病室マスタの選択肢の順)。
  const roomClasses = ROOM_CLASS_OPTIONS.map((o) => o.code as string).filter((code) =>
    [...statsByWard.values()].some((stats) => stats.emptyByRoomClass.has(code)),
  );
  const loading = wardOptions.isLoading || bedWards.isLoading || encounters.isLoading || planned.isLoading;

  return (
    <div className="page">
      <div className="page__header">
        <h1>病床状況</h1>
        <div className="page__header-actions">
          <Link className="button" to="/bed-schedule">
            ベッドスケジュール
          </Link>
          <Link className="button" to={`/inpatients?date=${date}`}>
            入院患者一覧
          </Link>
        </div>
      </div>

      <form className="patient-search-form" onSubmit={(e: FormEvent) => e.preventDefault()}>
        <label>
          日付
          <DateStepper value={date} onChange={(value) => value && setParams({ date: value })} />
        </label>
        <label>
          集計期間
          <select value={periodDays} onChange={(e) => setParams({ period: e.target.value })}>
            {PERIOD_OPTIONS.map((option) => (
              <option key={option.days} value={option.days}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </form>

      <ErrorBanner error={wardOptions.error} />
      <ErrorBanner error={bedWards.error} />
      <ErrorBanner error={encounters.error} />
      <ErrorBanner error={planned.error} />
      <TruncatedNotice show={encounters.data?.truncated || planned.data?.truncated} />

      {loading ? (
        <p>読み込み中...</p>
      ) : (
        <>
          {wards.length > 0 && (
            <StatsSummary
              stats={total}
              roomClasses={roomClasses}
              periodDays={periodDays}
              periodLabel={periodLabel}
            />
          )}
          <StatSection>
            <table className="lab-worklist stat-table">
              <thead>
                <tr>
                  <th rowSpan={2}>病棟</th>
                  <th colSpan={4} className="stat-table__group">病床</th>
                  <th colSpan={roomClasses.length + 1} className="stat-table__group">空床</th>
                  <th colSpan={4} className="stat-table__group">本日</th>
                  <th colSpan={2} className="stat-table__group">翌日の予定</th>
                  <th colSpan={2} className="stat-table__group">{periodLabel}</th>
                </tr>
                <tr>
                  <th className="stat-table__num stat-table__group-start">病床数</th>
                  <th className="stat-table__num">休止</th>
                  <th className="stat-table__num">在院</th>
                  <th className="stat-table__num">
                    稼働率 <HelpTip text={FORMULA.occupancy} />
                  </th>
                  <th className="stat-table__num stat-table__group-start">計</th>
                  {roomClasses.map((code) => (
                    <th key={code} className="stat-table__num">
                      {roomClassLabel(code)}
                    </th>
                  ))}
                  <th className="stat-table__num stat-table__group-start">入院</th>
                  <th className="stat-table__num">退院</th>
                  <th className="stat-table__num">転入</th>
                  <th className="stat-table__num">転出</th>
                  <th className="stat-table__num stat-table__group-start">入院</th>
                  <th className="stat-table__num">退院</th>
                  <th className="stat-table__num stat-table__group-start">
                    病床利用率 <HelpTip text={FORMULA.rate} />
                  </th>
                  <th className="stat-table__num">
                    平均在院日数 <HelpTip text={FORMULA.stay} />
                  </th>
                </tr>
              </thead>
              <tbody>
                {wards.map((ward) => (
                  <StatsRow
                    key={ward.id}
                    label={
                      <Link to={`/bed-schedule?ward=${ward.id}`}>{locationDisplayName(ward)}</Link>
                    }
                    stats={statsByWard.get(ward.id as string) as WardBedStats}
                    roomClasses={roomClasses}
                    periodDays={periodDays}
                  />
                ))}
                {wards.length === 0 && (
                  <tr>
                    <td colSpan={14 + roomClasses.length} className="master-search__empty">
                      病棟が登録されていません。
                    </td>
                  </tr>
                )}
              </tbody>
              {wards.length > 1 && (
                <tfoot>
                  <StatsRow label="合計" stats={total} roomClasses={roomClasses} periodDays={periodDays} />
                </tfoot>
              )}
            </table>
          </StatSection>
        </>
      )}
    </div>
  );
}

/** 稼働率(在院 ÷ 使えるベッド)。使えるベッドが無ければ null。 */
function currentOccupancy(stats: WardBedStats): number | null {
  const usable = stats.beds - stats.unusable;
  return usable > 0 ? Math.round((stats.occupied / usable) * 100) : null;
}

function emptyBeds(stats: WardBedStats): number {
  return [...stats.emptyByRoomClass.values()].reduce((sum, n) => sum + n, 0);
}

/** 病院全体の要約。表の合計の行と同じ集計を、大きな数字のタイルで出す。 */
function StatsSummary({
  stats,
  roomClasses,
  periodDays,
  periodLabel,
}: {
  stats: WardBedStats;
  roomClasses: string[];
  periodDays: number;
  periodLabel: string;
}) {
  const occupancy = currentOccupancy(stats);
  const rate = occupancyRate(stats, periodDays);
  const stay = averageStay(stats);
  return (
    <StatTiles>
      <StatTile
        label="在院"
        help={FORMULA.occupancy}
        value={stats.occupied}
        unit={`/ ${stats.beds}床`}
        meter={occupancy}
        sub={`稼働率 ${occupancy === null ? "-" : `${occupancy}%`}${stats.unusable > 0 ? `・休止 ${stats.unusable}` : ""}`}
      />
      <StatTile
        label="空床"
        value={emptyBeds(stats)}
        sub={roomClasses.map((code) => `${roomClassLabel(code)} ${stats.emptyByRoomClass.get(code) ?? 0}`).join("・")}
      />
      <StatTile
        label="本日"
        counts={[
          { label: "入院", value: stats.admissions },
          { label: "退院", value: stats.discharges },
        ]}
      />
      <StatTile
        label="翌日の予定"
        counts={[
          { label: "入院", value: stats.plannedAdmissionsNext },
          { label: "退院", value: stats.plannedDischargesNext },
        ]}
      />
      <StatTile
        label="病床利用率"
        help={FORMULA.rate}
        value={rate === null ? "-" : `${rate.toFixed(1)}%`}
        sub={periodLabel}
      />
      <StatTile
        label="平均在院日数"
        help={FORMULA.stay}
        value={stay === null ? "-" : `${stay.toFixed(1)}日`}
        sub={periodLabel}
      />
    </StatTiles>
  );
}

function StatsRow({
  label,
  stats,
  roomClasses,
  periodDays,
}: {
  label: ReactNode;
  stats: WardBedStats;
  roomClasses: string[];
  periodDays: number;
}) {
  const occupancy = currentOccupancy(stats);
  const rate = occupancyRate(stats, periodDays);
  const stay = averageStay(stats);
  return (
    <tr>
      <th className="stat-table__label">{label}</th>
      <td className="stat-table__num stat-table__group-start">{stats.beds}</td>
      <StatCell value={stats.unusable} />
      <td className="stat-table__num stat-table__strong">{stats.occupied}</td>
      <td className="stat-table__num">
        {occupancy === null ? (
          <span className="stat-table__zero">-</span>
        ) : (
          <span className="stat-table__rate">
            <StatMeter percent={occupancy} />
            {occupancy}%
          </span>
        )}
      </td>
      <td className="stat-table__num stat-table__group-start stat-table__strong">{emptyBeds(stats)}</td>
      {roomClasses.map((code) => (
        <StatCell key={code} value={stats.emptyByRoomClass.get(code)} />
      ))}
      <StatCell value={stats.admissions} groupStart />
      <StatCell value={stats.discharges} />
      <StatCell value={stats.transfersIn} />
      <StatCell value={stats.transfersOut} />
      <StatCell value={stats.plannedAdmissionsNext} groupStart />
      <StatCell value={stats.plannedDischargesNext} />
      <StatCell value={rate === null ? null : `${rate.toFixed(1)}%`} groupStart />
      <StatCell value={stay === null ? null : `${stay.toFixed(1)}日`} />
    </tr>
  );
}

/** 病棟の集計を足し合わせる(合計の行)。 */
function sumStats(list: WardBedStats[]): WardBedStats {
  const total: WardBedStats = {
    wardId: "",
    beds: 0,
    unusable: 0,
    occupied: 0,
    emptyByRoomClass: new Map(),
    admissions: 0,
    discharges: 0,
    transfersIn: 0,
    transfersOut: 0,
    plannedAdmissionsNext: 0,
    plannedDischargesNext: 0,
    patientDays: 0,
    periodIn: 0,
    periodOut: 0,
    periodAdmissions: 0,
    periodDischarges: 0,
  };
  for (const stats of list) {
    total.beds += stats.beds;
    total.unusable += stats.unusable;
    total.occupied += stats.occupied;
    total.admissions += stats.admissions;
    total.discharges += stats.discharges;
    total.transfersIn += stats.transfersIn;
    total.transfersOut += stats.transfersOut;
    total.plannedAdmissionsNext += stats.plannedAdmissionsNext;
    total.plannedDischargesNext += stats.plannedDischargesNext;
    total.patientDays += stats.patientDays;
    // 病院全体の平均在院日数は病棟の間の転出入を数えない(入院と退院だけ)。
    total.periodIn += stats.periodAdmissions;
    total.periodOut += stats.periodDischarges;
    total.periodAdmissions += stats.periodAdmissions;
    total.periodDischarges += stats.periodDischarges;
    for (const [code, count] of stats.emptyByRoomClass) {
      total.emptyByRoomClass.set(code, (total.emptyByRoomClass.get(code) ?? 0) + count);
    }
  }
  return total;
}
