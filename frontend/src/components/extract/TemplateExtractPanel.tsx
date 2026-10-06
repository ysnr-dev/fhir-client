import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useExtractQueries } from "../../api/masterQueries";
import { useExtractRun, useQuestionnaireOptions, useSelfDepartments, useTemplateExtract } from "../../api/queries";
import { departmentDisplayName, sortDepartmentsByCode } from "../../fhir/departmentHelpers";
import {
  leafLabel,
  patientCell,
  patientColumnsOf,
  resolvePeriod,
  type ExtractOutput,
  type ExtractPeriod,
} from "../../fhir/extractQueryHelpers";
import {
  latestPerPatient,
  sortVersionsDesc,
  templateExtractCsv,
  templateExtractHeader,
  templateExtractTable,
  templateFixedCells,
} from "../../fhir/templateExtractHelpers";
import { useDefinitionOwners } from "../../hooks/useDefinitionOwners";
import { today } from "../../lib/dates";
import { downloadBlob } from "../../lib/download";
import { ErrorBanner } from "../ErrorBanner";
import { TemplateSelect } from "../TemplateSelect";
import { TruncatedNotice } from "../TruncatedNotice";
import { PeriodFields } from "./ExtractLeafFields";
import { ExtractQuerySelect } from "./ExtractQuerySelect";
import { PatientColumnsField } from "./PatientColumnsField";

/** 画面に並べる行の上限(CSV にはすべて出す)。 */
const DISPLAY_LIMIT = 500;

/**
 * テンプレートの抽出(docs/data-extract-design.md §8)。1 つのテンプレートの回答を表と CSV にする。
 * 患者の条件を選んだら、先にその条件で患者を抽出し、該当した患者の回答だけを読む。
 */
export function TemplateExtractPanel() {
  const options = useQuestionnaireOptions();
  const { departments } = useSelfDepartments();
  const departmentOptions = sortDepartmentsByCode(departments).filter((d) => d.id);
  const owners = useDefinitionOwners("自分の条件");
  const queryList = useExtractQueries(owners.departmentId, owners.practitionerId, owners.ready);
  const queries = useMemo(() => queryList.data?.items ?? [], [queryList.data]);
  const patientExtract = useExtractRun();
  const extract = useTemplateExtract();

  const [templateUrl, setTemplateUrl] = useState("");
  const [period, setPeriod] = useState<ExtractPeriod>({ mode: "relative", days: 365 });
  const [departmentId, setDepartmentId] = useState("");
  const [queryId, setQueryId] = useState<number | null>(null);
  const [latestOnly, setLatestOnly] = useState(false);
  const [output, setOutput] = useState<ExtractOutput | undefined>(undefined);

  // 版は url ごとにまとめて集めるので、選択肢には url ごとに最新の版だけを出す。
  const templates = useMemo(() => {
    const byUrl = new Map<string, fhir4.Questionnaire[]>();
    for (const q of options.questionnaires) {
      if (!q.url) continue;
      byUrl.set(q.url, [...(byUrl.get(q.url) ?? []), q]);
    }
    return [...byUrl.values()].map((versions) => sortVersionsDesc(versions)[0]);
  }, [options.questionnaires]);
  const selected = templates.find((q) => q.url === templateUrl);

  const table = useMemo(
    () =>
      extract.result
        ? templateExtractTable(extract.result.questionnaires, extract.result.responses, extract.result.patients)
        : null,
    [extract.result],
  );
  const rows = useMemo(() => (table ? (latestOnly ? latestPerPatient(table.rows) : table.rows) : []), [table, latestOnly]);
  const patientColumns = patientColumnsOf(output);
  const query = queries.find((q) => q.id === queryId) ?? null;
  const running = patientExtract.running || extract.running;

  async function handleRun() {
    if (!selected?.url) return;
    const url = selected.url;
    let patientIds: string[] | undefined;
    if (query) {
      const result = await patientExtract.run(query.definition, leafLabel);
      if (!result) return;
      patientIds = result.rows.map((row) => row.patientId);
    }
    const range = resolvePeriod(period, today());
    void extract.run({
      url,
      from: range?.from ?? "",
      to: range?.to ?? "",
      departmentId: departmentId || undefined,
      patientIds,
    });
  }

  function handleCancel() {
    patientExtract.cancel();
    extract.cancel();
  }

  const title = selected?.title ?? selected?.name ?? "テンプレート";

  return (
    <>
      <div className="data-extract__toolbar data-extract__toolbar--fields">
        <TemplateSelect
          questionnaires={templates}
          value={selected?.id ?? ""}
          onChange={(id) => setTemplateUrl(templates.find((q) => q.id === id)?.url ?? "")}
        />
        <PeriodFields period={period} onChange={(next) => next && setPeriod(next)} />
        <label className="extract-field">
          診療科
          <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            <option value="">すべて</option>
            {departmentOptions.map((d) => (
              <option key={d.id} value={d.id}>
                {departmentDisplayName(d)}
              </option>
            ))}
          </select>
        </label>
        <label className="extract-field">
          患者
          <ExtractQuerySelect
            queries={queries}
            value={queryId}
            emptyLabel="すべて"
            onChange={(next) => setQueryId(next?.id ?? null)}
          />
        </label>
        <label className="extract-checks__item">
          <input type="checkbox" checked={latestOnly} onChange={(e) => setLatestOnly(e.target.checked)} />
          患者ごとに最新
        </label>
      </div>

      <PatientColumnsField
        value={patientColumns}
        selected={Boolean(output?.patient_columns?.length)}
        onChange={(patient_columns) => setOutput(patient_columns.length ? { patient_columns } : undefined)}
      />

      <ErrorBanner error={options.error ?? queryList.error} />

      <div className="data-extract__actions">
        {running ? (
          <button type="button" onClick={handleCancel}>
            中止
          </button>
        ) : (
          <button type="button" onClick={() => void handleRun()} disabled={!selected}>
            実行
          </button>
        )}
        {patientExtract.running && (
          <span className="order-select__muted">{`患者を抽出中(検索 ${patientExtract.requests} 回)`}</span>
        )}
        {extract.running && <span className="order-select__muted">実行中</span>}
        {table && (
          <span className="data-extract__exports">
            <button
              type="button"
              disabled={rows.length === 0}
              onClick={() =>
                downloadBlob(templateExtractCsv(table.columns, rows, output), `template_${title}_${today()}.csv`)
              }
            >
              CSV
            </button>
          </span>
        )}
      </div>

      <ErrorBanner error={patientExtract.error ?? extract.error} />
      {table && (
        <section className="extract-results">
          <div className="extract-results__summary">
            <span className="extract-results__count">
              {latestOnly ? `${rows.length} 人` : `${rows.length} 件(${new Set(rows.map((r) => r.patientId)).size} 人)`}
            </span>
            {query && patientExtract.result && (
              <span className="order-select__muted">{`「${query.name}」に該当 ${patientExtract.result.rows.length} 人`}</span>
            )}
          </div>
          <TruncatedNotice show={extract.result?.truncated}>
            回答が多いため、新しいものから一部だけを読みました。期間を絞ってください。
          </TruncatedNotice>
          <TruncatedNotice show={rows.length > DISPLAY_LIMIT}>
            {`先頭の ${DISPLAY_LIMIT} 件を表示しています。すべては CSV に出ます。`}
          </TruncatedNotice>
          <div className="extract-results__table-wrap">
            <table className="master-search__table extract-results__table template-extract__table">
              <thead>
                <tr>
                  {templateExtractHeader(table.columns, output).map((header, index) => (
                    <th key={index}>{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, DISPLAY_LIMIT).map((row) => (
                  <tr key={row.responseId}>
                    <td className="extract-results__nowrap">{row.patientNumber || "-"}</td>
                    <td className="extract-results__nowrap">
                      <Link to={`/patients/${row.patientId}/karte`}>{row.name || row.patientId}</Link>
                    </td>
                    {patientColumns.map((column) => (
                      <td key={column} className={column === "address" ? undefined : "extract-results__nowrap"}>
                        {patientCell(row, column)}
                      </td>
                    ))}
                    {templateFixedCells(row).map((cell, index) => (
                      <td key={`fixed-${index}`} className="extract-results__nowrap">
                        {cell}
                      </td>
                    ))}
                    {table.columns.map((column) => {
                      const value = row.values.get(column.key) ?? "";
                      return (
                        <td key={column.key} title={value || undefined}>
                          {value}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={templateExtractHeader(table.columns, output).length}
                      className="master-search__empty"
                    >
                      該当する回答はありません
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
