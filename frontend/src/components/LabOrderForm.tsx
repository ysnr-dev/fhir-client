import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import type { LabOrderItem } from "../api/masterClient";
import {
  useLabContainers,
  useLabOrderItemLayout,
  useLabOrderItemLayouts,
  useLabOrderItemSearch,
  useLabOrderItemsByCodes,
  useLabPanelMembers,
  useLabSpecimenOptions,
} from "../api/masterQueries";
import { refreshProblemDisplay } from "../fhir/conditionHelpers";
import {
  PRIORITY_OPTIONS,
  emptyLabOrderForm,
  groupBySpecimen,
  specimenGroupLabel,
  topLevelItems,
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
// パネル検査を選ぶと、その構成項目もマスタから引いてオーダーに入れる(FHIR には
// パネルとその構成項目を親子で保存する)。構成項目が伝票にも載っていればチェックが
// 連動し、外せばそのパネルからその項目だけを除いてオーダーできる。同じ項目が
// 「パネルの構成項目」と「単独の項目」で二重に入ることはない。
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
  const [searchCodes, setSearchCodes] = useState<string[]>([]);
  // 構成項目を入れ終えたパネル。保存済みオーダーを開いたときは、登録時に外した
  // 構成項目が復活しないよう、最初から入っているパネルを入れ終わり扱いにする。
  const expandedPanels = useRef<Set<string>>(
    new Set(topLevelItems(initialValues?.items ?? []).map((item) => item.code)),
  );

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

  // 選べる項目のマスタを先に揃えておく。チェックを入れた瞬間にオーダーへ写す値
  // (検体・採取管・パネルの構成)が要るため、伝票・検索結果・選択済みをまとめて引く。
  const layout = useLabOrderItemLayout(active?.kind === "layout" ? active.id : undefined);
  const layoutCodes = useMemo(
    () =>
      (layout.data?.cells ?? [])
        .filter((cell) => cell.cell_type === "item" && cell.order_item_code)
        .map((cell) => cell.order_item_code as string),
    [layout.data],
  );
  const catalogCodes = useMemo(
    () => [...layoutCodes, ...searchCodes, ...values.items.map((item) => item.code)],
    [layoutCodes, searchCodes, values.items],
  );

  const panelMembers = useLabPanelMembers(catalogCodes);
  // 構成項目もオーダーに写すので、マスタ行は構成項目のぶんまで引く。
  const memberCodes = useMemo(
    () => Array.from(panelMembers.data?.values() ?? []).flat(),
    [panelMembers.data],
  );
  const catalog = useLabOrderItemsByCodes([...catalogCodes, ...memberCodes]);
  const catalogByCode = useMemo(() => {
    const map = new Map<string, LabOrderItem>();
    for (const item of catalog.data?.items ?? []) map.set(item.order_item_code, item);
    return map;
  }, [catalog.data]);

  const specimens = useLabSpecimenOptions();
  const containers = useLabContainers();

  // マスタの検査オーダー項目を、オーダーに写す 1 行に変換する。採取管は項目の指定が
  // 優先で、無ければ検体マスタの既定採取管を使う(マスタ画面と同じ決め方)。
  const buildLine = useCallback(
    (item: LabOrderItem, parentCode: string): LabOrderItemLine => {
      const specimen = specimens.data?.items.find((s) => s.specimen_code === item.specimen_code);
      const containerCode = item.container_code || specimen?.default_container_code || "";
      const container = containers.data?.items.find((c) => c.container_code === containerCode);

      return {
        code: item.order_item_code,
        name: item.name,
        shortName: item.short_name ?? "",
        jlacCode: item.jlac_code ?? "",
        jlacCodeSystem: item.jlac_code_system ?? "",
        specimenCode: item.specimen_code ?? "",
        specimenName: specimen?.name ?? "",
        containerCode,
        containerName: container?.name ?? "",
        parentCode,
      };
    },
    [containers.data, specimens.data],
  );

  const selectedCodes = useMemo(
    () => new Set(values.items.map((item) => item.code)),
    [values.items],
  );

  // パネルを選んだら構成項目も入れる。マスタ行が届くのを待つので効果で処理する。
  // 一度入れたパネルは二度と自動で足さない(外した構成項目が復活しないように)。
  //
  // 組み立ては setValues の外で行う。更新関数の中で expandedPanels を書き換えると、
  // StrictMode が更新関数を 2 回呼ぶときに 2 回目が「追加済み」と判断してしまう。
  useEffect(() => {
    const members = panelMembers.data;
    if (!members) return;

    const pending = topLevelItems(values.items).filter(
      (item) => !expandedPanels.current.has(item.code) && (members.get(item.code)?.length ?? 0) > 0,
    );
    if (pending.length === 0) return;

    const items = [...values.items];
    const expanded: string[] = [];
    let changed = false;

    for (const panel of pending) {
      const memberCodesOfPanel = members.get(panel.code) ?? [];
      const memberRows = memberCodesOfPanel
        .map((code) => catalogByCode.get(code))
        .filter((row): row is LabOrderItem => Boolean(row));
      // マスタ行がまだ揃っていないパネルは次の描画に回す。
      if (memberRows.length !== memberCodesOfPanel.length) continue;

      expanded.push(panel.code);
      for (const row of memberRows) {
        const index = items.findIndex((item) => item.code === row.order_item_code);
        if (index < 0) {
          items.push(buildLine(row, panel.code));
          changed = true;
        } else if (!items[index].parentCode) {
          // 単独で選んでいた項目は、二重に入らないようパネルの構成項目に寄せる。
          items[index] = { ...items[index], parentCode: panel.code };
          changed = true;
        }
      }
    }

    if (expanded.length === 0) return;
    for (const code of expanded) expandedPanels.current.add(code);
    if (changed) setValues((current) => ({ ...current, items }));
  }, [buildLine, catalogByCode, panelMembers.data, values.items]);

  function update<K extends keyof LabOrderFormValues>(key: K, value: LabOrderFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  // チェックの ON/OFF。パネルを外すと構成項目も一緒に外れ、構成項目だけを外すと
  // そのパネルからその項目を除いたオーダーになる。
  function toggle(item: LabOrderItem) {
    const code = item.order_item_code;
    setValues((current) => {
      const selected = current.items.find((line) => line.code === code);
      if (selected) {
        expandedPanels.current.delete(code);
        return {
          ...current,
          items: current.items.filter((line) => line.code !== code && line.parentCode !== code),
        };
      }
      // 選択済みのパネルの構成項目なら、単独ではなくそのパネルにぶら下げて戻す。
      const parent = topLevelItems(current.items).find((line) =>
        (panelMembers.data?.get(line.code) ?? []).includes(code),
      );
      return { ...current, items: [...current.items, buildLine(item, parent?.code ?? "")] };
    });
  }

  function remove(code: string) {
    setValues((current) => {
      expandedPanels.current.delete(code);
      return {
        ...current,
        items: current.items.filter((line) => line.code !== code && line.parentCode !== code),
      };
    });
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
      <ErrorBanner error={layouts.error ?? panelMembers.error ?? catalog.error} />

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
        {layoutTabs.map((tab) => {
          const selected = active?.kind === "layout" && active.id === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              className={selected ? "lab-order-item__tab is-active" : "lab-order-item__tab"}
              onClick={() => setActive({ kind: "layout", id: tab.id })}
            >
              {tab.name}
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
          layout={layout.data}
          error={layout.error}
          catalogByCode={catalogByCode}
          selectedCodes={selectedCodes}
          onToggle={toggle}
        />
      )}
      {active?.kind === "search" && (
        <ItemSearchTab
          selectedCodes={selectedCodes}
          onToggle={toggle}
          onResults={setSearchCodes}
        />
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
  onToggle: (item: LabOrderItem) => void;
}

// 検査伝票のグリッド。マス割りはレイアウトマスタの定義そのままで、
// 検査項目のマスにチェックボックスを重ねる。
function LayoutSelectGrid({
  layout,
  error,
  catalogByCode,
  selectedCodes,
  onToggle,
}: SelectProps & {
  layout: ReturnType<typeof useLabOrderItemLayout>["data"];
  error: unknown;
  catalogByCode: Map<string, LabOrderItem>;
}) {
  if (!layout) {
    return <ErrorBanner error={error} />;
  }

  const cellsByPosition = new Map(
    layout.cells.map((cell) => [`${cell.grid_row}-${cell.grid_column}`, cell]),
  );
  const rows = Array.from({ length: layout.row_count }, (_, i) => i + 1);
  const columns = Array.from({ length: layout.column_count }, (_, i) => i + 1);

  return (
    <div className="lab-order-panel__grid-wrap">
      <ErrorBanner error={error} />
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
                const master = catalogByCode.get(code);
                return (
                  <td key={column} className="lab-order-panel__cell">
                    <label>
                      <input
                        type="checkbox"
                        checked={selectedCodes.has(code)}
                        // マスタ行が届く前に押されると検体が空のまま入ってしまうので、
                        // 揃うまでは押せないようにする。
                        disabled={!master}
                        onChange={() => master && onToggle(master)}
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
function ItemSearchTab({
  selectedCodes,
  onToggle,
  onResults,
}: SelectProps & { onResults: (codes: string[]) => void }) {
  const [name, setName] = useState("");
  const [page, setPage] = useState(1);
  // 期限切れの項目を出しても選べないだけなので、有効期間内に絞る。
  const result = useLabOrderItemSearch({ name, active: true }, page, name.trim().length > 0);

  const data = result.data;
  const hasNext = data ? page * data.per < data.total : false;

  // 検索でしか出てこない項目のパネル構成もフォーム側で先に引いておく。
  useEffect(() => {
    onResults((data?.items ?? []).map((item) => item.order_item_code));
  }, [data, onResults]);

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
                    onChange={() => onToggle(item)}
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
// 確かめる形に合わせる。パネルの構成項目は親の下にぶら下げ、個別に外せるようにする。
function SelectionPreview({
  items,
  onRemove,
}: {
  items: LabOrderItemLine[];
  onRemove: (code: string) => void;
}) {
  const groups = groupBySpecimen(items);

  return (
    <section className="lab-order-panel__preview">
      <h3>選択中({items.length})</h3>
      {items.length === 0 && <p className="lab-order-panel__muted">検査項目を選択してください</p>}
      {groups.map((group, index) => (
        <div key={group.specimenCode || "unset"} className="lab-order-panel__group">
          <h4>
            GP{index + 1} {specimenGroupLabel(group)}
          </h4>
          <ul>
            {group.entries.map((entry) => (
              <li key={entry.item.code}>
                {entry.item.name}
                <button
                  type="button"
                  className="lab-order-panel__remove"
                  onClick={() => onRemove(entry.item.code)}
                  aria-label={`${entry.item.name} を外す`}
                >
                  ×
                </button>
                {entry.members.length > 0 && (
                  <ul className="lab-order-panel__members">
                    {entry.members.map((member) => (
                      <li key={member.code}>
                        {member.name}
                        <button
                          type="button"
                          className="lab-order-panel__remove"
                          onClick={() => onRemove(member.code)}
                          aria-label={`${member.name} をこのパネルから外す`}
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
