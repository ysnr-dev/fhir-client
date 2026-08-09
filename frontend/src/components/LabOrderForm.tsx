import { useCallback, useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import type { LabOrderItem } from "../api/masterClient";
import {
  useLabContainers,
  useLabOrderItemLayout,
  useLabOrderItemLayouts,
  useLabOrderItemSearch,
  useLabOrderItemsByCodes,
  useLabPanelMemberLabels,
  useLabSpecimenOptions,
} from "../api/masterQueries";
import { refreshProblemDisplay } from "../fhir/conditionHelpers";
import {
  PRIORITY_OPTIONS,
  emptyLabOrderForm,
  groupBySpecimen,
  specimenGroupLabel,
  type LabOrderFormValues,
  type LabOrderItemLine,
  type LabOrderPriority,
} from "../fhir/labOrderHelpers";
import { SETTING_OPTIONS, type PrescriptionSetting } from "../fhir/prescriptionHelpers";
import { useProblemOptions } from "../hooks/useProblemOptions";
import { ErrorBanner } from "./ErrorBanner";
import { ProblemSelect } from "./ProblemSelect";

// 検体検査オーダーの入力フォーム。検査伝票(検査オーダーレイアウト)のタブと
// 個別検索から項目を選び、選んだ内容を検体ごとにまとめて確認してから登録する。
//
// 選んだ項目は、オーダー時点のマスタの内容(名称・JLAC コード・検体・採取管)を
// 写して持つ。マスタを直しても過去のオーダーの中身が変わらないようにするため。

interface LabOrderFormProps {
  patientId: string;
  initialValues?: LabOrderFormValues;
  onSubmit: (values: LabOrderFormValues) => void;
  submitting: boolean;
  submitError?: unknown;
  submitLabel?: string;
}

type ActiveTab = { kind: "layout"; id: number } | { kind: "search" };

function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9L12 4M6.5 6.5v5M9.5 6.5v5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * マスタの検査オーダー項目を、オーダーに写す 1 行に変換する。採取管は項目の指定が
 * 優先で、無ければ検体マスタの既定採取管を使う(マスタ画面と同じ決め方)。
 */
function useLineBuilder(): (item: LabOrderItem) => LabOrderItemLine {
  const specimens = useLabSpecimenOptions();
  const containers = useLabContainers();

  return useCallback(
    (item: LabOrderItem) => {
      const specimen = specimens.data?.items.find((s) => s.specimen_code === item.specimen_code);
      const containerCode = item.container_code || specimen?.default_container_code || "";
      const container = containers.data?.items.find((c) => c.container_code === containerCode);

      return {
        code: item.order_item_code,
        name: item.name,
        jlacCode: item.jlac_code ?? "",
        jlacCodeSystem: item.jlac_code_system ?? "",
        specimenCode: item.specimen_code ?? "",
        specimenName: specimen?.name ?? "",
        containerCode,
        containerName: container?.name ?? "",
      };
    },
    [containers.data, specimens.data],
  );
}

export function LabOrderForm({
  patientId,
  initialValues,
  onSubmit,
  submitting,
  submitError,
  submitLabel = "登録",
}: LabOrderFormProps) {
  const [values, setValues] = useState<LabOrderFormValues>(initialValues ?? emptyLabOrderForm);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [commentOpen, setCommentOpen] = useState(Boolean(initialValues?.comment));
  const [active, setActive] = useState<ActiveTab | null>(null);

  const problemOptions = useProblemOptions(patientId);
  const layouts = useLabOrderItemLayouts();

  const layoutTabs = useMemo(
    () => (layouts.data?.items ?? []).filter((layout) => layout.active),
    [layouts.data],
  );

  // 初期表示は先頭のレイアウト。レイアウトが 1 つも無ければ検索タブ。
  useEffect(() => {
    if (active === null && layouts.data) {
      setActive(
        layoutTabs.length > 0 ? { kind: "layout", id: layoutTabs[0].id } : { kind: "search" },
      );
    }
  }, [active, layouts.data, layoutTabs]);

  const selectedCodes = useMemo(
    () => new Set(values.items.map((item) => item.code)),
    [values.items],
  );

  function update<K extends keyof LabOrderFormValues>(key: K, value: LabOrderFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  // 選択の増減。外すのはコードだけで足りるが、足すときはオーダーに写す内容が要る。
  function toggle(line: LabOrderItemLine) {
    setValues((v) =>
      v.items.some((item) => item.code === line.code)
        ? { ...v, items: v.items.filter((item) => item.code !== line.code) }
        : { ...v, items: [...v.items, line] },
    );
  }

  function remove(code: string) {
    setValues((v) => ({ ...v, items: v.items.filter((item) => item.code !== code) }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (values.items.length === 0) {
      setValidationError("検査項目を 1 つ以上選択してください。");
      return;
    }
    if (!values.authoredDate) {
      setValidationError("検査日を入力してください。");
      return;
    }
    setValidationError(null);
    onSubmit({ ...values, problem: refreshProblemDisplay(values.problem, problemOptions) });
  }

  function handleKeyDown(e: KeyboardEvent<HTMLFormElement>) {
    // input 上での Enter による暗黙の form submit を抑止する(処方・注射と同じ)。
    if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
      e.preventDefault();
    }
  }

  return (
    <form className="prescription-form" onSubmit={handleSubmit} onKeyDown={handleKeyDown}>
      {validationError && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}
      <ErrorBanner error={submitError} />
      <ErrorBanner error={layouts.error} />

      <fieldset>
        <legend>検査共通</legend>
        <label>
          対象プロブレム
          <ProblemSelect
            value={values.problem}
            options={problemOptions}
            onChange={(problem) => update("problem", problem)}
          />
        </label>
        <label>
          入外区分
          <select
            value={values.setting}
            onChange={(e) => update("setting", e.target.value as PrescriptionSetting)}
          >
            <option value="">選択してください</option>
            {SETTING_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.display}
              </option>
            ))}
          </select>
        </label>
        <label>
          至急区分
          <select
            value={values.priority}
            onChange={(e) => update("priority", e.target.value as LabOrderPriority)}
          >
            {PRIORITY_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.display}
              </option>
            ))}
          </select>
        </label>
        <label>
          検査日
          <input
            type="date"
            value={values.authoredDate}
            onChange={(e) => update("authoredDate", e.target.value)}
          />
        </label>
        {commentOpen ? (
          <div className="prescription-form__comment-field">
            <label>
              検査コメント
              <input
                type="text"
                value={values.comment}
                onChange={(e) => update("comment", e.target.value)}
              />
            </label>
            <button
              type="button"
              className="rp-card__icon-button"
              title="検査コメントを削除"
              aria-label="検査コメントを削除"
              onClick={() => {
                setCommentOpen(false);
                update("comment", "");
              }}
            >
              <TrashIcon />
            </button>
          </div>
        ) : (
          <div className="prescription-form__comment-toggle">
            <button type="button" className="comment-add-button" onClick={() => setCommentOpen(true)}>
              ＋検査コメント
            </button>
          </div>
        )}
      </fieldset>

      {/* 検査伝票(レイアウト)と検査項目検索の切替。伝票が複数あればその数だけタブが並ぶ。 */}
      <div className="lab-order-item__tabs" role="tablist">
        {layoutTabs.map((layout) => {
          const selected = active?.kind === "layout" && active.id === layout.id;
          return (
            <button
              key={layout.id}
              type="button"
              role="tab"
              aria-selected={selected}
              className={selected ? "lab-order-item__tab is-active" : "lab-order-item__tab"}
              onClick={() => setActive({ kind: "layout", id: layout.id })}
            >
              {layout.name}
            </button>
          );
        })}
        <button
          type="button"
          role="tab"
          aria-selected={active?.kind === "search"}
          className={
            active?.kind === "search" ? "lab-order-item__tab is-active" : "lab-order-item__tab"
          }
          onClick={() => setActive({ kind: "search" })}
        >
          検査項目検索
        </button>
      </div>

      {active?.kind === "layout" && (
        <LayoutSelectGrid
          key={active.id}
          layoutId={active.id}
          selectedCodes={selectedCodes}
          onToggle={toggle}
        />
      )}
      {active?.kind === "search" && (
        <ItemSearchTab selectedCodes={selectedCodes} onToggle={toggle} />
      )}

      <SelectionPreview items={values.items} onRemove={remove} />

      <div className="prescription-form__submit">
        <button type="submit" disabled={submitting}>
          {submitting ? "送信中..." : submitLabel}
        </button>
      </div>
    </form>
  );
}

interface SelectProps {
  selectedCodes: ReadonlySet<string>;
  onToggle: (line: LabOrderItemLine) => void;
}

// 検査伝票のグリッド。マス割りはレイアウトマスタの定義そのままで、
// 検査項目のマスにチェックボックスを重ねる。
function LayoutSelectGrid({ layoutId, selectedCodes, onToggle }: SelectProps & { layoutId: number }) {
  const { data, error } = useLabOrderItemLayout(layoutId);
  const buildLine = useLineBuilder();

  // 伝票に載っている項目のマスタ行。チェックを入れた時点でオーダーに写せるよう、
  // マスの中身(コードと表示名)ではなく検体・採取管まで揃えて持っておく。
  const itemCodes = useMemo(
    () =>
      (data?.cells ?? [])
        .filter((cell) => cell.cell_type === "item" && cell.order_item_code)
        .map((cell) => cell.order_item_code as string),
    [data],
  );
  const masterItems = useLabOrderItemsByCodes(itemCodes);
  const itemsByCode = useMemo(() => {
    const map = new Map<string, LabOrderItem>();
    for (const item of masterItems.data?.items ?? []) map.set(item.order_item_code, item);
    return map;
  }, [masterItems.data]);

  if (!data) {
    return <ErrorBanner error={error} />;
  }

  const cellsByPosition = new Map(
    data.cells.map((cell) => [`${cell.grid_row}-${cell.grid_column}`, cell]),
  );
  const rows = Array.from({ length: data.row_count }, (_, i) => i + 1);
  const columns = Array.from({ length: data.column_count }, (_, i) => i + 1);

  return (
    <div className="lab-order-panel__grid-wrap">
      <ErrorBanner error={error ?? masterItems.error} />
      <table className="lab-order-panel__grid">
        <tbody>
          {rows.map((row) => (
            <tr key={row}>
              {columns.map((column) => {
                const cell = cellsByPosition.get(`${row}-${column}`);
                if (!cell) {
                  return <td key={column} className="lab-order-panel__cell" />;
                }
                if (cell.cell_type === "label") {
                  return (
                    <td key={column} className="lab-order-panel__cell lab-order-panel__cell--label">
                      {cell.display_name}
                    </td>
                  );
                }
                const code = cell.order_item_code ?? "";
                const master = itemsByCode.get(code);
                return (
                  <td key={column} className="lab-order-panel__cell">
                    <label>
                      <input
                        type="checkbox"
                        checked={selectedCodes.has(code)}
                        // マスタ行が届く前に押されると検体が空のまま入ってしまうので、
                        // 揃うまでは押せないようにする。
                        disabled={!master}
                        onChange={() => master && onToggle(buildLine(master))}
                      />
                      {cell.display_name ?? cell.item_name ?? code}
                    </label>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// 伝票に載っていない項目を個別に探して選ぶ。
function ItemSearchTab({ selectedCodes, onToggle }: SelectProps) {
  const [name, setName] = useState("");
  const [page, setPage] = useState(1);
  const buildLine = useLineBuilder();
  // 期限切れの項目を出しても選べないだけなので、有効期間内に絞る。
  const result = useLabOrderItemSearch({ name, active: true }, page, name.trim().length > 0);

  const data = result.data;
  const hasNext = data ? page * data.per < data.total : false;

  return (
    <div className="lab-order-panel__search">
      <input
        type="text"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setPage(1);
        }}
        placeholder="名称・略称・カナで検索"
      />
      <ErrorBanner error={result.error} />
      {name.trim().length > 0 && (
        <>
          <ul className="lab-order-panel__search-list">
            {data?.items.map((item) => (
              <li key={item.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={selectedCodes.has(item.order_item_code)}
                    onChange={() => onToggle(buildLine(item))}
                  />
                  {item.name}
                  {item.short_name && (
                    <span className="lab-order-panel__muted">{item.short_name}</span>
                  )}
                  {item.kind === "panel" && <span className="dose-conversion__badge">パネル</span>}
                </label>
              </li>
            ))}
            {data && data.items.length === 0 && (
              <li className="lab-order-panel__muted">該当する検査項目がありません</li>
            )}
          </ul>
          <div className="master-search__pager">
            <button
              type="button"
              onClick={() => setPage((p) => p - 1)}
              disabled={page <= 1 || result.isFetching}
            >
              前へ
            </button>
            <span>
              {page} ページ目 (全 {data?.total ?? 0} 件)
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => p + 1)}
              disabled={!hasNext || result.isFetching}
            >
              次へ
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// 選択中の項目を検体ごとにまとめたプレビュー。採血の現場が「何をどの容器で採るか」を
// 確かめる形に合わせる。パネルは構成項目を添える。
function SelectionPreview({
  items,
  onRemove,
}: {
  items: LabOrderItemLine[];
  onRemove: (code: string) => void;
}) {
  const panelMembers = useLabPanelMemberLabels(items.map((item) => item.code));
  const groups = groupBySpecimen(items);

  return (
    <section className="lab-order-panel__preview">
      <h3>選択中({items.length})</h3>
      <ErrorBanner error={panelMembers.error} />
      {items.length === 0 && <p className="lab-order-panel__muted">検査項目を選択してください</p>}
      {groups.map((group, index) => (
        <div key={group.specimenCode || "unset"} className="lab-order-panel__group">
          <h4>
            GP{index + 1} {specimenGroupLabel(group)}
          </h4>
          <ul>
            {group.items.map((item) => {
              const members = panelMembers.data?.get(item.code);
              return (
                <li key={item.code}>
                  {item.name}
                  {members && (
                    <span className="lab-order-panel__muted">（{members.join(", ")}）</span>
                  )}
                  <button
                    type="button"
                    className="lab-order-panel__remove"
                    onClick={() => onRemove(item.code)}
                    aria-label={`${item.name} を外す`}
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}
