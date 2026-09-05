import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useReturnLinkState } from "../returnTo";
import { useCurrentPractitioner } from "../api/authQueries";
import {
  useCancelAppointment,
  useSelfDepartments,
  useLocationOptions,
  useOutpatientList,
  usePractitionerOptions,
  usePractitionerRoles,
  useStartOutpatientExam,
  useUpdateAppointmentStatus,
  useUpdateOutpatientExam,
  type OutpatientRow,
} from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import {
  PatientKana,
  PatientProfileCells,
  PatientProfileHeadCells,
} from "../components/PatientRowCells";
import { NewPatientCheckInModal } from "../components/NewPatientCheckInModal";
import { RowMenu } from "../components/RowMenu";
import { WalkInCheckInModal } from "../components/WalkInCheckInModal";
import {
  APPOINTMENT_STATUS_OPTIONS,
  appointmentActorDisplay,
  appointmentActorId,
  appointmentDateTimeLabel,
  appointmentDepartmentCode,
  appointmentDepartmentLabel,
  appointmentBookedTimeLabel,
  appointmentCheckedInTimeLabel,
  appointmentScheduleLabel,
  canCheckInAppointment,
  isActiveAppointment,
} from "../fhir/appointmentHelpers";
import {
  IN_EXAM_LABEL,
  IN_EXAM_STATUS,
  buildExamFinishCancelledEncounter,
  buildExamStartCancelledEncounter,
  buildFinishedOutpatientEncounter,
  buildOutpatientEncounter,
  canStartExam,
  isExamFinished,
  isExamInProgress,
  outpatientStatusCode,
  outpatientStatusLabel,
} from "../fhir/outpatientEncounterHelpers";
import { nowFhirDateTime } from "../lib/dates";
import { departmentCode, departmentDisplayName } from "../fhir/departmentHelpers";
import { displayName } from "../fhir/patientHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { isDoctorRoleCode, parsePractitionerRole } from "../fhir/practitionerRoleHelpers";
import { today } from "../fhir/scheduleHelpers";

// 外来患者一覧(受付ワークリスト)。診察日を決めて、その日の予約患者を受付する。
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

// 取消・誤登録は一覧に出さないので、絞り込みの選択肢にも出さない。「診察中」は
// Appointment.status に無い状態なので、受付済と診療済の間に差し込む。
const STATUS_OPTIONS: { code: string; label: string }[] = APPOINTMENT_STATUS_OPTIONS.filter(
  (option) => !["cancelled", "entered-in-error"].includes(option.code),
).flatMap((option) =>
  option.code === "checked-in"
    ? [
        { code: option.code, label: option.label },
        { code: IN_EXAM_STATUS, label: IN_EXAM_LABEL },
      ]
    : [{ code: option.code, label: option.label }],
);

export function OutpatientListPage() {
  const navigate = useNavigate();
  // 診察を始めたら続けてカルテを開く。カルテの「戻る」でこの一覧に戻れるよう、
  // 行の「カルテ」リンクと同じ遷移元を渡す。
  const returnLinkState = useReturnLinkState();
  // 診察日は必須。未選択にはできないので当日から始める。
  const [date, setDate] = useState(today);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [newPatientOpen, setNewPatientOpen] = useState(false);

  // 列が多く、既定の幅では患者名や予約枠まで折り返すので、この画面だけ幅を広げる
  // (放射線検査一覧と同じやり方)。
  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  const list = useOutpatientList(date);
  const departments = useSelfDepartments();
  const practitioners = usePractitionerOptions();
  const locations = useLocationOptions();
  const updateStatus = useUpdateAppointmentStatus();
  const cancel = useCancelAppointment();
  const startExam = useStartOutpatientExam();
  const updateExam = useUpdateOutpatientExam();

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

  // 診察開始・診察終了は受付ボタンと同じく 1 クリック(現在時刻をそのまま記録する)。
  // 巻き戻しになる取消だけ確認を挟む。
  function handleStartExam(row: OutpatientRow) {
    const patientId = row.patient?.id ?? appointmentActorId(row.appointment, "Patient");
    startExam.mutate(
      buildOutpatientEncounter(row.appointment, row.patient, nowFhirDateTime()),
      {
        // 診察を始めたら次にやることはカルテを書くことなので、そのまま開く。
        // 患者が辿れないときだけ一覧に留まる(開き先が決まらないため)。
        onSuccess: () => {
          if (patientId) {
            navigate(`/patients/${patientId}/karte`, { state: returnLinkState });
          }
        },
      },
    );
  }

  function handleFinishExam(row: OutpatientRow) {
    if (!row.encounter) return;
    updateExam.mutate({
      encounter: buildFinishedOutpatientEncounter(row.encounter, nowFhirDateTime()),
      appointment: row.appointment,
      appointmentStatus: "fulfilled",
    });
  }

  function handleCancelExamStart(row: OutpatientRow) {
    if (!row.encounter) return;
    if (!window.confirm("診察開始を取り消して受付済に戻します。よろしいですか?")) return;
    // 予約は受付済のままなので触らない。
    updateExam.mutate({ encounter: buildExamStartCancelledEncounter(row.encounter) });
  }

  function handleCancelExamFinish(row: OutpatientRow) {
    if (!row.encounter) return;
    if (!window.confirm("診察終了を取り消して診察中に戻します。よろしいですか?")) return;
    updateExam.mutate({
      encounter: buildExamFinishCancelledEncounter(row.encounter),
      appointment: row.appointment,
      appointmentStatus: "checked-in",
    });
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
        <h1>外来患者一覧</h1>
        <div>
          <button type="button" onClick={() => setWalkInOpen(true)}>
            当日受付
          </button>
          {/* 初診は患者登録から要るので、登録と受付をまとめて行う入口を隣に置く。 */}
          <button type="button" onClick={() => setNewPatientOpen(true)}>
            新患登録
          </button>
        </div>
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
      <ErrorBanner
        error={updateStatus.error ?? cancel.error ?? startExam.error ?? updateExam.error}
      />

      {list.data?.truncated && (
        <p className="error-banner__line error-banner__line--error" role="status">
          この日の予約が多いため、一部のみ表示しています。
        </p>
      )}

      {list.isLoading ? (
        <p>読み込み中...</p>
      ) : (
        <>
          <div className="outpatient-wrap sticky-table-wrap">
            <table className="outpatient sticky-table">
              <thead>
                <tr>
                  {/* 横に送っても「いつ・誰の予約か」は残す(左 4 列を固定する)。
                      予約時間(枠の時刻)と受付時間(実際に来て受付した時刻)は
                      別物なので列を分ける。 */}
                  <th className="outpatient__time sticky-table__fix-1">予約時間</th>
                  <th className="outpatient__time sticky-table__fix-2">受付時間</th>
                  <th className="sticky-table__fix-3">患者番号</th>
                  <th className="sticky-table__fix-4">患者氏名</th>
                  <PatientProfileHeadCells />
                  <th className="outpatient__schedule">予約枠</th>
                  <th>診療科</th>
                  <th>担当医</th>
                  <th>診察室</th>
                  <th>状態</th>
                  <th className="outpatient__actions sticky-table__fix-actions"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <OutpatientTableRow
                    key={row.appointment.id}
                    row={row}
                    pending={
                      updateStatus.isPending ||
                      cancel.isPending ||
                      startExam.isPending ||
                      updateExam.isPending
                    }
                    onChangeStatus={(status) =>
                      updateStatus.mutate({ appointment: row.appointment, status })
                    }
                    onStartExam={() => handleStartExam(row)}
                    onFinishExam={() => handleFinishExam(row)}
                    onCancelExamStart={() => handleCancelExamStart(row)}
                    onCancelExamFinish={() => handleCancelExamFinish(row)}
                    onCancel={() => handleCancel(row.appointment)}
                  />
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={12} className="master-search__empty">
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
      {newPatientOpen && <NewPatientCheckInModal onClose={() => setNewPatientOpen(false)} />}
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
  if (filters.status && outpatientStatusCode(appointment, row.encounter) !== filters.status) {
    return false;
  }
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
  onStartExam,
  onFinishExam,
  onCancelExamStart,
  onCancelExamFinish,
  onCancel,
}: {
  row: OutpatientRow;
  pending: boolean;
  onChangeStatus: (status: fhir4.Appointment["status"]) => void;
  onStartExam: () => void;
  onFinishExam: () => void;
  onCancelExamStart: () => void;
  onCancelExamFinish: () => void;
  onCancel: () => void;
}) {
  // カルテの「戻る」でこの一覧に戻れるように遷移元を渡す。
  const returnLinkState = useReturnLinkState();
  const { appointment, patient, encounter } = row;
  const patientId = patient?.id ?? appointmentActorId(appointment, "Patient");
  const patientName = patient
    ? displayName(patient)
    : appointmentActorDisplay(appointment, "Patient");
  const inExam = isExamInProgress(encounter);
  const examFinished = isExamFinished(encounter);
  // 受付の取消・予約の取消は、診察が始まる前に限る(始まってからの巻き戻しは
  // 診察開始の取消が先)。
  const checkedIn = appointment.status === "checked-in" && !encounter;

  return (
    <tr>
      <td className="outpatient__time sticky-table__fix-1">
        {appointmentBookedTimeLabel(appointment)}
      </td>
      <td className="outpatient__time sticky-table__fix-2">
        {appointmentCheckedInTimeLabel(appointment)}
      </td>
      <td className="sticky-table__fix-3">{patient?.identifier?.[0]?.value ?? "-"}</td>
      <td className="sticky-table__fix-4">
        {/* カナは列を分けず、氏名の後ろに小さめの括弧書きで添える(入院患者一覧と同じ)。 */}
        {patientName || "-"}
        <PatientKana patient={patient} />
      </td>
      <PatientProfileCells patient={patient} />
      <td className="outpatient__schedule">{appointmentScheduleLabel(appointment)}</td>
      <td>{appointmentDepartmentLabel(appointment) || "-"}</td>
      <td>{appointmentActorDisplay(appointment, "Practitioner") || "-"}</td>
      <td>{appointmentActorDisplay(appointment, "Location") || "-"}</td>
      <td>
        <span
          className={`outpatient__status outpatient__status--${outpatientStatusCode(appointment, encounter)}`}
        >
          {outpatientStatusLabel(appointment, encounter)}
        </span>
      </td>
      <td className="outpatient__actions sticky-table__fix-actions">
        {/* 受付 → 診察開始 → 診察終了 と、同じ位置でボタンが入れ替わる。 */}
        {canCheckInAppointment(appointment) && (
          <button type="button" disabled={pending} onClick={() => onChangeStatus("checked-in")}>
            受付
          </button>
        )}
        {canStartExam(appointment, encounter) && (
          <button type="button" disabled={pending} onClick={onStartExam}>
            診察開始
          </button>
        )}
        {inExam && (
          <button type="button" disabled={pending} onClick={onFinishExam}>
            診察終了
          </button>
        )}
        {patientId && (
          <Link className="button" to={`/patients/${patientId}/karte`} state={returnLinkState}>
            カルテ
          </Link>
        )}
        {/* 受付取消・診察の取消・予約取消は押し間違えると進捗が巻き戻るので、一段畳んで
            置く。一覧は横スクロールできるよう overflow を持つため、メニューは
            escapesClipping で領域の外に出す(でないと縁で切れる)。 */}
        {(isActiveAppointment(appointment) || examFinished) && (
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
            {inExam && (
              <button
                type="button"
                className="row-menu__item"
                disabled={pending}
                onClick={onCancelExamStart}
              >
                診察開始を取り消す
              </button>
            )}
            {examFinished && (
              <button
                type="button"
                className="row-menu__item"
                disabled={pending}
                onClick={onCancelExamFinish}
              >
                診察終了を取り消す
              </button>
            )}
            {/* 診察が始まった予約は取り消せない(先に診察開始を取り消す)。 */}
            {isActiveAppointment(appointment) && !encounter && (
              <button
                type="button"
                className="row-menu__item row-menu__item--danger"
                disabled={pending}
                onClick={onCancel}
              >
                予約を取り消す
              </button>
            )}
          </RowMenu>
        )}
      </td>
    </tr>
  );
}
