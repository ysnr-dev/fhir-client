import { today } from "../lib/dates";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useReturnLinkState } from "../returnTo";
import {
  useInjectionWorklist,
  useSelfDepartments,
  useUpdateInjectionTaskStatus,
  type InjectionWorklistRow,
} from "../api/queries";
import { injectionLabelPdfUrl, injectionPdfUrl } from "../api/reportsClient";
import { ErrorBanner } from "../components/ErrorBanner";
import { InjectionDispenseModal } from "../components/InjectionDispenseModal";
import { InjectionOrderViewModal } from "../components/InjectionOrderViewModal";
import {
  PatientKana,
  PatientProfileCells,
  PatientProfileHeadCells,
} from "../components/PatientRowCells";
import { RowMenu } from "../components/RowMenu";
import {
  CATEGORY_OPTIONS,
  groupInjectionByRp,
  injectionSeriesLabel,
} from "../fhir/injectionHelpers";
import {
  INJECTION_TASK_STATUS_OPTIONS,
  injectionTaskActions,
  injectionTaskStatus,
  injectionTaskStatusDisplay,
  type InjectionTaskStatus,
} from "../fhir/injectionTaskHelpers";
import { displayName } from "../fhir/patientHelpers";
import {
  SETTING_OPTIONS,
  orderContextSummary,
  prescriptionRequester,
  wardOf,
} from "../fhir/prescriptionHelpers";
import { categoryCoding } from "../fhir/shared";
import { SETTING_SYSTEM } from "../fhir/prescriptionHelpers";

// 注射一覧(部門ワークリスト)。注射日を決めて、その日に払い出す注射を並べる。
// 作りは処方一覧(RxWorklistPage)に合わせてある。
//
// 進捗は 依頼済 → 受付済 → 払出済 → 実施済 と進む。注射箋の発行が受付を兼ねていて、
// 依頼済のオーダーは発行と同時に受付済へ進む(処方箋発行と同じ)。払出済へは「払出登録」で
// 進み、払出結果の MedicationDispense と一緒に書き込む。実施済へはカルテの実施入力(病棟)で進む。
// 注射ラベル(RP ごと 1 枚)はどの進捗でも刷れる(混注の準備で使うので払出の前に刷ることが多い)。
//
// 注射日だけが上流での絞り込みで、残りは読み込んだ 1 日ぶんから画面側で絞る。

interface Filters {
  setting: string;
  category: string;
  wardId: string;
  departmentId: string;
  status: string;
}

const emptyFilters: Filters = {
  setting: "",
  category: "",
  wardId: "",
  departmentId: "",
  status: "",
};

const INJECTION_CATEGORY_SYSTEM = "http://fhir-client.local/CodeSystem/injection-category";
const ALL_CATEGORY_OPTIONS = [...CATEGORY_OPTIONS.inpatient, ...CATEGORY_OPTIONS.outpatient];

export function InjectionWorklistPage() {
  const [date, setDate] = useState(today);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [dispensingId, setDispensingId] = useState<string | null>(null);

  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  const worklist = useInjectionWorklist(date);
  const departments = useSelfDepartments();
  const updateStatus = useUpdateInjectionTaskStatus();

  const rows = useMemo(
    () => (worklist.data?.rows ?? []).filter((row) => matchesFilters(row, filters)),
    [worklist.data, filters],
  );
  const total = worklist.data?.rows.length ?? 0;
  const viewing = worklist.data?.rows.find((row) => row.order.id === viewingId);
  const dispensing = worklist.data?.rows.find((row) => row.order.id === dispensingId);

  const wardOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const row of worklist.data?.rows ?? []) {
      const ward = wardOf(row.order);
      if (ward.wardId && !byId.has(ward.wardId)) byId.set(ward.wardId, ward.wardName || ward.wardId);
    }
    return Array.from(byId, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [worklist.data]);

  return (
    <div className="page">
      <div className="page__header">
        <h1>注射一覧</h1>
      </div>

      <FilterForm
        date={date}
        filters={filters}
        wards={wardOptions}
        departments={departments.departments}
        onDateChange={(value) => value && setDate(value)}
        onChange={setFilters}
      />

      <ErrorBanner error={worklist.error} />
      <ErrorBanner error={departments.error} />
      <ErrorBanner error={updateStatus.error} />

      {worklist.data?.truncated && (
        <p className="error-banner__line error-banner__line--error" role="status">
          この日の注射が多いため、一部のみ表示しています。
        </p>
      )}

      {worklist.isLoading ? (
        <p>読み込み中...</p>
      ) : (
        <>
          <div className="lab-worklist-wrap sticky-table-wrap">
            <table className="lab-worklist sticky-table">
              <thead>
                <tr>
                  <th className="sticky-table__fix-1">患者番号</th>
                  <th className="sticky-table__fix-2">患者氏名</th>
                  <PatientProfileHeadCells />
                  <th className="rx-worklist__content">注射内容</th>
                  <th className="lab-worklist__compact">区分</th>
                  <th className="lab-worklist__compact">病棟</th>
                  <th>依頼科 | 依頼医師</th>
                  <th className="lab-worklist__compact">ステータス</th>
                  <th className="lab-worklist__actions sticky-table__fix-actions"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <WorklistRow
                    key={row.order.id}
                    row={row}
                    pending={updateStatus.isPending}
                    onView={() => setViewingId(row.order.id ?? null)}
                    onDispense={() => setDispensingId(row.order.id ?? null)}
                    onChangeStatus={(status) =>
                      updateStatus.mutate({
                        targets: [{ serviceRequest: row.order, task: row.task }],
                        status,
                      })
                    }
                  />
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={10} className="master-search__empty">
                      {total === 0
                        ? "この注射日の注射オーダーはありません"
                        : "絞り込みに該当する注射がありません"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="order-select__muted lab-worklist__count">{rows.length} 件</p>
        </>
      )}

      {viewing && <InjectionOrderViewModal row={viewing} onClose={() => setViewingId(null)} />}
      {dispensing && (
        <InjectionDispenseModal row={dispensing} onClose={() => setDispensingId(null)} />
      )}
    </div>
  );
}

function matchesFilters(row: InjectionWorklistRow, filters: Filters): boolean {
  const setting = categoryCoding(row.order, SETTING_SYSTEM)?.code ?? "";
  const category = categoryCoding(row.order, INJECTION_CATEGORY_SYSTEM)?.code ?? "";
  if (filters.setting && setting !== filters.setting) return false;
  if (filters.category && category !== filters.category) return false;
  if (filters.wardId && wardOf(row.order).wardId !== filters.wardId) return false;
  const requester = prescriptionRequester(row.order);
  if (filters.departmentId && requester.departmentId !== filters.departmentId) return false;
  if (filters.status && injectionTaskStatus(row.task) !== filters.status) return false;
  return true;
}

interface FilterFormProps {
  date: string;
  filters: Filters;
  wards: { id: string; name: string }[];
  departments: fhir4.Organization[];
  onDateChange: (value: string) => void;
  onChange: (filters: Filters) => void;
}

function FilterForm({ date, filters, wards, departments, onDateChange, onChange }: FilterFormProps) {
  function handleSubmit(e: FormEvent) {
    e.preventDefault();
  }
  const categoryOptions = filters.setting
    ? CATEGORY_OPTIONS[filters.setting as "inpatient" | "outpatient"]
    : ALL_CATEGORY_OPTIONS;

  return (
    <form className="patient-search-form" onSubmit={handleSubmit}>
      <label>
        注射日
        <input type="date" value={date} required onChange={(e) => onDateChange(e.target.value)} />
      </label>
      <label>
        入外区分
        <select
          value={filters.setting}
          onChange={(e) => onChange({ ...filters, setting: e.target.value, category: "" })}
        >
          <option value="">すべて</option>
          {SETTING_OPTIONS.map((option) => (
            <option key={option.code} value={option.code}>
              {option.display}
            </option>
          ))}
        </select>
      </label>
      <label>
        注射区分
        <select
          value={filters.category}
          onChange={(e) => onChange({ ...filters, category: e.target.value })}
        >
          <option value="">すべて</option>
          {categoryOptions.map((option) => (
            <option key={option.code} value={option.code}>
              {option.display}
            </option>
          ))}
        </select>
      </label>
      <label>
        病棟
        <select value={filters.wardId} onChange={(e) => onChange({ ...filters, wardId: e.target.value })}>
          <option value="">すべて</option>
          {wards.map((ward) => (
            <option key={ward.id} value={ward.id}>
              {ward.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        診療科
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
        ステータス
        <select value={filters.status} onChange={(e) => onChange({ ...filters, status: e.target.value })}>
          <option value="">すべて</option>
          {INJECTION_TASK_STATUS_OPTIONS.map((option) => (
            <option key={option.code} value={option.code}>
              {option.display}
            </option>
          ))}
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

function WorklistRow({
  row,
  pending,
  onView,
  onDispense,
  onChangeStatus,
}: {
  row: InjectionWorklistRow;
  pending: boolean;
  onView: () => void;
  onDispense: () => void;
  onChangeStatus: (status: InjectionTaskStatus) => void;
}) {
  const returnLinkState = useReturnLinkState();
  const { order, patient } = row;
  const requester = prescriptionRequester(order);
  const status = injectionTaskStatus(row.task);
  const actions = injectionTaskActions(status);
  const settingDisplay = categoryCoding(order, SETTING_SYSTEM)?.display ?? "";
  const categoryDisplay = categoryCoding(order, INJECTION_CATEGORY_SYSTEM)?.display ?? "";
  const seriesLabel = injectionSeriesLabel(order);
  // 発行済み(受付済以降)は注射箋を刷り直せる。中止した注射は刷らせない。
  const canReissue = status === "accepted" || status === "in-progress" || status === "completed";

  // 注射内容の列。払い出す側が何を揃えるかが分かればよいので医薬品の名前だけを並べ、
  // 用法・用量は「表示」か「払出登録」で開く。
  const medicineNames = groupInjectionByRp(row.medicationRequests)
    .flatMap((rp) => rp.medicines.map((medicine) => medicine.name))
    .filter(Boolean)
    .join("・");

  return (
    <tr>
      <td className="sticky-table__fix-1">{patient?.identifier?.[0]?.value ?? "-"}</td>
      <td className="sticky-table__fix-2">
        {patient ? (
          <>
            <Link to={`/patients/${patient.id}/karte`} state={returnLinkState}>
              {displayName(patient)}
            </Link>
            <PatientKana patient={patient} />
          </>
        ) : (
          "-"
        )}
      </td>
      <PatientProfileCells patient={patient} />
      <td className="rx-worklist__content">
        {medicineNames ? (
          <span className="rx-worklist__medicines" title={medicineNames}>
            {medicineNames}
          </span>
        ) : (
          <span className="order-select__muted">医薬品なし</span>
        )}
        {/* 連日オーダーの何日目かは払出の段取り(明日も同じものが出る)に関わるので添える。 */}
        {seriesLabel && <span className="injection-series-label">{seriesLabel}</span>}
      </td>
      <td className="lab-worklist__compact">
        {[settingDisplay, categoryDisplay].filter(Boolean).join(" ") || "-"}
      </td>
      <td className="lab-worklist__compact">{wardOf(order).wardName || "-"}</td>
      <td>{orderContextSummary(requester) || "-"}</td>
      <td className="lab-worklist__compact">
        <span className={`lab-worklist__status lab-worklist__status--${status}`}>
          {injectionTaskStatusDisplay(status)}
        </span>
      </td>
      <td className="lab-worklist__actions sticky-table__fix-actions">
        {/* 注射箋の発行が受付を兼ねる(処方箋発行と同じ)。依頼済のオーダーは PDF を
            開くと同時に受付済へ進める。再発行はケバブメニューへ畳む。 */}
        {status === "requested" && (
          <a
            className="button"
            href={injectionPdfUrl(order.id ?? "")}
            target="_blank"
            rel="noopener"
            title="注射箋の PDF を新規タブで開く"
            onClick={() => onChangeStatus("accepted")}
          >
            注射箋発行
          </a>
        )}
        {status === "accepted" && (
          <button type="button" disabled={!patient?.id} onClick={onDispense}>
            払出登録
          </button>
        )}
        <button type="button" onClick={onView}>
          表示
        </button>
        {(actions.length > 0 || canReissue || status !== "cancelled") && (
          <RowMenu label="この注射の操作" escapesClipping>
            {canReissue && (
              <a
                className="row-menu__item"
                href={injectionPdfUrl(order.id ?? "")}
                target="_blank"
                rel="noopener"
              >
                注射箋再発行
              </a>
            )}
            {/* ラベルは進捗を動かさない。混注の準備で使うので払出前でも刷れる。 */}
            {status !== "cancelled" && (
              <a
                className="row-menu__item"
                href={injectionLabelPdfUrl(order.id ?? "")}
                target="_blank"
                rel="noopener"
              >
                注射ラベル発行
              </a>
            )}
            {actions.map((action) => (
              <button
                key={action.next}
                type="button"
                className={`row-menu__item${action.next === "cancelled" ? " row-menu__item--danger" : ""}`}
                disabled={pending}
                onClick={() => onChangeStatus(action.next)}
              >
                {action.label}
              </button>
            ))}
          </RowMenu>
        )}
      </td>
    </tr>
  );
}
