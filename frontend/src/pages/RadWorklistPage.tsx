import { today } from "../lib/dates";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  useDepartmentList,
  useRadWorklist,
  useUpdateRadTaskStatus,
  type RadWorklistRow,
} from "../api/queries";
import type { RadItem } from "../api/masterClient";
import { useRadItemsByCodes, useRadJj1017Catalog } from "../api/masterQueries";
import { ErrorBanner } from "../components/ErrorBanner";
import { RadPerformModal } from "../components/RadPerformModal";
import { RowMenu } from "../components/RowMenu";
import { displayName } from "../fhir/patientHelpers";
import {
  SETTING_OPTIONS,
  orderContextSummary,
  prescriptionRequester,
} from "../fhir/prescriptionHelpers";
import {
  entryLabel,
  orderEntries,
  radOrderItems,
  radOrderTime,
  summarizeRadOrder,
} from "../fhir/radOrderHelpers";
import {
  RAD_TASK_STATUS_OPTIONS,
  radTaskActions,
  radTaskStatus,
  radTaskStatusDisplay,
  type RadTaskStatus,
} from "../fhir/radTaskHelpers";

// 放射線検査一覧(部門ワークリスト)。撮影日を決めて、その日に撮る検査を並べる。
//
// 1 行 = オーダー 1 件。CT・MRI のように 1 撮影に時間を要する項目は、マスタで
// 「単独」にしておけばオーダー登録の時点で 1 件ずつ別オーダーに分かれるので、
// 行がそのまま撮影の単位になる(放射線オーダー項目マスタの「オーダー単位」)。
//
// 撮影日だけが上流での絞り込みで、残りは読み込んだ 1 日ぶんから画面側で絞る
// (理由は queries.ts の useRadWorklist を参照)。

interface Filters {
  modalityCode: string;
  setting: string;
  departmentId: string;
  status: string;
}

const emptyFilters: Filters = {
  modalityCode: "",
  setting: "",
  departmentId: "",
  status: "",
};

export function RadWorklistPage() {
  // 撮影日は必須。未選択にはできないので当日から始める。
  const [date, setDate] = useState(today);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  // 実施入力を開いている行。「実施」だけはステータス変更ではなくモーダルを開く。
  const [performing, setPerforming] = useState<RadWorklistRow | null>(null);

  // 列が多く、既定の幅では患者名や依頼科まで折り返すので、この画面だけ幅を広げる
  // (カルテと同じやり方)。
  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  const worklist = useRadWorklist(date);
  const catalog = useRadJj1017Catalog();
  const departments = useDepartmentList({});
  const updateStatus = useUpdateRadTaskStatus();

  const rows = useMemo(
    () => (worklist.data?.rows ?? []).filter((row) => matchesFilters(row, filters)),
    [worklist.data, filters],
  );
  const total = worklist.data?.rows.length ?? 0;

  // 「実施」で実施入力を開くかどうかは撮影項目マスタが決めるので、この日の
  // オーダーに載っている項目をまとめて引いておく。
  const itemCodes = useMemo(
    () =>
      (worklist.data?.rows ?? []).flatMap((row) =>
        radOrderItems(row.order, row.itemRequests).map((item) => item.code),
      ),
    [worklist.data],
  );
  const items = useRadItemsByCodes(itemCodes);
  const masterByCode = useMemo(() => {
    const map = new Map<string, RadItem>();
    for (const item of items.data?.items ?? []) map.set(item.item_code, item);
    return map;
  }, [items.data]);

  // 実施入力をする項目が 1 つでもあれば実施入力を開く。
  //
  // セットは撮影そのものではなく依頼の束ね方なので、判定は構成項目だけで行う
  // (JJ1017 の要素を持たないのと同じ理由)。マスタに無いコード(項目を消した後の
  // オーダーなど)は入力の機会を落とさないよう「あり」に倒す。
  function needsPerformInput(row: RadWorklistRow): boolean {
    const codes = radOrderItems(row.order, row.itemRequests)
      .map((item) => item.code)
      .filter((code) => masterByCode.get(code)?.kind !== "set");
    if (codes.length === 0) return true;

    return codes.some((code) => masterByCode.get(code)?.requires_perform_input ?? true);
  }

  // 実施入力をしない検査は、実施記録を作らずに Task を実施済にするだけ。
  function handlePerform(row: RadWorklistRow) {
    if (needsPerformInput(row)) setPerforming(row);
    else updateStatus.mutate({ order: row.order, task: row.task, status: "completed" });
  }

  function handleDateChange(value: string) {
    // 日付を空にはさせない(空で検索すると全期間になってしまう)。
    if (value) setDate(value);
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>放射線検査一覧</h1>
      </div>

      <FilterForm
        date={date}
        filters={filters}
        modalities={catalog.data?.modality ?? []}
        departments={departments.departments}
        onDateChange={handleDateChange}
        onChange={setFilters}
      />

      <ErrorBanner error={worklist.error} />
      <ErrorBanner error={catalog.error ?? departments.error ?? items.error} />
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
          <div className="rad-worklist-wrap">
            <table className="rad-worklist">
              <thead>
                <tr>
                  <th className="rad-worklist__time">撮影時刻</th>
                  <th>患者番号</th>
                  <th>患者氏名</th>
                  <th className="rad-worklist__content">撮影内容</th>
                  <th className="rad-worklist__compact">区分</th>
                  <th>依頼科 | 依頼医師</th>
                  <th className="rad-worklist__compact">ステータス</th>
                  <th className="rad-worklist__actions"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <WorklistRow
                    key={row.order.id}
                    row={row}
                    // マスタが読めるまでは実施入力の有無が決まらないので押させない。
                    pending={updateStatus.isPending || items.isLoading}
                    onChangeStatus={(status) =>
                      updateStatus.mutate({ order: row.order, task: row.task, status })
                    }
                    onPerform={() => handlePerform(row)}
                  />
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="master-search__empty">
                      {total === 0
                        ? "この撮影日の放射線検査オーダーはありません"
                        : "絞り込みに該当する検査がありません"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="order-select__muted rad-worklist__count">{rows.length} 件</p>
        </>
      )}

      {performing && (
        <RadPerformModal row={performing} onClose={() => setPerforming(null)} />
      )}
    </div>
  );
}

// 明細に載っている種別(モダリティ)。セットは自身に種別を持たないので構成項目から採る。
function rowModalityCodes(row: RadWorklistRow): string[] {
  return radOrderItems(row.order, row.itemRequests)
    .map((item) => item.modalityCode)
    .filter(Boolean);
}

function matchesFilters(row: RadWorklistRow, filters: Filters): boolean {
  if (filters.modalityCode && !rowModalityCodes(row).includes(filters.modalityCode)) return false;

  const summary = summarizeRadOrder(row.order);
  if (filters.setting && summary.settingCode !== filters.setting) return false;

  const requester = prescriptionRequester(row.order);
  if (filters.departmentId && requester.departmentId !== filters.departmentId) return false;

  if (filters.status && radTaskStatus(row.task) !== filters.status) return false;

  return true;
}

interface FilterFormProps {
  date: string;
  filters: Filters;
  modalities: { code: string; name: string }[];
  departments: fhir4.Organization[];
  onDateChange: (value: string) => void;
  onChange: (filters: Filters) => void;
}

function FilterForm({
  date,
  filters,
  modalities,
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
        撮影日
        <input type="date" value={date} required onChange={(e) => onDateChange(e.target.value)} />
      </label>
      <label>
        種別(モダリティ)
        <select
          value={filters.modalityCode}
          onChange={(e) => onChange({ ...filters, modalityCode: e.target.value })}
        >
          <option value="">すべて</option>
          {modalities.map((modality) => (
            <option key={modality.code} value={modality.code}>
              {modality.name}
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
          {RAD_TASK_STATUS_OPTIONS.map((option) => (
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
  onChangeStatus,
  onPerform,
}: {
  row: RadWorklistRow;
  pending: boolean;
  onChangeStatus: (status: RadTaskStatus) => void;
  onPerform: () => void;
}) {
  const { order, patient, task } = row;
  const summary = summarizeRadOrder(order);
  const entries = orderEntries(radOrderItems(order, row.itemRequests));
  const status = radTaskStatus(task);
  const requester = prescriptionRequester(order);
  const actions = radTaskActions(status);
  const secondaryActions = actions.filter((action) => action.secondary);

  return (
    <tr className={summary.urgent ? "rad-worklist__row--urgent" : undefined}>
      <td className="rad-worklist__time">{radOrderTime(order) || "-"}</td>
      <td>{patient?.identifier?.[0]?.value ?? "-"}</td>
      <td>
        {patient ? (
          // 実施時に前回画像や病名を見に行けるよう、カルテへ直接飛べるようにする。
          <Link to={`/patients/${patient.id}/karte`}>{displayName(patient)}</Link>
        ) : (
          "-"
        )}
      </td>
      <td className="rad-worklist__content">
        <ul className="rad-worklist__items">
          {entries.map((entry) => (
            <li key={entry.item.code}>{entryLabel(entry)}</li>
          ))}
          {entries.length === 0 && <li className="order-select__muted">撮影項目なし</li>}
        </ul>
      </td>
      <td className="rad-worklist__compact">
        {summary.settingDisplay || "-"}
        {summary.urgent && <span className="dose-conversion__badge">至急</span>}
      </td>
      <td>{orderContextSummary(requester) || "-"}</td>
      <td className="rad-worklist__compact">
        <span className={`rad-worklist__status rad-worklist__status--${status}`}>
          {radTaskStatusDisplay(status)}
        </span>
      </td>
      <td className="rad-worklist__actions">
        {actions
          .filter((action) => !action.secondary)
          .map((action) => (
            <button
              key={action.next}
              type="button"
              disabled={pending}
              onClick={() => (action.opensPerformInput ? onPerform() : onChangeStatus(action.next))}
            >
              {action.label}
            </button>
          ))}
        {/* 訂正・取りやめは押し間違えると進捗が巻き戻るので、一段畳んで置く。
            一覧は横スクロールできるよう overflow を持つため、メニューは
            escapesClipping で領域の外に出す(でないと縁で切れる)。 */}
        {secondaryActions.length > 0 && (
          <RowMenu label="この検査の操作" escapesClipping>
            {secondaryActions.map((action) => (
              <button
                key={action.next}
                type="button"
                // 中止は検査そのものを取りやめる操作なので目立たせる。取消は
                // 1 つ前に戻すだけの訂正なので通常の項目にする。
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
