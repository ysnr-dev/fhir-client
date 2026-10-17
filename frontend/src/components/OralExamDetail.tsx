import {
  codeDisplay,
  materialOf,
  withMaterial,
  MOUTH_SECTIONS,
  TM_MAIN_ITEMS,
  TM_MORE_ITEMS,
  toothLabel,
  TP_MAIN_ITEMS,
  TP_MORE_ITEMS,
  TP_PART_ITEMS,
  TP_SURFACE_ITEMS,
  usesMissingContent,
  type MouthRecord,
  type OralExamCodeBook,
  type ToothRecord,
} from "../fhir/oralExamHelpers";
import { TfLine } from "./OralExamToothEditor";

const TP_LABELED = [...TP_MAIN_ITEMS, ...TP_PART_ITEMS, ...TP_MORE_ITEMS];
const TM_LABELED = [...TM_MAIN_ITEMS, ...TM_MORE_ITEMS];

/** 選んだ歯の記録(読み取り)。 */
export function OralExamToothDetail({
  book,
  toothCode,
  records,
}: {
  book: OralExamCodeBook | undefined;
  toothCode: string;
  records: ToothRecord[];
}) {
  return (
    <section className="oral-exam__detail" aria-label={toothLabel(toothCode)}>
      <h4>{toothLabel(toothCode)}</h4>
      {records.length === 0 && <p className="oral-exam__empty">記録なし</p>}
      {records.map((record, i) => (
        <div key={record.key} className="oral-exam__detail-group">
          {records.length > 1 && <div className="oral-exam__subhead">グループ{i + 1}</div>}
          <dl className="oral-exam__dl">
            <dt>基本状態</dt>
            <dd>
              {codeDisplay(book, "TD-2", record.basic)}
              <span className="oral-exam__muted">
                {" "}
                ({codeDisplay(book, "TB-3", record.stateCode)}
                {record.partCode !== "0" ? ` / ${codeDisplay(book, "TB-4", record.partCode)}` : ""})
              </span>
            </dd>
            {usesMissingContent(record.basic)
              ? TM_LABELED.filter((d) => record.missing[d.item]).map((d) => (
                  <Row key={d.item} label={d.label} value={codeDisplay(book, d.item, record.missing[d.item])} />
                ))
              : record.contents.map((content, j) => (
                  <Row
                    key={content.key}
                    label={record.contents.length > 1 ? `現在歯の内容 ${j + 1}` : "現在歯の内容"}
                    value={contentText(book, content.values)}
                  />
                ))}
            {record.productName || record.productNumber ? (
              <Row label="製品" value={[record.productName, record.productNumber].filter(Boolean).join(" / ")} />
            ) : null}
            {materialOf(record.remark) && <Row label="材料" value={materialOf(record.remark)} />}
            {withMaterial(record.remark, "") && <Row label="特記事項" value={withMaterial(record.remark, "")} />}
            {record.updatedOn && <Row label="更新日" value={record.updatedOn} />}
          </dl>
          <TfLine book={book} record={record} />
        </div>
      ))}
    </section>
  );
}

function contentText(book: OralExamCodeBook | undefined, values: Record<string, string>): string {
  const parts = TP_LABELED.filter((d) => values[d.item]).map((d) => codeDisplay(book, d.item, values[d.item]));
  const surfaces = TP_SURFACE_ITEMS.filter((d) => values[d.item]).map((d) => d.label);
  if (surfaces.length) parts.push(`歯面 ${surfaces.join("")}`);
  return parts.join(" / ");
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

/** 口腔全体の記録(読み取り)。書いてある行だけを出す。 */
export function OralExamMouthDetail({ book, mouth }: { book: OralExamCodeBook | undefined; mouth: MouthRecord[] }) {
  const rows = MOUTH_SECTIONS.flatMap((section) => {
    const entries = mouth.filter((m) => m.record === section.record);
    return entries.flatMap((entry, index) =>
      section.items
        .map((def) => {
          const value = def.teeth
            ? (entry.teeth[def.item] ?? []).map(toothLabel).join("、")
            : def.text
              ? (entry.texts[def.item] ?? "")
              : entry.values[def.item]
                ? codeDisplay(book, def.item, entry.values[def.item])
                : "";
          const head = entries.length > 1 ? `${section.label} ${index + 1}` : section.label;
          return { key: `${entry.key}-${def.item}`, label: `${head} ${def.label === section.label ? "" : def.label}`.trim(), value };
        })
        .filter((row) => row.value),
    );
  });
  if (!rows.length) return null;
  return (
    <section className="oral-exam__detail" aria-label="口腔全体">
      <h4>口腔全体</h4>
      <dl className="oral-exam__dl">
        {rows.map((row) => (
          <Row key={row.key} label={row.label} value={row.value} />
        ))}
      </dl>
    </section>
  );
}
