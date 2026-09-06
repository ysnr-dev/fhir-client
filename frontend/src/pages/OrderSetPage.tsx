import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useCurrentPractitioner } from "../api/authQueries";
import type { OrderSet, OrderSetDetail, OrderSetEntryPayload, OrderSetScope } from "../api/masterClient";
import { useOrderSet, useOrderSetMutations, useOrderSets } from "../api/masterQueries";
import { usePractitionerRoles } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { Modal } from "../components/Modal";
import {
  ORDER_SET_TYPE_LABELS,
  ORDER_SET_TYPE_ORDER,
  ORDER_SET_TYPES,
} from "../components/orderSetRegistry";
import {
  buildOrderSetTree,
  flattenFoldersForSelect,
  siblingsOf,
  type OrderSetNode,
} from "../components/orderSetTree";
import {
  ORDER_SET_SCHEMA_VERSION,
  isOrderSetOrderType,
  migrateEntryValues,
  type OrderSetOrderType,
} from "../fhir/orderSetHelpers";
import {
  baseRoleOf,
  isDoctorRoleCode,
  parseDepartmentRoles,
  parsePractitionerRole,
} from "../fhir/practitionerRoleHelpers";
import { useStackedOrderForms } from "../hooks/useStackedOrderForms";

// オーダーセット(よく出すオーダーのひとまとめ)の登録画面。左ペインで 3 つの持ち主
// (院内共通 / 診療科 / 自分)ごとのフォルダ・セットのツリーを管理し、右ペインで
// 選んだセットの中身を、通常のオーダー登録と同じフォームを縦に積んで編集する。
//
// 権限は画面側で判定する(backend は職種を知らない。docs/order-set-design.md §3):
//   院内共通 … 医師なら誰でも / 診療科 … その科を担当する医師 / 自分 … 本人(医師)
// 医師以外は全ルート閲覧のみ。

/** ツリーのルート 1 つぶん(持ち主)。 */
interface Owner {
  scope: OrderSetScope;
  ownerId: string | null;
  ownerName: string | null;
  label: string;
  canEdit: boolean;
}

type Selection =
  | { kind: "set"; id: number }
  | { kind: "new"; owner: Owner; parentId: number | null }
  | null;

type FolderEditing =
  | { mode: "new"; owner: Owner; parentId: number | null }
  | { mode: "edit"; owner: Owner; folder: OrderSet }
  | null;

export function OrderSetPage() {
  const { practitionerId, practitioner } = useCurrentPractitioner();
  const practitionerRoles = usePractitionerRoles(practitionerId ?? undefined);
  // 右ペインにオーダーフォームを積むので、部門一覧と同じく本文の幅制限を外す。
  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);
  const baseRole = baseRoleOf(practitionerRoles.roles);
  const isDoctor = isDoctorRoleCode(
    baseRole ? parsePractitionerRole(baseRole).roleCode : undefined,
  );
  const myDepartments = useMemo(
    () => parseDepartmentRoles(practitionerRoles.roles),
    [practitionerRoles.roles],
  );

  // 診療科ルートに出す科。担当科の先頭(既定科)を初期値にする。
  const [departmentId, setDepartmentId] = useState("");
  useEffect(() => {
    if (!departmentId && myDepartments.length > 0) setDepartmentId(myDepartments[0].organizationId);
  }, [departmentId, myDepartments]);
  const department = myDepartments.find((d) => d.organizationId === departmentId);

  const owners: Owner[] = useMemo(() => {
    const practitionerName = practitioner
      ? practitioner.name?.[0]?.text ||
        [practitioner.name?.[0]?.family, ...(practitioner.name?.[0]?.given ?? [])].filter(Boolean).join(" ")
      : "";
    return [
      { scope: "facility", ownerId: null, ownerName: null, label: "院内共通", canEdit: isDoctor },
      {
        scope: "department",
        ownerId: department?.organizationId ?? null,
        ownerName: department?.name ?? null,
        label: department?.name ?? "診療科",
        canEdit: isDoctor && Boolean(department),
      },
      {
        scope: "practitioner",
        ownerId: practitionerId,
        ownerName: practitionerName || null,
        label: "自分のセット",
        canEdit: isDoctor && Boolean(practitionerId),
      },
    ];
  }, [isDoctor, department, practitionerId, practitioner]);

  const setsQuery = useOrderSets(departmentId || undefined, practitionerId ?? undefined);
  const items = setsQuery.data?.items ?? [];
  const mutations = useOrderSetMutations();

  // 持ち主はタブで切り替える(カルテのセット選択と同じ)。
  const [scope, setScope] = useState<OrderSetScope>("facility");
  const [selected, setSelected] = useState<Selection>(null);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [folderEditing, setFolderEditing] = useState<FolderEditing>(null);
  const [copying, setCopying] = useState<OrderSet | null>(null);

  const busy = mutations.update.isPending || mutations.remove.isPending;

  function toggleCollapse(id: number) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // 同じ親の兄弟内で隣と入れ替え、変わった行だけ 1 始まりの連番へ振り直す。
  function move(owner: Owner, node: OrderSet, direction: -1 | 1) {
    const siblings = siblingsOf(items, owner.scope, owner.ownerId, node.parent_id);
    const index = siblings.findIndex((s) => s.id === node.id);
    const target = siblings[index + direction];
    if (!target) return;
    siblings[index + direction] = siblings[index];
    siblings[index] = target;
    siblings.forEach((sibling, position) => {
      const display_order = position + 1;
      if (sibling.display_order === display_order) return;
      mutations.update.mutate({ id: sibling.id, payload: { display_order } });
    });
  }

  function remove(node: OrderSet) {
    const kind = node.kind === "folder" ? "フォルダ" : "セット";
    if (!window.confirm(`${kind}「${node.name}」を削除しますか？`)) return;
    if (selected?.kind === "set" && selected.id === node.id) setSelected(null);
    mutations.remove.mutate(node.id);
  }

  function renderNode(owner: Owner, node: OrderSetNode) {
    const { set, children } = node;
    const siblings = siblingsOf(items, owner.scope, owner.ownerId, set.parent_id);
    const index = siblings.findIndex((s) => s.id === set.id);
    const isCollapsed = collapsed.has(set.id);
    const isSelected = selected?.kind === "set" && selected.id === set.id;
    const isFolder = set.kind === "folder";

    return (
      <li key={set.id}>
        <div
          className={`order-set-tree__row${isFolder ? " order-set-tree__row--folder" : ""}${
            isSelected ? " is-selected" : ""
          }${set.active ? "" : " order-set__row--inactive"}`}
        >
          {isFolder ? (
            <button
              type="button"
              className="order-set-tree__toggle"
              aria-label={isCollapsed ? `${set.name} を展開` : `${set.name} を折りたたむ`}
              onClick={() => toggleCollapse(set.id)}
            >
              {isCollapsed ? "▶" : "▼"}
            </button>
          ) : (
            <span className="order-set-tree__leaf" aria-hidden="true" />
          )}
          <button
            type="button"
            className="order-set-tree__name"
            onClick={() => (isFolder ? toggleCollapse(set.id) : setSelected({ kind: "set", id: set.id }))}
          >
            {set.name}
          </button>
          <span className="schema-master__cat-actions">
            <button
              type="button"
              aria-label={`${set.name} を上へ`}
              disabled={index <= 0 || busy || !owner.canEdit}
              onClick={() => move(owner, set, -1)}
            >
              ↑
            </button>
            <button
              type="button"
              aria-label={`${set.name} を下へ`}
              disabled={index === siblings.length - 1 || busy || !owner.canEdit}
              onClick={() => move(owner, set, 1)}
            >
              ↓
            </button>
            {isFolder ? (
              <>
                <button
                  type="button"
                  title="このフォルダにフォルダを追加"
                  disabled={busy || !owner.canEdit}
                  onClick={() => setFolderEditing({ mode: "new", owner, parentId: set.id })}
                >
                  +フォルダ
                </button>
                <button
                  type="button"
                  title="このフォルダにセットを追加"
                  disabled={busy || !owner.canEdit}
                  onClick={() => setSelected({ kind: "new", owner, parentId: set.id })}
                >
                  +セット
                </button>
                <button
                  type="button"
                  title="フォルダ名を変更"
                  disabled={busy || !owner.canEdit}
                  onClick={() => setFolderEditing({ mode: "edit", owner, folder: set })}
                >
                  編集
                </button>
              </>
            ) : (
              // 複製は別の持ち主へも置けるので、閲覧しかできない持ち主のセットからも出せる
              // (院内共通のセットを自分用に写して育てる、など)。
              <button
                type="button"
                title="セットを複製"
                disabled={busy || !isDoctor}
                onClick={() => setCopying(set)}
              >
                複製
              </button>
            )}
            <button
              type="button"
              title="削除"
              disabled={busy || !owner.canEdit}
              onClick={() => remove(set)}
            >
              削除
            </button>
          </span>
        </div>
        {isFolder && !isCollapsed && children.length > 0 && (
          <ul className="order-set-tree__children">
            {children.map((child) => renderNode(owner, child))}
          </ul>
        )}
      </li>
    );
  }

  const activeOwner = owners.find((o) => o.scope === scope) ?? owners[0];
  const tree = buildOrderSetTree(items, activeOwner.scope, activeOwner.ownerId);

  return (
    <div className="page order-set-page">
      <div className="page__header">
        <h1>セット登録</h1>
      </div>

      <ErrorBanner error={setsQuery.error} />
      <ErrorBanner error={mutations.update.error ?? mutations.remove.error} />
      {!practitionerRoles.isPending && !isDoctor && (
        <p className="order-set__notice">セットの登録・変更は医師のみ行えます(閲覧はできます)。</p>
      )}

      <div className="schema-master order-set">
        <div className="schema-master__categories order-set__tree">
          <div className="order-set-picker__tabs" role="tablist" aria-label="セットの持ち主">
            {owners.map((owner) => (
              <button
                key={owner.scope}
                type="button"
                role="tab"
                aria-selected={owner.scope === activeOwner.scope}
                className={`order-set-picker__tab${
                  owner.scope === activeOwner.scope ? " order-set-picker__tab--active" : ""
                }`}
                // 別の持ち主に切り替えたら、右ペインに前の持ち主のセットを残さない。
                onClick={() => {
                  setScope(owner.scope);
                  setSelected(null);
                }}
              >
                {owner.label}
              </button>
            ))}
          </div>
          <div className="order-set__tree-head">
            {activeOwner.scope === "department" && myDepartments.length > 1 && (
              <select
                value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value)}
                aria-label="診療科"
              >
                {myDepartments.map((d) => (
                  <option key={d.organizationId} value={d.organizationId}>
                    {d.name}
                  </option>
                ))}
              </select>
            )}
            <span className="schema-master__cat-actions order-set__root-actions">
              <button
                type="button"
                disabled={busy || !activeOwner.canEdit}
                onClick={() => setFolderEditing({ mode: "new", owner: activeOwner, parentId: null })}
              >
                +フォルダ
              </button>
              <button
                type="button"
                disabled={busy || !activeOwner.canEdit}
                onClick={() => setSelected({ kind: "new", owner: activeOwner, parentId: null })}
              >
                +セット
              </button>
            </span>
          </div>
          {tree.length === 0 ? (
            <p className="order-set__empty">セットはありません。</p>
          ) : (
            <ul className="order-set-tree">{tree.map((node) => renderNode(activeOwner, node))}</ul>
          )}
        </div>

        <div className="schema-master__schemas order-set__editor">
          {selected === null ? (
            <p className="karte-right__placeholder">
              左のツリーからセットを選ぶか、「+セット」で新しいセットを作ってください。
            </p>
          ) : selected.kind === "new" ? (
            <SetEditor
              key={`new:${selected.owner.scope}:${selected.parentId ?? ""}`}
              owner={selected.owner}
              set={null}
              initialParentId={selected.parentId}
              items={items}
              onSaved={(id) => setSelected({ kind: "set", id })}
            />
          ) : (
            <SetEditorLoader
              key={`set:${selected.id}`}
              id={selected.id}
              owners={owners}
              items={items}
              onSaved={(id) => setSelected({ kind: "set", id })}
            />
          )}
        </div>
      </div>

      {folderEditing && (
        <FolderEditModal editing={folderEditing} items={items} onClose={() => setFolderEditing(null)} />
      )}
      {copying && (
        <CopyModal
          source={copying}
          owners={owners}
          items={items}
          onClose={() => setCopying(null)}
          onCopied={(id) => {
            setCopying(null);
            setSelected({ kind: "set", id });
          }}
        />
      )}
    </div>
  );
}

// 保存済みセットは中身(entries)を読んでからエディタを描く(フォームの初期値は
// 初回描画時にしか効かない)。持ち主は一覧ではなく読んだ本体から決める(保存直後は
// 一覧の再取得が終わっておらず、一覧に無いことがある)。
function SetEditorLoader({
  id,
  owners,
  items,
  onSaved,
}: {
  id: number;
  owners: Owner[];
  items: OrderSet[];
  onSaved: (id: number) => void;
}) {
  const detail = useOrderSet(id);
  if (detail.isPending) return <p>読み込み中...</p>;
  if (!detail.data) return <ErrorBanner error={detail.error} />;
  const set = detail.data;
  const owner = owners.find(
    (o) => o.scope === set.scope && (o.scope === "facility" || o.ownerId === set.owner_id),
  );
  // 表示中の持ち主(選んでいる診療科など)と違うセットは閲覧のみ。
  const fallback: Owner = {
    scope: set.scope,
    ownerId: set.owner_id,
    ownerName: set.owner_name,
    label: set.owner_name ?? set.scope,
    canEdit: false,
  };
  return (
    <SetEditor
      owner={owner ?? fallback}
      set={set}
      initialParentId={set.parent_id}
      items={items}
      onSaved={onSaved}
    />
  );
}

/** エディタに積んだエントリ 1 件。 */
interface LocalEntry {
  localId: number;
  orderType: OrderSetOrderType;
  /** 画面に出すフォームの初期値。対応していない種別・新しい版のときは null。 */
  initialValues: unknown;
  /** 保存済みの要約(新しく足したエントリは空)。 */
  label: string;
  /** 保存済みの生の値。対応していない種別はこれをそのまま保存し直す。 */
  raw: { order_type: string; label: string | null; values: unknown; schema_version: number } | null;
  unsupported: boolean;
  collapsed: boolean;
}

let nextLocalId = 1;

function SetEditor({
  owner,
  set,
  initialParentId,
  items,
  onSaved,
}: {
  owner: Owner;
  /** null は新規。 */
  set: OrderSetDetail | null;
  initialParentId: number | null;
  items: OrderSet[];
  onSaved: (id: number) => void;
}) {
  const mutations = useOrderSetMutations();
  const stack = useStackedOrderForms<number>();
  const [name, setName] = useState(set?.name ?? "");
  const [parentId, setParentId] = useState(initialParentId === null ? "" : String(initialParentId));
  const [active, setActive] = useState(set?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<LocalEntry[]>(() =>
    (set?.entries ?? []).map((entry) => {
      const orderType = isOrderSetOrderType(entry.order_type) ? entry.order_type : null;
      const def = orderType ? ORDER_SET_TYPES[orderType] : undefined;
      const migrated = orderType
        ? migrateEntryValues(orderType, entry.schema_version, entry.values)
        : { values: entry.values, unsupported: true };
      const unsupported = !def || migrated.unsupported;
      return {
        localId: nextLocalId++,
        orderType: orderType ?? "prescription",
        // 登録画面ではセット自身の入外区分を保ったまま、日付だけ当日で埋める。
        initialValues:
          def && !unsupported
            ? def.buildDoValues(migrated.values, def.settingOf(migrated.values) || "outpatient")
            : null,
        label: entry.label ?? "",
        raw: entry,
        unsupported,
        collapsed: false,
      };
    }),
  );

  const folderOptions = flattenFoldersForSelect(buildOrderSetTree(items, owner.scope, owner.ownerId));
  const readOnly = !owner.canEdit;
  const saving =
    mutations.create.isPending || mutations.update.isPending || mutations.replaceEntries.isPending;

  function addEntry(orderType: OrderSetOrderType) {
    const def = ORDER_SET_TYPES[orderType];
    if (!def) return;
    setEntries((prev) => [
      ...prev,
      {
        localId: nextLocalId++,
        orderType,
        initialValues: def.emptyValues("outpatient"),
        label: "",
        raw: null,
        unsupported: false,
        collapsed: false,
      },
    ]);
  }

  function moveEntry(index: number, direction: -1 | 1) {
    setEntries((prev) => {
      const next = [...prev];
      const target = next[index + direction];
      if (!target) return prev;
      next[index + direction] = next[index];
      next[index] = target;
      return next;
    });
  }

  function removeEntry(localId: number) {
    setEntries((prev) => prev.filter((e) => e.localId !== localId));
  }

  function toggleEntry(localId: number) {
    setEntries((prev) =>
      prev.map((e) => (e.localId === localId ? { ...e, collapsed: !e.collapsed } : e)),
    );
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (readOnly) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError("セット名を入力してください。");
      return;
    }
    if (entries.length === 0) {
      setError("オーダーを 1 件以上追加してください。");
      return;
    }
    const editable = entries.filter((entry) => !entry.unsupported);
    const result = stack.submitAll(editable.map((entry) => entry.localId));
    if (!result.ok) {
      const failed = entries.find((entry) => entry.localId === result.failedKey);
      setError(
        `「${failed ? ORDER_SET_TYPE_LABELS[failed.orderType] : ""}」の入力を確認してください。`,
      );
      if (failed) {
        setEntries((prev) =>
          prev.map((entry) => (entry.localId === failed.localId ? { ...entry, collapsed: false } : entry)),
        );
        stack.scrollTo(failed.localId);
      }
      return;
    }
    const { collected } = result;
    setError(null);

    const payload: OrderSetEntryPayload[] = entries.map((entry) => {
      const def = ORDER_SET_TYPES[entry.orderType];
      const submitted = collected.get(entry.localId);
      if (entry.unsupported || !def || !submitted) {
        // 対応していない種別・新しい版のエントリは触らずそのまま保存し直す。
        return {
          order_type: entry.raw?.order_type ?? entry.orderType,
          label: entry.raw?.label ?? undefined,
          values: entry.raw?.values ?? {},
          schema_version: entry.raw?.schema_version ?? ORDER_SET_SCHEMA_VERSION,
        };
      }
      return {
        order_type: entry.orderType,
        label: def.summarize(submitted.values),
        values: def.sanitize(submitted.values),
        schema_version: ORDER_SET_SCHEMA_VERSION,
      };
    });
    const parent_id = parentId === "" ? null : Number(parentId);

    try {
      if (set) {
        await mutations.update.mutateAsync({ id: set.id, payload: { name: trimmed, parent_id, active } });
        await mutations.replaceEntries.mutateAsync({ id: set.id, entries: payload });
        onSaved(set.id);
      } else {
        const created = await mutations.create.mutateAsync({
          kind: "set",
          scope: owner.scope,
          owner_id: owner.ownerId,
          owner_name: owner.ownerName,
          parent_id,
          name: trimmed,
          active,
          entries: payload,
        });
        onSaved(created.id);
      }
    } catch {
      // エラーは mutation の error を ErrorBanner で出す。
    }
  }

  return (
    <div className="order-set-editor">
      <div className="schema-master__pane-header">
        <h2>{set ? `セット: ${set.name}` : `新しいセット(${owner.label})`}</h2>
      </div>

      {/* 外側は form にしない(積んだオーダーフォームがそれぞれ form を持つため)。 */}
      <div className="lab-order-item__fields order-set-editor__fields">
        <label>
          セット名
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={readOnly}
          />
        </label>
        <label>
          置き場所
          <select value={parentId} onChange={(e) => setParentId(e.target.value)} disabled={readOnly}>
            <option value="">(最上位)</option>
            {folderOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="dose-conversion__checkbox">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            disabled={readOnly}
          />
          有効(カルテのセット選択に出す)
        </label>
      </div>

      <div className="order-set-stack">
        {entries.map((entry, index) => {
          const def = ORDER_SET_TYPES[entry.orderType];
          return (
            <section className="order-set-stack__item" key={entry.localId}>
              <div className="order-set-stack__head">
                <button
                  type="button"
                  className="schema-master__cat-toggle"
                  aria-label={entry.collapsed ? "展開" : "折りたたむ"}
                  onClick={() => toggleEntry(entry.localId)}
                >
                  {entry.collapsed ? "▶" : "▼"}
                </button>
                <span className="order-set-stack__type">{ORDER_SET_TYPE_LABELS[entry.orderType]}</span>
                <span className="order-set-stack__label">{entry.label}</span>
                <span className="schema-master__cat-actions order-set-stack__actions">
                  <button
                    type="button"
                    aria-label="上へ"
                    disabled={index === 0 || readOnly}
                    onClick={() => moveEntry(index, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label="下へ"
                    disabled={index === entries.length - 1 || readOnly}
                    onClick={() => moveEntry(index, 1)}
                  >
                    ↓
                  </button>
                  <button type="button" disabled={readOnly} onClick={() => removeEntry(entry.localId)}>
                    削除
                  </button>
                </span>
              </div>
              {/* 折りたたみはアンマウントせず隠すだけ(入力中の値を保つ)。 */}
              <div
                className="order-set-stack__body"
                ref={stack.registerContainer(entry.localId)}
                hidden={entry.collapsed}
              >
                {entry.unsupported || !def ? (
                  <p className="order-set-stack__unsupported">
                    この種別はこの画面ではまだ編集できません(保存時はそのまま残ります)。
                  </p>
                ) : (
                  def.renderForm({
                    patientId: "",
                    initialValues: entry.initialValues,
                    onSubmit: (values, ...extra) => stack.collect(entry.localId, values, ...extra),
                    submitting: saving,
                    mode: "set",
                  })
                )}
              </div>
            </section>
          );
        })}
      </div>

      {!readOnly && (
        <div className="order-set-editor__add">
          {ORDER_SET_TYPE_ORDER.map((type) => (
            <button key={type} type="button" onClick={() => addEntry(type)}>
              ＋{ORDER_SET_TYPE_LABELS[type]}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{error}</p>
        </div>
      )}
      <ErrorBanner
        error={mutations.create.error ?? mutations.update.error ?? mutations.replaceEntries.error}
      />

      {!readOnly && (
        <div className="lab-order-item__actions">
          <button type="button" onClick={handleSave} disabled={saving}>
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      )}
    </div>
  );
}

function FolderEditModal({
  editing,
  items,
  onClose,
}: {
  editing: NonNullable<FolderEditing>;
  items: OrderSet[];
  onClose: () => void;
}) {
  const mutations = useOrderSetMutations();
  const { owner } = editing;
  const [name, setName] = useState(editing.mode === "edit" ? editing.folder.name : "");
  const [parentId, setParentId] = useState<string>(() => {
    const initial = editing.mode === "edit" ? editing.folder.parent_id : editing.parentId;
    return initial === null ? "" : String(initial);
  });
  // 親フォルダの選択肢。編集時は自分自身と子孫を除外して循環を作らせない。
  const parentOptions = flattenFoldersForSelect(
    buildOrderSetTree(items, owner.scope, owner.ownerId),
    editing.mode === "edit" ? editing.folder.id : undefined,
  );

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    const parent_id = parentId === "" ? null : Number(parentId);
    if (editing.mode === "new") {
      await mutations.create.mutateAsync({
        kind: "folder",
        scope: owner.scope,
        owner_id: owner.ownerId,
        owner_name: owner.ownerName,
        parent_id,
        name: trimmed,
      });
    } else {
      await mutations.update.mutateAsync({ id: editing.folder.id, payload: { name: trimmed, parent_id } });
    }
    onClose();
  }

  return (
    <Modal title={editing.mode === "new" ? "フォルダを追加" : "フォルダを編集"} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="lab-order-item__fields">
          <label>
            フォルダ名
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            親フォルダ
            <select value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="">(最上位)</option>
              {parentOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <ErrorBanner error={mutations.create.error ?? mutations.update.error} />
        <div className="lab-order-item__actions">
          <button type="submit" disabled={mutations.create.isPending || mutations.update.isPending}>
            保存
          </button>
        </div>
      </form>
    </Modal>
  );
}

// セットの複製。持ち主を変えて写せる(自分のセットを診療科・院内共通へ昇格させる、
// 院内共通のセットを自分用に写して手を入れる)。
function CopyModal({
  source,
  owners,
  items,
  onClose,
  onCopied,
}: {
  source: OrderSet;
  owners: Owner[];
  items: OrderSet[];
  onClose: () => void;
  onCopied: (id: number) => void;
}) {
  const mutations = useOrderSetMutations();
  const editableOwners = owners.filter((o) => o.canEdit);
  const [scope, setScope] = useState<OrderSetScope>(
    editableOwners.find((o) => o.scope === source.scope)?.scope ?? editableOwners[0]?.scope ?? "practitioner",
  );
  const owner = owners.find((o) => o.scope === scope);
  const [name, setName] = useState(`${source.name}のコピー`);
  const [parentId, setParentId] = useState("");
  const folderOptions = owner
    ? flattenFoldersForSelect(buildOrderSetTree(items, owner.scope, owner.ownerId))
    : [];

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!owner) return;
    const created = await mutations.copy.mutateAsync({
      id: source.id,
      payload: {
        scope: owner.scope,
        owner_id: owner.ownerId,
        owner_name: owner.ownerName,
        parent_id: parentId === "" ? null : Number(parentId),
        name: name.trim() || undefined,
      },
    });
    onCopied(created.id);
  }

  return (
    <Modal title={`「${source.name}」を複製`} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="lab-order-item__fields">
          <label>
            複製先
            <select
              value={scope}
              onChange={(e) => {
                setScope(e.target.value as OrderSetScope);
                setParentId("");
              }}
            >
              {editableOwners.map((o) => (
                <option key={o.scope} value={o.scope}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            置き場所
            <select value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="">(最上位)</option>
              {folderOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            セット名
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
        </div>
        <ErrorBanner error={mutations.copy.error} />
        <div className="lab-order-item__actions">
          <button type="submit" disabled={mutations.copy.isPending || !owner}>
            複製
          </button>
        </div>
      </form>
    </Modal>
  );
}
