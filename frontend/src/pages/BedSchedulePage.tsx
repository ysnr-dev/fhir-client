import { useEffect, useMemo, useRef, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  useEncountersInRange,
  usePlannedAdmissions,
  useWardGrid,
  useWardOptions,
} from "../api/queries";
import { DateStepper } from "../components/DateStepper";
import { ErrorBanner } from "../components/ErrorBanner";
import { TruncatedNotice } from "../components/TruncatedNotice";
import {
  bedBars,
  scheduleSegments,
  unassignedPlannedAdmissions,
  type BedSegment,
  type ScheduleBar,
} from "../fhir/bedScheduleHelpers";
import {
  encounterAttendingName,
  encounterDepartmentName,
  encounterDischargePlan,
  encounterPatientId,
  encounterTransferPlan,
  plannedAdmissionDate,
} from "../fhir/encounterHelpers";
import { locationDisplayName } from "../fhir/locationHelpers";
import { displayName } from "../fhir/patientHelpers";
import { bedShortLabel, roomClassCode, roomClassLabel } from "../fhir/wardHelpers";
import { addDays, today, WEEKDAY_LABELS, weekdayOf } from "../lib/dates";
import { useReturnLinkState } from "../returnTo";

// ベッドスケジュール(病床ガント)。病棟のベッド × 日付の格子に、入院の帯(実績・続いている入院の
// 今日より先・入院予定・転棟予定)を置く。組み立ては fhir/bedScheduleHelpers.ts
// (docs/bed-management-design.md §2)。
//
// 帯は入院(Encounter)の床の履歴から起こすので、転床・転棟した入院は床ごとに帯が分かれる。
// ベッドの決まっていない入院予定は最下段の「ベッド未定」に日付で並べる。

const PERIOD_OPTIONS = [
  { days: 14, label: "2週間" },
  { days: 28, label: "4週間" },
];

/** 開始日の既定。今日の 3 日前から(直近の入退院も目に入るように)。 */
function defaultFrom(): string {
  return addDays(today(), -3);
}

export function BedSchedulePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const wardId = searchParams.get("ward") ?? "";
  const from = searchParams.get("from") || defaultFrom();
  const days = PERIOD_OPTIONS.some((o) => String(o.days) === searchParams.get("days"))
    ? Number(searchParams.get("days"))
    : PERIOD_OPTIONS[0].days;
  const to = addDays(from, days - 1);
  const todayValue = today();
  const returnLinkState = useReturnLinkState();

  // 日付の列が多いのでこの画面だけ幅を広げる(他の病棟の一覧と同じ)。
  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  const wardOptions = useWardOptions();
  const grid = useWardGrid(wardId || undefined);
  const encounters = useEncountersInRange(from, to);
  const planned = usePlannedAdmissions();

  function setParams(next: Record<string, string>, replace = false) {
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    setSearchParams(params, { replace });
  }

  // 病棟が未指定なら先頭の病棟を開く(指示簿と同じ)。
  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current || wardId) return;
    const first = wardOptions.wards[0];
    if (!first?.id) return;
    initialized.current = true;
    setParams({ ward: first.id }, true);
    // 初回に一度だけ動けばよい。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wardId, wardOptions.wards]);

  const dates = useMemo(() => Array.from({ length: days }, (_, i) => addDays(from, i)), [from, days]);

  const patientsById = useMemo(() => {
    const map = new Map<string, fhir4.Patient>(encounters.data?.patientsById ?? []);
    for (const [id, patient] of planned.data?.patientsById ?? []) map.set(id, patient);
    return map;
  }, [encounters.data, planned.data]);

  // 床 id → その床の帯。病棟のベッドに載らない区間(他の病棟)は使わない。
  const segmentsByBed = useMemo(() => {
    const map = new Map<string, BedSegment[]>();
    for (const segment of scheduleSegments(encounters.data?.encounters ?? [], planned.data?.encounters ?? [])) {
      map.set(segment.bedId, [...(map.get(segment.bedId) ?? []), segment]);
    }
    return map;
  }, [encounters.data, planned.data]);

  // ベッドの決まっていない入院予定を、予定日の列ごとに。
  const unassignedByIndex = useMemo(() => {
    const map = new Map<number, fhir4.Encounter[]>();
    if (!wardId) return map;
    for (const encounter of unassignedPlannedAdmissions(planned.data?.encounters ?? [], wardId)) {
      const index = dates.indexOf(plannedAdmissionDate(encounter));
      if (index >= 0) map.set(index, [...(map.get(index) ?? []), encounter]);
    }
    return map;
  }, [planned.data, wardId, dates]);

  const loading = grid.isLoading || encounters.isLoading || planned.isLoading;
  const todayIndex = dates.indexOf(todayValue);

  return (
    <div className="page">
      <div className="page__header">
        <h1>ベッドスケジュール</h1>
        <div className="page__header-actions">
          <Link className="button" to={`/bed-status?date=${todayValue}`}>
            病床状況
          </Link>
          <Link className="button" to={`/inpatients?ward=${wardId}`}>
            入院患者一覧
          </Link>
        </div>
      </div>

      <form className="patient-search-form" onSubmit={(e: FormEvent) => e.preventDefault()}>
        <label>
          開始日
          <DateStepper value={from} onChange={(value) => value && setParams({ from: value })} />
        </label>
        <label>
          期間
          <select value={days} onChange={(e) => setParams({ days: e.target.value })}>
            {PERIOD_OPTIONS.map((option) => (
              <option key={option.days} value={option.days}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          病棟
          <select value={wardId} onChange={(e) => setParams({ ward: e.target.value })}>
            {wardOptions.wards.map((ward) => (
              <option key={ward.id} value={ward.id}>
                {locationDisplayName(ward)}
              </option>
            ))}
          </select>
        </label>
        <div className="bed-schedule__legend" aria-label="凡例">
          <span className="bed-schedule__bar bed-schedule__bar--actual">入院</span>
          <span className="bed-schedule__bar bed-schedule__bar--future">在院(今後)</span>
          <span className="bed-schedule__bar bed-schedule__bar--planned">予定</span>
        </div>
      </form>

      <ErrorBanner error={wardOptions.error} />
      <ErrorBanner error={grid.error} />
      <ErrorBanner error={encounters.error} />
      <ErrorBanner error={planned.error} />
      <TruncatedNotice show={encounters.data?.truncated || planned.data?.truncated} />

      {!wardId ? (
        <p className="patient-table__empty">病棟を選んでください。</p>
      ) : loading ? (
        <p>読み込み中...</p>
      ) : (
        <div className="lab-worklist-wrap sticky-table-wrap">
          <table className="lab-worklist sticky-table bed-schedule" style={{ ["--days" as string]: days }}>
            <colgroup>
              <col className="bed-schedule__room-col" />
              <col className="bed-schedule__bed-col" />
              {dates.map((date) => (
                <col key={date} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th>病室</th>
                <th>ベッド</th>
                {dates.map((date) => {
                  const weekday = weekdayOf(date) ?? 0;
                  return (
                    <th
                      key={date}
                      className={[
                        "bed-schedule__day",
                        weekday === 0 ? "bed-schedule__day--sun" : weekday === 6 ? "bed-schedule__day--sat" : "",
                        date === todayValue ? "bed-schedule__day--today" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      {date.slice(5).replace("-", "/")}
                      <span className="bed-schedule__weekday">{WEEKDAY_LABELS[weekday]}</span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {grid.rooms.flatMap((room) => {
                const beds = grid.bedsByRoom.get(room.id ?? "") ?? [];
                return beds.map((bed, index) => {
                  const usable = (bed.status ?? "active") === "active" && (room.status ?? "active") === "active";
                  const bars = bedBars(segmentsByBed.get(bed.id ?? "") ?? [], from, days, todayValue);
                  return (
                    <tr key={bed.id} className={usable ? undefined : "bed-schedule__row--unusable"}>
                      {index === 0 && (
                        <th rowSpan={beds.length} className="bed-schedule__room">
                          {room.name}
                          <span className="bed-schedule__room-class">{roomClassLabel(roomClassCode(room))}</span>
                        </th>
                      )}
                      <td className="bed-schedule__bed">
                        {bedShortLabel(bed)}
                        {!usable && <span className="bed-schedule__unusable">休止</span>}
                      </td>
                      <td colSpan={days} className="bed-schedule__cell">
                        <div
                          className="bed-schedule__track"
                          style={{ height: `${Math.max(1, ...bars.map((bar) => bar.lane + 1)) * 24 + 4}px` }}
                        >
                          {todayIndex >= 0 && (
                            <div
                              className="bed-schedule__today"
                              style={{ left: `${((todayIndex + 0.5) / days) * 100}%` }}
                            />
                          )}
                          {bars.map((bar) => (
                            <BarView
                              key={bar.segment.key}
                              bar={bar}
                              days={days}
                              patient={patientsById.get(bar.segment.patientId)}
                              returnLinkState={returnLinkState}
                            />
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                });
              })}
              <tr>
                <th colSpan={2} className="bed-schedule__room">
                  ベッド未定
                </th>
                <td colSpan={days} className="bed-schedule__cell">
                  <div className="bed-schedule__unassigned" style={{ ["--days" as string]: days }}>
                    {dates.map((date, index) => (
                      <div key={date}>
                        {(unassignedByIndex.get(index) ?? []).map((encounter) => {
                          const patientId = encounterPatientId(encounter) ?? "";
                          const patient = patientsById.get(patientId);
                          return (
                            <Link
                              key={encounter.id}
                              className="bed-schedule__bar bed-schedule__bar--planned bed-schedule__chip"
                              to={`/patients/${patientId}/karte`}
                              state={returnLinkState}
                              title={`入院予定 ${plannedAdmissionDate(encounter)} ${patient ? displayName(patient) : ""}`}
                            >
                              {patient ? displayName(patient) : patientId}
                            </Link>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </td>
              </tr>
              {grid.rooms.length === 0 && (
                <tr>
                  <td colSpan={days + 2} className="master-search__empty">
                    この病棟には病室が登録されていません。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** 帯 1 本。区切り(実績・今後・予定)ごとに塗り分け、名前は先頭の区切りに出す。押すとカルテ。 */
function BarView({
  bar,
  days,
  patient,
  returnLinkState,
}: {
  bar: ScheduleBar;
  days: number;
  patient?: fhir4.Patient;
  returnLinkState: ReturnType<typeof useReturnLinkState>;
}) {
  const { segment } = bar;
  const name = patient ? displayName(patient) : segment.patientId;
  const prefix = segment.plan === "admission" ? "入予 " : segment.plan === "transfer" ? "転予 " : "";
  const title = barTitle(segment, name);
  const top = bar.lane * 24 + 2;
  return (
    <>
      {bar.pieces.map((piece, index) => (
        <Link
          key={`${piece.from}-${piece.variant}`}
          to={`/patients/${segment.patientId}/karte`}
          state={returnLinkState}
          title={title}
          className={[
            "bed-schedule__bar",
            `bed-schedule__bar--${piece.variant}`,
            index === 0 && !bar.clippedStart ? "bed-schedule__bar--start" : "",
            index === bar.pieces.length - 1 && !bar.clippedEnd && !bar.open ? "bed-schedule__bar--end" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          style={{
            left: `${(piece.from / days) * 100}%`,
            width: `${((piece.to - piece.from + 1) / days) * 100}%`,
            top: `${top}px`,
          }}
        >
          {index === 0 ? `${prefix}${name}` : ""}
        </Link>
      ))}
    </>
  );
}

/** 帯の吹き出し。入院日・退院日(予定)・診療科・主治医。 */
function barTitle(segment: BedSegment, name: string): string {
  const encounter = segment.encounter;
  const lines = [name];
  if (segment.plan === "admission") {
    lines.push(`入院予定 ${segment.start}`);
  } else if (segment.plan === "transfer") {
    lines.push(`転棟予定 ${segment.start}`);
  } else {
    const end = segment.until
      ? `${segment.discharged ? "退院" : "移動"} ${segment.until}`
      : encounterDischargePlan(encounter)?.at
        ? `退院予定 ${encounterDischargePlan(encounter)?.at.slice(0, 10)}`
        : "在院中";
    lines.push(`${segment.first ? "入院" : "移動"} ${segment.start} 〜 ${end}`);
    const transfer = encounterTransferPlan(encounter);
    if (segment.until === null && transfer?.date) {
      lines.push(`転棟予定 ${transfer.date} ${transfer.wardName}`);
    }
  }
  const department = encounterDepartmentName(encounter);
  const attending = encounterAttendingName(encounter);
  if (department && department !== "-") lines.push(department);
  if (attending && attending !== "-") lines.push(`主治医 ${attending}`);
  return lines.join("\n");
}
