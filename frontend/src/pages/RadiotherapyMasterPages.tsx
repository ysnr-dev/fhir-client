import { useState, type FormEvent } from "react";
import type {
  RadiotherapyDevice,
  RadiotherapyModality,
  RadiotherapyStopReason,
  RadiotherapyTechnique,
} from "../api/masterClient";
import {
  radiotherapyDeviceHooks,
  radiotherapyModalityHooks,
  radiotherapyStopReasonHooks,
  radiotherapyTechniqueHooks,
} from "../api/masterQueries";
import { ErrorBanner } from "../components/ErrorBanner";
import { Modal } from "../components/Modal";

// 放射線治療の施設固有マスタのうち、項目が平らな 4 つ(モダリティ・照射技法・治療装置・
// 休止/中止理由)。どれも数十件で同じ作りなので、1 つの画面部品を項目の定義だけ変えて使う
// (docs/radiotherapy-order-design.md §3)。治療プロトコルは入れ子を持つので別画面。

type Row = { id: number; code: string; name: string; enabled: boolean; display_order: number | null };

interface Field<T> {
  key: keyof T & string;
  label: string;
  type: "text" | "select" | "modalities";
  options?: { code: string; display: string }[];
  /** 一覧に列として出すか。 */
  column?: boolean;
}

interface MasterHooks<T extends Row> {
  useList: () => { data?: { items: T[] }; error: unknown };
  useMutations: () => {
    create: { mutateAsync: (payload: Partial<Omit<T, "id">>) => Promise<T>; isPending: boolean; error: unknown };
    update: {
      mutateAsync: (args: { id: number; payload: Partial<Omit<T, "id">> }) => Promise<T>;
      isPending: boolean;
      error: unknown;
    };
    remove: { mutateAsync: (id: number) => Promise<void>; isPending: boolean; error: unknown };
  };
}

interface MasterPageProps<T extends Row> {
  title: string;
  itemLabel: string;
  hooks: MasterHooks<T>;
  fields: Field<T>[];
  defaults: Partial<T>;
}

function SimpleMasterPage<T extends Row>({ title, itemLabel, hooks, fields, defaults }: MasterPageProps<T>) {
  const list = hooks.useList();
  // 編集対象。"new" は新規作成。
  const [editing, setEditing] = useState<T | "new" | null>(null);
  const modalities = radiotherapyModalityHooks.useOptions();
  const columns = fields.filter((f) => f.column);

  function cell(item: T, field: Field<T>): string {
    const value = item[field.key];
    if (field.type === "modalities") {
      return (value as string[])
        .map((code) => modalities.items.find((m) => m.code === code)?.name ?? code)
        .join("・");
    }
    if (field.type === "select") {
      return field.options?.find((o) => o.code === value)?.display ?? String(value ?? "");
    }
    return String(value ?? "");
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>{title}</h1>
        <div className="page__header-actions">
          <button type="button" onClick={() => setEditing("new")}>
            {itemLabel}を追加
          </button>
        </div>
      </div>

      <ErrorBanner error={list.error} />

      <table className="master-search__table">
        <thead>
          <tr>
            <th>コード</th>
            <th>名称</th>
            {columns.map((field) => (
              <th key={field.key}>{field.label}</th>
            ))}
            <th className="rad-item__compact">表示順</th>
            <th className="rad-item__compact">状態</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.items.map((item) => (
            <tr key={item.id} onClick={() => setEditing(item)} className="master-search__row">
              <td>{item.code}</td>
              <td>{item.name}</td>
              {columns.map((field) => (
                <td key={field.key}>{cell(item, field)}</td>
              ))}
              <td className="rad-item__compact">{item.display_order}</td>
              <td className="rad-item__compact">
                {!item.enabled && <span className="dose-conversion__badge">無効</span>}
              </td>
            </tr>
          ))}
          {list.data && list.data.items.length === 0 && (
            <tr>
              <td colSpan={columns.length + 4} className="master-search__empty">
                {itemLabel}がありません
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {editing !== null && (
        <EditModal
          itemLabel={itemLabel}
          hooks={hooks}
          fields={fields}
          record={editing === "new" ? null : editing}
          defaults={defaults}
          modalityOptions={modalities.items}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function EditModal<T extends Row>({
  itemLabel,
  hooks,
  fields,
  record,
  defaults,
  modalityOptions,
  onClose,
}: {
  itemLabel: string;
  hooks: MasterHooks<T>;
  fields: Field<T>[];
  record: T | null;
  defaults: Partial<T>;
  modalityOptions: RadiotherapyModality[];
  onClose: () => void;
}) {
  const mutations = hooks.useMutations();
  const [draft, setDraft] = useState<Record<string, unknown>>(() => ({
    code: "",
    name: "",
    enabled: true,
    display_order: "",
    ...defaults,
    ...(record ?? {}),
    ...(record ? { display_order: record.display_order ?? "" } : {}),
  }));

  const set = (key: string, value: unknown) => setDraft((d) => ({ ...d, [key]: value }));

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const payload: Record<string, unknown> = {
      code: draft.code,
      name: draft.name,
      enabled: draft.enabled,
      display_order: draft.display_order === "" ? null : Number(draft.display_order),
    };
    for (const field of fields) {
      const value = draft[field.key];
      payload[field.key] = field.type === "modalities" ? (value ?? []) : value === "" ? null : value;
    }
    if (record === null) await mutations.create.mutateAsync(payload as Partial<Omit<T, "id">>);
    else await mutations.update.mutateAsync({ id: record.id, payload: payload as Partial<Omit<T, "id">> });
    onClose();
  }

  async function handleDelete() {
    if (record === null) return;
    if (!window.confirm(`${record.name} を削除しますか？`)) return;
    await mutations.remove.mutateAsync(record.id);
    onClose();
  }

  return (
    <Modal
      title={record === null ? `${itemLabel}を追加` : `${itemLabel}を編集`}
      onClose={onClose}
      className="modal--lab-order-item"
    >
      <form onSubmit={handleSubmit}>
        <div className="lab-order-item__fields">
          <label>
            コード
            <input
              type="text"
              value={String(draft.code ?? "")}
              onChange={(e) => set("code", e.target.value)}
              disabled={record !== null}
              required
            />
          </label>
          <label>
            名称
            <input
              type="text"
              value={String(draft.name ?? "")}
              onChange={(e) => set("name", e.target.value)}
              required
            />
          </label>
          {fields
            .filter((field) => field.type !== "modalities")
            .map((field) => (
              <label key={field.key}>
                {field.label}
                {field.type === "select" ? (
                  <select
                    value={String(draft[field.key] ?? "")}
                    onChange={(e) => set(field.key, e.target.value)}
                  >
                    {field.options?.map((o) => (
                      <option key={o.code} value={o.code}>
                        {o.display}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={String(draft[field.key] ?? "")}
                    onChange={(e) => set(field.key, e.target.value)}
                  />
                )}
              </label>
            ))}
          <label>
            表示順
            <input
              type="number"
              value={String(draft.display_order ?? "")}
              onChange={(e) => set("display_order", e.target.value)}
            />
          </label>
        </div>

        {fields
          .filter((field) => field.type === "modalities")
          .map((field) => {
            const selected = (draft[field.key] as string[] | undefined) ?? [];
            return (
              <fieldset key={field.key}>
                <legend>{field.label}</legend>
                {modalityOptions.map((m) => (
                  <label key={m.code} className="dose-conversion__checkbox">
                    <input
                      type="checkbox"
                      checked={selected.includes(m.code)}
                      onChange={(e) =>
                        set(
                          field.key,
                          e.target.checked
                            ? [...selected, m.code]
                            : selected.filter((code) => code !== m.code),
                        )
                      }
                    />
                    {m.name}
                  </label>
                ))}
              </fieldset>
            );
          })}

        <label className="dose-conversion__checkbox">
          <input
            type="checkbox"
            checked={Boolean(draft.enabled)}
            onChange={(e) => set("enabled", e.target.checked)}
          />
          有効
        </label>

        <ErrorBanner
          error={mutations.create.error ?? mutations.update.error ?? mutations.remove.error}
        />

        <div className="lab-order-item__actions">
          <button type="submit" disabled={mutations.create.isPending || mutations.update.isPending}>
            保存
          </button>
          {record !== null && (
            <button type="button" onClick={handleDelete} disabled={mutations.remove.isPending}>
              削除
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}

const DEVICE_TYPE_OPTIONS = [
  { code: "linac", display: "リニアック" },
  { code: "tomotherapy", display: "トモセラピー" },
  { code: "stereotactic", display: "定位照射専用装置" },
  { code: "particle", display: "粒子線治療装置" },
  { code: "brachytherapy", display: "小線源治療装置" },
  { code: "other", display: "その他" },
];

const STOP_REASON_KIND_OPTIONS = [
  { code: "both", display: "休止・中止" },
  { code: "suspend", display: "休止" },
  { code: "terminate", display: "中止" },
];

export function RadiotherapyModalityPage() {
  return (
    <SimpleMasterPage<RadiotherapyModality>
      title="照射モダリティマスタ"
      itemLabel="モダリティ"
      hooks={radiotherapyModalityHooks}
      defaults={{ dose_unit: "Gy" }}
      fields={[
        { key: "dose_unit", label: "線量の単位", type: "text", column: true },
        { key: "reference_system", label: "標準コードの体系", type: "text" },
        { key: "reference_code", label: "標準コード", type: "text", column: true },
        { key: "note", label: "備考", type: "text" },
      ]}
    />
  );
}

export function RadiotherapyTechniquePage() {
  return (
    <SimpleMasterPage<RadiotherapyTechnique>
      title="照射技法マスタ"
      itemLabel="照射技法"
      hooks={radiotherapyTechniqueHooks}
      defaults={{ modality_codes: [] }}
      fields={[
        { key: "abbreviation", label: "略称", type: "text", column: true },
        { key: "modality_codes", label: "選べるモダリティ", type: "modalities", column: true },
        { key: "reference_system", label: "標準コードの体系", type: "text" },
        { key: "reference_code", label: "標準コード", type: "text", column: true },
        { key: "note", label: "備考", type: "text" },
      ]}
    />
  );
}

export function RadiotherapyDevicePage() {
  return (
    <SimpleMasterPage<RadiotherapyDevice>
      title="放射線治療装置マスタ"
      itemLabel="治療装置"
      hooks={radiotherapyDeviceHooks}
      defaults={{ device_type: "linac", modality_codes: [] }}
      fields={[
        { key: "device_type", label: "装置種別", type: "select", options: DEVICE_TYPE_OPTIONS, column: true },
        { key: "modality_codes", label: "対応モダリティ", type: "modalities", column: true },
        { key: "note", label: "備考", type: "text" },
      ]}
    />
  );
}

export function RadiotherapyStopReasonPage() {
  return (
    <SimpleMasterPage<RadiotherapyStopReason>
      title="放射線治療 休止・中止理由マスタ"
      itemLabel="理由"
      hooks={radiotherapyStopReasonHooks}
      defaults={{ kind: "both" }}
      fields={[
        { key: "kind", label: "区分", type: "select", options: STOP_REASON_KIND_OPTIONS, column: true },
      ]}
    />
  );
}
