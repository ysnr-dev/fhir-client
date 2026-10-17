import { useMemo, useState } from "react";
import { usePatientFolders, useDashboards, useHomeLayoutMutations } from "../api/masterQueries";
import { useMyCareTeams, useSelfDepartments, useWardOptions } from "../api/queries";
import { appMenuLinks } from "../appMenu";
import {
  HOME_CARD_GROUPS,
  HOME_CARD_KIND_KEYS,
  HOME_CARD_KINDS,
  HOME_MAX_CARDS,
  homeCardLabel,
  isHomeCardComplete,
  newHomeCardId,
  toHomeLayoutBody,
  type HomeCard,
  type HomeCardField,
  type HomeCardKind,
  type HomeCardNameResolver,
} from "../fhir/homeCards";
import { useDefinitionOwners } from "../hooks/useDefinitionOwners";
import { usePatientFolderOwners } from "../hooks/usePatientFolderOwners";
import { moveItem } from "../lib/arrays";
import { ErrorBanner } from "./ErrorBanner";
import { TrashIcon } from "./icons/TrashIcon";
import { Modal } from "./Modal";
import { patientFolderPath } from "./patientFolderTree";

// ホームのカードの並びを編集するモーダル。上下で並べ替え、削除、種類を選んで追加、カードごとの
// 設定(病棟・科・チーム・ダッシュボード・フォルダ・画面)を変える。保存すると backend に
// 本人の設定として置き、「既定に戻す」で消して職種の既定に戻る。

interface Props {
  cards: HomeCard[];
  /** 保存した設定を表示中か(既定を表示中なら「既定に戻す」は出さない)。 */
  saved: boolean;
  practitionerId: string;
  onClose: () => void;
}

type Option = { value: string; label: string };

export function HomeLayoutEditorModal({ cards: initial, saved, practitionerId, onClose }: Props) {
  const [cards, setCards] = useState(initial);
  const [adding, setAdding] = useState("");
  const { save, reset } = useHomeLayoutMutations(practitionerId);

  // 参照の設定の選択肢。モーダルを開いたときだけ読む。
  const wards = useWardOptions();
  const departments = useSelfDepartments();
  const teams = useMyCareTeams(practitionerId);
  const owners = useDefinitionOwners("自分のダッシュボード");
  const dashboards = useDashboards(owners.departmentId, owners.practitionerId, owners.ready, owners.teamIds);
  const folderOwners = usePatientFolderOwners();
  const folders = usePatientFolders(folderOwners.departmentId || undefined, folderOwners.practitionerId ?? undefined);
  const links = useMemo(() => appMenuLinks(), []);

  const optionsOf = useMemo(() => {
    const folderItems = folders.data?.items ?? [];
    const table: Record<Exclude<HomeCardField["type"], "enum">, Option[]> = {
      ward: wards.wards.flatMap((w) => (w.id ? [{ value: w.id, label: w.name ?? w.id }] : [])),
      department: departments.departments.flatMap((d) => (d.id ? [{ value: d.id, label: d.name ?? d.id }] : [])),
      team: (teams.data ?? []).flatMap((t) => (t.id ? [{ value: t.id, label: t.name ?? t.id }] : [])),
      dashboard: (dashboards.data?.items ?? []).map((d) => ({
        value: d.code,
        label: d.owner_name ? `${d.name}(${d.owner_name})` : d.name,
      })),
      folder: folderItems.map((f) => ({ value: String(f.id), label: patientFolderPath(folderItems, f.id) })),
      links: links.map((l) => ({ value: l.to, label: l.label })),
    };
    return table;
  }, [wards.wards, departments.departments, teams.data, dashboards.data, folders.data, links]);

  const resolve: HomeCardNameResolver = (field, value) =>
    field.type === "enum" ? undefined : optionsOf[field.type].find((o) => o.value === value)?.label;

  function updateSetting(id: string, key: string, value: unknown) {
    setCards((prev) =>
      prev.map((card) => (card.id === id ? ({ ...card, settings: { ...card.settings, [key]: value } } as HomeCard) : card)),
    );
  }

  /** 「追加」の候補。種類ごと、部門ワークリストは部門ごとに 1 行。値は kind か kind:variant の番号。 */
  const addOptions = HOME_CARD_GROUPS.map((group) => ({
    group,
    options: HOME_CARD_KIND_KEYS.filter((kind) => HOME_CARD_KINDS[kind].group === group).flatMap((kind) => {
      const def = HOME_CARD_KINDS[kind];
      if (def.variants) {
        return def.variants.map((variant, index) => ({
          value: `${kind}:${index}`,
          label: variant.label,
          disabled: cards.some(
            (c) => c.kind === kind && JSON.stringify(c.settings) === JSON.stringify(variant.settings),
          ),
        }));
      }
      return [{ value: kind, label: def.label, disabled: !def.multiple && cards.some((c) => c.kind === kind) }];
    }),
  }));

  function handleAdd() {
    if (!adding || cards.length >= HOME_MAX_CARDS) return;
    const [kind, variantIndex] = adding.split(":") as [HomeCardKind, string | undefined];
    const def = HOME_CARD_KINDS[kind];
    const settings: Record<string, unknown> = {
      ...(variantIndex !== undefined ? def.variants?.[Number(variantIndex)]?.settings : def.defaultSettings),
    };
    // 参照の設定は選択肢の先頭を初期値にする(空のままだと保存できない)。
    for (const field of def.fields) {
      if (field.type === "enum" || field.type === "links" || field.blankLabel !== undefined) continue;
      const first = optionsOf[field.type][0];
      if (first) settings[field.key] = field.type === "folder" ? Number(first.value) : first.value;
    }
    setCards((prev) => [...prev, { id: newHomeCardId(), kind, settings } as HomeCard]);
    setAdding("");
  }

  const complete = cards.every(isHomeCardComplete);
  const busy = save.isPending || reset.isPending;

  async function handleSave() {
    await save.mutateAsync(toHomeLayoutBody(cards));
    onClose();
  }

  async function handleReset() {
    await reset.mutateAsync();
    onClose();
  }

  return (
    <Modal title="ホームの編集" onClose={onClose} className="modal--chart-editor">
      <div className="chart-editor">
        <table className="chart-editor__items home-editor__items">
          <thead>
            <tr>
              <th>カード</th>
              <th>設定</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {cards.map((card, index) => {
              const label = homeCardLabel(card, resolve);
              return (
                <tr key={card.id}>
                  <td className="home-editor__name">
                    {HOME_CARD_KINDS[card.kind].fields.length > 0 ? HOME_CARD_KINDS[card.kind].label : label}
                  </td>
                  <td className="home-editor__settings">
                    <SettingsFields card={card} optionsOf={optionsOf} onChange={(key, value) => updateSetting(card.id, key, value)} />
                  </td>
                  <td className="chart-editor__row-actions">
                    <button
                      type="button"
                      className="chart-editor__step"
                      onClick={() => setCards(moveItem(cards, index, -1))}
                      disabled={index === 0}
                      title="上へ"
                      aria-label="上へ"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="chart-editor__step"
                      onClick={() => setCards(moveItem(cards, index, 1))}
                      disabled={index === cards.length - 1}
                      title="下へ"
                      aria-label="下へ"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="rp-card__icon-button"
                      onClick={() => setCards(cards.filter((c) => c.id !== card.id))}
                      title={`${label} を削除`}
                      aria-label={`${label} を削除`}
                    >
                      <TrashIcon />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="home-editor__add">
          <select value={adding} onChange={(e) => setAdding(e.target.value)}>
            <option value="">カードを選択</option>
            {addOptions.map(({ group, options }) => (
              <optgroup key={group} label={group}>
                {options.map((option) => (
                  <option key={option.value} value={option.value} disabled={option.disabled}>
                    {option.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <button type="button" onClick={handleAdd} disabled={!adding || cards.length >= HOME_MAX_CARDS}>
            追加
          </button>
        </div>

        <ErrorBanner error={save.error ?? reset.error} />

        <div className="chart-editor__actions">
          <button type="button" onClick={handleSave} disabled={busy || !complete}>
            保存
          </button>
          {saved && (
            <button type="button" onClick={handleReset} disabled={busy}>
              既定に戻す
            </button>
          )}
          <button type="button" onClick={onClose}>
            取消
          </button>
        </div>
      </div>
    </Modal>
  );
}

function SettingsFields({
  card,
  optionsOf,
  onChange,
}: {
  card: HomeCard;
  optionsOf: Record<Exclude<HomeCardField["type"], "enum">, Option[]>;
  onChange: (key: string, value: unknown) => void;
}) {
  const def = HOME_CARD_KINDS[card.kind];
  const settings = card.settings as Record<string, unknown>;
  if (def.fields.length === 0) return null;
  return (
    <div className="home-editor__fields">
      {def.fields.map((field) => {
        if (field.type === "enum") {
          return (
            <label key={field.key} className="home-editor__field">
              {field.label}
              <select value={String(settings[field.key] ?? "")} onChange={(e) => onChange(field.key, e.target.value)}>
                {field.options.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          );
        }
        if (field.type === "links") {
          const selected = (settings[field.key] as string[]) ?? [];
          return (
            <div key={field.key} className="home-editor__links">
              {optionsOf.links.map((option) => (
                <label key={option.value}>
                  <input
                    type="checkbox"
                    checked={selected.includes(option.value)}
                    onChange={(e) =>
                      onChange(
                        field.key,
                        e.target.checked
                          ? [...selected, option.value]
                          : selected.filter((v) => v !== option.value),
                      )
                    }
                  />
                  {option.label}
                </label>
              ))}
            </div>
          );
        }
        const value = settings[field.key];
        const current = value === 0 || value === undefined ? "" : String(value);
        return (
          <label key={field.key} className="home-editor__field">
            {field.label}
            <select
              value={current}
              onChange={(e) =>
                onChange(field.key, field.type === "folder" ? Number(e.target.value) : e.target.value)
              }
            >
              {field.blankLabel !== undefined ? (
                <option value="">{field.blankLabel}</option>
              ) : (
                current === "" && <option value="">選択</option>
              )}
              {optionsOf[field.type].map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        );
      })}
    </div>
  );
}
