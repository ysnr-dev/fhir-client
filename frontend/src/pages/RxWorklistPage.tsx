import { today } from "../lib/dates";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useKarteLinkState } from "../karteReturn";
import {
  useDepartmentList,
  useRxWorklist,
  useUpdateRxTaskStatus,
  type RxWorklistRow,
} from "../api/queries";
import { prescriptionPdfUrl } from "../api/reportsClient";
import { ErrorBanner } from "../components/ErrorBanner";
import { RowMenu } from "../components/RowMenu";
import { RxDispenseModal } from "../components/RxDispenseModal";
import { RxOrderViewModal } from "../components/RxOrderViewModal";
import { displayName } from "../fhir/patientHelpers";
import {
  CATEGORY_OPTIONS,
  SETTING_OPTIONS,
  groupByRp,
  orderContextSummary,
  prescriptionRequester,
  summarizeServiceRequest,
} from "../fhir/prescriptionHelpers";
import {
  RX_TASK_STATUS_OPTIONS,
  rxTaskActions,
  rxTaskStatus,
  rxTaskStatusDisplay,
  type RxTaskStatus,
} from "../fhir/rxTaskHelpers";

// 処方一覧(部門ワークリスト)。処方日を決めて、その日に調剤する処方を並べる。
// 作りは検体検査一覧(LabWorklistPage)に合わせてある。
//
// 1 行 = オーダー 1 件。1 行を 1 段に収めて件数を目で追えるよう、処方内容の列には
// 医薬品の名前だけを並べる。用法や用量は「表示」で開くモーダルに送る。
//
// 進捗は 依頼済 → 受付済 → 調剤済 と進む。処方箋の発行が受付を兼ねていて、
// 依頼済のオーダーは発行と同時に受付済へ進む(検体検査のラベル発行と同じ考え方。
// 処方箋そのものの発行機能は別タスク)。調剤済へは「調剤登録」で進み、調剤結果の
// MedicationDispense と一緒に書き込む。
//
// 処方日だけが上流での絞り込みで、残りは読み込んだ 1 日ぶんから画面側で絞る
// (理由は queries.ts の useRxWorklist を参照)。

interface Filters {
  setting: string;
  category: string;
  departmentId: string;
  status: string;
}

const emptyFilters: Filters = {
  setting: "",
  category: "",
  departmentId: "",
  status: "",
};

// 入外区分を選んでいないときの処方区分の候補。入院・外来で区分のコードは重ならない
// ので、そのまま繋げて全部出す。
const ALL_CATEGORY_OPTIONS = [...CATEGORY_OPTIONS.inpatient, ...CATEGORY_OPTIONS.outpatient];

export function RxWorklistPage() {
  // 処方日は必須。未選択にはできないので当日から始める。
  const [date, setDate] = useState(today);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  // 内容を開いているオーダー。行そのものではなく id で覚えておき、読み直しの
  // たびに引き直す(発行・調剤の後に開いたままのモーダルも追い付く)。
  const [viewingId, setViewingId] = useState<string | null>(null);
  // 調剤を入力しているオーダー。同じ理由で id で覚えておく。
  const [dispensingId, setDispensingId] = useState<string | null>(null);

  // 処方内容の列が長くなるので、この画面だけ幅を広げる(検体検査一覧と同じ)。
  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  const worklist = useRxWorklist(date);
  const departments = useDepartmentList({});
  const updateStatus = useUpdateRxTaskStatus();

  const rows = useMemo(
    () => (worklist.data?.rows ?? []).filter((row) => matchesFilters(row, filters)),
    [worklist.data, filters],
  );
  const total = worklist.data?.rows.length ?? 0;
  const viewing = worklist.data?.rows.find((row) => row.order.id === viewingId);
  const dispensing = worklist.data?.rows.find((row) => row.order.id === dispensingId);

  function handleDateChange(value: string) {
    // 日付を空にはさせない(空で検索すると全期間になってしまう)。
    if (value) setDate(value);
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>処方一覧</h1>
      </div>

      <FilterForm
        date={date}
        filters={filters}
        departments={departments.departments}
        onDateChange={handleDateChange}
        onChange={setFilters}
      />

      <ErrorBanner error={worklist.error} />
      <ErrorBanner error={departments.error} />
      <ErrorBanner error={updateStatus.error} />

      {worklist.data?.truncated && (
        <p className="error-banner__line error-banner__line--error" role="status">
          この日の処方が多いため、一部のみ表示しています。
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
                  <th className="rx-worklist__content">処方内容</th>
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
                    onDispense={() => setDispensingId(row.order.id ?? null)}
                    onChangeStatus={(status) =>
                      updateStatus.mutate({ order: row.order, task: row.task, status })
                    }
                  />
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="master-search__empty">
                      {total === 0
                        ? "この処方日の処方オーダーはありません"
                        : "絞り込みに該当する処方がありません"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="order-select__muted lab-worklist__count">{rows.length} 件</p>
        </>
      )}

      {viewing && <RxOrderViewModal row={viewing} onClose={() => setViewingId(null)} />}
      {dispensing && (
        <RxDispenseModal row={dispensing} onClose={() => setDispensingId(null)} />
      )}
    </div>
  );
}

function matchesFilters(row: RxWorklistRow, filters: Filters): boolean {
  const summary = summarizeServiceRequest(row.order);
  if (filters.setting && summary.settingCode !== filters.setting) return false;
  if (filters.category && summary.categoryCode !== filters.category) return false;

  const requester = prescriptionRequester(row.order);
  if (filters.departmentId && requester.departmentId !== filters.departmentId) return false;

  if (filters.status && rxTaskStatus(row.task) !== filters.status) return false;

  return true;
}

interface FilterFormProps {
  date: string;
  filters: Filters;
  departments: fhir4.Organization[];
  onDateChange: (value: string) => void;
  onChange: (filters: Filters) => void;
}

function FilterForm({ date, filters, departments, onDateChange, onChange }: FilterFormProps) {
  // 絞り込みは選んだ瞬間に効かせるので、Enter での送信は何もしない。
  function handleSubmit(e: FormEvent) {
    e.preventDefault();
  }

  const categoryOptions = filters.setting
    ? CATEGORY_OPTIONS[filters.setting as "inpatient" | "outpatient"]
    : ALL_CATEGORY_OPTIONS;

  function handleSettingChange(setting: string) {
    // 入外区分を変えると、選んでいた処方区分がその区分に無いことがあるので落とす。
    onChange({ ...filters, setting, category: "" });
  }

  return (
    <form className="patient-search-form" onSubmit={handleSubmit}>
      <label>
        処方日
        <input type="date" value={date} required onChange={(e) => onDateChange(e.target.value)} />
      </label>
      <label>
        入外区分
        <select value={filters.setting} onChange={(e) => handleSettingChange(e.target.value)}>
          <option value="">すべて</option>
          {SETTING_OPTIONS.map((option) => (
            <option key={option.code} value={option.code}>
              {option.display}
            </option>
          ))}
        </select>
      </label>
      <label>
        処方区分
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
          {RX_TASK_STATUS_OPTIONS.map((option) => (
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
  row: RxWorklistRow;
  pending: boolean;
  onView: () => void;
  onDispense: () => void;
  onChangeStatus: (status: RxTaskStatus) => void;
}) {
  // カルテの「戻る」でこの一覧に戻れるように遷移元を渡す。
  const karteLinkState = useKarteLinkState();
  const { order, patient } = row;
  const summary = summarizeServiceRequest(order);
  const requester = prescriptionRequester(order);
  const status = rxTaskStatus(row.task);
  const actions = rxTaskActions(status);
  // 発行済み(受付済以降)は処方箋を刷り直せる。中止した処方は刷らせない。
  const canReissue = status === "accepted" || status === "in-progress" || status === "completed";

  // 処方内容の列。薬袋を作る側が何を揃えるかが分かればよいので、医薬品の名前だけを
  // 横に並べる。用法・用量まで要るときは「表示」か「調剤登録」で開く。
  const medicineNames = groupByRp(row.medicationRequests)
    .flatMap((rp) => rp.medicines.map((medicine) => medicine.name))
    .filter(Boolean)
    .join("・");

  return (
    <tr>
      <td>{patient?.identifier?.[0]?.value ?? "-"}</td>
      <td>
        {patient ? (
          // 調剤の前に病名や検査結果を見に行けるよう、カルテへ直接飛べるようにする。
          <Link to={`/patients/${patient.id}/karte`} state={karteLinkState}>{displayName(patient)}</Link>
        ) : (
          "-"
        )}
      </td>
      <td className="rx-worklist__content">
        {medicineNames ? (
          <span className="rx-worklist__medicines" title={medicineNames}>
            {medicineNames}
          </span>
        ) : (
          <span className="order-select__muted">医薬品なし</span>
        )}
      </td>
      <td className="lab-worklist__compact">
        {[summary.settingDisplay, summary.categoryDisplay].filter(Boolean).join(" ") || "-"}
      </td>
      <td>{orderContextSummary(requester) || "-"}</td>
      <td className="lab-worklist__compact">
        <span className={`lab-worklist__status lab-worklist__status--${status}`}>
          {rxTaskStatusDisplay(status)}
        </span>
      </td>
      <td className="lab-worklist__actions">
        {/* 処方箋の発行が受付を兼ねる(検体検査のラベル発行と同じ)。薬剤部が最初に
            するのが処方箋の発行なので、依頼済のオーダーは PDF を開くと同時に受付済へ
            進める。院外・院内どちらの様式で刷るかは backend がオーダーの区分で決める。
            発行済みの再発行はケバブメニューへ畳む(同じ内容が刷られるだけの操作なので、
            主ボタンの列には出さない)。 */}
        {status === "requested" && (
          <a
            className="button"
            href={prescriptionPdfUrl(order.id ?? "")}
            target="_blank"
            rel="noopener"
            title="処方箋の PDF を新規タブで開く"
            onClick={() => onChangeStatus("accepted")}
          >
            処方箋発行
          </a>
        )}
        {/* 受付が済んだら調剤の結果を登録できる。紐付け先はこの行のオーダーで決まって
            いるので、モーダルの中でオーダーを選ばせない(RxDispenseModal)。 */}
        {status === "accepted" && (
          <button type="button" disabled={!patient?.id} onClick={onDispense}>
            調剤登録
          </button>
        )}
        {/* 一覧には医薬品名しか出さないので、用法・用量はここから開く。行によって
            数が変わる進捗のボタンより右に置いて、どの行でも同じ位置で押せるようにする。 */}
        <button type="button" onClick={onView}>
          表示
        </button>
        {/* 取消・中止は押し間違えると進捗が巻き戻るので一段畳む(検体検査一覧と同じ)。
            処方箋の再発行も同じメニューに置く(進捗は動かさず、同じ処方箋を開くだけ)。 */}
        {(actions.length > 0 || canReissue) && (
          <RowMenu label="この処方の操作" escapesClipping>
            {canReissue && (
              <a
                className="row-menu__item"
                href={prescriptionPdfUrl(order.id ?? "")}
                target="_blank"
                rel="noopener"
              >
                処方箋再発行
              </a>
            )}
            {actions.map((action) => (
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
