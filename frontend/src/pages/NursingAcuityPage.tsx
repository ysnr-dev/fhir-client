import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  useAcuityObservations,
  useAcuityReportMonths,
  useAdmissionsInYear,
  useBedWardIndex,
  useDepartmentsOf,
  useEmergencyArrivalsInYear,
  useEncountersInRange,
  useFacilitySettings,
  useSelfOrganization,
  useWardOptions,
} from "../api/queries";
import { DateStepper } from "../components/DateStepper";
import { ErrorBanner } from "../components/ErrorBanner";
import { NursingAcuityBulkGrid } from "../components/NursingAcuityBulkGrid";
import { TruncatedNotice } from "../components/TruncatedNotice";
import { patientsByDayAtBeds } from "../fhir/bedScheduleHelpers";
import { departmentCode } from "../fhir/departmentHelpers";
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
import {
  emergencyCoefficients,
  fiscalYearOf,
  percentOf,
  ratioIndexPercent,
  type UnitCoefficient,
} from "../fhir/nursingAcuityCoefficientHelpers";
import {
  acuityReportMonth,
  form10Rows,
  form43Rows,
  monthRange,
  monthsEndingAt,
  reportFormOf,
  type ReportRow,
} from "../fhir/nursingAcuityReportHelpers";
import { belowThreshold, resolveAcuityUnits, type AcuityUnit } from "../fhir/nursingAcuityUnitHelpers";
import { useInpatientsAtBeds } from "../hooks/useWardInpatients";
import { csvBlob } from "../lib/csv";
import { addDays, addMonths, today } from "../lib/dates";
import { downloadBlob } from "../lib/download";
import { xlsxBlob } from "../lib/xlsx";

// 重症度、医療・看護必要度(docs/nursing-acuity-design.md)。届出単位(病棟、または ICU・HCU などの病室)ごとに、
// 「評価」タブは 1 日の患者 × 評価項目のグリッドで評価を入れ(氏名から 1 人ずつの評価を開ける)、「集計」タブは
// 月の該当患者割合を日ごとに出して基準値と比べ(救急患者応需係数を足した割合指数)、「届出」タブは
// 届出様式(様式10・様式43)の欄を出す。
//
// 評価は患者 × 日の Observation 1 件。評価した日の届出単位を order-ward 拡張に焼き付け、集計は
// 「その日にその単位で評価した患者」を数える(延べ患者数で割合を出す)。

type Tab = "entry" | "summary" | "report";

export function NursingAcuityPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: Tab =
    searchParams.get("tab") === "summary" ? "summary" : searchParams.get("tab") === "report" ? "report" : "entry";
  // ward は届出単位の id(病棟の id のままの既存リンクも開ける)。
  const unitId = searchParams.get("ward") ?? "";
  const date = searchParams.get("date") || today();
  const facility = useFacilitySettings();
  const settings = facility.data?.nursing_acuity ?? DEFAULT_NURSING_ACUITY;
  const wardOptions = useWardOptions();
  const bedWards = useBedWardIndex();
  const units = useMemo(
    () => resolveAcuityUnits(settings, wardOptions.wards, bedWards.bedWards),
    [settings, wardOptions.wards, bedWards.bedWards],
  );

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

  // 単位が未指定なら先頭の単位を開く(指示簿と同じ)。
  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current || unitId) return;
    const first = units[0];
    if (!first) return;
    initialized.current = true;
    setParams({ ward: first.id }, true);
    // 初回に一度だけ動けばよい。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitId, units]);

  const unit = units.find((u) => u.id === unitId);
  const loading = wardOptions.isLoading || bedWards.isLoading || facility.isLoading;

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
            ["report", "届出"],
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
          {tab === "entry" ? "評価日" : tab === "summary" ? "月" : "算出期間の終わりの月"}
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
          届出単位
          <select value={unitId} onChange={(e) => setParams({ ward: e.target.value })}>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {unitLabel(u)}
              </option>
            ))}
          </select>
        </label>
        {unit && (
          <span className="order-select__muted nursing-acuity__unit-info">
            {unit.form.shortLabel}
            {unit.category ? ` ・ ${unit.category.label}(必要度${unit.method === "II" ? "Ⅱ" : "Ⅰ"})` : ""}
            {` ・ ${unit.beds} 床`}
          </span>
        )}
      </form>

      <ErrorBanner error={wardOptions.error} />
      <ErrorBanner error={bedWards.error} />
      <ErrorBanner error={facility.error} />

      {loading ? (
        <p>読み込み中...</p>
      ) : !unit ? (
        <p className="patient-table__empty">届出単位を選んでください。</p>
      ) : tab === "entry" ? (
        <EntryTab date={date} unit={unit} />
      ) : tab === "summary" ? (
        <SummaryTab month={date.slice(0, 7)} unit={unit} units={units} settings={settings} />
      ) : (
        <ReportTab month={date.slice(0, 7)} unit={unit} units={units} settings={settings} />
      )}
    </div>
  );
}

/** セレクトの表示(病室単位は「病棟 / 病室」)。 */
function unitLabel(unit: AcuityUnit): string {
  return unit.kind === "room" ? `${unit.name}(${unit.form.shortLabel})` : unit.name;
}

function EntryTab({ date, unit }: { date: string; unit: AcuityUnit }) {
  const inpatients = useInpatientsAtBeds(date, unit.bedIds);
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
    const todayObservation = byPatient.get(row.patientId)?.today;
    if (!todayObservation) continue;
    const parsed = parseAcuityObservation(todayObservation);
    if (parsed.values.excluded) continue;
    const scores = acuityScores(parsed.form, parsed.values);
    evaluated += 1;
    if (meetsAcuityCriterion(scores, unit.criteria.ratio1, parsed.values.checks)) met1 += 1;
    if (meetsAcuityCriterion(scores, unit.criteria.ratio2, parsed.values.checks)) met2 += 1;
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
          {/* 日付・単位を変えたら入力途中の値を捨てて作り直す。 */}
          <NursingAcuityBulkGrid
            key={`${unit.id}:${date}`}
            rows={inpatients.rows}
            byPatient={byPatient}
            date={date}
            unit={unit}
          />
          <p className="order-select__muted lab-worklist__count">
            評価 {evaluated} / {inpatients.rows.length} 人
            {evaluated > 0 && (
              <>
                {" "}/ 割合1 {percent(met1, evaluated)}
                {unit.criteria.ratio2.length > 0 && <> / 割合2 {percent(met2, evaluated)}</>}
              </>
            )}
          </p>
        </>
      )}
    </>
  );
}

/**
 * 年度の救急患者応需係数(届出単位ごと)。係数を算入する単位が 1 つも無ければ読まない。
 * 年度の件数は欠けると係数が狂うので complete で読む(上限に達したらエラー)。
 */
function useUnitCoefficients(fiscalYear: number, units: AcuityUnit[], settings: NursingAcuitySettings) {
  const needed = units.some((unit) => unit.coefficientApplies);
  const emergencies = useEmergencyArrivalsInYear(needed ? fiscalYear : undefined);
  const admissions = useAdmissionsInYear(needed ? fiscalYear : undefined);
  const coefficients = useMemo(
    () =>
      needed
        ? emergencyCoefficients({
            fiscalYear,
            units,
            emergencies: emergencies.data ?? [],
            admissions: admissions.data ?? [],
            override: settings.emergency_years[String(fiscalYear)],
          })
        : new Map<string, UnitCoefficient>(),
    [needed, fiscalYear, units, emergencies.data, admissions.data, settings.emergency_years],
  );
  return {
    coefficients,
    isLoading: needed && (emergencies.isLoading || admissions.isLoading),
    error: emergencies.error ?? admissions.error,
  };
}

function SummaryTab({
  month,
  unit,
  units,
  settings,
}: {
  month: string;
  unit: AcuityUnit;
  units: AcuityUnit[];
  settings: NursingAcuitySettings;
}) {
  const { from, to } = monthRange(month);
  const encounters = useEncountersInRange(from, to);
  const presence = useMemo(
    () =>
      patientsByDayAtBeds({
        encounters: encounters.data?.encounters ?? [],
        bedIds: unit.bedIds,
        from,
        to,
      }),
    [encounters.data, unit.bedIds, from, to],
  );
  const patientIds = useMemo(() => [...new Set([...presence.values()].flatMap((set) => [...set]))], [presence]);
  const observations = useAcuityObservations(patientIds, from, to);
  // 月の指数には、その月の年度の前年度の係数を使う。
  const fiscalYear = fiscalYearOf(from) - 1;
  const coefficient = useUnitCoefficients(fiscalYear, units, settings);
  const unitCoefficient = coefficient.coefficients.get(unit.id);

  // 日 → その日にこの単位で付けた評価(単位は評価の order-ward 拡張)。
  const days = useMemo(() => {
    const byDay = new Map<string, fhir4.Observation[]>();
    for (const observation of observations.data?.observations ?? []) {
      if (acuityWardId(observation) !== unit.id) continue;
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
        if (meetsAcuityCriterion(scores, unit.criteria.ratio1, values.checks)) met1 += 1;
        if (meetsAcuityCriterion(scores, unit.criteria.ratio2, values.checks)) met2 += 1;
      }
      const present = presence.get(day)?.size ?? 0;
      return { day, present, evaluated, excluded, met1, met2, missing: Math.max(0, present - evaluated - excluded) };
    });
  }, [observations.data, presence, unit]);

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
  const showRatio2 = unit.criteria.ratio2.length > 0;
  const ratio1Title = `割合1: ${acuityCriterionLabel(unit.criteria.ratio1)}`;
  const ratio2Title = `割合2: ${acuityCriterionLabel(unit.criteria.ratio2)}`;

  // 月の判定。係数を算入する単位は割合指数(割合 + 係数)を、それ以外は割合を基準値と比べる。
  const coef = unit.coefficientApplies ? (unitCoefficient?.coefficient ?? 0) : 0;
  const ratio1 = percentOf(total.met1, total.evaluated);
  const ratio2 = percentOf(total.met2, total.evaluated);
  const index1 = ratioIndexPercent(ratio1, coef);
  const index2 = ratioIndexPercent(ratio2, coef);
  const below1 = belowThreshold(index1, unit.thresholds[0]);
  const below2 = belowThreshold(index2, unit.thresholds[1]);
  const belowClass = (below: boolean | null) => (below ? " nursing-acuity-list__below" : "");
  const columns = showRatio2 ? 9 : 7;

  return (
    <>
      <ErrorBanner error={encounters.error} />
      <ErrorBanner error={observations.error} />
      <ErrorBanner error={coefficient.error} />
      <TruncatedNotice show={encounters.data?.truncated || observations.data?.truncated} />
      {encounters.isLoading || observations.isLoading || coefficient.isLoading ? (
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
                {/* 割合1・割合2は該当患者の基準を吹き出しに出す。 */}
                <th className="nursing-acuity-list__num" title={ratio1Title}>割合1 該当</th>
                <th className="nursing-acuity-list__num" title={ratio1Title}>割合1</th>
                {showRatio2 && <th className="nursing-acuity-list__num" title={ratio2Title}>割合2 該当</th>}
                {showRatio2 && <th className="nursing-acuity-list__num" title={ratio2Title}>割合2</th>}
              </tr>
            </thead>
            <tbody>
              {shown.map((d) => (
                  <tr key={d.day}>
                    <td className="lab-worklist__compact">
                      <Link to={`/nursing-acuity?ward=${unit.id}&date=${d.day}`}>{d.day.slice(5).replace("-", "/")}</Link>
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
                <td className={`nursing-acuity-list__num${!unit.coefficientApplies ? belowClass(below1) : ""}`}>
                  {percent(total.met1, total.evaluated)}
                </td>
                {showRatio2 && <td className="nursing-acuity-list__num">{total.met2}</td>}
                {showRatio2 && (
                  <td className={`nursing-acuity-list__num${!unit.coefficientApplies ? belowClass(below2) : ""}`}>
                    {percent(total.met2, total.evaluated)}
                  </td>
                )}
              </tr>
              {/* 応需係数を算入する単位は、割合に係数を足した割合指数で基準値と比べる。 */}
              {unit.coefficientApplies && (
                <tr className="nursing-acuity-list__index">
                  <th className="lab-worklist__compact" colSpan={5}>
                    割合指数
                    <span
                      className="order-select__muted"
                      title={coefficientTitle(fiscalYear, unitCoefficient)}
                    >
                      (応需係数 {coef.toFixed(4)}、{fiscalYear}年度)
                    </span>
                  </th>
                  <td className="nursing-acuity-list__num"></td>
                  <td className={`nursing-acuity-list__num${belowClass(below1)}`}>{percentText(index1)}</td>
                  {showRatio2 && <td className="nursing-acuity-list__num"></td>}
                  {showRatio2 && <td className={`nursing-acuity-list__num${belowClass(below2)}`}>{percentText(index2)}</td>}
                </tr>
              )}
              {(unit.thresholds[0] !== null || unit.thresholds[1] !== null) && (
                <tr className="nursing-acuity-list__threshold">
                  <th className="lab-worklist__compact" colSpan={5}>
                    基準値{unit.category ? `(${unit.category.label})` : ""}
                  </th>
                  <td className="nursing-acuity-list__num"></td>
                  <td className="nursing-acuity-list__num">{thresholdText(unit.thresholds[0])}</td>
                  {showRatio2 && <td className="nursing-acuity-list__num"></td>}
                  {showRatio2 && <td className="nursing-acuity-list__num">{thresholdText(unit.thresholds[1])}</td>}
                </tr>
              )}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={columns} className="master-search__empty">
                    この月の日はまだありません。
                  </td>
                </tr>
              )}
            </tfoot>
          </table>
        </div>
      )}
    </>
  );
}

function coefficientTitle(fiscalYear: number, c: UnitCoefficient | undefined): string {
  if (!c) return `${fiscalYear}年度の件数がありません`;
  return `${fiscalYear}年度: (1)救急搬送受入 ${c.transports} 件 × ((4)この単位の救急搬送からの入院 ${c.admissions} 件 ÷ (2)全区分 ${c.admissionsTotal} 件) ÷ (3)病床数 ${c.beds} × 0.005(上限 0.1)`;
}

function ReportTab({
  month,
  unit,
  units,
  settings,
}: {
  month: string;
  unit: AcuityUnit;
  units: AcuityUnit[];
  settings: NursingAcuitySettings;
}) {
  const { form, months: count } = reportFormOf(unit);
  const months = useMemo(() => monthsEndingAt(month, count), [month, count]);
  const data = useAcuityReportMonths(months);
  const self = useSelfOrganization();
  const departments = useDepartmentsOf(self.selfOrganizationId ?? undefined);
  const departmentCodes = useMemo(
    () => new Map((departments.data ?? []).map((d) => [d.id ?? "", departmentCode(d)])),
    [departments.data],
  );
  // 係数は算出期間の終わりの月の年度の前年度。
  const fiscalYear = fiscalYearOf(`${month}-01`) - 1;
  const coefficient = useUnitCoefficients(fiscalYear, units, settings);
  const [trainingDate, setTrainingDate] = useState("");

  const rows = useMemo<ReportRow[]>(() => {
    const todayValue = today();
    const monthResults = data.months.map((m) =>
      acuityReportMonth(
        unit,
        {
          month: m.month,
          encounters: m.encounters?.encounters ?? [],
          patientsById: m.encounters?.patientsById ?? new Map(),
          departmentCodes,
          observations: (m.observations?.observations ?? []).filter((o) => acuityWardId(o) === unit.id),
        },
        todayValue,
      ),
    );
    return form === "10"
      ? form10Rows({
          unit,
          months: monthResults,
          coefficient: coefficient.coefficients.get(unit.id),
          fiscalYear,
          trainingDate,
        })
      : form43Rows({ unit, months: monthResults, trainingDate });
  }, [data.months, unit, departmentCodes, form, coefficient.coefficients, fiscalYear, trainingDate]);

  const title = form === "10" ? "様式10" : "様式43";
  const fileBase = `${title}_${unit.name}_${month}`;
  const header = ["項目", "値"];
  const table = rows.map((row) => [row.label, row.value]);

  return (
    <>
      <ErrorBanner error={data.error} />
      <ErrorBanner error={departments.error} />
      <ErrorBanner error={coefficient.error} />
      <TruncatedNotice show={data.truncated} />
      <form className="patient-search-form" onSubmit={(e: FormEvent) => e.preventDefault()}>
        <label>
          院内研修の実施日
          <input type="date" value={trainingDate} onChange={(e) => setTrainingDate(e.target.value)} />
        </label>
        <span className="patient-search-form__actions">
          <button type="button" onClick={() => downloadBlob(csvBlob(header, table), `${fileBase}.csv`)}>
            CSV
          </button>
          <button type="button" onClick={() => downloadBlob(xlsxBlob(title, header, table), `${fileBase}.xlsx`)}>
            Excel
          </button>
        </span>
      </form>
      {data.isLoading || coefficient.isLoading ? (
        <p>読み込み中...</p>
      ) : (
        <div className="lab-worklist-wrap">
          <table className="lab-worklist nursing-acuity-report">
            <caption className="nursing-acuity-report__caption">
              {title}({unit.name}、{months[0].replace("-", "/")}
              {count > 1 ? ` 〜 ${months[months.length - 1].replace("-", "/")}` : ""})
            </caption>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label}>
                  <th className="nursing-acuity-report__label">{row.label}</th>
                  <td className="nursing-acuity-report__value">{row.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function percent(numerator: number, denominator: number): string {
  return percentText(percentOf(numerator, denominator));
}

function percentText(value: number | null): string {
  return value === null ? "-" : `${value.toFixed(1)}%`;
}

function thresholdText(value: number | null): string {
  return value === null ? "-" : `${value}%`;
}
