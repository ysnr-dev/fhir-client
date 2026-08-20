import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  useDepartmentList,
  useLabWorklist,
  useUpdateLabTaskStatus,
  type LabWorklistRow,
} from "../api/queries";
import { labLabelPdfUrl } from "../api/reportsClient";
import { ErrorBanner } from "../components/ErrorBanner";
import { LabOrderViewModal } from "../components/LabOrderViewModal";
import { LabResultEntryModal } from "../components/LabResultEntryModal";
import { RowMenu } from "../components/RowMenu";
import {
  groupBySpecimen,
  labOrderItems,
  summarizeLabOrder,
  type LabSpecimenGroup,
} from "../fhir/labOrderHelpers";
import {
  LAB_TASK_STATUS_OPTIONS,
  labTaskActions,
  labTaskStatus,
  labTaskStatusDisplay,
  type LabTaskStatus,
} from "../fhir/labTaskHelpers";
import { displayName } from "../fhir/patientHelpers";
import {
  SETTING_OPTIONS,
  orderContextSummary,
  prescriptionRequester,
} from "../fhir/prescriptionHelpers";

// 検体検査一覧(部門ワークリスト)。検査日を決めて、その日に検体を採る検査を並べる。
// 作りは放射線検査一覧(RadWorklistPage)に合わせてある。
//
// 1 行 = オーダー 1 件。1 行を 1 段に収めて件数を目で追えるよう、検査内容の列には
// 採る検体の名前だけを並べる。検査項目やラベルの番号は「表示」で開くモーダルに送る。
//
// 検体ラベル(採取管に貼るバーコード付きの PDF)の発行が受付を兼ねていて、
// 依頼済のオーダーは発行と同時に受付済へ進む(docs/lab-label-design.md)。
// 実施済へは検体到着確認画面のスキャン(全検体の到着)で進む。
// 管ごとの発行・到着と採取番号は「表示」のモーダル(LabOrderViewModal)で見せる
// (docs/lab-arrival-design.md §4-2)。
//
// 検査日だけが上流での絞り込みで、残りは読み込んだ 1 日ぶんから画面側で絞る
// (理由は queries.ts の useLabWorklist を参照)。

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

interface Filters {
  specimenCode: string;
  setting: string;
  departmentId: string;
  status: string;
}

const emptyFilters: Filters = {
  specimenCode: "",
  setting: "",
  departmentId: "",
  status: "",
};

export function LabWorklistPage() {
  // 検査日は必須。未選択にはできないので当日から始める。
  const [date, setDate] = useState(today);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  // 内容を開いているオーダー。行そのものではなく id で覚えておき、読み直しの
  // たびに引き直す(受付・ラベル発行の後に開いたままのモーダルも追い付く)。
  const [viewingId, setViewingId] = useState<string | null>(null);
  // 結果を入力しているオーダー。同じ理由で id で覚えておく。
  const [enteringId, setEnteringId] = useState<string | null>(null);

  // 検査内容の列が長くなるので、この画面だけ幅を広げる(放射線検査一覧と同じ)。
  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  const worklist = useLabWorklist(date);
  const departments = useDepartmentList({});
  const updateStatus = useUpdateLabTaskStatus();

  const rows = useMemo(
    () => (worklist.data?.rows ?? []).filter((row) => matchesFilters(row, filters)),
    [worklist.data, filters],
  );
  const total = worklist.data?.rows.length ?? 0;
  const viewing = worklist.data?.rows.find((row) => row.order.id === viewingId);
  const entering = worklist.data?.rows.find((row) => row.order.id === enteringId);

  // 検体の選択肢は読み込んだ 1 日ぶんのオーダーから拾う。マスタ全件を出しても
  // その日に採らない検体ばかりが並ぶだけなので、実際にある検体だけにする。
  const specimenOptions = useMemo(() => {
    const byCode = new Map<string, string>();
    for (const row of worklist.data?.rows ?? []) {
      for (const item of labOrderItems(row.order, row.itemRequests)) {
        if (item.specimenCode && !byCode.has(item.specimenCode)) {
          byCode.set(item.specimenCode, item.specimenName || item.specimenCode);
        }
      }
    }
    return Array.from(byCode, ([code, name]) => ({ code, name })).sort((a, b) =>
      a.code.localeCompare(b.code),
    );
  }, [worklist.data]);

  function handleDateChange(value: string) {
    // 日付を空にはさせない(空で検索すると全期間になってしまう)。
    if (value) setDate(value);
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>検体検査一覧</h1>
      </div>

      <FilterForm
        date={date}
        filters={filters}
        specimens={specimenOptions}
        departments={departments.departments}
        onDateChange={handleDateChange}
        onChange={setFilters}
      />

      <ErrorBanner error={worklist.error} />
      <ErrorBanner error={departments.error} />
      <ErrorBanner error={updateStatus.error} />

      {worklist.data?.truncated && (
        <p className="error-banner__line error-banner__line--error" role="status">
          この日のオーダーが多いため、一部のみ表示しています。
        </p>
      )}

      {worklist.isLoading ? (
        <p>読み込み中...</p>
      ) : (
        <>
          <div className="lab-worklist-wrap">
            <table className="lab-worklist">
              <thead>
                <tr>
                  <th>患者番号</th>
                  <th>患者氏名</th>
                  <th className="lab-worklist__content">検査内容</th>
                  <th className="lab-worklist__compact">区分</th>
                  <th>依頼科 | 依頼医師</th>
                  <th className="lab-worklist__compact">ステータス</th>
                  <th className="lab-worklist__actions"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <WorklistRow
                    key={row.order.id}
                    row={row}
                    pending={updateStatus.isPending}
                    onView={() => setViewingId(row.order.id ?? null)}
                    onEnterResult={() => setEnteringId(row.order.id ?? null)}
                    onChangeStatus={(status) =>
                      updateStatus.mutate({ order: row.order, task: row.task, status })
                    }
                  />
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="master-search__empty">
                      {total === 0
                        ? "この検査日の検体検査オーダーはありません"
                        : "絞り込みに該当する検査がありません"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="order-select__muted lab-worklist__count">{rows.length} 件</p>
        </>
      )}

      {viewing && <LabOrderViewModal row={viewing} onClose={() => setViewingId(null)} />}
      {entering && <LabResultEntryModal row={entering} onClose={() => setEnteringId(null)} />}
    </div>
  );
}

function matchesFilters(row: LabWorklistRow, filters: Filters): boolean {
  if (
    filters.specimenCode &&
    !labOrderItems(row.order, row.itemRequests).some(
      (item) => item.specimenCode === filters.specimenCode,
    )
  ) {
    return false;
  }

  const summary = summarizeLabOrder(row.order);
  if (filters.setting && summary.settingCode !== filters.setting) return false;

  const requester = prescriptionRequester(row.order);
  if (filters.departmentId && requester.departmentId !== filters.departmentId) return false;

  if (filters.status && labTaskStatus(row.task) !== filters.status) return false;

  return true;
}

interface FilterFormProps {
  date: string;
  filters: Filters;
  specimens: { code: string; name: string }[];
  departments: fhir4.Organization[];
  onDateChange: (value: string) => void;
  onChange: (filters: Filters) => void;
}

function FilterForm({
  date,
  filters,
  specimens,
  departments,
  onDateChange,
  onChange,
}: FilterFormProps) {
  // 絞り込みは選んだ瞬間に効かせるので、Enter での送信は何もしない。
  function handleSubmit(e: FormEvent) {
    e.preventDefault();
  }

  return (
    <form className="patient-search-form" onSubmit={handleSubmit}>
      <label>
        検査日
        <input type="date" value={date} required onChange={(e) => onDateChange(e.target.value)} />
      </label>
      <label>
        検体
        <select
          value={filters.specimenCode}
          onChange={(e) => onChange({ ...filters, specimenCode: e.target.value })}
        >
          <option value="">すべて</option>
          {specimens.map((specimen) => (
            <option key={specimen.code} value={specimen.code}>
              {specimen.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        入外区分
        <select
          value={filters.setting}
          onChange={(e) => onChange({ ...filters, setting: e.target.value })}
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
        <select
          value={filters.status}
          onChange={(e) => onChange({ ...filters, status: e.target.value })}
        >
          <option value="">すべて</option>
          {LAB_TASK_STATUS_OPTIONS.map((option) => (
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

/**
 * 検査内容の列。採る検体の名前だけを横に並べる(「血清・全血」)。採血の現場が
 * 用意するものが一目で分かればよく、項目まで要るときは「表示」で開く。
 * 採取管まで添えないのは、行が伸びると 1 行に収まらなくなるため。
 */
function specimenNames(groups: LabSpecimenGroup[]): string {
  return groups.map((group) => group.specimenName || group.specimenCode || "検体未設定").join("・");
}

function WorklistRow({
  row,
  pending,
  onView,
  onEnterResult,
  onChangeStatus,
}: {
  row: LabWorklistRow;
  pending: boolean;
  onView: () => void;
  onEnterResult: () => void;
  onChangeStatus: (status: LabTaskStatus) => void;
}) {
  const { order, patient } = row;
  const summary = summarizeLabOrder(order);
  const groups = groupBySpecimen(labOrderItems(order, row.itemRequests));
  const requester = prescriptionRequester(order);
  const status = labTaskStatus(row.task);
  const actions = labTaskActions(status);
  const secondaryActions = actions.filter((action) => action.secondary);

  return (
    <tr className={summary.urgent ? "lab-worklist__row--urgent" : undefined}>
      <td>{patient?.identifier?.[0]?.value ?? "-"}</td>
      <td>
        {patient ? (
          // 採血の前に病名や前回結果を見に行けるよう、カルテへ直接飛べるようにする。
          <Link to={`/patients/${patient.id}/karte`}>{displayName(patient)}</Link>
        ) : (
          "-"
        )}
      </td>
      <td className="lab-worklist__content">
        {groups.length > 0 ? (
          specimenNames(groups)
        ) : (
          <span className="order-select__muted">検査項目なし</span>
        )}
      </td>
      <td className="lab-worklist__compact">
        {summary.settingDisplay || "-"}
        {summary.urgent && <span className="dose-conversion__badge">至急</span>}
      </td>
      <td>{orderContextSummary(requester) || "-"}</td>
      <td className="lab-worklist__compact">
        <span className={`lab-worklist__status lab-worklist__status--${status}`}>
          {labTaskStatusDisplay(status)}
        </span>
      </td>
      <td className="lab-worklist__actions">
        {actions
          .filter((action) => !action.secondary)
          .map((action) => (
            <button
              key={action.next}
              type="button"
              disabled={pending}
              onClick={() => onChangeStatus(action.next)}
            >
              {action.label}
            </button>
          ))}
        {/* 検体ラベルの発行が受付を兼ねる(docs/lab-label-design.md §4)。採血室が
            最初にするのがラベルの発行なので、依頼済のオーダーはこの操作で受付済へ
            進める。受付済で押したときは再発行(同じ番号が刷られるだけなので文言も
            進捗も変えない)。中止のオーダーには出さない。 */}
        {(status === "requested" || status === "accepted") && (
          <a
            className="button"
            href={labLabelPdfUrl(order.id ?? "")}
            target="_blank"
            rel="noopener"
            title="検体ラベルの PDF を新規タブで開く"
            onClick={() => {
              if (status === "requested") onChangeStatus("accepted");
            }}
          >
            ラベル発行
          </a>
        )}
        {/* 検体が着いたら結果を入力できる。紐付け先はこの行のオーダーで決まっているので、
            モーダルの中でオーダーを選ばせない(LabResultEntryModal)。
            結果が登録済みのオーダーは 1 件目と二重にならないよう押させない
            (訂正はカルテの検査結果タブで行う)。 */}
        {status === "completed" &&
          (row.reportId ? (
            <button type="button" disabled title="この検査の結果は登録済みです">
              結果登録
            </button>
          ) : (
            <button type="button" disabled={!patient?.id} onClick={onEnterResult}>
              結果登録
            </button>
          ))}
        {/* 一覧には検体しか出さないので、検査項目・採取番号はここから開く。行によって
            数が変わる進捗のボタンより右に置いて、どの行でも同じ位置で押せるようにする。 */}
        <button type="button" onClick={onView}>
          表示
        </button>
        {/* 取消・中止は押し間違えると進捗が巻き戻るので一段畳む(放射線検査一覧と同じ)。 */}
        {secondaryActions.length > 0 && (
          <RowMenu label="この検査の操作" escapesClipping>
            {secondaryActions.map((action) => (
              <button
                key={action.next}
                type="button"
                className={`row-menu__item${
                  action.next === "cancelled" ? " row-menu__item--danger" : ""
                }`}
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
