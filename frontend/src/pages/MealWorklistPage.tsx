import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  useBedWardIndex,
  useInpatientEncounters,
  useMealOrdersOn,
  useWardOptions,
} from "../api/queries";
import { useMealDietOptions, useMealItemOptions } from "../api/masterQueries";
import { DateStepper } from "../components/DateStepper";
import { ErrorBanner } from "../components/ErrorBanner";
import { RowPictograms } from "../components/PatientListRowParts";
import { PatientProfileDrawer, useRowDrawer } from "../components/PatientProfileDrawer";
import { PatientKana } from "../components/PatientRowCells";
import { TruncatedNotice } from "../components/TruncatedNotice";
import { locationDisplayName } from "../fhir/locationHelpers";
import { MEAL_TIMING_OPTIONS } from "../fhir/mealOrderHelpers";
import {
  buildMealWorklist,
  countMeals,
  type MealCountRow,
  type MealWorklistCell,
  type MealWorklistRow,
} from "../fhir/mealWorklistHelpers";
import { displayName } from "../fhir/patientHelpers";
import { useRowPictogramSources } from "../hooks/useRowPictogramSources";
import { today } from "../lib/dates";
import { useReturnLinkState } from "../returnTo";

// 給食部門の食事一覧(docs/meal-order-design.md §5.2)。その日の入院患者ごとに朝・昼・夕の
// 食事を並べる「患者別」と、食種・主食ごとの食数を数える「食数集計」の 2 面。
//
// 食事オーダーはその日に掛かっているものを全病棟まとめて 1 回で引き、病棟は入院のベッドから
// 決めて画面側で絞る(転棟した患者も、いまいる病棟に出る)。

type View = "patients" | "counts";
type RowFilter = "" | "changed" | "no-order";

export function MealWorklistPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const date = searchParams.get("date") || today();
  const wardId = searchParams.get("ward") ?? "";
  const view: View = searchParams.get("view") === "counts" ? "counts" : "patients";
  const [rowFilter, setRowFilter] = useState<RowFilter>("");

  const wardOptions = useWardOptions();
  const inpatients = useInpatientEncounters(date);
  const bedWards = useBedWardIndex();
  const orders = useMealOrdersOn(date);
  const diets = useMealDietOptions();
  const staples = useMealItemOptions("staple");
  const returnLinkState = useReturnLinkState();

  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  function setParams(next: Record<string, string>) {
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    setSearchParams(params);
  }

  const rows = useMemo(
    () =>
      buildMealWorklist({
        date,
        encounters: inpatients.data?.encounters ?? [],
        patientsById: inpatients.data?.patientsById ?? new Map(),
        orders: orders.data ?? [],
        bedWards: bedWards.bedWards,
      }),
    [date, inpatients.data, orders.data, bedWards.bedWards],
  );
  const wardRows = useMemo(
    () => (wardId ? rows.filter((row) => row.wardId === wardId) : rows),
    [rows, wardId],
  );
  const visible = wardRows.filter((row) => matchesRowFilter(row, rowFilter));
  const patientIds = useMemo(() => wardRows.map((row) => row.patientId), [wardRows]);
  const pictograms = useRowPictogramSources(patientIds);
  // 行を押すと右に患者プロファイルを出す(他の部門一覧と同じ)。
  const drawer = useRowDrawer(view);
  const selectedRow = visible.find((row) => row.patientId === drawer.selectedKey);

  // 集計の並びはマスタの表示順(API の返す順)。
  const summary = useMemo(() => {
    const dietOrder = new Map((diets.data?.items ?? []).map((d, i) => [d.item_code, i]));
    const stapleOrder = new Map((staples.data?.items ?? []).map((s, i) => [s.item_code, i]));
    return countMeals(wardRows, dietOrder, stapleOrder);
  }, [wardRows, diets.data, staples.data]);

  const loading = inpatients.isLoading || orders.isLoading || bedWards.isLoading;

  return (
    <div className="page">
      <div className="page__header">
        <h1>食事一覧</h1>
        <div className="page__header-actions">
          <button
            type="button"
            onClick={() => {
              void inpatients.refetch();
              void orders.refetch();
            }}
          >
            最新表示
          </button>
        </div>
      </div>

      <div className="order-select__tabs" role="tablist">
        {(
          [
            { key: "patients", label: "患者別" },
            { key: "counts", label: "食数集計" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={view === tab.key}
            className={view === tab.key ? "order-select__tab is-active" : "order-select__tab"}
            onClick={() => setParams({ view: tab.key === "patients" ? "" : tab.key })}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <FilterForm
        date={date}
        wardId={wardId}
        wards={wardOptions.wards}
        rowFilter={view === "patients" ? rowFilter : null}
        onDateChange={(value) => value && setParams({ date: value })}
        onWardChange={(value) => setParams({ ward: value })}
        onRowFilterChange={setRowFilter}
      />

      <ErrorBanner error={inpatients.error ?? orders.error ?? bedWards.error ?? wardOptions.error} />
      <TruncatedNotice show={inpatients.data?.truncated} />

      {loading ? (
        <p>読み込み中...</p>
      ) : view === "patients" ? (
        <>
          <div className="lab-worklist-wrap sticky-table-wrap">
            <table className="lab-worklist sticky-table meal-worklist">
              <thead>
                <tr>
                  <th className="lab-worklist__compact">病棟</th>
                  <th className="lab-worklist__compact">病室</th>
                  <th>患者</th>
                  {MEAL_TIMING_OPTIONS.map((timing) => (
                    <th key={timing.code}>{timing.display}</th>
                  ))}
                  <th className="lab-worklist__compact">副食形態</th>
                  <th className="lab-worklist__compact">塩分</th>
                  <th className="lab-worklist__compact">アレルギー</th>
                  <th className="lab-worklist__compact">欠食理由</th>
                  <th>コメント</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.encounter.id ?? row.patientId} {...drawer.rowProps(row.patientId)}>
                    <td className="lab-worklist__compact">{row.wardName || "-"}</td>
                    <td className="lab-worklist__compact">{row.bedLabel}</td>
                    <td>
                      {row.patient ? (
                        <>
                          <Link
                            to={`/patients/${row.patientId}/karte?tab=meal`}
                            state={returnLinkState}
                          >
                            {displayName(row.patient)}
                          </Link>
                          <PatientKana patient={row.patient} />
                          <RowPictograms patientId={row.patientId} {...pictograms} />
                        </>
                      ) : (
                        row.patientId
                      )}
                      {row.admittedToday && <span className="meal-worklist__badge">入院</span>}
                      {row.dischargedToday && <span className="meal-worklist__badge">退院</span>}
                    </td>
                    {MEAL_TIMING_OPTIONS.map((timing) => (
                      <MealCell key={timing.code} cell={row.cells[timing.code]} />
                    ))}
                    <td className="lab-worklist__compact">{row.sideDishForm}</td>
                    <td className="lab-worklist__compact">{row.saltLimit}</td>
                    <td className="lab-worklist__compact meal-worklist__allergy">{row.allergy}</td>
                    <td className="lab-worklist__compact">{row.fastingReason}</td>
                    <td className="meal-worklist__comment">{row.comment}</td>
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={11} className="master-search__empty">
                      {wardRows.length === 0
                        ? "この日の入院患者はいません。"
                        : "絞り込みに一致する患者がいません。"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="order-select__muted lab-worklist__count">{visible.length} 人</p>
        </>
      ) : (
        <div className="meal-count">
          <CountTable
            title="食種"
            rows={summary.diets}
            footer={[
              { label: "計", counts: summary.served },
              { label: "欠食", counts: summary.skipped },
              { label: "オーダーなし", counts: summary.noOrder },
            ]}
          />
          <CountTable title="主食" rows={summary.staples} />
        </div>
      )}

      {view === "patients" && selectedRow && (
        <PatientProfileDrawer
          patientId={selectedRow.patientId}
          patient={selectedRow.patient}
          onClose={drawer.close}
        />
      )}
    </div>
  );
}

function matchesRowFilter(row: MealWorklistRow, filter: RowFilter): boolean {
  if (filter === "changed") return MEAL_TIMING_OPTIONS.some((t) => row.cells[t.code]?.changed);
  if (filter === "no-order") return MEAL_TIMING_OPTIONS.some((t) => !row.cells[t.code]);
  return true;
}

/** 1 食ぶん。食種と主食を 2 段で出し、その食事から変わったものに印を付ける。 */
function MealCell({ cell }: { cell: MealWorklistCell | null }) {
  if (!cell) {
    return <td className="meal-worklist__meal meal-worklist__meal--none">—</td>;
  }
  return (
    <td className={cell.changed ? "meal-worklist__meal meal-worklist__meal--changed" : "meal-worklist__meal"}>
      <div className="meal-worklist__diet">
        {cell.dietName}
        {cell.changed && <span className="meal-worklist__badge">変更</span>}
      </div>
      {cell.skipped ? (
        <div className="meal-worklist__skipped">欠食</div>
      ) : (
        cell.stapleName && <div className="meal-worklist__staple">{cell.stapleName}</div>
      )}
    </td>
  );
}

function CountTable({
  title,
  rows,
  footer = [],
}: {
  title: string;
  rows: MealCountRow[];
  footer?: { label: string; counts: Record<string, number> }[];
}) {
  return (
    <table className="lab-worklist meal-count__table">
      <thead>
        <tr>
          <th>{title}</th>
          {MEAL_TIMING_OPTIONS.map((timing) => (
            <th key={timing.code} className="meal-count__num">
              {timing.display}
            </th>
          ))}
          <th className="meal-count__num">計</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            <td>{row.label}</td>
            {MEAL_TIMING_OPTIONS.map((timing) => (
              <td key={timing.code} className="meal-count__num">
                {row.counts[timing.code] || ""}
              </td>
            ))}
            <td className="meal-count__num">{row.total}</td>
          </tr>
        ))}
        {rows.length === 0 && (
          <tr>
            <td colSpan={5} className="master-search__empty">
              ありません
            </td>
          </tr>
        )}
      </tbody>
      {footer.length > 0 && (
        <tfoot>
          {footer.map((line) => (
            <tr key={line.label}>
              <th>{line.label}</th>
              {MEAL_TIMING_OPTIONS.map((timing) => (
                <td key={timing.code} className="meal-count__num">
                  {line.counts[timing.code]}
                </td>
              ))}
              <td className="meal-count__num">
                {MEAL_TIMING_OPTIONS.reduce((sum, t) => sum + line.counts[t.code], 0)}
              </td>
            </tr>
          ))}
        </tfoot>
      )}
    </table>
  );
}

function FilterForm({
  date,
  wardId,
  wards,
  rowFilter,
  onDateChange,
  onWardChange,
  onRowFilterChange,
}: {
  date: string;
  wardId: string;
  wards: fhir4.Location[];
  /** null は「表示」の絞り込みを出さない(食数集計)。 */
  rowFilter: RowFilter | null;
  onDateChange: (value: string) => void;
  onWardChange: (value: string) => void;
  onRowFilterChange: (value: RowFilter) => void;
}) {
  function handleSubmit(e: FormEvent) {
    e.preventDefault();
  }

  return (
    <form className="patient-search-form" onSubmit={handleSubmit}>
      <label>
        日付
        <DateStepper value={date} onChange={onDateChange} />
      </label>
      <label>
        病棟
        <select value={wardId} onChange={(e) => onWardChange(e.target.value)}>
          <option value="">すべて</option>
          {wards.map((ward) => (
            <option key={ward.id} value={ward.id}>
              {locationDisplayName(ward)}
            </option>
          ))}
        </select>
      </label>
      {rowFilter !== null && (
        <label>
          表示
          <select
            value={rowFilter}
            onChange={(e) => onRowFilterChange(e.target.value as RowFilter)}
          >
            <option value="">すべて</option>
            <option value="changed">変更あり</option>
            <option value="no-order">オーダーなし</option>
          </select>
        </label>
      )}
    </form>
  );
}
