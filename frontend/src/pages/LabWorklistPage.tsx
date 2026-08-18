import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useDepartmentList, useLabWorklist, type LabWorklistRow } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import {
  groupBySpecimen,
  labOrderItems,
  specimenGroupLabel,
  summarizeLabOrder,
  type LabSpecimenGroup,
} from "../fhir/labOrderHelpers";
import { displayName } from "../fhir/patientHelpers";
import {
  SETTING_OPTIONS,
  orderContextSummary,
  prescriptionRequester,
} from "../fhir/prescriptionHelpers";

// 検体検査一覧(部門ワークリスト)。検査日を決めて、その日に検体を採る検査を並べる。
// 作りは放射線検査一覧(RadWorklistPage)に合わせてある。
//
// 1 行 = オーダー 1 件。検査内容は採血の現場が動く単位(どの容器に何を採るか)で
// 見せたいので、検体・採取管ごとにまとめて並べる(カルテのカードと同じ考え方)。
//
// 今はその日のオーダーを見渡す一覧だけ。検体ラベルの発行と到着確認(進捗)は
// この画面に足していく予定。
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
}

const emptyFilters: Filters = {
  specimenCode: "",
  setting: "",
  departmentId: "",
};

export function LabWorklistPage() {
  // 検査日は必須。未選択にはできないので当日から始める。
  const [date, setDate] = useState(today);
  const [filters, setFilters] = useState<Filters>(emptyFilters);

  // 検査内容の列が長くなるので、この画面だけ幅を広げる(放射線検査一覧と同じ)。
  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  const worklist = useLabWorklist(date);
  const departments = useDepartmentList({});

  const rows = useMemo(
    () => (worklist.data?.rows ?? []).filter((row) => matchesFilters(row, filters)),
    [worklist.data, filters],
  );
  const total = worklist.data?.rows.length ?? 0;

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
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <WorklistRow key={row.order.id} row={row} />
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="master-search__empty">
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
      <div className="patient-search-form__actions">
        <button type="button" onClick={() => onChange(emptyFilters)}>
          クリア
        </button>
      </div>
    </form>
  );
}

/** 検体グループ 1 行のラベル(「血清（分離剤管） | 末梢血液一般・CRP」)。 */
function groupLabel(group: LabSpecimenGroup): string {
  const names = group.entries.map((entry) => entry.item.name).filter(Boolean);
  return `${specimenGroupLabel(group)} | ${names.join("・") || "(項目なし)"}`;
}

function WorklistRow({ row }: { row: LabWorklistRow }) {
  const { order, patient } = row;
  const summary = summarizeLabOrder(order);
  const groups = groupBySpecimen(labOrderItems(order, row.itemRequests));
  const requester = prescriptionRequester(order);

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
        <ul className="lab-worklist__items">
          {groups.map((group) => (
            <li key={group.specimenCode || "(none)"}>{groupLabel(group)}</li>
          ))}
          {groups.length === 0 && <li className="order-select__muted">検査項目なし</li>}
        </ul>
      </td>
      <td className="lab-worklist__compact">
        {summary.settingDisplay || "-"}
        {summary.urgent && <span className="dose-conversion__badge">至急</span>}
      </td>
      <td>{orderContextSummary(requester) || "-"}</td>
    </tr>
  );
}
