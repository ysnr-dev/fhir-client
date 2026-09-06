import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { OrderSetDetail, OrderSetScope } from "../api/masterClient";
import { useOrderSet, useOrderSets } from "../api/masterQueries";
import { useCreatePrescription, useKarteConditions, usePatient } from "../api/queries";
import { nextProblemNumber, splitConditions, type ProblemRef } from "../fhir/conditionHelpers";
import {
  isOrderSetOrderType,
  mergeTransactionBundles,
  migrateEntryValues,
  sortConditionsFirst,
  stampOrderSetInstance,
  type OrderSetOrderType,
} from "../fhir/orderSetHelpers";
import { useDefaultOrderSetting } from "../hooks/useDefaultOrderSetting";
import { useOrderContext } from "../hooks/useOrderContext";
import { useStackedOrderForms } from "../hooks/useStackedOrderForms";
import { ErrorBanner } from "./ErrorBanner";
import { ORDER_SET_TYPE_LABELS, ORDER_SET_TYPES } from "./orderSetRegistry";
import { buildOrderSetTree, type OrderSetNode } from "./orderSetTree";
import { findSettingDisplay } from "../fhir/shared";
import { today } from "../lib/dates";

// カルテ右ペインの「セット適用」。セットを選ぶと、中のオーダーが通常の登録フォームの
// まま縦に並ぶ。除外するものはチェックを外し、直したいものはその場で直して、最後に
// 「一括登録」で 1 つの transaction として登録する(全部登録か全部失敗かのどちらか)。
//
// セットの持ち主は OrderContext 基準: 院内共通 / ヘッダーで選んだ依頼科 / 指示医師。
// 代行入力(医師以外のログイン)では「医師」ルートはログインユーザーではなく指示医師の
// セットになる(セットは「その医師がいつも出す組み合わせ」なので)。

interface OrderSetApplyPanelProps {
  patientId: string;
  /** 未選択ならセット選択のツリーを出す。 */
  setId?: number;
  defaultProblem?: ProblemRef;
  onSelectSet: (setId: number) => void;
  /** セット選択に戻る(選んだセットを外す)。 */
  onBack: () => void;
  onSaved: () => void;
}

export function OrderSetApplyPanel({
  patientId,
  setId,
  defaultProblem,
  onSelectSet,
  onBack,
  onSaved,
}: OrderSetApplyPanelProps) {
  if (!setId) return <OrderSetPicker onSelect={onSelectSet} />;
  return (
    <OrderSetApplyLoader
      patientId={patientId}
      setId={setId}
      defaultProblem={defaultProblem}
      onBack={onBack}
      onSaved={onSaved}
    />
  );
}

function OrderSetPicker({ onSelect }: { onSelect: (setId: number) => void }) {
  const context = useOrderContext();
  const sets = useOrderSets(context.departmentId || undefined, context.practitionerId || undefined);
  const items = sets.data?.items ?? [];
  const [scope, setScope] = useState<OrderSetScope>("facility");
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  // 持ち主はタブで切り替える(3 つ並べると縦に長くなり、目当てのセットが探しにくい)。
  // 診療科・医師はヘッダーで選んでいる依頼科と指示医師。
  const tabs: { scope: OrderSetScope; label: string; ownerId: string | null }[] = [
    { scope: "facility", label: "院内共通", ownerId: null },
    { scope: "department", label: context.departmentName || "診療科", ownerId: context.departmentId || null },
    { scope: "practitioner", label: context.practitionerName || "医師", ownerId: context.practitionerId || null },
  ];
  const active = tabs.find((tab) => tab.scope === scope) ?? tabs[0];
  const tree = buildOrderSetTree(items, active.scope, active.ownerId);

  function toggle(id: number) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function renderNode(node: OrderSetNode) {
    const { set, children } = node;
    // 無効にしたセットは選択に出さない(フォルダは中に有効なセットがあれば出す)。
    if (set.kind === "set" && !set.active) return null;
    const isFolder = set.kind === "folder";
    const isCollapsed = collapsed.has(set.id);
    return (
      <li key={set.id}>
        <div className={`order-set-tree__row${isFolder ? " order-set-tree__row--folder" : ""}`}>
          {isFolder ? (
            <button
              type="button"
              className="order-set-tree__toggle"
              aria-label={isCollapsed ? `${set.name} を展開` : `${set.name} を折りたたむ`}
              onClick={() => toggle(set.id)}
            >
              {isCollapsed ? "▶" : "▼"}
            </button>
          ) : (
            <span className="order-set-tree__leaf" aria-hidden="true" />
          )}
          <button
            type="button"
            className="order-set-tree__name"
            onClick={() => (isFolder ? toggle(set.id) : onSelect(set.id))}
          >
            {set.name}
          </button>
        </div>
        {isFolder && !isCollapsed && children.length > 0 && (
          <ul className="order-set-tree__children">{children.map(renderNode)}</ul>
        )}
      </li>
    );
  }

  return (
    <div className="order-set-picker">
      <div className="order-set-picker__tabs" role="tablist" aria-label="セットの持ち主">
        {tabs.map((tab) => (
          <button
            key={tab.scope}
            type="button"
            role="tab"
            aria-selected={tab.scope === active.scope}
            className={`order-set-picker__tab${tab.scope === active.scope ? " order-set-picker__tab--active" : ""}`}
            onClick={() => setScope(tab.scope)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <ErrorBanner error={sets.error} />
      {sets.isPending ? (
        <p>読み込み中...</p>
      ) : tree.length === 0 ? (
        <p className="order-set__empty">セットはありません。</p>
      ) : (
        <ul className="order-set-tree">{tree.map(renderNode)}</ul>
      )}
    </div>
  );
}

// セットの中身・患者の在院状況・患者の病名が揃ってからフォームを積む(初期値は初回描画時のみ)。
function OrderSetApplyLoader({
  patientId,
  setId,
  defaultProblem,
  onBack,
  onSaved,
}: {
  patientId: string;
  setId: number;
  defaultProblem?: ProblemRef;
  onBack: () => void;
  onSaved: () => void;
}) {
  const detail = useOrderSet(setId);
  const defaultSetting = useDefaultOrderSetting(patientId);
  const { data: patientResult, isPending: patientPending } = usePatient(patientId);
  // 病名エントリの重複判定(同じ病名が継続中か)と親プロブレム候補に使う。
  const karte = useKarteConditions(patientId);
  if (detail.isPending || !defaultSetting.ready || patientPending || karte.isPending) {
    return <p>読み込み中...</p>;
  }
  if (!detail.data) return <ErrorBanner error={detail.error} />;
  return (
    <OrderSetApplyForms
      patientId={patientId}
      set={detail.data}
      defaultProblem={defaultProblem}
      defaultSetting={defaultSetting}
      patient={patientResult?.data}
      conditions={karte.conditions}
      onBack={onBack}
      onSaved={onSaved}
    />
  );
}

interface ApplyEntry {
  id: number;
  orderType: OrderSetOrderType;
  initialValues: unknown;
  label: string;
  /** セット側の入外区分(患者の在院状況と食い違うときに注意を出す)。 */
  setting: string;
  unsupported: boolean;
  /** 患者に同じものが既にあって登録しない理由(病名)。あればチェックを入れさせない。 */
  duplicateNote: string | null;
  included: boolean;
  collapsed: boolean;
}

function OrderSetApplyForms({
  patientId,
  set,
  defaultProblem,
  defaultSetting,
  patient,
  conditions,
  onBack,
  onSaved,
}: {
  patientId: string;
  set: OrderSetDetail;
  defaultProblem?: ProblemRef;
  defaultSetting: ReturnType<typeof useDefaultOrderSetting>;
  patient?: fhir4.Patient;
  conditions: fhir4.Condition[];
  onBack: () => void;
  onSaved: () => void;
}) {
  const requester = useOrderContext();
  const create = useCreatePrescription();
  const queryClient = useQueryClient();
  const stack = useStackedOrderForms<number>();
  const [error, setError] = useState<string | null>(null);
  // セット全体の適用日。変えると各フォームの開始日に入る(予約する項目は動かない)。
  const [applyDate, setApplyDate] = useState(today());

  // 病名はオーダーより上に出す(登録画面と同じ並び)。
  const initialEntries = useMemo<ApplyEntry[]>(
    () =>
      sortConditionsFirst(set.entries.map((entry) => {
        const orderType = isOrderSetOrderType(entry.order_type) ? entry.order_type : null;
        const def = orderType ? ORDER_SET_TYPES[orderType] : undefined;
        const migrated = orderType
          ? migrateEntryValues(orderType, entry.schema_version, entry.values)
          : { values: entry.values, unsupported: true };
        const unsupported = !def || migrated.unsupported;
        // DO と同じ正規化(日付を当日に、入外区分を患者の在院状況に)をしてから、
        // カルテで選択中のプロブレムを対象にする。
        const values =
          def && !unsupported
            ? {
                ...(def.buildDoValues(migrated.values, defaultSetting.setting) as object),
                problem: defaultProblem ?? null,
              }
            : null;
        const duplicateNote =
          def && !unsupported && values ? (def.duplicateNote?.(values, { conditions }) ?? null) : null;
        return {
          id: entry.id,
          orderType: orderType ?? "prescription",
          initialValues: values,
          label: entry.label ?? "",
          setting: def && !unsupported ? def.settingOf(migrated.values) : "",
          unsupported,
          duplicateNote,
          // 患者に同じものが既にあるエントリは外しておく(病名の二重登録を防ぐ)。
          included: !unsupported && duplicateNote === null,
          // 一覧として見渡せるよう既定は閉じておき、直したいものだけ開く。
          collapsed: true,
        };
      })),
    [set, defaultSetting.setting, defaultProblem, conditions],
  );
  const [entries, setEntries] = useState(initialEntries);

  function patch(id: number, changes: Partial<ApplyEntry>) {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...changes } : e)));
  }

  // 1 つでも開いていれば「すべて閉じる」、全部閉じていれば「すべて開く」。
  const anyOpen = entries.some((e) => !e.collapsed);
  function toggleAll() {
    setEntries((prev) => prev.map((e) => ({ ...e, collapsed: anyOpen })));
  }

  function handleRegister() {
    const included = entries.filter((e) => e.included && !e.unsupported);
    if (included.length === 0) {
      setError("登録する項目を 1 件以上選んでください。");
      return;
    }
    const result = stack.submitAll(included.map((e) => e.id));
    if (!result.ok) {
      const failed = entries.find((e) => e.id === result.failedKey);
      setError(`「${failed ? ORDER_SET_TYPE_LABELS[failed.orderType] : ""}」の入力を確認してください。`);
      if (failed) {
        patch(failed.id, { collapsed: false });
        stack.scrollTo(failed.id);
      }
      return;
    }
    const { collected } = result;

    // 画面で直した結果、患者に既にあるものと同じになったエントリは登録しない
    // (初期化時の判定は元の値に対するものなので、ここで最終値を見直す)。
    for (const entry of included) {
      const def = ORDER_SET_TYPES[entry.orderType]!;
      const note = def.duplicateNote?.(collected.get(entry.id)!.values, { conditions });
      if (note) {
        setError(`「${ORDER_SET_TYPE_LABELS[entry.orderType]}」: ${note}`);
        patch(entry.id, { collapsed: false });
        stack.scrollTo(entry.id);
        return;
      }
    }
    setError(null);

    // プロブレム番号は既存の最大値 +1 から、この適用の中で順に振る。
    let nextNumber = nextProblemNumber(splitConditions(conditions).problems);
    const allocateProblemNumber = () => nextNumber++;

    const built = included.map((entry) => {
      const def = ORDER_SET_TYPES[entry.orderType]!;
      const submitted = collected.get(entry.id)!;
      return def.buildBundle({
        values: submitted.values,
        extra: submitted.extra,
        patientId,
        requester,
        defaultSetting,
        patient,
        allocateProblemNumber,
      });
    });
    // 全種別を 1 つの transaction にまとめ、ヘッダにどのセットから出したかの印を焼く。
    // 来歴(Provenance)は useCreatePrescription が付ける(16 種別すべてと同じ道)。
    const bundle = stampOrderSetInstance(
      mergeTransactionBundles(built.map((b) => b.bundle)),
      { code: set.code, name: set.name },
    );
    create.mutate(bundle, {
      onSuccess: () => {
        for (const key of built.flatMap((b) => b.invalidate)) {
          queryClient.invalidateQueries({ queryKey: key });
        }
        onSaved();
      },
    });
  }

  const includedCount = entries.filter((e) => e.included && !e.unsupported).length;

  return (
    <div className="order-set-apply">
      <div className="order-set-apply__head">
        <label className="order-set-apply__date">
          適用日
          <input type="date" value={applyDate} onChange={(e) => setApplyDate(e.target.value)} />
        </label>
        <button type="button" className="order-set-apply__toggle" onClick={toggleAll}>
          {anyOpen ? "すべて閉じる" : "すべて開く"}
        </button>
        <button type="button" className="order-set-apply__back" onClick={onBack}>
          ← セット選択
        </button>
      </div>
      <div className="order-set-stack">
        {entries.map((entry) => {
          const def = ORDER_SET_TYPES[entry.orderType];
          const settingMismatch =
            entry.setting && entry.setting !== defaultSetting.setting;
          return (
            <section
              className={`order-set-stack__item${entry.included ? "" : " order-set-stack__item--excluded"}`}
              key={entry.id}
            >
              <div className="order-set-stack__head">
                <button
                  type="button"
                  className="schema-master__cat-toggle"
                  aria-label={entry.collapsed ? "展開" : "折りたたむ"}
                  onClick={() => patch(entry.id, { collapsed: !entry.collapsed })}
                >
                  {entry.collapsed ? "▶" : "▼"}
                </button>
                <label className="dose-conversion__checkbox order-set-stack__include">
                  <input
                    type="checkbox"
                    checked={entry.included}
                    disabled={entry.unsupported || entry.duplicateNote !== null}
                    onChange={(e) => patch(entry.id, { included: e.target.checked })}
                  />
                  <span className="order-set-stack__type">{ORDER_SET_TYPE_LABELS[entry.orderType]}</span>
                </label>
                <span className="order-set-stack__label">{entry.label}</span>
              </div>
              {settingMismatch && entry.included && (
                <p className="order-set-stack__warning">
                  このセットは「{findSettingDisplay(entry.setting)}」で作られています。患者はいま
                  「{findSettingDisplay(defaultSetting.setting)}」なので、区分を確認してください。
                </p>
              )}
              {entry.duplicateNote && (
                <p className="order-set-stack__note">{entry.duplicateNote}</p>
              )}
              {/* 除外・折りたたみはアンマウントせず隠すだけ(入力中の値を保つ)。 */}
              <div
                className="order-set-stack__body"
                ref={stack.registerContainer(entry.id)}
                hidden={entry.collapsed || !entry.included}
              >
                {entry.unsupported || !def ? (
                  <p className="order-set-stack__unsupported">この種別はセットからの登録にまだ対応していません。</p>
                ) : (
                  def.renderForm({
                    patientId,
                    initialValues: entry.initialValues,
                    onSubmit: (values, ...extra) => stack.collect(entry.id, values, ...extra),
                    submitting: create.isPending,
                    mode: "order",
                    bulkStartDate: applyDate,
                    conditions,
                  })
                )}
              </div>
            </section>
          );
        })}
      </div>

      {error && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{error}</p>
        </div>
      )}
      <ErrorBanner error={create.error} />

      <div className="prescription-form__submit order-set-apply__submit">
        <button type="button" onClick={handleRegister} disabled={create.isPending || includedCount === 0}>
          {create.isPending ? "送信中..." : `一括登録(${includedCount}件)`}
        </button>
      </div>
    </div>
  );
}
