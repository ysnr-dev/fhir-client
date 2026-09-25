import { useMemo, useState } from "react";
import type { LabResultItem, Medicine } from "../api/masterClient";
import type { OrderSetScope } from "../api/masterClient";
import { useQuestionnaireOptions } from "../api/queries";
import {
  CHART_AXIS_UNIT_LABELS,
  CHART_COLUMN_CHOICES,
  CHART_EVENT_KINDS,
  CHART_ITEM_SOURCE_LABELS,
  CHART_LAB_DATA_TYPES,
  CHART_LAYOUT_OPTIONS,
  CHART_STATE_EVENT_KINDS,
  chartColumnsFor,
  chartDrugOf,
  chartEventKindLabel,
  isChoiceItem,
  ownerKeyOf,
  labChartItem,
  parseTrackRefKey,
  templateChartItems,
  trackRefKey,
  vitalChartItems,
  type ChartAxisUnit,
  type ChartDefinitionBody,
  type ChartDrug,
  type ChartEventKind,
  type ChartItem,
  type ChartTrackRef,
} from "../fhir/chartDefinitionHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { TrashIcon } from "./PathwayEventCard";
import { LabResultItemSearchModal } from "./LabResultItemSearchModal";
import { MedicineSearchModal } from "./MedicineSearchModal";
import { Modal } from "./Modal";

/** 持ち主の選択肢。呼び出し元が権限を見て canEdit を決める。 */
export interface ChartOwnerOption {
  scope: OrderSetScope;
  ownerId: string | null;
  ownerName: string | null;
  label: string;
  canEdit: boolean;
}

export interface ChartDefinitionDraft {
  name: string;
  scope: OrderSetScope;
  ownerId: string | null;
  ownerName: string | null;
  definition: ChartDefinitionBody;
}

interface Props {
  mode: "create" | "edit" | "copy";
  initial: ChartDefinitionDraft;
  owners: ChartOwnerOption[];
  busy: boolean;
  error: unknown;
  onSave: (draft: ChartDefinitionDraft) => void;
  onClose: () => void;
}

const MODE_TITLES: Record<Props["mode"], string> = {
  create: "チャートを作成",
  edit: "チャートを編集",
  copy: "名前を付けて保存",
};

export function ChartDefinitionEditorModal({
  mode,
  initial,
  owners,
  busy,
  error,
  onSave,
  onClose,
}: Props) {
  const [name, setName] = useState(initial.name);
  const [ownerKey, setOwnerKey] = useState(ownerKeyOf(initial.scope, initial.ownerId));
  const [items, setItems] = useState<ChartItem[]>(initial.definition.items);
  const [unit, setUnit] = useState<ChartAxisUnit>(initial.definition.axis.unit);
  const [columns, setColumns] = useState(initial.definition.axis.columns);
  const [events, setEvents] = useState<ChartEventKind[]>(initial.definition.events);
  const [overlay, setOverlay] = useState(initial.definition.overlay);
  const [drugs, setDrugs] = useState<ChartDrug[]>(initial.definition.drugs);
  const [background, setBackground] = useState<ChartTrackRef | null>(initial.definition.background);
  const [labSearch, setLabSearch] = useState(false);
  const [drugSearch, setDrugSearch] = useState(false);
  const [templateId, setTemplateId] = useState("");
  const [localError, setLocalError] = useState("");

  // 権限(医師かどうか)は上流の PractitionerRole が届いてから決まるので、開いた直後は
  // 選択肢が空のことがある。選んだ持ち主は「選択肢の中の 1 つ」として引き直し、
  // 見つからなければ先頭に寄せる(選択肢に無い持ち主のまま保存させない)。
  const editable = owners.filter((owner) => owner.canEdit);
  const selectedOwner =
    editable.find((owner) => ownerKeyOf(owner.scope, owner.ownerId) === ownerKey) ?? editable[0];
  const templates = useQuestionnaireOptions({ status: "active" });
  const keys = useMemo(() => new Set(items.map((item) => item.key)), [items]);

  const vitals = useMemo(() => vitalChartItems().filter((item) => !keys.has(item.key)), [keys]);
  const templateOptions = useMemo(
    () =>
      templates.questionnaires
        .map((questionnaire) => ({ questionnaire, items: templateChartItems(questionnaire) }))
        .filter((entry) => entry.items.length > 0),
    [templates.questionnaires],
  );
  const templateItems = useMemo(
    () =>
      templateOptions
        .find((entry) => entry.questionnaire.id === templateId)
        ?.items.filter((item) => !keys.has(item.key)) ?? [],
    [templateOptions, templateId, keys],
  );

  // 背景に敷ける行(選択肢の項目・追う薬剤・期間を持つ種別)。編集中の内容から作る。
  const backgroundChoices: { value: string; label: string }[] = [
    ...items.filter(isChoiceItem).map((item) => ({ value: `item:${item.key}`, label: item.name })),
    ...drugs.map((drug) => ({ value: `drug:${drug.key}`, label: drug.name })),
    ...CHART_STATE_EVENT_KINDS.filter((kind) => events.includes(kind)).map((kind) => ({
      value: `event:${kind}`,
      label: chartEventKindLabel(kind),
    })),
  ];
  const backgroundKey = trackRefKey(background);
  const backgroundValue = backgroundChoices.some((choice) => choice.value === backgroundKey)
    ? backgroundKey
    : "";

  function addItem(item: ChartItem) {
    if (keys.has(item.key)) return;
    setItems([...items, item]);
  }

  function addLabItem(item: LabResultItem) {
    addItem(labChartItem(item));
    setLabSearch(false);
  }

  function moveItem(index: number, delta: number) {
    setItems(moved(items, index, delta));
  }

  function addDrug(medicine: Medicine) {
    const drug = chartDrugOf(medicine);
    if (!drugs.some((entry) => entry.key === drug.key)) setDrugs([...drugs, drug]);
    setDrugSearch(false);
  }

  function renameDrug(key: string, name: string) {
    setDrugs(drugs.map((drug) => (drug.key === key ? { ...drug, name } : drug)));
  }

  function toggleEvent(kind: ChartEventKind) {
    setEvents(events.includes(kind) ? events.filter((e) => e !== kind) : [...events, kind]);
  }

  function handleUnitChange(next: ChartAxisUnit) {
    setUnit(next);
    setColumns(chartColumnsFor(next, columns));
  }

  function handleSave() {
    if (!name.trim()) return setLocalError("チャート名を入力してください。");
    if (items.length === 0 && drugs.length === 0) {
      return setLocalError("項目か薬剤を 1 つ以上選んでください。");
    }
    if (drugs.some((drug) => !drug.name.trim())) return setLocalError("薬剤の表示名を入力してください。");
    const owner = selectedOwner;
    if (!owner) return setLocalError("保存先を選んでください。");

    setLocalError("");
    onSave({
      name: name.trim(),
      scope: owner.scope,
      ownerId: owner.ownerId,
      ownerName: owner.ownerName,
      definition: {
        schema_version: 1,
        axis: { unit, columns },
        items,
        events,
        drugs: drugs.map((drug) => ({ ...drug, name: drug.name.trim() })),
        overlay,
        // 元の行を外していたら背景も外す(選択肢に無い値を保存しない)。
        background: backgroundValue ? background : null,
      },
    });
  }

  return (
    <Modal title={MODE_TITLES[mode]} onClose={onClose} className="modal--chart-editor">
      {/* Modal は非ポータルでカルテのフォームの中に描画されるため form を入れ子にしない。 */}
      <div className="chart-editor">
        <div className="chart-editor__head">
          <label>
            チャート名
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            保存先
            <select
              value={selectedOwner ? ownerKeyOf(selectedOwner.scope, selectedOwner.ownerId) : ""}
              onChange={(e) => setOwnerKey(e.target.value)}
              disabled={mode === "edit"}
            >
              {editable.map((owner) => (
                <option key={ownerKeyOf(owner.scope, owner.ownerId)} value={ownerKeyOf(owner.scope, owner.ownerId)}>
                  {owner.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            横軸
            <select value={unit} onChange={(e) => handleUnitChange(e.target.value as ChartAxisUnit)}>
              {(Object.keys(CHART_AXIS_UNIT_LABELS) as ChartAxisUnit[]).map((key) => (
                <option key={key} value={key}>
                  {CHART_AXIS_UNIT_LABELS[key]}
                </option>
              ))}
            </select>
          </label>
          <label>
            列数
            <select value={columns} onChange={(e) => setColumns(Number(e.target.value))}>
              {CHART_COLUMN_CHOICES[unit].map((choice) => (
                <option key={choice} value={choice}>
                  {choice}
                </option>
              ))}
            </select>
          </label>
          <label>
            グラフ
            <select value={String(overlay)} onChange={(e) => setOverlay(e.target.value === "true")}>
              {CHART_LAYOUT_OPTIONS.map((option) => (
                <option key={String(option.overlay)} value={String(option.overlay)}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            背景
            <select
              value={backgroundValue}
              onChange={(e) => setBackground(parseTrackRefKey(e.target.value))}
              disabled={backgroundChoices.length === 0}
            >
              <option value="">なし</option>
              {backgroundChoices.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="chart-editor__add">
          <button type="button" onClick={() => setLabSearch(true)}>
            検査項目を追加
          </button>
          <select
            value=""
            onChange={(e) => {
              const item = vitals.find((entry) => entry.key === e.target.value);
              if (item) addItem(item);
            }}
          >
            <option value="">バイタルを追加</option>
            {vitals.map((item) => (
              <option key={item.key} value={item.key}>
                {item.name}
              </option>
            ))}
          </select>
          <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            <option value="">テンプレートを選択</option>
            {templateOptions.map((entry) => (
              <option key={entry.questionnaire.id} value={entry.questionnaire.id}>
                {entry.questionnaire.title ?? entry.questionnaire.name ?? entry.questionnaire.id}
              </option>
            ))}
          </select>
          <select
            value=""
            disabled={templateItems.length === 0}
            onChange={(e) => {
              const item = templateItems.find((entry) => entry.key === e.target.value);
              if (item) addItem(item);
            }}
          >
            <option value="">テンプレート項目を追加</option>
            {templateItems.map((item) => (
              <option key={item.key} value={item.key}>
                {item.options?.length ? `${item.name}(選択肢)` : item.name}
              </option>
            ))}
          </select>
        </div>

        <table className="chart-editor__items">
          <thead>
            <tr>
              <th>項目</th>
              <th>単位</th>
              <th>区分</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={item.key}>
                <td>{item.name}</td>
                <td>{item.options?.length ? "選択肢" : item.unit}</td>
                <td>
                  <span className="chart-editor__source">{CHART_ITEM_SOURCE_LABELS[item.source]}</span>
                </td>
                <td className="chart-editor__row-actions">
                  <button
                    type="button"
                    className="chart-editor__step"
                    onClick={() => moveItem(index, -1)}
                    disabled={index === 0}
                    title="上へ"
                    aria-label="上へ"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="chart-editor__step"
                    onClick={() => moveItem(index, 1)}
                    disabled={index === items.length - 1}
                    title="下へ"
                    aria-label="下へ"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="rp-card__icon-button"
                    onClick={() => setItems(items.filter((e) => e.key !== item.key))}
                    title={`${item.name} を削除`}
                    aria-label={`${item.name} を削除`}
                  >
                    <TrashIcon />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="chart-editor__events">
          {CHART_EVENT_KINDS.map((entry) => (
            <label key={entry.kind}>
              <input
                type="checkbox"
                checked={events.includes(entry.kind)}
                onChange={() => toggleEvent(entry.kind)}
              />
              {entry.label}
            </label>
          ))}
        </div>

        <div className="chart-editor__add">
          <button type="button" onClick={() => setDrugSearch(true)}>
            薬剤を追加
          </button>
        </div>

        {drugs.length > 0 && (
          <table className="chart-editor__items">
            <thead>
              <tr>
                <th>薬剤(表示名)</th>
                <th>まとめ方</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {drugs.map((drug, index) => (
                <tr key={drug.key}>
                  <td>
                    <input
                      type="text"
                      value={drug.name}
                      aria-label="薬剤の表示名"
                      onChange={(e) => renameDrug(drug.key, e.target.value)}
                    />
                  </td>
                  <td>
                    <span className="chart-editor__source">{drug.yj7 ? "同じ成分" : "この薬剤"}</span>
                  </td>
                  <td className="chart-editor__row-actions">
                    <button
                      type="button"
                      className="chart-editor__step"
                      onClick={() => setDrugs(moved(drugs, index, -1))}
                      disabled={index === 0}
                      title="上へ"
                      aria-label="上へ"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="chart-editor__step"
                      onClick={() => setDrugs(moved(drugs, index, 1))}
                      disabled={index === drugs.length - 1}
                      title="下へ"
                      aria-label="下へ"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="rp-card__icon-button"
                      onClick={() => setDrugs(drugs.filter((e) => e.key !== drug.key))}
                      title={`${drug.name} を削除`}
                      aria-label={`${drug.name} を削除`}
                    >
                      <TrashIcon />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {localError && (
          <div className="error-banner" role="alert">
            <p className="error-banner__line error-banner__line--error">{localError}</p>
          </div>
        )}
        <ErrorBanner error={error} />

        <div className="chart-editor__actions">
          <button type="button" onClick={handleSave} disabled={busy}>
            保存
          </button>
          <button type="button" onClick={onClose}>
            キャンセル
          </button>
        </div>
      </div>

      {labSearch && (
        <LabResultItemSearchModal
          title="チャートに足す検査項目を選択"
          dataType={CHART_LAB_DATA_TYPES}
          onSelect={addLabItem}
          onClose={() => setLabSearch(false)}
        />
      )}
      {drugSearch && (
        <MedicineSearchModal
          title="チャートに足す薬剤を選択"
          allowGeneric
          onSelect={addDrug}
          onClose={() => setDrugSearch(false)}
        />
      )}
    </Modal>
  );
}

/** 並びの中で 1 つ上・下へ動かす(端なら動かさない)。 */
function moved<T>(list: T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (target < 0 || target >= list.length) return list;
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
