import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  useFacilitySettings,
  useInpatientEncounters,
  useNursingPerformsOn,
  useNursingWorklist,
  useSelfDepartments,
  useWardInjectionOrders,
  useWardOptions,
} from "../api/queries";
import { DateStepper } from "../components/DateStepper";
import { ErrorBanner } from "../components/ErrorBanner";
import { InjectionPerformModal } from "../components/InjectionPerformModal";
import { NursingPerformModal } from "../components/NursingPerformModal";
import { PatientKana } from "../components/PatientRowCells";
import { TruncatedNotice } from "../components/TruncatedNotice";
import { encounterBedLabel, encounterPatientId } from "../fhir/encounterHelpers";
import {
  INSULIN_WORKLIST_KIND_OPTIONS,
  SHIFT_OPTIONS,
  buildInsulinWorklist,
  insulinWorklistKindDisplay,
  shiftOf,
  type InsulinWorklistItem,
  type InsulinWorklistKind,
  type ShiftCode,
} from "../fhir/insulinWorklistHelpers";
import { locationDisplayName } from "../fhir/locationHelpers";
import { NURSING_OBSERVATION_CODE_SYSTEM } from "../fhir/nursingOrderHelpers";
import { NURSING_GLUCOSE_MANAGE_NO, type NursingPerformDisplay } from "../fhir/nursingPerformHelpers";
import { DEFAULT_NURSING_SCHEDULE } from "../fhir/nursingScheduleHelpers";
import { displayName } from "../fhir/patientHelpers";
import { nowDateTimeInput, today } from "../lib/dates";
import { useReturnLinkState } from "../returnTo";

// 血糖インスリン指示患者一覧。病棟の 1 日ぶんのインスリンの施用と血糖測定の予定を時刻順に並べ、
// 行から実施入力・カルテ・経過表を開く(fhir/insulinWorklistHelpers.ts)。
//
// 病棟は指示簿と同じく上流の ward 検索で絞る(注射も看護指示も登録時の order-ward を持つ)。
// 依頼科・勤務帯・区分・状態は 1 病棟 1 日ぶんの中での見方の切り替えなので画面側で絞る。

const GLUCOSE_ORDER_CODE = `${NURSING_OBSERVATION_CODE_SYSTEM}|${NURSING_GLUCOSE_MANAGE_NO}`;

interface Filters {
  departmentId: string;
  shift: ShiftCode | "";
  kind: InsulinWorklistKind | "";
  /** undone = 未実施だけ。 */
  status: "" | "undone";
}

const emptyFilters: Filters = { departmentId: "", shift: "", kind: "", status: "" };

export function InsulinWorklistPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const wardId = searchParams.get("ward") ?? "";
  const date = searchParams.get("date") || today();
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  // 実施入力を開いている行。読み直しのたびに引き直すので key で覚える。
  const [performingKey, setPerformingKey] = useState<string | null>(null);

  const wardOptions = useWardOptions();
  const injections = useWardInjectionOrders(date, wardId || undefined);
  const glucose = useNursingWorklist(date, wardId || undefined, GLUCOSE_ORDER_CODE);
  const inpatients = useInpatientEncounters(date);
  const departments = useSelfDepartments();
  const facility = useFacilitySettings();
  const scheduleSettings = facility.data?.nursing_schedule ?? DEFAULT_NURSING_SCHEDULE;
  const returnLinkState = useReturnLinkState();

  // 列が多いのでこの画面だけ幅を広げる(他のワークリストと同じ)。
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

  const bedByPatientId = useMemo(() => {
    const map = new Map<string, string>();
    for (const encounter of inpatients.data?.encounters ?? []) {
      const patientId = encounterPatientId(encounter);
      if (patientId && !map.has(patientId)) map.set(patientId, encounterBedLabel(encounter));
    }
    return map;
  }, [inpatients.data]);

  const glucoseRows = useMemo(() => glucose.data?.rows ?? [], [glucose.data]);
  const glucosePatientIds = useMemo(
    () => glucoseRows.map((row) => row.order.subject?.reference?.split("/").pop() ?? ""),
    [glucoseRows],
  );
  const nursingPerforms = useNursingPerformsOn(date, glucosePatientIds);
  const nursingPerformsByOrderId = useMemo(
    () => nursingPerforms.data ?? new Map<string, NursingPerformDisplay[]>(),
    [nursingPerforms.data],
  );

  const items = useMemo(
    () =>
      buildInsulinWorklist({
        injections: injections.data,
        glucoseOrders: glucoseRows,
        nursingPerformsByOrderId,
        date,
        scheduleSettings,
        bedLabelOf: (patientId) => bedByPatientId.get(patientId) ?? "",
      }),
    [injections.data, glucoseRows, nursingPerformsByOrderId, date, scheduleSettings, bedByPatientId],
  );
  const visible = items.filter((item) => matchesFilters(item, filters));
  const performing = items.find((item) => item.key === performingKey) ?? null;
  const loading = injections.isLoading || glucose.isLoading;

  return (
    <div className="page">
      <div className="page__header">
        <h1>血糖インスリン指示</h1>
        <div className="page__header-actions">
          <button
            type="button"
            onClick={() => {
              void injections.refetch();
              void glucose.refetch();
              void nursingPerforms.refetch();
            }}
          >
            更新
          </button>
          <Link className="button" to={`/nursing-worklist?ward=${wardId}&date=${date}`}>
            指示簿
          </Link>
        </div>
      </div>

      <FilterForm
        date={date}
        wardId={wardId}
        wards={wardOptions.wards}
        departments={departments.departments}
        filters={filters}
        onDateChange={(value) => value && setParams({ date: value })}
        onWardChange={(value) => setParams({ ward: value })}
        onChange={setFilters}
      />

      <ErrorBanner error={injections.error} />
      <ErrorBanner error={glucose.error} />
      <ErrorBanner error={nursingPerforms.error} />
      <ErrorBanner error={wardOptions.error} />
      <TruncatedNotice show={injections.data?.truncated || glucose.data?.truncated} />

      {!wardId ? (
        <p className="patient-table__empty">病棟を選んでください。</p>
      ) : loading ? (
        <p>読み込み中...</p>
      ) : (
        <>
          <div className="lab-worklist-wrap sticky-table-wrap">
            <table className="lab-worklist sticky-table">
              <thead>
                <tr>
                  <th className="lab-worklist__compact">時刻</th>
                  <th className="lab-worklist__compact">病室</th>
                  <th>患者</th>
                  <th className="lab-worklist__compact">区分</th>
                  <th>指示内容</th>
                  <th className="lab-worklist__compact">期間</th>
                  <th className="lab-worklist__compact">依頼者</th>
                  <th className="lab-worklist__compact">状態</th>
                  <th className="lab-worklist__actions sticky-table__fix-actions"></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((item) => (
                  <tr key={item.key}>
                    <td className="lab-worklist__compact">{item.time || "-"}</td>
                    <td className="lab-worklist__compact">
                      {(bedByPatientId.get(item.patientId) ?? "").split(" ")[0] || "-"}
                    </td>
                    <td>
                      {item.patient ? (
                        <>
                          <Link to={`/patients/${item.patientId}/karte`} state={returnLinkState}>
                            {displayName(item.patient)}
                          </Link>
                          <PatientKana patient={item.patient} />
                        </>
                      ) : (
                        item.patientId || "-"
                      )}
                    </td>
                    <td className="lab-worklist__compact">{insulinWorklistKindDisplay(item.kind)}</td>
                    <td>
                      {item.instruction}
                      {item.detail && <div className="nursing-tab__comment">{item.detail}</div>}
                    </td>
                    <td className="lab-worklist__compact">{item.period}</td>
                    <td className="lab-worklist__compact">{item.requesterName}</td>
                    <td className="lab-worklist__compact">
                      {item.done ? (
                        <span className="lab-worklist__status lab-worklist__status--completed">実施済</span>
                      ) : (
                        <span className="order-select__muted">未</span>
                      )}
                    </td>
                    <td className="lab-worklist__actions sticky-table__fix-actions">
                      <button type="button" onClick={() => setPerformingKey(item.key)}>
                        実施
                      </button>
                      <Link
                        className="button"
                        to={`/patients/${item.patientId}/karte?tab=flowsheet`}
                        state={returnLinkState}
                      >
                        経過表
                      </Link>
                    </td>
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={9} className="master-search__empty">
                      {items.length === 0
                        ? "この日のインスリン・血糖測定の指示はありません。"
                        : "絞り込みに一致する指示がありません。"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="order-select__muted lab-worklist__count">
            {new Set(visible.map((item) => item.patientId)).size} 人 / {visible.length} 件
          </p>
        </>
      )}

      {performing?.injection && (
        <InjectionPerformModal
          order={performing.injection.order}
          medicationRequests={performing.injection.medicationRequests}
          task={performing.injection.task}
          performs={performing.injection.performs}
          onClose={() => setPerformingKey(null)}
        />
      )}
      {performing?.nursingOrder && (
        <NursingPerformModal
          patientName={performing.patient ? displayName(performing.patient) : undefined}
          orders={[performing.nursingOrder]}
          // 予定の時刻、時刻の無い指示は見ている日の今の時刻(別の日を見ているとき今日に記録しないため)。
          defaultAt={`${date}T${performing.time || nowDateTimeInput().slice(11, 16)}`}
          performsByOrderId={nursingPerformsByOrderId}
          onClose={() => setPerformingKey(null)}
        />
      )}
    </div>
  );
}

function matchesFilters(item: InsulinWorklistItem, filters: Filters): boolean {
  if (filters.departmentId && item.departmentId !== filters.departmentId) return false;
  if (filters.kind && item.kind !== filters.kind) return false;
  if (filters.status === "undone" && item.done) return false;
  // 時刻の無い予定はどの勤務帯にも出す(いつ入れてもよい指示)。
  if (filters.shift && item.time && shiftOf(item.time) !== filters.shift) return false;
  return true;
}

function FilterForm({
  date,
  wardId,
  wards,
  departments,
  filters,
  onDateChange,
  onWardChange,
  onChange,
}: {
  date: string;
  wardId: string;
  wards: fhir4.Location[];
  departments: fhir4.Organization[];
  filters: Filters;
  onDateChange: (value: string) => void;
  onWardChange: (value: string) => void;
  onChange: (filters: Filters) => void;
}) {
  function handleSubmit(e: FormEvent) {
    // 選んだ瞬間に効くので、Enter では何もしない。
    e.preventDefault();
  }

  return (
    <form className="patient-search-form" onSubmit={handleSubmit}>
      <label>
        実施日
        <DateStepper value={date} onChange={onDateChange} />
      </label>
      <label>
        病棟
        <select value={wardId} onChange={(e) => onWardChange(e.target.value)}>
          {wards.map((ward) => (
            <option key={ward.id} value={ward.id}>
              {locationDisplayName(ward)}
            </option>
          ))}
        </select>
      </label>
      <label>
        依頼科
        <select
          value={filters.departmentId}
          onChange={(e) => onChange({ ...filters, departmentId: e.target.value })}
        >
          <option value="">すべて</option>
          {departments.map((department) => (
            <option key={department.id} value={department.id}>
              {department.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        勤務帯
        <select
          value={filters.shift}
          onChange={(e) => onChange({ ...filters, shift: e.target.value as Filters["shift"] })}
        >
          <option value="">すべて</option>
          {SHIFT_OPTIONS.map((option) => (
            <option key={option.code} value={option.code}>
              {option.display}
            </option>
          ))}
        </select>
      </label>
      <label>
        区分
        <select
          value={filters.kind}
          onChange={(e) => onChange({ ...filters, kind: e.target.value as Filters["kind"] })}
        >
          <option value="">すべて</option>
          {INSULIN_WORKLIST_KIND_OPTIONS.map((option) => (
            <option key={option.code} value={option.code}>
              {option.display}
            </option>
          ))}
        </select>
      </label>
      <label>
        状態
        <select
          value={filters.status}
          onChange={(e) => onChange({ ...filters, status: e.target.value as Filters["status"] })}
        >
          <option value="">すべて</option>
          <option value="undone">未実施</option>
        </select>
      </label>
      <div className="patient-search-form__actions">
        <button type="button" onClick={() => onChange(emptyFilters)}>
          クリア
        </button>
      </div>
    </form>
  );
}
