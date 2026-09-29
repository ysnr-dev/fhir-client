import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useReturnLinkState } from "../returnTo";
import type { PatientCaution } from "../api/masterClient";
import { usePatientCautions } from "../api/masterQueries";
import { useCurrentPractitioner } from "../api/authQueries";
import {
  useCancelAppointment,
  useSelfDepartments,
  useLocationOptions,
  OUTPATIENT_POLLING_INTERVAL,
  useAllergiesForPatients,
  useFlagsForPatients,
  useInfectionsForPatients,
  useOutpatientList,
  useOutpatientOrders,
  usePractitionerOptions,
  usePractitionerRoles,
  useStartOutpatientExam,
  useUpdateAppointmentStatus,
  useUpdateOutpatientExam,
  type OutpatientRow,
} from "../api/queries";
import { type OutpatientOrderSummary } from "../fhir/outpatientOrderProgressHelpers";
import { DateStepper } from "../components/DateStepper";
import { ErrorBanner } from "../components/ErrorBanner";
import { BillingSendModal, type BillingSendTarget } from "../components/BillingSendModal";
import { useReceiptStatus, useSettledReceptions } from "../api/receiptQueries";
import { patientNumberOf } from "../fhir/patientHelpers";
import { receptionCoverageSetKey } from "../fhir/coverageHelpers";
import {
  PatientKana,
  PatientProfileCells,
  PatientProfileHeadCells,
} from "../components/PatientRowCells";
import { NewPatientCheckInModal } from "../components/NewPatientCheckInModal";
import { ORDER_LEGEND, OrderSummaryChips, RowPictograms } from "../components/PatientListRowParts";
import { OutpatientReceptionModal } from "../components/OutpatientReceptionModal";
import { RowMenu } from "../components/RowMenu";
import { WalkInCheckInModal } from "../components/WalkInCheckInModal";
import { useNow } from "../hooks/useNow";
import { useStoredToggle } from "../hooks/useStoredToggle";
import {
  appointmentActorDisplay,
  appointmentActorId,
  appointmentDateTimeLabel,
  appointmentDepartmentCode,
  appointmentDepartmentLabel,
  appointmentBookedTimeLabel,
  appointmentCheckedInAt,
  appointmentCheckedInTimeLabel,
  appointmentVisitKind,
  appointmentScheduleLabel,
  canCheckInAppointment,
  isActiveAppointment,
  visitKindLabel,
} from "../fhir/appointmentHelpers";
import {
  OUTPATIENT_STATUS_OPTIONS,
  buildExamFinishCancelledEncounter,
  buildExamStartCancelledEncounter,
  buildFinishedOutpatientEncounter,
  buildOutpatientEncounter,
  canStartExam,
  isExamFinished,
  isExamInProgress,
  outpatientStatusCode,
  outpatientStatusCounts,
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

// 診察日と絞り込みは URL に持つ。カルテの「戻る」は遷移元の検索文字列ごと戻すので、
// こうしておくと開く前の日付・絞り込みのまま一覧に戻れる。
const DATE_PARAM = "date";
const FILTER_PARAMS: Record<keyof Filters, string> = {
  departmentCode: "department",
  practitionerId: "practitioner",
  locationId: "location",
  status: "status",
};

// 自動更新の入り切り。端末ごとの設定で、既定は切ってある(上流は検索のたびに
// 監査ログを 1 行書くので、常に見張りたい端末でだけ入れる。通知のベルと同じ考え方)。
const POLLING_STORAGE_KEY = "fhir-client.outpatients.polling";

export function OutpatientListPage() {
  const navigate = useNavigate();
  // 診察を始めたら続けてカルテを開く。カルテの「戻る」でこの一覧に戻れるよう、
  // 行の「カルテ」リンクと同じ遷移元を渡す。
  const returnLinkState = useReturnLinkState();
  const [searchParams, setSearchParams] = useSearchParams();
  // 診察日は必須。未選択にはできないので当日から始める。
  const date = searchParams.get(DATE_PARAM) || today();
  const filters = useMemo<Filters>(
    () => ({
      departmentCode: searchParams.get(FILTER_PARAMS.departmentCode) ?? "",
      practitionerId: searchParams.get(FILTER_PARAMS.practitionerId) ?? "",
      locationId: searchParams.get(FILTER_PARAMS.locationId) ?? "",
      status: searchParams.get(FILTER_PARAMS.status) ?? "",
    }),
    [searchParams],
  );
  const [polling, setPolling] = useStoredToggle(POLLING_STORAGE_KEY);
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [newPatientOpen, setNewPatientOpen] = useState(false);
  // 受付内容(診療科・担当医・診察室)を変える行。
  const [receptionTarget, setReceptionTarget] = useState<OutpatientRow | null>(null);

  // 列が多く、既定の幅では患者名や予約枠まで折り返すので、この画面だけ幅を広げる
  // (放射線検査一覧と同じやり方)。
  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  const list = useOutpatientList(date, { polling });
  const departments = useSelfDepartments();
  const practitioners = usePractitionerOptions();
  const locations = useLocationOptions();
  const updateStatus = useUpdateAppointmentStatus();
  const cancel = useCancelAppointment();
  const startExam = useStartOutpatientExam();
  const updateExam = useUpdateOutpatientExam();
  // 会計送信はレセコン連携が有効なときだけ。無効なら行メニューに項目ごと出さない。
  const receiptStatus = useReceiptStatus();
  // その日に会計が済んだ受診。レセコン連携が有効なときだけ問い合わせ、行に印を付ける。
  const settledReceptions = useSettledReceptions(date, {
    enabled: receiptStatus.data?.enabled === true,
    refetchInterval: polling ? OUTPATIENT_POLLING_INTERVAL : false,
  });
  const settledNumbers = useMemo(
    () => new Set((settledReceptions.data?.settled ?? []).map((s) => s.patient_number)),
    [settledReceptions.data],
  );
  const [billingTarget, setBillingTarget] = useState<BillingSendTarget | null>(null);

  // 日付・絞り込みの一部だけ変えるときも他を残す。
  function setParams(next: Record<string, string>, replace = false) {
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    // 日付は常に URL に残す。検索文字列が空のとき(メニューから開き直したとき)
    // だけ、下の医師の初期絞り込みを掛けるため。
    if (!params.get(DATE_PARAM)) params.set(DATE_PARAM, date);
    setSearchParams(params, { replace });
  }

  function setFilters(next: Filters) {
    setParams(
      Object.fromEntries(
        (Object.keys(FILTER_PARAMS) as (keyof Filters)[]).map((key) => [
          FILTER_PARAMS[key],
          next[key],
        ]),
      ),
    );
  }

  // ログイン中の医師には自分の予約から見せる(受付や代行入力の職種はすべての予約)。
  // 掛けるのは検索文字列の無い状態で開いたときだけ。カルテから戻ったときなど、
  // 検索文字列があるときはそちらの絞り込み(「すべて」に戻したことも含む)を守る。
  const { practitionerId } = useCurrentPractitioner();
  const roles = usePractitionerRoles(practitionerId ?? undefined);
  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current) return;
    if (searchParams.toString()) {
      initialized.current = true;
      return;
    }
    if (!practitionerId || roles.isPending) return;
    initialized.current = true;
    const roleCode = roles.role ? parsePractitionerRole(roles.role).roleCode : undefined;
    setParams(
      isDoctorRoleCode(roleCode) ? { [FILTER_PARAMS.practitionerId]: practitionerId } : {},
      true,
    );
    // setParams は searchParams に依存するが、初回に一度だけ動けばよい。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [practitionerId, roles.isPending, roles.role, searchParams]);

  const rows = useMemo(
    () => (list.data?.rows ?? []).filter((row) => matchesFilters(row, filters)),
    [list.data, filters],
  );
  const total = list.data?.rows.length ?? 0;

  // 状態ごとの件数。状態以外の絞り込み(診療科・担当医・診察室)だけを掛けて数える
  // (状態で絞っても、他の状態が何件あるかは見えるようにする)。
  const statusCounts = useMemo(
    () =>
      outpatientStatusCounts(
        (list.data?.rows ?? []).filter((row) => matchesFilters(row, { ...filters, status: "" })),
      ),
    [list.data, filters],
  );

  // 行の患者ぶんの注意(ピクトグラム)と当日オーダー。絞り込みで隠れた行のぶんも
  // 引いておく(絞り込みを切り替えるたびに引き直さないように)。
  const patientIds = useMemo(
    () =>
      (list.data?.rows ?? [])
        .map((row) => row.patient?.id ?? appointmentActorId(row.appointment, "Patient"))
        .filter((id): id is string => Boolean(id)),
    [list.data],
  );
  const cautions = usePatientCautions();
  const cautionsByCode = useMemo(
    () => new Map<string, PatientCaution>((cautions.data?.items ?? []).map((c) => [c.code, c])),
    [cautions.data],
  );
  const flags = useFlagsForPatients(patientIds);
  const allergies = useAllergiesForPatients(patientIds);
  const infections = useInfectionsForPatients(patientIds);
  const orders = useOutpatientOrders(date, patientIds, { polling });

  // 待ち時間は当日の一覧だけで数える(過去の日は受付のまま残っていても待っていない)。
  const isToday = date === today();
  const now = useNow(isToday);

  // 会計はレセコン側で 診療日 + 患者 + 診療科 の単位で持つので、Encounter ではなく
  // 一覧の日付をそのまま診療日として渡す。
  function openBillingSend(row: OutpatientRow) {
    const patientId = row.patient?.id ?? appointmentActorId(row.appointment, "Patient");
    if (!patientId) return;
    setBillingTarget({
      patientId,
      patientName: row.patient
        ? displayName(row.patient)
        : appointmentActorDisplay(row.appointment, "Patient"),
      performDate: date,
      departmentCode: appointmentDepartmentCode(row.appointment) || undefined,
      practitionerId: appointmentActorId(row.appointment, "Practitioner") || undefined,
      coverageSetKey: receptionCoverageSetKey(row.appointment) || undefined,
    });
  }

  function handleDateChange(value: string) {
    // 日付を空にはさせない(空で検索すると全期間になってしまう)。
    if (value) setParams({ [DATE_PARAM]: value });
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
          <label className="outpatient__polling" title="一覧を 1 分ごとに読み直します">
            <input
              type="checkbox"
              checked={polling}
              onChange={(event) => setPolling(event.target.checked)}
            />
            自動更新
          </label>
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
          <p className="outpatient__summary">
            {statusCounts.map((status) => (
              <span key={status.code} className="outpatient__summary-item">
                {status.label} <strong>{status.count}</strong>
              </span>
            ))}
          </p>
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
                  <th>初再診</th>
                  <th className="outpatient__schedule">予約枠</th>
                  <th>診療科</th>
                  <th>担当医</th>
                  <th>診察室</th>
                  <th>状態</th>
                  <th title={ORDER_LEGEND}>当日オーダー</th>
                  <th className="outpatient__actions sticky-table__fix-actions"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <OutpatientTableRow
                    key={row.appointment.id}
                    row={row}
                    settled={
                      !!row.patient && settledNumbers.has(normalizePatientNumber(patientNumberOf(row.patient)))
                    }
                    waitingMinutes={isToday ? waitingMinutes(row, now) : undefined}
                    pictograms={
                      <RowPictograms
                        patientId={row.patient?.id ?? appointmentActorId(row.appointment, "Patient")}
                        flags={flags.byPatient}
                        allergies={allergies.byPatient}
                        infections={infections.byPatient}
                        cautionsByCode={cautionsByCode}
                      />
                    }
                    orders={
                      orders.byPatient.get(
                        row.patient?.id ?? appointmentActorId(row.appointment, "Patient"),
                      ) ?? []
                    }
                    pending={
                      updateStatus.isPending ||
                      cancel.isPending ||
                      startExam.isPending ||
                      updateExam.isPending
                    }
                    canMarkNoShow={date <= today()}
                    onChangeStatus={(status) =>
                      updateStatus.mutate({ appointment: row.appointment, status })
                    }
                    onStartExam={() => handleStartExam(row)}
                    onFinishExam={() => handleFinishExam(row)}
                    onCancelExamStart={() => handleCancelExamStart(row)}
                    onCancelExamFinish={() => handleCancelExamFinish(row)}
                    onSendBilling={
                      receiptStatus.data?.enabled ? () => openBillingSend(row) : undefined
                    }
                    onCancel={() => handleCancel(row.appointment)}
                    onEditReception={() => setReceptionTarget(row)}
                  />
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={14} className="master-search__empty">
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

      {receptionTarget && (
        <OutpatientReceptionModal
          row={receptionTarget}
          onClose={() => setReceptionTarget(null)}
        />
      )}
      {billingTarget && (
        <BillingSendModal target={billingTarget} onClose={() => setBillingTarget(null)} />
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
        <DateStepper value={date} onChange={onDateChange} />
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
          {OUTPATIENT_STATUS_OPTIONS.map((option) => (
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

/** 受付から診察開始までの待ち時間(分)。受付済で診察が始まっていない行だけ。 */
function waitingMinutes(row: OutpatientRow, now: Date): number | undefined {
  if (row.appointment.status !== "checked-in" || row.encounter) return undefined;
  const checkedInAt = new Date(appointmentCheckedInAt(row.appointment)).getTime();
  if (Number.isNaN(checkedInAt)) return undefined;
  return Math.max(0, Math.floor((now.getTime() - checkedInAt) / 60_000));
}

/** レセコンの患者番号との突き合わせ用。数字だけの番号はゼロ埋めを外す。 */
function normalizePatientNumber(number: string | undefined): string {
  const text = number ?? "";
  return /^\d+$/.test(text) ? text.replace(/^0+(?=\d)/, "") : text;
}

function OutpatientTableRow({
  row,
  settled,
  waitingMinutes,
  pictograms,
  orders,
  pending,
  canMarkNoShow,
  onChangeStatus,
  onStartExam,
  onFinishExam,
  onCancelExamStart,
  onCancelExamFinish,
  onSendBilling,
  onCancel,
  onEditReception,
}: {
  row: OutpatientRow;
  /** レセコンで会計が済んでいる。 */
  settled: boolean;
  /** 受付からの待ち時間(分)。待っていない行・当日でない一覧は undefined。 */
  waitingMinutes?: number;
  pictograms: ReactNode;
  orders: OutpatientOrderSummary[];
  pending: boolean;
  /** 未来院にできる日か(診察日が今日以前)。先の日付の予約はまだ来ないだけなので付けない。 */
  canMarkNoShow: boolean;
  onChangeStatus: (status: fhir4.Appointment["status"]) => void;
  onStartExam: () => void;
  onFinishExam: () => void;
  onCancelExamStart: () => void;
  onCancelExamFinish: () => void;
  /** レセコン連携が無効なら undefined。メニューに項目ごと出さない。 */
  onSendBilling?: () => void;
  onCancel: () => void;
  onEditReception: () => void;
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
        {waitingMinutes !== undefined && (
          <span className="outpatient__wait" title={`受付から ${waitingMinutes} 分`}>
            {waitingMinutes}分
          </span>
        )}
      </td>
      <td className="sticky-table__fix-3">{patient?.identifier?.[0]?.value ?? "-"}</td>
      <td className="sticky-table__fix-4">
        {/* カナは列を分けず、氏名の後ろに小さめの括弧書きで添える(入院患者一覧と同じ)。
            列は固定幅なので、あふれたら氏名・カナの側を省略してピクトグラムは必ず残す。 */}
        <span className="outpatient__name-cell">
          <span className="outpatient__name">
            {patientName || "-"}
            <PatientKana patient={patient} />
          </span>
          {pictograms}
        </span>
      </td>
      <PatientProfileCells patient={patient} />
      <td>{visitKindLabel(appointmentVisitKind(appointment)) || "-"}</td>
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
        {settled && <span className="outpatient__settled">会計済</span>}
      </td>
      <td className="outpatient__orders-cell">
        <OrderSummaryChips orders={orders} />
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
        {/* 診察が終わったら次にやることは会計送信なので、同じ位置に出す。 */}
        {examFinished && onSendBilling && (
          <button type="button" disabled={pending} onClick={onSendBilling}>
            医事送信
          </button>
        )}
        {patientId && (
          <Link className="button" to={`/patients/${patientId}/karte`} state={returnLinkState}>
            カルテ
          </Link>
        )}
        {/* 受付内容の編集と、受付取消・診察の取消・予約取消。取消は押し間違えると進捗が
            巻き戻るので、一段畳んで置く。一覧は横スクロールできるよう overflow を
            持つため、メニューは escapesClipping で領域の外に出す(でないと縁で切れる)。 */}
        <RowMenu label="この予約の操作" escapesClipping>
          {/* 診療科・担当医・診察室の編集。枠から引き継いだあとでも、当日に担当医が
              替わる・別の診察室に回すことがあるので、受付の前後を問わず編集できる。 */}
          <button
            type="button"
            className="row-menu__item"
            disabled={pending}
            onClick={onEditReception}
          >
            編集
          </button>
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
          {/* 来なかった予約。取消と違って予約の記録は残し、枠も触らない。遅れて来たときは
              取り消して予約済に戻してから受付する。 */}
          {canMarkNoShow && canCheckInAppointment(appointment) && (
            <button
              type="button"
              className="row-menu__item"
              disabled={pending}
              onClick={() => onChangeStatus("noshow")}
            >
              未来院にする
            </button>
          )}
          {appointment.status === "noshow" && (
            <button
              type="button"
              className="row-menu__item"
              disabled={pending}
              onClick={() => onChangeStatus("booked")}
            >
              未来院を取り消す
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
          {/* 会計はレセコン側に置くので、カルテからは診療行為と病名を送るだけ。
              受付済み以降ならいつでも送れる(診察終了を待たなくてよい)。診察終了後は
              行に「医事送信」が出るので、メニューには重ねて出さない。 */}
          {onSendBilling && !examFinished && appointment.status !== "noshow" && (
            <button
              type="button"
              className="row-menu__item"
              disabled={pending}
              onClick={onSendBilling}
            >
              医事送信
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
      </td>
    </tr>
  );
}
