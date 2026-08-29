import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useCurrentPractitioner } from "../api/authQueries";
import { useNursingActLevels } from "../api/masterQueries";
import {
  useAcceptNursingOrders,
  useInpatientEncounters,
  useNursingWorklist,
  useRevokeNursingOrder,
  useSelfDepartments,
  useWardOptions,
  type NursingWorklistRow,
} from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { NursingOrderDetailModal } from "../components/NursingOrderDetailModal";
import { PatientKana } from "../components/PatientRowCells";
import { RowMenu } from "../components/RowMenu";
import { encounterBedLabel, encounterPatientId } from "../fhir/encounterHelpers";
import { displayJapaneseName } from "../fhir/humanName";
import {
  nursingOrderPeriodLabel,
  summarizeNursingOrder,
  type NursingOrderGroup,
} from "../fhir/nursingOrderHelpers";
import {
  nursingTaskOwnerName,
  nursingTaskStatus,
  nursingTaskStatusDisplay,
} from "../fhir/nursingTaskHelpers";
import { displayName } from "../fhir/patientHelpers";
import { locationDisplayName } from "../fhir/locationHelpers";
import { prescriptionRequester } from "../fhir/prescriptionHelpers";
import { today } from "../lib/dates";
import { useReturnLinkState } from "../returnTo";

// 病棟の指示簿(看護指示のワークリスト)。
//
// **他の部門一覧と依頼を受ける側が違う。** 検査・処置は部門が受けるので「その日に
// 実施予定のオーダー」を部門ごとに並べるが、看護指示を受けるのは病棟なので、
// 絞り込みの主軸が病棟になる。しかも病棟だけは **上流の ward 検索でサーバー側で絞る**
// (看護指示は退院まで status=active のまま残るので、全病院ぶんを引いてから捨てると
// 際限なく重くなる。api/queries.ts の fetchNursingWorklist を参照)。
//
// 軸はリハビリ一覧と同じで、基準日に効いている(始まっていて、まだ終わっていない)
// 指示を並べる。1 つの指示が入院中ずっと続き、看護師はそれを受けて実施していく。
//
// 行は **患者でまとめる**。病棟の作業単位が患者(ラウンドで 1 人ぶんの新しい指示を
// まとめて受ける)で、フラットに並べると同じ患者名が何行も続くため。
//
// 中止は置くが編集は置かない。指示の内容を変えるのは医師の操作で、カルテの右ペイン
// (NursingOrderPanels)が担当する。

type View = "pending" | "all";

interface Filters {
  departmentId: string;
  status: string;
}

const emptyFilters: Filters = { departmentId: "", status: "" };

/** 患者 1 人ぶん。指示は基準日に効いているものだけが入る。 */
interface PatientGroupData {
  patientId: string;
  patient?: fhir4.Patient;
  /** 「301号室」。表示は病室まで(ベッド番号は病棟の指示簿では使わない)。 */
  roomLabel: string;
  /** 「301号室 ベッド1」。並び順にだけ使う。 */
  bedLabel: string;
  rows: NursingWorklistRow[];
  pendingRows: NursingWorklistRow[];
}

export function NursingWorklistPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const wardId = searchParams.get("ward") ?? "";
  const date = searchParams.get("date") || today();
  const view: View = searchParams.get("view") === "all" ? "all" : "pending";

  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // 開いている対象は行そのものではなく id で覚え、読み直しのたびに引き直す。
  const [detailId, setDetailId] = useState<string | null>(null);

  // 列が多いのでこの画面だけ幅を広げる(他のワークリストと同じ)。
  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  const wardOptions = useWardOptions();
  const worklist = useNursingWorklist(date, wardId || undefined);
  // 病室・ベッドは入院患者一覧と同じキャッシュに乗る(行き来しても引き直さない)。
  const inpatients = useInpatientEncounters(date);
  const departments = useSelfDepartments();
  const levels = useNursingActLevels();
  const me = useCurrentPractitioner();
  const accept = useAcceptNursingOrders();
  const revoke = useRevokeNursingOrder();
  const returnLinkState = useReturnLinkState();

  function setParams(next: Record<string, string>, replace = false) {
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    setSearchParams(params, { replace });
  }

  // 病棟が未指定なら先頭の病棟を開く。履歴を汚さないよう replace で書く。
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

  // 病棟や日付が変わると行がまるごと入れ替わる。前の病棟の id を選んだまま
  // 「選択した N 件を指示受け」を押せてしまうので、選択を捨てる。
  useEffect(() => setSelected(new Set()), [wardId, date]);

  const allRows = useMemo(() => worklist.data?.rows ?? [], [worklist.data]);
  const rows = useMemo(
    () => allRows.filter((row) => matchesFilters(row, filters)),
    [allRows, filters],
  );

  // 患者 id -> 病室・ベッド。入院を引けた患者だけ。
  const bedByPatientId = useMemo(() => {
    const map = new Map<string, string>();
    for (const encounter of inpatients.data?.encounters ?? []) {
      const patientId = encounterPatientId(encounter);
      if (patientId && !map.has(patientId)) map.set(patientId, encounterBedLabel(encounter));
    }
    return map;
  }, [inpatients.data]);

  // 患者ごとにまとめる。並びは病室・ベッド順(引けなければ患者番号順のまま末尾へ)。
  const groups = useMemo<PatientGroupData[]>(() => {
    const byPatient = new Map<string, PatientGroupData>();
    for (const row of rows) {
      const patientId = row.order.subject?.reference?.split("/").pop() ?? "";
      let group = byPatient.get(patientId);
      if (!group) {
        group = {
          patientId,
          patient: row.patient,
          bedLabel: bedByPatientId.get(patientId) ?? "",
          roomLabel: roomOf(bedByPatientId.get(patientId) ?? ""),
          rows: [],
          pendingRows: [],
        };
        byPatient.set(patientId, group);
      }
      group.rows.push(row);
      if (isPending(row)) group.pendingRows.push(row);
    }

    const list = [...byPatient.values()];
    list.sort((a, b) => {
      if (a.bedLabel && b.bedLabel) return a.bedLabel.localeCompare(b.bedLabel, "ja");
      return a.bedLabel ? -1 : b.bedLabel ? 1 : 0;
    });
    // 未指示受けビューは、受け終わった患者を出さない。
    return view === "pending" ? list.filter((g) => g.pendingRows.length > 0) : list;
  }, [rows, bedByPatientId, view]);

  // 表に出す行(ビューで絞ったあと)。指示受けの対象もここから数える。
  const visibleRows = useMemo(
    () => groups.flatMap((group) => (view === "pending" ? group.pendingRows : group.rows)),
    [groups, view],
  );
  const pendingRows = useMemo(() => rows.filter(isPending), [rows]);
  const selectedRows = visibleRows.filter(
    (row) => isPending(row) && selected.has(row.order.id ?? ""),
  );

  const detailRow = allRows.find((row) => row.order.id === detailId) ?? null;
  const ownerName = me.practitioner ? displayJapaneseName(me.practitioner.name) : "";
  const canAccept = Boolean(me.practitionerId);

  const groupName = (group: NursingOrderGroup): string => {
    if (group.kind === "observation") return "観察";
    if (group.kind === "free") return "その他";
    const l1 = levels.data?.levels.find((l) => l.code === group.level1Code);
    return l1?.name ?? group.level1Code;
  };

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** 患者ぶんをまとめて選ぶ・外す。 */
  function togglePatient(patientRows: NursingWorklistRow[], checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const row of patientRows) {
        const id = row.order.id ?? "";
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  function handleAccept(target: NursingWorklistRow[]) {
    if (!me.practitionerId || target.length === 0) return;
    accept.mutate(
      {
        rows: target.map((row) => ({ order: row.order, task: row.task })),
        owner: { practitionerId: me.practitionerId, display: ownerName },
      },
      { onSuccess: () => setSelected(new Set()) },
    );
  }

  function handleRevoke(row: NursingWorklistRow) {
    const label = summarizeNursingOrder(row.order).text;
    if (!window.confirm(`「${label}」を中止します。よろしいですか？`)) return;
    revoke.mutate({ order: row.order, task: row.task });
  }

  function handleDateChange(value: string) {
    // 日付を空にはさせない(空で検索すると全期間になってしまう)。
    if (!value) return;
    setParams({ date: value });
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>指示簿</h1>
        {/* 病棟の患者そのもの(ベッドの埋まり具合・担当看護師)を見たいときの戻り先。
            見ている病棟と基準日をそのまま渡す。 */}
        <Link className="button" to={`/inpatients?ward=${wardId}&date=${date}`}>
          入院患者一覧
        </Link>
      </div>

      {/* 2 つのビューは絞り込みではなく見る軸の切り替えなのでタブに出す
          (リハビリ一覧の依頼/予約と同じ)。 */}
      <div className="order-select__tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={view === "pending"}
          className={view === "pending" ? "order-select__tab is-active" : "order-select__tab"}
          onClick={() => setParams({ view: "" })}
        >
          未指示受け{pendingRows.length > 0 && ` (${pendingRows.length})`}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "all"}
          className={view === "all" ? "order-select__tab is-active" : "order-select__tab"}
          onClick={() => setParams({ view: "all" })}
        >
          全指示
        </button>
      </div>

      <FilterForm
        date={date}
        wardId={wardId}
        filters={filters}
        wards={wardOptions.wards}
        departments={departments.departments}
        onDateChange={handleDateChange}
        onWardChange={(value) => setParams({ ward: value })}
        onChange={setFilters}
      />

      <ErrorBanner error={worklist.error} />
      <ErrorBanner error={wardOptions.error} />
      <ErrorBanner error={departments.error} />
      <ErrorBanner error={accept.error} />
      <ErrorBanner error={revoke.error} />

      {worklist.data?.truncated && (
        <p className="error-banner__line error-banner__line--error" role="status">
          この病棟の指示が多いため、一部のみ表示しています。
        </p>
      )}

      {!wardId ? (
        <p className="patient-table__empty">病棟を選んでください。</p>
      ) : worklist.isLoading ? (
        <p>読み込み中...</p>
      ) : (
        <>
          {pendingRows.length > 0 && (
            <div className="nursing-tab__accept">
              <span>指示受け待ち {pendingRows.length} 件</span>
              <button
                type="button"
                disabled={!canAccept || accept.isPending || selectedRows.length === 0}
                onClick={() => handleAccept(selectedRows)}
                title={canAccept ? undefined : "医療従事者に紐づくアカウントでログインしてください"}
              >
                選択した {selectedRows.length} 件を指示受け
              </button>
              <button
                type="button"
                disabled={!canAccept || accept.isPending}
                onClick={() => handleAccept(pendingRows)}
              >
                すべて指示受け
              </button>
            </div>
          )}

          <div className="lab-worklist-wrap sticky-table-wrap">
            <table className="lab-worklist sticky-table">
              <thead>
                <tr>
                  <th className="nursing-worklist__check"></th>
                  <th className="lab-worklist__compact">区分</th>
                  <th>指示内容</th>
                  <th className="lab-worklist__compact">頻度・条件</th>
                  <th className="lab-worklist__compact">期間</th>
                  <th className="lab-worklist__compact">指示医</th>
                  <th className="lab-worklist__compact">指示受け</th>
                  <th className="lab-worklist__actions sticky-table__fix-actions"></th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <PatientGroup
                    key={group.patientId}
                    group={group}
                    view={view}
                    date={date}
                    groupName={groupName}
                    selected={selected}
                    pending={accept.isPending || revoke.isPending}
                    returnLinkState={returnLinkState}
                    onToggle={toggle}
                    onTogglePatient={togglePatient}
                    onView={setDetailId}
                    onRevoke={handleRevoke}
                  />
                ))}
                {groups.length === 0 && (
                  <tr>
                    <td colSpan={8} className="master-search__empty">
                      {allRows.length === 0
                        ? "この日に効いている看護指示はありません。"
                        : view === "pending"
                          ? "指示受け待ちの指示はありません。"
                          : "絞り込みに一致する指示がありません。"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <p className="order-select__muted lab-worklist__count">
            {groups.length} 人 / {visibleRows.length} 件
          </p>
        </>
      )}

      {detailRow && (
        <NursingOrderDetailModal
          order={detailRow.order}
          task={detailRow.task}
          at={date}
          patientName={detailRow.patient ? displayName(detailRow.patient) : undefined}
          onClose={() => setDetailId(null)}
        />
      )}
    </div>
  );
}

/**
 * 「301号室 ベッド1」から病室だけを取り出す。指示簿は患者を探す画面なので、
 * ベッド番号まで出すと病室が読み取りにくくなる(並び順にはベッドまで使う)。
 */
function roomOf(bedLabel: string): string {
  return bedLabel.split(" ")[0] ?? "";
}

/** 未指示受けか(有効な指示で、まだ誰も受けていない)。 */
function isPending(row: NursingWorklistRow): boolean {
  return row.order.status === "active" && nursingTaskStatus(row.task) === "requested";
}

function matchesFilters(row: NursingWorklistRow, filters: Filters): boolean {
  if (filters.departmentId) {
    const requester = prescriptionRequester(row.order);
    if (requester.departmentId !== filters.departmentId) return false;
  }
  if (filters.status && nursingTaskStatus(row.task) !== filters.status) return false;
  return true;
}

interface FilterFormProps {
  date: string;
  wardId: string;
  filters: Filters;
  wards: fhir4.Location[];
  departments: fhir4.Organization[];
  onDateChange: (value: string) => void;
  onWardChange: (value: string) => void;
  onChange: (filters: Filters) => void;
}

function FilterForm({
  date,
  wardId,
  filters,
  wards,
  departments,
  onDateChange,
  onWardChange,
  onChange,
}: FilterFormProps) {
  function handleSubmit(e: FormEvent) {
    // 選んだ瞬間に効くので、Enter では何もしない。
    e.preventDefault();
  }

  return (
    <form className="patient-search-form" onSubmit={handleSubmit}>
      <label>
        基準日
        <input
          type="date"
          value={date}
          onChange={(e) => onDateChange(e.target.value)}
          required
        />
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
        指示受け
        <select
          value={filters.status}
          onChange={(e) => onChange({ ...filters, status: e.target.value })}
        >
          <option value="">すべて</option>
          <option value="requested">指示受け待ち</option>
          <option value="accepted">指示受け済</option>
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

interface PatientGroupProps {
  group: PatientGroupData;
  view: View;
  date: string;
  groupName: (group: NursingOrderGroup) => string;
  selected: Set<string>;
  pending: boolean;
  returnLinkState: ReturnType<typeof useReturnLinkState>;
  onToggle: (id: string) => void;
  onTogglePatient: (rows: NursingWorklistRow[], checked: boolean) => void;
  onView: (srId: string) => void;
  onRevoke: (row: NursingWorklistRow) => void;
}

// 患者 1 人ぶん。見出し行に病室・氏名・未指示受け件数と「この患者を指示受け」を置く。
function PatientGroup({
  group,
  view,
  date,
  groupName,
  selected,
  pending,
  returnLinkState,
  onToggle,
  onTogglePatient,
  onView,
  onRevoke,
}: PatientGroupProps) {
  const rows = view === "pending" ? group.pendingRows : group.rows;
  const checkedCount = group.pendingRows.filter((row) =>
    selected.has(row.order.id ?? ""),
  ).length;
  const allChecked = group.pendingRows.length > 0 && checkedCount === group.pendingRows.length;
  const someChecked = checkedCount > 0;

  return (
    <>
      <tr className="nursing-worklist__patient">
        {/* 患者ぶんをまとめて選ぶチェック。指示行のチェックと縦に揃える。 */}
        <th className="nursing-worklist__check">
          {group.pendingRows.length > 0 && (
            <input
              type="checkbox"
              checked={allChecked}
              // 一部だけ選んでいるときは「この患者の一部」を表す中間状態にする。
              ref={(el) => {
                if (el) el.indeterminate = !allChecked && someChecked;
              }}
              onChange={() => onTogglePatient(group.pendingRows, !allChecked)}
              aria-label={`${group.patient ? displayName(group.patient) : "この患者"} の指示をまとめて選ぶ`}
            />
          )}
        </th>
        <th colSpan={7}>
          <span className="nursing-worklist__room">{group.roomLabel || "-"}</span>
          {group.patient ? (
            <>
              {/* カルテの指示簿タブを直接開く。 */}
              <Link
                className="nursing-worklist__name"
                to={`/patients/${group.patient.id}/karte?tab=nursing`}
                state={returnLinkState}
              >
                {displayName(group.patient)}
              </Link>
              <PatientKana patient={group.patient} />
            </>
          ) : (
            <span className="nursing-worklist__name">{group.patientId || "-"}</span>
          )}
          {group.pendingRows.length > 0 && (
            <span className="nursing-worklist__pending">
              未指示受け {group.pendingRows.length} 件
            </span>
          )}
        </th>
      </tr>
      {rows.map((row) => (
        <OrderRow
          key={row.order.id}
          row={row}
          date={date}
          groupName={groupName}
          checked={selected.has(row.order.id ?? "")}
          pending={pending}
          onToggle={() => onToggle(row.order.id ?? "")}
          onView={() => onView(row.order.id ?? "")}
          onRevoke={() => onRevoke(row)}
        />
      ))}
    </>
  );
}

function OrderRow({
  row,
  date,
  groupName,
  checked,
  pending,
  onToggle,
  onView,
  onRevoke,
}: {
  row: NursingWorklistRow;
  date: string;
  groupName: (group: NursingOrderGroup) => string;
  checked: boolean;
  pending: boolean;
  onToggle: () => void;
  onView: () => void;
  onRevoke: () => void;
}) {
  const summary = summarizeNursingOrder(row.order);
  const taskStatus = nursingTaskStatus(row.task);
  const acceptable = isPending(row);

  return (
    <tr>
      <td className="nursing-worklist__check">
        {acceptable && (
          <input
            type="checkbox"
            checked={checked}
            onChange={onToggle}
            aria-label="指示受けの対象にする"
          />
        )}
      </td>
      <td className="lab-worklist__compact">{groupName(summary.group)}</td>
      <td>
        {summary.text}
        {summary.comment && <div className="nursing-tab__comment">{summary.comment}</div>}
      </td>
      <td className="lab-worklist__compact">{summary.frequency}</td>
      <td className="lab-worklist__compact nursing-tab__period">
        {nursingOrderPeriodLabel(summary, date)}
      </td>
      <td className="lab-worklist__compact">{summary.requesterName}</td>
      <td className="lab-worklist__compact">
        <span
          className={`lab-worklist__status lab-worklist__status--${taskStatus}`}
          // 受けた人は詳細で見る。列幅を取らないよう吹き出しに留める。
          title={nursingTaskOwnerName(row.task) || undefined}
        >
          {nursingTaskStatusDisplay(taskStatus)}
        </span>
      </td>
      <td className="lab-worklist__actions sticky-table__fix-actions">
        <button type="button" onClick={onView}>
          表示
        </button>
        {/* 中止は押し間違えると指示が消えるので一段畳む。内容の編集はカルテの右ペイン。 */}
        {row.order.status === "active" && (
          <RowMenu label={`${summary.text} の操作`} escapesClipping>
            <button
              type="button"
              className="row-menu__item row-menu__item--danger"
              disabled={pending}
              onClick={onRevoke}
            >
              中止
            </button>
          </RowMenu>
        )}
      </td>
    </tr>
  );
}
