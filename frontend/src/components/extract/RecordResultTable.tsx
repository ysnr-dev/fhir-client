import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { RECORD_DISPLAY_LIMIT, patientCell, type PatientColumn } from "../../fhir/extractQueryHelpers";
import type { BreakdownSettings } from "../../fhir/recordBreakdownHelpers";
import {
  recordTableCells,
  recordTableCsv,
  recordTableHeader,
  type PatientAttribute,
  type RecordTableRow,
} from "../../fhir/recordTableHelpers";
import { today } from "../../lib/dates";
import { downloadBlob } from "../../lib/download";
import { FolderRegisterButton } from "./FolderRegisterButton";
import { RecordBreakdownView } from "./RecordBreakdownView";

export type { RecordTableRow } from "../../fhir/recordTableHelpers";

interface Props {
  header: string[];
  patientColumns: PatientColumn[];
  rows: RecordTableRow[];
  emptyLabel: string;
  /** 患者の列の直後に並べる患者ごとの属性(比較群・担当医。docs/data-extract-design.md §21)。 */
  patientAttributes?: PatientAttribute[];
  /** 内訳の切り口。保存する条件に含めるときはタブが持って渡す(渡さなければここで持つ)。 */
  breakdown?: BreakdownSettings;
  onBreakdownChange?: (settings: BreakdownSettings) => void;
}

type View = "list" | "breakdown";

const VIEWS: { key: View; label: string }[] = [
  { key: "list", label: "一覧" },
  { key: "breakdown", label: "内訳" },
];

/** 内訳のセルから絞った一覧。signature は絞ったときの結果の目印(実行し直したら外す)。 */
interface Drill {
  label: string;
  indices: number[];
  signature: string;
}

/**
 * 記録を表にするタブの結果。「一覧」(表)と「内訳」(期間・分類ごとの件数と集計。docs/data-extract-design.md §18)を
 * 切り替える。内訳は表と同じ見出しとセルから数えるので、タブごとの知識を持たない。内訳のセルを押すと、
 * 一覧をそのセルの行に絞る(絞った行だけの CSV とフォルダ登録もできる)。内訳の切り口を残すため、
 * 見ていない方も描いたまま隠す。
 */
export function RecordResultTable(props: Props) {
  const { header, patientColumns, rows } = props;
  const attributes = useMemo(() => props.patientAttributes ?? [], [props.patientAttributes]);
  const fullHeader = useMemo(
    () => recordTableHeader(header, patientColumns, attributes),
    [header, patientColumns, attributes],
  );
  const [view, setView] = useState<View>("list");
  const [drillState, setDrill] = useState<Drill | null>(null);
  const [localBreakdown, setLocalBreakdown] = useState<BreakdownSettings>({});
  const signature = `${rows.length}:${rows[0]?.key ?? ""}:${rows[rows.length - 1]?.key ?? ""}`;
  const drill = drillState && drillState.signature === signature ? drillState : null;
  // 内訳に渡すセル(見出しと同じ並び)。
  const cells = useMemo(
    () => recordTableCells(rows, patientColumns, attributes),
    [rows, patientColumns, attributes],
  );
  const patientIds = useMemo(() => rows.map((row) => row.patient.patientId), [rows]);
  const drilledRows = drill ? drill.indices.map((i) => rows[i]).filter(Boolean) : rows;
  return (
    <>
      <div className="inpatient-tabs" role="tablist" aria-label="結果の表示切替">
        {VIEWS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={view === item.key}
            className={`inpatient-tabs__tab${view === item.key ? " is-active" : ""}`}
            onClick={() => setView(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div hidden={view !== "list"}>
        {drill && (
          <div className="extract-results__drill">
            <span>{`内訳「${drill.label}」の ${drilledRows.length} 件`}</span>
            <FolderRegisterButton patientIds={drilledRows.map((row) => row.patient.patientId)} />
            <button
              type="button"
              onClick={() =>
                downloadBlob(recordTableCsv(header, patientColumns, drilledRows, attributes), `extract_subset_${today()}.csv`)
              }
            >
              CSV
            </button>
            <button type="button" onClick={() => setDrill(null)}>
              絞り込みを外す
            </button>
          </div>
        )}
        <ListTable {...props} header={fullHeader} attributes={attributes} rows={drilledRows} />
      </div>
      <div hidden={view !== "breakdown"}>
        <RecordBreakdownView
          header={fullHeader}
          cells={cells}
          patientIds={patientIds}
          settings={props.breakdown ?? localBreakdown}
          onSettingsChange={props.onBreakdownChange ?? setLocalBreakdown}
          onDrill={(indices, label) => {
            setDrill({ indices, label, signature });
            setView("list");
          }}
        />
      </div>
    </>
  );
}

/** 患者番号・氏名(カルテへのリンク)・患者の列・属性・固定列・項目の列の順に並べ、先頭 RECORD_DISPLAY_LIMIT 行だけを出す。 */
function ListTable({
  header,
  patientColumns,
  rows,
  emptyLabel,
  attributes,
}: Props & { attributes: PatientAttribute[] }) {
  return (
    <div className="extract-results__table-wrap">
      <table className="master-search__table extract-results__table template-extract__table">
        <thead>
          <tr>
            {header.map((label, index) => (
              <th key={index}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, RECORD_DISPLAY_LIMIT).map(({ key, patient, fixed, values }) => (
            <tr key={key}>
              <td className="extract-results__nowrap">{patient.patientNumber || "-"}</td>
              <td className="extract-results__nowrap">
                <Link to={`/patients/${patient.patientId}/karte`}>{patient.name || patient.patientId}</Link>
              </td>
              {patientColumns.map((column) => (
                <td key={column} className={column === "address" ? undefined : "extract-results__nowrap"}>
                  {patientCell(patient, column)}
                </td>
              ))}
              {attributes.map((attribute) => (
                <td key={`attribute-${attribute.label}`} className="extract-results__nowrap">
                  {attribute.valueOf(patient.patientId)}
                </td>
              ))}
              {fixed.map((cell, index) => (
                <td key={`fixed-${index}`} className="extract-results__nowrap">
                  {cell}
                </td>
              ))}
              {values.map((value, index) => (
                <td key={`value-${index}`} title={value || undefined}>
                  {value}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={header.length} className="master-search__empty">
                {emptyLabel}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
