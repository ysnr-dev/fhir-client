import { useState, type FormEvent } from "react";
import type {
  RadiotherapyProtocol,
  RadiotherapyProtocolPhase,
  RadiotherapyProtocolVolume,
} from "../api/masterClient";
import {
  radiotherapyDeviceHooks,
  radiotherapyModalityHooks,
  radiotherapyProtocolHooks,
  radiotherapyTechniqueHooks,
  useRadJj1017Catalog,
} from "../api/masterQueries";
import { ErrorBanner } from "../components/ErrorBanner";
import { Modal } from "../components/Modal";
import { renderJj1017CodeOptions } from "../components/radItemOptions";
import {
  RADIOTHERAPY_INTENT_OPTIONS,
  RADIOTHERAPY_LATERALITY_OPTIONS,
  VOLUME_TYPE_OPTIONS,
  formatDose,
  radiotherapyTotalDose,
} from "../fhir/radiotherapyOrderHelpers";
import { displayOf } from "../fhir/shared";

// 放射線治療の治療プロトコル(定型処方)マスタ(docs/radiotherapy-order-design.md §3)。
//
// 「乳房温存術後 50Gy/25回 + Boost 10Gy/5回」のように、標的と Phase(線量分割)を
// ひとまとめにした施設の定型。治療処方のフォームで選ぶと展開され、展開後は自由に直せる。
// レジメンと違い承認の段階は持たない(処方のたびに放射線治療医が内容を確かめて登録する)。

interface PhaseDraft extends Omit<RadiotherapyProtocolPhase, "fractions" | "fractions_per_week" | "doses"> {
  fractions: string;
  fractions_per_week: string;
  /** volume key → 1 回線量(Gy)。 */
  doses: Record<string, string>;
}

interface Draft {
  code: string;
  name: string;
  name_kana: string;
  intent: string;
  enabled: boolean;
  display_order: string;
  note: string;
  volumes: RadiotherapyProtocolVolume[];
  phases: PhaseDraft[];
}

function newKey(): string {
  return crypto.randomUUID().slice(0, 8);
}

function emptyPhase(): PhaseDraft {
  return { label: "", modality_code: "", technique_code: "", device_code: "", fractions: "", fractions_per_week: "5", doses: {} };
}

function toDraft(record: RadiotherapyProtocol | null): Draft {
  if (!record) {
    return {
      code: "",
      name: "",
      name_kana: "",
      intent: "",
      enabled: true,
      display_order: "",
      note: "",
      volumes: [{ key: newKey(), label: "PTV1", volume_type: "PTV" }],
      phases: [emptyPhase()],
    };
  }
  return {
    code: record.code,
    name: record.name,
    name_kana: record.name_kana ?? "",
    intent: record.intent ?? "",
    enabled: record.enabled,
    display_order: record.display_order === null ? "" : String(record.display_order),
    note: record.note ?? "",
    volumes: record.volumes,
    phases: record.phases.map((p) => ({
      label: p.label ?? "",
      modality_code: p.modality_code ?? "",
      technique_code: p.technique_code ?? "",
      device_code: p.device_code ?? "",
      fractions: String(p.fractions),
      fractions_per_week: p.fractions_per_week ? String(p.fractions_per_week) : "",
      doses: Object.fromEntries(p.doses.map((d) => [d.volume_key, String(d.fraction_dose)])),
    })),
  };
}

function toPayload(draft: Draft): Partial<Omit<RadiotherapyProtocol, "id">> {
  return {
    code: draft.code,
    name: draft.name,
    name_kana: draft.name_kana || null,
    intent: draft.intent || null,
    enabled: draft.enabled,
    display_order: draft.display_order ? Number(draft.display_order) : null,
    note: draft.note || null,
    volumes: draft.volumes,
    phases: draft.phases.map((p) => ({
      label: p.label || null,
      modality_code: p.modality_code || null,
      technique_code: p.technique_code || null,
      device_code: p.device_code || null,
      fractions: Number(p.fractions),
      fractions_per_week: p.fractions_per_week ? Number(p.fractions_per_week) : null,
      doses: draft.volumes
        .filter((v) => (p.doses[v.key] ?? "") !== "")
        .map((v) => ({ volume_key: v.key, fraction_dose: Number(p.doses[v.key]) })),
    })),
  };
}

/** 「PTV 全乳房 50 Gy / 25 回、…」。一覧で定型の中身が分かるように出す。 */
function protocolDoseLabel(protocol: RadiotherapyProtocol): string {
  return protocol.volumes
    .map((volume) => {
      let cGy = 0;
      let fractions = 0;
      for (const phase of protocol.phases) {
        const dose = phase.doses.find((d) => d.volume_key === volume.key);
        if (!dose) continue;
        cGy += Math.round(dose.fraction_dose * 100) * phase.fractions;
        fractions += phase.fractions;
      }
      return fractions > 0 ? `${volume.label} ${formatDose(cGy / 100)} Gy / ${fractions} 回` : "";
    })
    .filter(Boolean)
    .join("、");
}

export function RadiotherapyProtocolPage() {
  const [input, setInput] = useState("");
  const [name, setName] = useState("");
  const list = radiotherapyProtocolHooks.useList({ name });
  const [editing, setEditing] = useState<RadiotherapyProtocol | "new" | null>(null);

  return (
    <div className="page">
      <div className="page__header">
        <h1>放射線治療プロトコルマスタ</h1>
        <div className="page__header-actions">
          <button type="button" onClick={() => setEditing("new")}>
            プロトコルを追加
          </button>
        </div>
      </div>

      <form
        className="patient-search-form"
        onSubmit={(e) => {
          e.preventDefault();
          setName(input);
        }}
      >
        <label>
          名称・カナ
          <input type="text" value={input} onChange={(e) => setInput(e.target.value)} />
        </label>
        <div className="patient-search-form__actions">
          <button type="submit">検索</button>
          <button
            type="button"
            onClick={() => {
              setInput("");
              setName("");
            }}
          >
            クリア
          </button>
        </div>
      </form>

      <ErrorBanner error={list.error} />

      <table className="master-search__table">
        <thead>
          <tr>
            <th>コード</th>
            <th>名称</th>
            <th className="rad-item__compact">目的</th>
            <th>線量分割</th>
            <th className="rad-item__compact">状態</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.items.map((item) => (
            <tr key={item.id} onClick={() => setEditing(item)} className="master-search__row">
              <td>{item.code}</td>
              <td>{item.name}</td>
              <td className="rad-item__compact">
                {item.intent ? displayOf(RADIOTHERAPY_INTENT_OPTIONS, item.intent) : ""}
              </td>
              <td>{protocolDoseLabel(item)}</td>
              <td className="rad-item__compact">
                {!item.enabled && <span className="dose-conversion__badge">無効</span>}
              </td>
            </tr>
          ))}
          {list.data && list.data.items.length === 0 && (
            <tr>
              <td colSpan={5} className="master-search__empty">
                プロトコルがありません
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {editing !== null && (
        <ProtocolEditModal
          record={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function ProtocolEditModal({
  record,
  onClose,
}: {
  record: RadiotherapyProtocol | null;
  onClose: () => void;
}) {
  const mutations = radiotherapyProtocolHooks.useMutations();
  const modalities = radiotherapyModalityHooks.useOptions();
  const techniques = radiotherapyTechniqueHooks.useOptions();
  const devices = radiotherapyDeviceHooks.useOptions();
  const catalog = useRadJj1017Catalog();
  const bodyParts = catalog.data?.body_part ?? [];
  const [draft, setDraft] = useState<Draft>(() => toDraft(record));

  function updateVolume(key: string, patch: Partial<RadiotherapyProtocolVolume>) {
    setDraft((d) => ({ ...d, volumes: d.volumes.map((v) => (v.key === key ? { ...v, ...patch } : v)) }));
  }

  function updatePhase(index: number, patch: Partial<PhaseDraft>) {
    setDraft((d) => ({ ...d, phases: d.phases.map((p, i) => (i === index ? { ...p, ...patch } : p)) }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const payload = toPayload(draft);
    if (record === null) await mutations.create.mutateAsync(payload);
    else await mutations.update.mutateAsync({ id: record.id, payload });
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
      title={record === null ? "プロトコルを追加" : "プロトコルを編集"}
      onClose={onClose}
      className="modal--wide"
    >
      <form onSubmit={handleSubmit}>
        <div className="lab-order-item__fields">
          <label>
            コード
            <input
              type="text"
              value={draft.code}
              onChange={(e) => setDraft({ ...draft, code: e.target.value })}
              disabled={record !== null}
              required
            />
          </label>
          <label>
            名称
            <input
              type="text"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              required
            />
          </label>
          <label>
            カナ(検索用)
            <input
              type="text"
              value={draft.name_kana}
              onChange={(e) => setDraft({ ...draft, name_kana: e.target.value })}
            />
          </label>
          <label>
            治療目的
            <select value={draft.intent} onChange={(e) => setDraft({ ...draft, intent: e.target.value })}>
              <option value=""></option>
              {RADIOTHERAPY_INTENT_OPTIONS.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.display}
                </option>
              ))}
            </select>
          </label>
          <label>
            表示順
            <input
              type="number"
              value={draft.display_order}
              onChange={(e) => setDraft({ ...draft, display_order: e.target.value })}
            />
          </label>
          <label>
            備考
            <input
              type="text"
              value={draft.note}
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            />
          </label>
        </div>

        <section className="lab-order-item__section">
          <div className="lab-order-item__section-head">
            <h3>標的</h3>
            <button
              type="button"
              onClick={() =>
                setDraft({
                  ...draft,
                  volumes: [
                    ...draft.volumes,
                    { key: newKey(), label: `PTV${draft.volumes.length + 1}`, volume_type: "PTV" },
                  ],
                })
              }
            >
              標的を追加
            </button>
          </div>
          <table className="master-search__table">
            <thead>
              <tr>
                <th>名称</th>
                <th>種別</th>
                <th>部位</th>
                <th>左右</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {draft.volumes.map((volume) => (
                <tr key={volume.key}>
                  <td>
                    <input
                      type="text"
                      value={volume.label}
                      onChange={(e) => updateVolume(volume.key, { label: e.target.value })}
                      required
                    />
                  </td>
                  <td>
                    <select
                      value={volume.volume_type ?? ""}
                      onChange={(e) => updateVolume(volume.key, { volume_type: e.target.value })}
                    >
                      <option value=""></option>
                      {VOLUME_TYPE_OPTIONS.map((o) => (
                        <option key={o.code} value={o.code}>
                          {o.display}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      value={volume.body_part_code ?? ""}
                      onChange={(e) =>
                        updateVolume(volume.key, {
                          body_part_code: e.target.value || null,
                          body_part_name:
                            bodyParts.find((c) => c.code === e.target.value)?.name ?? null,
                        })
                      }
                    >
                      <option value="">（処方時に選ぶ）</option>
                      {renderJj1017CodeOptions(bodyParts, undefined)}
                    </select>
                  </td>
                  <td>
                    <select
                      value={volume.laterality_code ?? ""}
                      onChange={(e) =>
                        updateVolume(volume.key, {
                          laterality_code: e.target.value || null,
                          laterality_name: e.target.value
                            ? displayOf(RADIOTHERAPY_LATERALITY_OPTIONS, e.target.value)
                            : null,
                        })
                      }
                    >
                      <option value=""></option>
                      {RADIOTHERAPY_LATERALITY_OPTIONS.map((o) => (
                        <option key={o.code} value={o.code}>
                          {o.display}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button
                      type="button"
                      disabled={draft.volumes.length <= 1}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          volumes: draft.volumes.filter((v) => v.key !== volume.key),
                        })
                      }
                    >
                      削除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {draft.phases.map((phase, index) => {
          const fractions = Number(phase.fractions);
          const techniqueChoices = techniques.items.filter(
            (t) =>
              t.modality_codes.length === 0 ||
              !phase.modality_code ||
              t.modality_codes.includes(phase.modality_code),
          );
          return (
            <section key={index} className="lab-order-item__section">
              <div className="lab-order-item__section-head">
                <h3>Phase {index + 1}</h3>
                <button
                  type="button"
                  disabled={draft.phases.length <= 1}
                  onClick={() =>
                    setDraft({ ...draft, phases: draft.phases.filter((_, i) => i !== index) })
                  }
                >
                  Phase を削除
                </button>
              </div>
              <div className="lab-order-item__fields">
                <label>
                  名称
                  <input
                    type="text"
                    value={phase.label ?? ""}
                    onChange={(e) => updatePhase(index, { label: e.target.value })}
                  />
                </label>
                <label>
                  モダリティ
                  <select
                    value={phase.modality_code ?? ""}
                    onChange={(e) =>
                      updatePhase(index, { modality_code: e.target.value, technique_code: "" })
                    }
                  >
                    <option value=""></option>
                    {modalities.items.map((m) => (
                      <option key={m.code} value={m.code}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  照射技法
                  <select
                    value={phase.technique_code ?? ""}
                    onChange={(e) => updatePhase(index, { technique_code: e.target.value })}
                  >
                    <option value=""></option>
                    {techniqueChoices.map((t) => (
                      <option key={t.code} value={t.code}>
                        {t.abbreviation ? `${t.abbreviation} ${t.name}` : t.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  使用予定装置
                  <select
                    value={phase.device_code ?? ""}
                    onChange={(e) => updatePhase(index, { device_code: e.target.value })}
                  >
                    <option value=""></option>
                    {devices.items.map((d) => (
                      <option key={d.code} value={d.code}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  分割回数
                  <input
                    type="number"
                    min={1}
                    max={99}
                    value={phase.fractions}
                    onChange={(e) => updatePhase(index, { fractions: e.target.value })}
                    required
                  />
                </label>
                <label>
                  週あたり回数
                  <input
                    type="number"
                    min={1}
                    max={14}
                    value={phase.fractions_per_week}
                    onChange={(e) => updatePhase(index, { fractions_per_week: e.target.value })}
                  />
                </label>
              </div>
              <table className="master-search__table">
                <thead>
                  <tr>
                    <th>標的</th>
                    <th>1回線量(Gy)</th>
                    <th>総線量</th>
                  </tr>
                </thead>
                <tbody>
                  {draft.volumes.map((volume) => {
                    const text = phase.doses[volume.key] ?? "";
                    const dose = Number(text);
                    return (
                      <tr key={volume.key}>
                        <td>{volume.label}</td>
                        <td>
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={text}
                            onChange={(e) =>
                              updatePhase(index, {
                                doses: { ...phase.doses, [volume.key]: e.target.value },
                              })
                            }
                          />
                        </td>
                        <td>
                          {text !== "" && dose > 0 && fractions > 0
                            ? `${formatDose(radiotherapyTotalDose(dose, fractions))} Gy`
                            : ""}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          );
        })}

        <div className="lab-order-item__actions">
          <button type="button" onClick={() => setDraft({ ...draft, phases: [...draft.phases, emptyPhase()] })}>
            ＋ Phase
          </button>
        </div>

        <label className="dose-conversion__checkbox">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
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
