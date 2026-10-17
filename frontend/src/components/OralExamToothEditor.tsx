import { useState } from "react";
import {
  applyMaterial,
  deriveTf,
  materialOf,
  ORAL_EXAM_MATERIALS,
  withMaterial,
  emptyContent,
  isSupernumerary,
  itemOptions,
  newToothRecord,
  supernumeraryCode,
  tfLabel,
  TM_MAIN_ITEMS,
  TM_MORE_ITEMS,
  toothLabel,
  TP_MAIN_ITEMS,
  TP_MORE_ITEMS,
  TP_PART_ITEMS,
  TP_SURFACE_ITEMS,
  usesMissingContent,
  defaultStateCode,
  type OralExamCodeBook,
  type ToothContent,
  type ToothRecord,
} from "../fhir/oralExamHelpers";
import { TrashIcon } from "./icons/TrashIcon";
import { OralExamItemField } from "./OralExamItemField";

interface OralExamToothEditorProps {
  book: OralExamCodeBook | undefined;
  toothCode: string;
  /** この歯の記録(併存グループの順)。 */
  records: ToothRecord[];
  onChange: (records: ToothRecord[]) => void;
  /** 近傍過剰歯を足して、そちらを選ぶ。 */
  onAddSupernumerary?: (toothCode: string) => void;
  hasSupernumerary: boolean;
}

/** 選んだ歯の編集。併存グループごとに、基本状態・現在歯の内容(または欠損歯の内容)・その他を書く。 */
export function OralExamToothEditor({
  book,
  toothCode,
  records,
  onChange,
  onAddSupernumerary,
  hasSupernumerary,
}: OralExamToothEditorProps) {
  const [groupIndex, setGroupIndex] = useState(0);
  const index = Math.min(groupIndex, Math.max(records.length - 1, 0));
  const record = records[index];

  function replace(next: ToothRecord) {
    onChange(records.map((r, i) => (i === index ? next : r)));
  }

  function changeBasic(basic: string) {
    if (!basic) {
      onChange(records.filter((_, i) => i !== index));
      setGroupIndex(0);
      return;
    }
    if (!record) {
      onChange([newToothRecord(toothCode, basic)]);
      return;
    }
    replace({ ...record, basic, stateCode: defaultStateCode(basic) });
  }

  function addGroup() {
    onChange([...records, newToothRecord(toothCode, records[0]?.basic ?? "01")]);
    setGroupIndex(records.length);
  }

  return (
    <section className="oral-exam__editor" aria-label={`${toothLabel(toothCode)}の編集`}>
      <div className="oral-exam__editor-head">
        <h4>{toothLabel(toothCode)}</h4>
        <div className="karte-tabpanel__actions">
          {record && (
            <button type="button" className="rp-card__compact-button" onClick={addGroup}>
              併存グループを追加
            </button>
          )}
          {onAddSupernumerary && !isSupernumerary(toothCode) && !hasSupernumerary && (
            <button
              type="button"
              className="rp-card__compact-button"
              onClick={() => onAddSupernumerary(supernumeraryCode(toothCode))}
            >
              過剰歯を追加
            </button>
          )}
        </div>
      </div>

      {records.length > 1 && (
        <div className="order-select__tabs" role="tablist" aria-label="併存グループ">
          {records.map((r, i) => (
            <button
              key={r.key}
              type="button"
              role="tab"
              aria-selected={i === index}
              className={i === index ? "order-select__tab is-active" : "order-select__tab"}
              onClick={() => setGroupIndex(i)}
            >
              グループ{i + 1}
            </button>
          ))}
        </div>
      )}

      <div className="oral-exam__fields">
        <label className="oral-exam__field oral-exam__field--wide">
          基本状態
          <select value={record?.basic ?? ""} onChange={(e) => changeBasic(e.target.value)}>
            <option value="">(記録なし)</option>
            {itemOptions(book, "TD-2", record?.basic).map((option) => (
              <option key={option.code} value={option.code}>
                {option.display}
              </option>
            ))}
          </select>
        </label>
        {record && (
          <>
            <label className="oral-exam__field">
              状態コード
              <select value={record.stateCode} onChange={(e) => replace({ ...record, stateCode: e.target.value })}>
                {itemOptions(book, "TB-3", record.stateCode).map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.display}
                  </option>
                ))}
              </select>
            </label>
            <label className="oral-exam__field">
              部分コード
              <select value={record.partCode} onChange={(e) => replace({ ...record, partCode: e.target.value })}>
                <option value="0">部分指定なし</option>
                {itemOptions(book, "TB-4", record.partCode)
                  .filter((option) => option.code !== "0")
                  .map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.display}
                    </option>
                  ))}
              </select>
            </label>
          </>
        )}
      </div>

      {record &&
        (usesMissingContent(record.basic) ? (
          <MissingFields book={book} record={record} onChange={replace} />
        ) : (
          <ContentList book={book} record={record} onChange={replace} />
        ))}

      {record && (
        <>
          <div className="oral-exam__fields">
            <OralExamItemField
              book={book}
              item="TE-2"
              label="製品識別情報"
              value={record.productKind}
              onChange={(productKind) => replace({ ...record, productKind })}
            />
            <label className="oral-exam__field">
              製品名
              <input
                type="text"
                value={record.productName}
                onChange={(e) => replace({ ...record, productName: e.target.value })}
              />
            </label>
            <label className="oral-exam__field">
              製造番号・記号等
              <input
                type="text"
                value={record.productNumber}
                onChange={(e) => replace({ ...record, productNumber: e.target.value })}
              />
            </label>
            <label className="oral-exam__field">
              材料
              <select
                value={materialOf(record.remark)}
                onChange={(e) => replace(applyMaterial(record, e.target.value, book))}
              >
                <option value="" />
                {ORAL_EXAM_MATERIALS.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="oral-exam__field oral-exam__field--wide">
              特記事項
              <input
                type="text"
                value={withMaterial(record.remark, "")}
                onChange={(e) =>
                  replace({ ...record, remark: withMaterial(e.target.value, materialOf(record.remark)) })
                }
              />
            </label>
          </div>
          <TfLine book={book} record={record} />
          {records.length > 1 && (
            <div className="oral-exam__group-actions">
              <button
                type="button"
                className="rp-card__icon-button"
                title={`グループ${index + 1}を削除`}
                aria-label={`グループ${index + 1}を削除`}
                onClick={() => {
                  onChange(records.filter((_, i) => i !== index));
                  setGroupIndex(0);
                }}
              >
                <TrashIcon />
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function TfLine({ book, record }: { book: OralExamCodeBook | undefined; record: ToothRecord }) {
  const tf = deriveTf(record, book);
  return (
    <p className="oral-exam__tf">
      <span className="oral-exam__tf-label">標準プロファイル</span>
      {tf.map((n) => (
        <span key={n} className="oral-exam__chip" title={`TF-${n}`}>
          {tfLabel(book, n)}
        </span>
      ))}
    </p>
  );
}

function ContentList({
  book,
  record,
  onChange,
}: {
  book: OralExamCodeBook | undefined;
  record: ToothRecord;
  onChange: (record: ToothRecord) => void;
}) {
  function replaceContent(key: string, next: ToothContent) {
    onChange({ ...record, contents: record.contents.map((c) => (c.key === key ? next : c)) });
  }

  return (
    <div className="oral-exam__contents">
      <div className="oral-exam__subhead">
        <span>現在歯の内容</span>
        <button
          type="button"
          className="rp-card__compact-button"
          onClick={() => onChange({ ...record, contents: [...record.contents, emptyContent()] })}
        >
          追加
        </button>
      </div>
      {record.contents.map((content, i) => (
        <ContentCard
          key={content.key}
          book={book}
          index={i}
          content={content}
          onChange={(next) => replaceContent(content.key, next)}
          onRemove={() => onChange({ ...record, contents: record.contents.filter((c) => c.key !== content.key) })}
        />
      ))}
    </div>
  );
}

function ContentCard({
  book,
  index,
  content,
  onChange,
  onRemove,
}: {
  book: OralExamCodeBook | undefined;
  index: number;
  content: ToothContent;
  onChange: (content: ToothContent) => void;
  onRemove: () => void;
}) {
  const set = (item: string) => (code: string) => {
    const values = { ...content.values };
    if (code) values[item] = code;
    else delete values[item];
    onChange({ ...content, values });
  };
  const moreUsed = TP_MORE_ITEMS.some((d) => content.values[d.item]);

  return (
    <div className="oral-exam__content">
      <div className="oral-exam__content-head">
        <span>{index + 1}</span>
        <button
          type="button"
          className="rp-card__icon-button"
          title="現在歯の内容を削除"
          aria-label="現在歯の内容を削除"
          onClick={onRemove}
        >
          <TrashIcon />
        </button>
      </div>
      <div className="oral-exam__fields">
        {TP_MAIN_ITEMS.map((def) => (
          <OralExamItemField
            key={def.item}
            book={book}
            item={def.item}
            label={def.label}
            value={content.values[def.item] ?? ""}
            onChange={set(def.item)}
          />
        ))}
      </div>
      <div className="oral-exam__checks">
        <span className="oral-exam__checks-label">歯面</span>
        {TP_SURFACE_ITEMS.map((def) => (
          <label key={def.item} className="oral-exam__check" title={def.name}>
            <input
              type="checkbox"
              checked={Boolean(content.values[def.item])}
              onChange={(e) => set(def.item)(e.target.checked ? "01" : "")}
            />
            {def.label}
          </label>
        ))}
        <span className="oral-exam__checks-label">部位</span>
        {TP_PART_ITEMS.map((def) => (
          <OralExamItemField
            key={def.item}
            book={book}
            item={def.item}
            label={def.label}
            value={content.values[def.item] ?? ""}
            onChange={set(def.item)}
          />
        ))}
      </div>
      <details className="oral-exam__more" open={moreUsed || undefined}>
        <summary>その他</summary>
        <div className="oral-exam__fields">
          {TP_MORE_ITEMS.map((def) => (
            <OralExamItemField
              key={def.item}
              book={book}
              item={def.item}
              label={def.label}
              value={content.values[def.item] ?? ""}
              onChange={set(def.item)}
            />
          ))}
        </div>
      </details>
    </div>
  );
}

function MissingFields({
  book,
  record,
  onChange,
}: {
  book: OralExamCodeBook | undefined;
  record: ToothRecord;
  onChange: (record: ToothRecord) => void;
}) {
  const set = (item: string) => (code: string) => {
    const missing = { ...record.missing };
    if (code) missing[item] = code;
    else delete missing[item];
    onChange({ ...record, missing });
  };
  const moreUsed = TM_MORE_ITEMS.some((d) => record.missing[d.item]);

  return (
    <div className="oral-exam__contents">
      <div className="oral-exam__subhead">
        <span>欠損歯の内容</span>
      </div>
      <div className="oral-exam__fields">
        {TM_MAIN_ITEMS.map((def) => (
          <OralExamItemField
            key={def.item}
            book={book}
            item={def.item}
            label={def.label}
            value={record.missing[def.item] ?? ""}
            onChange={set(def.item)}
          />
        ))}
      </div>
      <details className="oral-exam__more" open={moreUsed || undefined}>
        <summary>その他</summary>
        <div className="oral-exam__fields">
          {TM_MORE_ITEMS.map((def) => (
            <OralExamItemField
              key={def.item}
              book={book}
              item={def.item}
              label={def.label}
              value={record.missing[def.item] ?? ""}
              onChange={set(def.item)}
            />
          ))}
        </div>
      </details>
    </div>
  );
}
