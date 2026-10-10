import { useEffect, useMemo, useRef, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  useAcuityObservations,
  useBedWardIndex,
  useEncountersInRange,
  useFacilitySettings,
  useWardOptions,
} from "../api/queries";
import { DateStepper } from "../components/DateStepper";
import { ErrorBanner } from "../components/ErrorBanner";
import { NursingAcuityBulkGrid } from "../components/NursingAcuityBulkGrid";
import { TruncatedNotice } from "../components/TruncatedNotice";
import { wardPatientsByDay } from "../fhir/bedScheduleHelpers";
import { locationDisplayName } from "../fhir/locationHelpers";
import {
  DEFAULT_NURSING_ACUITY,
  acuityCriterionLabel,
  acuityDate,
  acuityPatientId,
  acuityScores,
  acuityWardId,
  meetsAcuityCriterion,
  parseAcuityObservation,
  type NursingAcuitySettings,
} from "../fhir/nursingAcuityHelpers";
import { useWardInpatients } from "../hooks/useWardInpatients";
import { addDays, addMonths, today } from "../lib/dates";

// 重症度、医療・看護必要度(docs/nursing-acuity-design.md)。「評価」タブは病棟の 1 日の患者 × 評価項目の
// グリッドで評価を入れる(氏名から 1 人ずつの評価を開ける)。「集計」タブは病棟 × 月の該当患者割合を日ごとに出す。
//
// 評価は患者 × 日の Observation 1 件。評価した日の病棟を order-ward 拡張に焼き付け、集計は
// 「その日にその病棟で評価した患者」を数える(延べ患者数で割合を出す)。

type Tab = "entry" | "summary";

export function NursingAcuityPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: Tab = searchParams.get("tab") === "summary" ? "summary" : "entry";
  const wardId = searchParams.get("ward") ?? "";
  const date = searchParams.get("date") || today();
  const facility = useFacilitySettings();
  const settings = facility.data?.nursing_acuity ?? DEFAULT_NURSING_ACUITY;
  const wardOptions = useWardOptions();

  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

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

  const ward = wardOptions.wards.find((w) => w.id === wardId);

  return (
    <div className="page">
      <div className="page__header">
        <h1>看護必要度</h1>
      </div>

      <div className="order-select__tabs" role="tablist">
        {(
          [
            ["entry", "評価"],
            ["summary", "集計"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? "order-select__tab is-active" : "order-select__tab"}
            onClick={() => setParams({ tab: key === "entry" ? "" : key })}
          >
            {label}
          </button>
        ))}
      </div>

      <form className="patient-search-form" onSubmit={(e: FormEvent) => e.preventDefault()}>
        <label>
          {tab === "entry" ? "評価日" : "月"}
          {tab === "entry" ? (
            <DateStepper value={date} onChange={(value) => value && setParams({ date: value })} />
          ) : (
            <span className="inpatient__date">
              <button type="button" onClick={() => setParams({ date: addMonths(date, -1) })} aria-label="前の月">
                &lt;
              </button>
              <input
                type="month"
                value={date.slice(0, 7)}
                onChange={(e) => e.target.value && setParams({ date: `${e.target.value}-01` })}
              />
              <button type="button" onClick={() => setParams({ date: addMonths(date, 1) })} aria-label="次の月">
                &gt;
              </button>
            </span>
          )}
        </label>
        <label>
          病棟
          <select value={wardId} onChange={(e) => setParams({ ward: e.target.value })}>
            {wardOptions.wards.map((w) => (
              <option key={w.id} value={w.id}>
                {locationDisplayName(w)}
              </option>
            ))}
          </select>
        </label>
      </form>

      <ErrorBanner error={wardOptions.error} />
      <ErrorBanner error={facility.error} />

      {!wardId ? (
        <p className="patient-table__empty">病棟を選んでください。</p>
      ) : tab === "entry" ? (
        <EntryTab
          date={date}
          ward={{ wardId, wardName: ward ? locationDisplayName(ward) : "" }}
          settings={settings}
        />
      ) : (
        <SummaryTab month={date.slice(0, 7)} wardId={wardId} settings={settings} />
      )}

      {/* 該当患者の基準(施設設定)。表を読むときの補足なので表の下に置く。 */}
      <p className="nursing-acuity__criteria">
        割合1: {acuityCriterionLabel(settings.ratio1)}
        {settings.ratio2.length > 0 && <> / 割合2: {acuityCriterionLabel(settings.ratio2)}</>}
      </p>
    </div>
  );
}

function EntryTab({
  date,
  ward,
  settings,
}: {
  date: string;
  ward: { wardId: string; wardName: string };
  settings: NursingAcuitySettings;
}) {
  const inpatients = useWardInpatients(date, ward.wardId);
  const observations = useAcuityObservations(
    inpatients.rows.map((row) => row.patientId),
    addDays(date, -1),
    date,
  );

  // 患者 id → その日・前日の評価。
  const byPatient = useMemo(() => {
    const map = new Map<string, { today?: fhir4.Observation; previous?: fhir4.Observation }>();
    for (const observation of observations.data?.observations ?? []) {
      const patientId = acuityPatientId(observation);
      const entry = map.get(patientId) ?? {};
      if (acuityDate(observation) === date) entry.today = observation;
      else entry.previous = observation;
      map.set(patientId, entry);
    }
    return map;
  }, [observations.data, date]);

  // 保存済みの評価から数えた、その日の評価人数と該当割合(グリッドの入力途中の値は入れない)。
  let evaluated = 0;
  let met1 = 0;
  let met2 = 0;
  for (const row of inpatients.rows) {
    const today = byPatient.get(row.patientId)?.today;
    if (!today) continue;
    const parsed = parseAcuityObservation(today);
    if (parsed.values.excluded) continue;
    const scores = acuityScores(parsed.form, parsed.values);
    evaluated += 1;
    if (meetsAcuityCriterion(scores, settings.ratio1)) met1 += 1;
    if (meetsAcuityCriterion(scores, settings.ratio2)) met2 += 1;
  }

  return (
    <>
      <ErrorBanner error={inpatients.error} />
      <ErrorBanner error={observations.error} />
      <TruncatedNotice show={inpatients.truncated || observations.data?.truncated} />
      {inpatients.isLoading || observations.isLoading ? (
        <p>読み込み中...</p>
      ) : (
        <>
          {/* 日付・病棟を変えたら入力途中の値を捨てて作り直す。 */}
          <NursingAcuityBulkGrid
            key={`${ward.wardId}:${date}`}
            rows={inpatients.rows}
            byPatient={byPatient}
            date={date}
            ward={ward}
            settings={settings}
          />
          <p className="order-select__muted lab-worklist__count">
            評価 {evaluated} / {inpatients.rows.length} 人
            {evaluated > 0 && (
              <>
                {" "}/ 割合1 {percent(met1, evaluated)}
                {settings.ratio2.length > 0 && <> / 割合2 {percent(met2, evaluated)}</>}
              </>
            )}
          </p>
        </>
      )}
    </>
  );
}

function SummaryTab({
  month,
  wardId,
  settings,
}: {
  month: string;
  wardId: string;
  settings: NursingAcuitySettings;
}) {
  const from = `${month}-01`;
  const to = addDays(addMonths(from, 1), -1);
  const encounters = useEncountersInRange(from, to);
  const bedWards = useBedWardIndex();
  const presence = useMemo(
    () =>
      wardPatientsByDay({
        encounters: encounters.data?.encounters ?? [],
        bedPlaces: bedWards.bedWards,
        wardId,
        from,
        to,
      }),
    [encounters.data, bedWards.bedWards, wardId, from, to],
  );
  const patientIds = useMemo(() => [...new Set([...presence.values()].flatMap((set) => [...set]))], [presence]);
  const observations = useAcuityObservations(patientIds, from, to);

  // 日 → その日にこの病棟で付けた評価(病棟は評価の order-ward 拡張)。
  const days = useMemo(() => {
    const byDay = new Map<string, fhir4.Observation[]>();
    for (const observation of observations.data?.observations ?? []) {
      if (acuityWardId(observation) !== wardId) continue;
      const day = acuityDate(observation);
      byDay.set(day, [...(byDay.get(day) ?? []), observation]);
    }
    return [...presence.keys()].map((day) => {
      let evaluated = 0;
      let excluded = 0;
      let met1 = 0;
      let met2 = 0;
      for (const observation of byDay.get(day) ?? []) {
        const { form, values } = parseAcuityObservation(observation);
        if (values.excluded) {
          excluded += 1;
          continue;
        }
        evaluated += 1;
        const scores = acuityScores(form, values);
        if (meetsAcuityCriterion(scores, settings.ratio1)) met1 += 1;
        if (meetsAcuityCriterion(scores, settings.ratio2)) met2 += 1;
      }
      const present = presence.get(day)?.size ?? 0;
      return { day, present, evaluated, excluded, met1, met2, missing: Math.max(0, present - evaluated - excluded) };
    });
  }, [observations.data, presence, wardId, settings]);

  // 今日より先の日は出さず、合計にも入れない(続いている入院は月末まで在棟に数えてしまうため)。
  const todayValue = today();
  const shown = days.filter((d) => d.day <= todayValue);
  const total = shown.reduce(
    (sum, d) => ({
      present: sum.present + d.present,
      evaluated: sum.evaluated + d.evaluated,
      excluded: sum.excluded + d.excluded,
      met1: sum.met1 + d.met1,
      met2: sum.met2 + d.met2,
      missing: sum.missing + d.missing,
    }),
    { present: 0, evaluated: 0, excluded: 0, met1: 0, met2: 0, missing: 0 },
  );
  const showRatio2 = settings.ratio2.length > 0;

  return (
    <>
      <ErrorBanner error={encounters.error} />
      <ErrorBanner error={bedWards.error} />
      <ErrorBanner error={observations.error} />
      <TruncatedNotice show={encounters.data?.truncated || observations.data?.truncated} />
      {encounters.isLoading || bedWards.isLoading || observations.isLoading ? (
        <p>読み込み中...</p>
      ) : (
        <div className="lab-worklist-wrap sticky-table-wrap">
          <table className="lab-worklist sticky-table nursing-acuity-list">
            <thead>
              <tr>
                <th className="lab-worklist__compact">日付</th>
                <th className="nursing-acuity-list__num">在棟</th>
                <th className="nursing-acuity-list__num">評価</th>
                <th className="nursing-acuity-list__num">対象外</th>
                <th className="nursing-acuity-list__num">未評価</th>
                <th className="nursing-acuity-list__num">割合1 該当</th>
                <th className="nursing-acuity-list__num">割合1</th>
                {showRatio2 && <th className="nursing-acuity-list__num">割合2 該当</th>}
                {showRatio2 && <th className="nursing-acuity-list__num">割合2</th>}
              </tr>
            </thead>
            <tbody>
              {shown.map((d) => (
                  <tr key={d.day}>
                    <td className="lab-worklist__compact">
                      <Link to={`/nursing-acuity?ward=${wardId}&date=${d.day}`}>{d.day.slice(5).replace("-", "/")}</Link>
                    </td>
                    <td className="nursing-acuity-list__num">{d.present}</td>
                    <td className="nursing-acuity-list__num">{d.evaluated}</td>
                    <td className="nursing-acuity-list__num">{d.excluded || "-"}</td>
                    <td className={`nursing-acuity-list__num${d.missing > 0 ? " nursing-acuity-list__pending" : ""}`}>
                      {d.missing || "-"}
                    </td>
                    <td className="nursing-acuity-list__num">{d.met1}</td>
                    <td className="nursing-acuity-list__num">{percent(d.met1, d.evaluated)}</td>
                    {showRatio2 && <td className="nursing-acuity-list__num">{d.met2}</td>}
                    {showRatio2 && <td className="nursing-acuity-list__num">{percent(d.met2, d.evaluated)}</td>}
                  </tr>
                ))}
            </tbody>
            <tfoot>
              <tr>
                <th className="lab-worklist__compact">{month.replace("-", "/")} 計</th>
                <td className="nursing-acuity-list__num">{total.present}</td>
                <td className="nursing-acuity-list__num">{total.evaluated}</td>
                <td className="nursing-acuity-list__num">{total.excluded || "-"}</td>
                <td className="nursing-acuity-list__num">{total.missing || "-"}</td>
                <td className="nursing-acuity-list__num">{total.met1}</td>
                <td className="nursing-acuity-list__num">{percent(total.met1, total.evaluated)}</td>
                {showRatio2 && <td className="nursing-acuity-list__num">{total.met2}</td>}
                {showRatio2 && <td className="nursing-acuity-list__num">{percent(total.met2, total.evaluated)}</td>}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </>
  );
}

function percent(numerator: number, denominator: number): string {
  return denominator > 0 ? `${((numerator / denominator) * 100).toFixed(1)}%` : "-";
}
