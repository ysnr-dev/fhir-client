import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useCurrentPractitioner } from "../api/authQueries";
import {
  useCancelAppointment,
  useDepartmentList,
  useLocationOptions,
  useOutpatientList,
  usePractitionerOptions,
  usePractitionerRoles,
  useUpdateAppointmentStatus,
  type OutpatientRow,
} from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { RowMenu } from "../components/RowMenu";
import { WalkInCheckInModal } from "../components/WalkInCheckInModal";
import {
  APPOINTMENT_STATUS_OPTIONS,
  appointmentActorDisplay,
  appointmentActorId,
  appointmentDateTimeLabel,
  appointmentDepartmentCode,
  appointmentDepartmentLabel,
  appointmentScheduleLabel,
  appointmentStatusLabel,
  appointmentTimeLabel,
  canCheckInAppointment,
  isActiveAppointment,
} from "../fhir/appointmentHelpers";
import { departmentCode, departmentDisplayName } from "../fhir/departmentHelpers";
import { displayName } from "../fhir/patientHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { isDoctorRoleCode, parsePractitionerRole } from "../fhir/practitionerRoleHelpers";
import { today } from "../fhir/scheduleHelpers";

// 外来一覧(受付ワークリスト)。診察日を決めて、その日の予約患者を受付する。
//
// 1 行 = 予約(Appointment)1 件。予約なしの来院は「当日受付」で枠を持たない予約を
// 作り、同じ一覧に載せる(登録は WalkInCheckInModal)。
//
// 診察日だけが上流での絞り込みで、残りは読み込んだ 1 日ぶんから画面側で絞る
// (理由は queries.ts の useOutpatientList を参照)。

interface Filters {
  departmentCode: string;
  practitionerId: string;
  locationId: string;
  status: string;
}

const emptyFilters: Filters = {
  departmentCode: "",
  practitionerId: "",
  locationId: "",
  status: "",
};

// 取消・誤登録は一覧に出さないので、絞り込みの選択肢にも出さない。
const STATUS_OPTIONS = APPOINTMENT_STATUS_OPTIONS.filter(
  (option) => !["cancelled", "entered-in-error"].includes(option.code),
);

export function OutpatientListPage() {
  // 診察日は必須。未選択にはできないので当日から始める。
  const [date, setDate] = useState(today);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [walkInOpen, setWalkInOpen] = useState(false);

  // 列が多く、既定の幅では患者名や予約枠まで折り返すので、この画面だけ幅を広げる
  // (放射線検査一覧と同じやり方)。
  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  const list = useOutpatientList(date);
  const departments = useDepartmentList({});
  const practitioners = usePractitionerOptions();
  const locations = useLocationOptions();
  const updateStatus = useUpdateAppointmentStatus();
  const cancel = useCancelAppointment();

  // ログイン中の医師には自分の予約から見せる(受付や代行入力の職種はすべての予約)。
  const { practitionerId } = useCurrentPractitioner();
  const roles = usePractitionerRoles(practitionerId ?? undefined);
  const initializedFor = useRef("");
  useEffect(() => {
    if (!practitionerId || roles.isPending) return;
    if (initializedFor.current === practitionerId) return;
    initializedFor.current = practitionerId;
    const roleCode = roles.role ? parsePractitionerRole(roles.role).roleCode : undefined;
    if (isDoctorRoleCode(roleCode)) {
      setFilters((current) => ({ ...current, practitionerId }));
    }
  }, [practitionerId, roles.isPending, roles.role]);

  const rows = useMemo(
    () => (list.data?.rows ?? []).filter((row) => matchesFilters(row, filters)),
    [list.data, filters],
  );
  const total = list.data?.rows.length ?? 0;

  function handleDateChange(value: string) {
    // 日付を空にはさせない(空で検索すると全期間になってしまう)。
    if (value) setDate(value);
  }

  function handleCancel(appointment: fhir4.Appointment) {
    if (
      !window.confirm(
        `${appointmentDateTimeLabel(appointment)} の予約を取り消します。よろしいですか?`,
      )
    ) {
      return;
    }
    cancel.mutate(appointment);
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>外来一覧</h1>
        <button type="button" onClick={() => setWalkInOpen(true)}>
          当日受付
        </button>
      </div>

      <FilterForm
        date={date}
        filters={filters}
        departments={departments.departments}
        practitioners={practitioners.practitioners}
        locations={locations.locations}
        onDateChange={handleDateChange}
        onChange={setFilters}
      />

      <ErrorBanner error={list.error} />
      <ErrorBanner error={departments.error ?? practitioners.error ?? locations.error} />
      <ErrorBanner error={updateStatus.error ?? cancel.error} />

      {list.data?.truncated && (
        <p className="error-banner__line error-banner__line--error" role="status">
          この日の予約が多いため、一部のみ表示しています。
        </p>
      )}

      {list.isLoading ? (
        <p>読み込み中...</p>
      ) : (
        <>
          <div className="outpatient-wrap">
            <table className="outpatient">
              <thead>
                <tr>
                  <th className="outpatient__time">時刻</th>
                  <th>患者番号</th>
                  <th>患者氏名</th>
                  <th className="outpatient__schedule">予約枠</th>
                  <th>診療科</th>
                  <th>担当医</th>
                  <th>診察室</th>
                  <th>状態</th>
                  <th className="outpatient__actions"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <OutpatientTableRow
                    key={row.appointment.id}
                    row={row}
                    pending={updateStatus.isPending || cancel.isPending}
                    onChangeStatus={(status) =>
                      updateStatus.mutate({ appointment: row.appointment, status })
                    }
                    onCancel={() => handleCancel(row.appointment)}
                  />
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={9} className="master-search__empty">
                      {total === 0
                        ? "この診察日の予約はありません"
                        : "絞り込みに該当する予約がありません"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="order-select__muted outpatient__count">{rows.length} 件</p>
        </>
      )}

      {walkInOpen && <WalkInCheckInModal onClose={() => setWalkInOpen(false)} />}
    </div>
  );
}

function matchesFilters(row: OutpatientRow, filters: Filters): boolean {
  const { appointment } = row;
  if (filters.departmentCode && appointmentDepartmentCode(appointment) !== filters.departmentCode) {
    return false;
  }
  if (
    filters.practitionerId &&
    appointmentActorId(appointment, "Practitioner") !== filters.practitionerId
  ) {
    return false;
  }
  if (filters.locationId && appointmentActorId(appointment, "Location") !== filters.locationId) {
    return false;
  }
  if (filters.status && appointment.status !== filters.status) return false;
  return true;
}

interface FilterFormProps {
  date: string;
  filters: Filters;
  departments: fhir4.Organization[];
  practitioners: fhir4.Practitioner[];
  locations: fhir4.Location[];
  onDateChange: (value: string) => void;
  onChange: (filters: Filters) => void;
}

function FilterForm({
  date,
  filters,
  departments,
  practitioners,
  locations,
  onDateChange,
  onChange,
}: FilterFormProps) {
  // 予約は診療科を SS-MIX2 コードで持つ(枠から引き継ぐ)ので、絞り込みもコードで
  // 行う。コード未設定の院内独自科は照合できないため選択肢に出さない。
  // 施設をまたいで同じコードの科があっても 1 つにまとめる。
  const departmentOptions = useMemo(() => {
    const byCode = new Map<string, string>();
    for (const department of departments) {
      const code = departmentCode(department);
      if (code && !byCode.has(code)) byCode.set(code, departmentDisplayName(department));
    }
    return [...byCode.entries()].map(([code, name]) => ({ code, name }));
  }, [departments]);

  // 絞り込みは選んだ瞬間に効かせるので、Enter での送信は何もしない。
  function handleSubmit(e: FormEvent) {
    e.preventDefault();
  }

  return (
    <form className="patient-search-form" onSubmit={handleSubmit}>
      <label>
        診察日
        <input type="date" value={date} required onChange={(e) => onDateChange(e.target.value)} />
      </label>
      <label>
        診療科
        <select
          value={filters.departmentCode}
          onChange={(e) => onChange({ ...filters, departmentCode: e.target.value })}
        >
          <option value="">すべて</option>
          {departmentOptions.map((option) => (
            <option key={option.code} value={option.code}>
              {option.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        担当医
        <select
          value={filters.practitionerId}
          onChange={(e) => onChange({ ...filters, practitionerId: e.target.value })}
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
        診察室
        <select
          value={filters.locationId}
          onChange={(e) => onChange({ ...filters, locationId: e.target.value })}
        >
          <option value="">すべて</option>
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        状態
        <select
          value={filters.status}
          onChange={(e) => onChange({ ...filters, status: e.target.value })}
        >
          <option value="">すべて</option>
          {STATUS_OPTIONS.map((option) => (
            <option key={option.code} value={option.code}>
              {option.label}
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

function OutpatientTableRow({
  row,
  pending,
  onChangeStatus,
  onCancel,
}: {
  row: OutpatientRow;
  pending: boolean;
  onChangeStatus: (status: fhir4.Appointment["status"]) => void;
  onCancel: () => void;
}) {
  const { appointment, patient } = row;
  const patientId = patient?.id ?? appointmentActorId(appointment, "Patient");
  const patientName = patient
    ? displayName(patient)
    : appointmentActorDisplay(appointment, "Patient");
  const checkedIn = appointment.status === "checked-in";

  return (
    <tr>
      <td className="outpatient__time">{appointmentTimeLabel(appointment)}</td>
      <td>{patient?.identifier?.[0]?.value ?? "-"}</td>
      <td>{patientName || "-"}</td>
      <td className="outpatient__schedule">{appointmentScheduleLabel(appointment)}</td>
      <td>{appointmentDepartmentLabel(appointment) || "-"}</td>
      <td>{appointmentActorDisplay(appointment, "Practitioner") || "-"}</td>
      <td>{appointmentActorDisplay(appointment, "Location") || "-"}</td>
      <td>
        <span className={`outpatient__status outpatient__status--${appointment.status}`}>
          {appointmentStatusLabel(appointment.status)}
        </span>
      </td>
      <td className="outpatient__actions">
        {canCheckInAppointment(appointment) && (
          <button type="button" disabled={pending} onClick={() => onChangeStatus("checked-in")}>
            受付
          </button>
        )}
        {patientId && (
          <Link className="button" to={`/patients/${patientId}/karte`}>
            カルテ
          </Link>
        )}
        {/* 受付取消・予約取消は押し間違えると受付が巻き戻るので、一段畳んで置く。
            一覧は横スクロールできるよう overflow を持つため、メニューは
            escapesClipping で領域の外に出す(でないと縁で切れる)。 */}
        {isActiveAppointment(appointment) && (
          <RowMenu label="この予約の操作" escapesClipping>
            {checkedIn && (
              <button
                type="button"
                className="row-menu__item"
                disabled={pending}
                onClick={() => onChangeStatus("booked")}
              >
                受付を取り消す
              </button>
            )}
            <button
              type="button"
              className="row-menu__item row-menu__item--danger"
              disabled={pending}
              onClick={onCancel}
            >
              予約を取り消す
            </button>
          </RowMenu>
        )}
      </td>
    </tr>
  );
}
