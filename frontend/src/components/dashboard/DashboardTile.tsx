import { useMemo, type PointerEvent } from "react";
import { Link } from "react-router-dom";
import type { ExtractQuery } from "../../api/masterClient";
import { dashboardViewLabel, type DashboardTile as Tile } from "../../fhir/dashboardLayout";
import { patientColumnsOf } from "../../fhir/extractQueryHelpers";
import { extractTabLabel, type ExtractTab, type IndicatorExtractDefinition } from "../../fhir/extractRecordQuery";
import { EXTRACT_TAB_RUNNERS, recordCountLabel } from "../../fhir/extractTabRunners";
import { recordTableCells, recordTableHeader } from "../../fhir/recordTableHelpers";
import type { TileOutcome, TileState } from "../../hooks/useDashboardRun";
import { dateTimeLabel } from "../../lib/dates";
import { ErrorBanner } from "../ErrorBanner";
import { BreakdownTable, ResultTable } from "../extract/ExtractResults";
import { IndicatorTrendView } from "../extract/IndicatorTrendView";
import { RecordBreakdownView } from "../extract/RecordBreakdownView";
import { RecordResultNotices } from "../extract/RecordResultNotices";
import { RecordListTable } from "../extract/RecordResultTable";
import { TrashIcon } from "../icons/TrashIcon";
import { RowMenu } from "../RowMenu";
import { TruncatedNotice } from "../TruncatedNotice";

interface Props {
  tile: Tile;
  /** タイルが指す保存した条件。消えていれば undefined。 */
  query: ExtractQuery | undefined;
  state: TileState;
  editing: boolean;
  onRun: () => void;
  onRemove: () => void;
  /** 編集モードで見出しを掴んだ(動かす)。 */
  onMoveStart: (event: PointerEvent<HTMLElement>) => void;
  /** 編集モードで右下の角を掴んだ(大きさを変える)。 */
  onResizeStart: (event: PointerEvent<HTMLElement>) => void;
}

/** データ抽出で開く URL(「患者」タブは tab を付けない)。 */
function dataExtractUrl(query: ExtractQuery): string {
  const params = new URLSearchParams();
  if (query.tab !== "patient") params.set("tab", query.tab);
  params.set("query", String(query.id));
  return `/data-extract?${params.toString()}`;
}

/** ダッシュボードのタイル 1 つ(docs/dashboard-design.md §4)。見出しに条件の名前と実行日時、本体に結果。 */
export function DashboardTile({ tile, query, state, editing, onRun, onRemove, onMoveStart, onResizeStart }: Props) {
  const title = tile.title || query?.name || "条件が見つかりません";
  const style = { "--tile-x": tile.x, "--tile-y": tile.y, "--tile-w": tile.w, "--tile-h": tile.h } as React.CSSProperties;
  return (
    <section className={`dashboard-tile${editing ? " is-editing" : ""}`} style={style} aria-label={title}>
      <header className="dashboard-tile__header" onPointerDown={editing ? onMoveStart : undefined}>
        <div className="dashboard-tile__heading">
          <h2 className="dashboard-tile__title">{title}</h2>
          <span className="dashboard-tile__meta">
            {query ? `${extractTabLabel(query.tab as ExtractTab)}・${dashboardViewLabel(tile.view)}` : dashboardViewLabel(tile.view)}
          </span>
        </div>
        {editing ? (
          <button
            type="button"
            className="rp-card__icon-button"
            title="タイルを削除"
            aria-label="タイルを削除"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onRemove}
          >
            <TrashIcon />
          </button>
        ) : (
          <div className="dashboard-tile__actions">
            {state.ranAt && <span className="dashboard-tile__ran-at">{dateTimeLabel(state.ranAt)}</span>}
            <RowMenu label={`${title} の操作`}>
              <button type="button" className="row-menu__item" disabled={!query || state.running} onClick={onRun}>
                実行
              </button>
              {query && (
                <Link to={dataExtractUrl(query)} className="row-menu__item">
                  データ抽出で開く
                </Link>
              )}
            </RowMenu>
          </div>
        )}
      </header>
      <div className="dashboard-tile__body">
        <TileBody tile={tile} query={query} state={state} />
      </div>
      {editing && (
        <button
          type="button"
          className="dashboard-tile__resize"
          aria-label="大きさを変える"
          title="大きさを変える"
          onPointerDown={onResizeStart}
        />
      )}
    </section>
  );
}

function TileBody({ tile, query, state }: { tile: Tile; query: ExtractQuery | undefined; state: TileState }) {
  if (!query) return <p className="order-select__muted">条件が見つかりません(削除されたか、見えない持ち主の条件です)。</p>;
  if (state.running && !state.outcome) return <p className="order-select__muted">実行中</p>;
  if (!state.outcome) return <p className="order-select__muted">未実行</p>;
  const outcome = state.outcome;
  if (outcome.kind === "error") return <ErrorBanner error={outcome.error} />;
  return (
    <>
      {state.running && <p className="order-select__muted">実行中</p>}
      {outcome.kind === "patient" ? (
        <PatientTileBody tile={tile} query={query} outcome={outcome} />
      ) : (
        <RecordTileBody tile={tile} outcome={outcome} />
      )}
    </>
  );
}

function PatientTileBody({
  tile,
  query,
  outcome,
}: {
  tile: Tile;
  query: ExtractQuery;
  outcome: Extract<TileOutcome, { kind: "patient" }>;
}) {
  const { result } = outcome;
  if (tile.view === "count") return <Count value={result.rows.length} unit="人" />;
  if (tile.view === "breakdown") return <BreakdownTable result={result} />;
  return (
    <ResultTable
      result={result}
      leaves={result.leaves}
      output={query.definition.output}
      teamId={query.scope === "team" ? (query.owner_id ?? undefined) : undefined}
    />
  );
}

function RecordTileBody({ tile, outcome }: { tile: Tile; outcome: Extract<TileOutcome, { kind: "record" }> }) {
  const { table, definition, attributes } = outcome;
  const runner = EXTRACT_TAB_RUNNERS[outcome.tab];
  const patientColumns = patientColumnsOf(definition.output);
  const header = useMemo(
    () => recordTableHeader(table.header, patientColumns, attributes),
    [table.header, patientColumns, attributes],
  );
  const cells = useMemo(() => recordTableCells(table.rows, patientColumns, attributes), [table.rows, patientColumns, attributes]);
  const patientIds = useMemo(() => table.rows.map((row) => row.patient.patientId), [table.rows]);
  const notices = (
    <>
      <RecordResultNotices runner={runner} truncated={outcome.truncated} table={table} />
      <TruncatedNotice show={outcome.attendingTruncated}>
        受診・処方が多く読み切れなかったため、担当医は読めた記録から決めています。
      </TruncatedNotice>
    </>
  );
  if (tile.view === "count") {
    return (
      <>
        <p className="dashboard-tile__number">{table.headline ?? recordCountLabel(table)}</p>
        {notices}
      </>
    );
  }
  if (tile.view === "breakdown" && outcome.tab === "indicator") {
    return (
      <>
        {notices}
        <IndicatorTrendView
          header={header}
          cells={cells}
          patientIds={patientIds}
          definition={definition as IndicatorExtractDefinition}
          periods={table.periods}
          controls={false}
        />
      </>
    );
  }
  if (tile.view === "breakdown") {
    return (
      <>
        {notices}
        <RecordBreakdownView
          header={header}
          cells={cells}
          patientIds={patientIds}
          settings={definition.breakdown ?? {}}
          onSettingsChange={() => undefined}
          controls={false}
        />
      </>
    );
  }
  return (
    <>
      {notices}
      <RecordListTable
        header={header}
        patientColumns={patientColumns}
        attributes={attributes}
        rows={table.rows}
        emptyLabel={table.incomplete ? "" : runner.emptyLabel}
      />
    </>
  );
}

function Count({ value, unit }: { value: number; unit: string }) {
  return (
    <p className="dashboard-tile__number">
      {value}
      <span className="dashboard-tile__unit">{unit}</span>
    </p>
  );
}
