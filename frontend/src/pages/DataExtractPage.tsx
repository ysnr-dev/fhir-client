import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { ExtractQuery } from "../api/masterClient";
import {
  useExtractQueries,
  useExtractQueryMutations,
  useExtractQueryRuns,
  useRecordExtractRun,
} from "../api/masterQueries";
import { useExtractDetailExport, useExtractRun } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { AdverseEventExtractPanel } from "../components/extract/AdverseEventExtractPanel";
import { ConditionExtractPanel } from "../components/extract/ConditionExtractPanel";
import { DataExtractGuide } from "../components/extract/DataExtractGuide";
import { EncounterExtractPanel } from "../components/extract/EncounterExtractPanel";
import { ExtractConditionBuilder } from "../components/extract/ExtractConditionBuilder";
import { ExtractQuerySelect } from "../components/extract/ExtractQuerySelect";
import { ExtractResults } from "../components/extract/ExtractResults";
import { FolderRegisterButton } from "../components/extract/FolderRegisterButton";
import { LabExtractPanel } from "../components/extract/LabExtractPanel";
import { MedicationExtractPanel } from "../components/extract/MedicationExtractPanel";
import { MicroExtractPanel } from "../components/extract/MicroExtractPanel";
import { PathwayExtractPanel } from "../components/extract/PathwayExtractPanel";
import { PerformExtractPanel } from "../components/extract/PerformExtractPanel";
import { SurgeryExtractPanel } from "../components/extract/SurgeryExtractPanel";
import { PatientColumnsField } from "../components/extract/PatientColumnsField";
import { SaveQueryModal } from "../components/extract/SaveQueryModal";
import { TemplateExtractPanel } from "../components/extract/TemplateExtractPanel";
import { TrashIcon } from "../components/icons/TrashIcon";
import {
  collectLeaves,
  emptyExtractQuery,
  extractCsv,
  leafLabel,
  patientColumnsOf,
  validateExtractQuery,
  type ExtractQueryBody,
} from "../fhir/extractQueryHelpers";
import { definitionOwnerOf, useDefinitionOwners } from "../hooks/useDefinitionOwners";
import { today } from "../lib/dates";
import { downloadBlob } from "../lib/download";

// データ抽出(docs/data-extract-design.md)。「患者」タブは病名・検査結果・処方/注射・入院・外来・
// 患者属性の条件を AND / OR で組み、該当する患者を一覧・内訳・CSV にする。条件は持ち主(院内共通 /
// 診療科 / 自分)ごとに保存できる。ほかのタブは記録 1 件を 1 行にした表にする: 「入院・外来」は入院・外来受診、「病名」は病名、
// 「テンプレート」は 1 つのテンプレートの回答、「検査結果」は検査・バイタルの結果、「投薬」は処方・注射の薬剤、
// 「細菌検査」は分離菌と薬剤感受性、「手術」は手術の実施記録、「部門実施」は放射線・内視鏡などの実施記録、
// 「有害事象」は CTCAE Grade の記録、「パス」はクリニカルパスの適用と評価(バリアンス)。
// いずれも保存した患者の条件や患者フォルダの患者に絞れる。
// 抽出は上流 FHIR をその場で引く。

type Tab =
  | "patient"
  | "encounter"
  | "condition"
  | "template"
  | "lab"
  | "medication"
  | "micro"
  | "surgery"
  | "perform"
  | "adverse"
  | "pathway";

const TABS: { key: Tab; label: string }[] = [
  { key: "patient", label: "患者" },
  { key: "encounter", label: "入院・外来" },
  { key: "condition", label: "病名" },
  { key: "template", label: "テンプレート" },
  { key: "lab", label: "検査結果" },
  { key: "medication", label: "投薬" },
  { key: "micro", label: "細菌検査" },
  { key: "surgery", label: "手術" },
  { key: "perform", label: "部門実施" },
  { key: "adverse", label: "有害事象" },
  { key: "pathway", label: "パス" },
];

function tabOf(value: string | null): Tab {
  return TABS.find((t) => t.key === value)?.key ?? "patient";
}

export function DataExtractPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [guideOpen, setGuideOpen] = useState(false);
  const tab = tabOf(searchParams.get("tab"));

  // 結果の表は列が多いので、本文の幅制限を外して全画面にする。
  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  return (
    <div className="page data-extract">
      <div className="page__header">
        <div className="data-extract__title">
          <h1>データ抽出</h1>
          <button
            type="button"
            className="modal__help"
            onClick={() => setGuideOpen(true)}
            aria-label="データ抽出の使い方"
            title="データ抽出の使い方"
          >
            ?
          </button>
        </div>
      </div>
      <div className="inpatient-tabs data-extract__tabs" role="tablist" aria-label="抽出の切替">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            className={`inpatient-tabs__tab${tab === item.key ? " is-active" : ""}`}
            onClick={() => setSearchParams(item.key === "patient" ? {} : { tab: item.key }, { replace: true })}
          >
            {item.label}
          </button>
        ))}
      </div>
      {tab === "patient" && <PatientExtractTab />}
      {tab === "encounter" && <EncounterExtractPanel />}
      {tab === "condition" && <ConditionExtractPanel />}
      {tab === "template" && <TemplateExtractPanel />}
      {tab === "lab" && <LabExtractPanel />}
      {tab === "medication" && <MedicationExtractPanel />}
      {tab === "micro" && <MicroExtractPanel />}
      {tab === "surgery" && <SurgeryExtractPanel />}
      {tab === "perform" && <PerformExtractPanel />}
      {tab === "adverse" && <AdverseEventExtractPanel />}
      {tab === "pathway" && <PathwayExtractPanel />}
      {guideOpen && <DataExtractGuide onClose={() => setGuideOpen(false)} />}
    </div>
  );
}

/** 条件に当てはまる患者の抽出。 */
function PatientExtractTab() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { owners, ready, departmentId, practitionerId, practitionerName } = useDefinitionOwners("自分の条件");
  const list = useExtractQueries(departmentId, practitionerId, ready);
  const mutations = useExtractQueryMutations();
  const queries = useMemo(() => list.data?.items ?? [], [list.data]);

  const [body, setBody] = useState<ExtractQueryBody>(emptyExtractQuery);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [savedJson, setSavedJson] = useState(JSON.stringify(emptyExtractQuery()));
  const [saving, setSaving] = useState(false);
  const [validation, setValidation] = useState<string[]>([]);
  const extract = useExtractRun();
  const runs = useExtractQueryRuns(selectedId);
  const recordRun = useRecordExtractRun();
  // 保存した条件を直さずに実行したときだけ、結果の人数を定点観測の記録に残す(直した条件の
  // 人数は保存した条件の推移ではないため)。
  const recordForRef = useRef<number | null>(null);
  const detail = useExtractDetailExport();

  const selected = queries.find((q) => q.id === selectedId) ?? null;
  const dirty = JSON.stringify(body) !== savedJson;
  const canEditSelected = selected ? definitionOwnerOf(owners, selected)?.canEdit === true : false;

  function load(query: ExtractQuery | null) {
    const next = query ? query.definition : emptyExtractQuery();
    setBody(next);
    setSavedJson(JSON.stringify(next));
    setSelectedId(query?.id ?? null);
    setValidation([]);
    extract.reset();
    setSearchParams(query ? { query: String(query.id) } : {}, { replace: true });
  }

  // ?query=<id> で開いたら読み込む(実行はしない)。
  const queryParam = Number(searchParams.get("query"));
  useEffect(() => {
    if (!queryParam || selectedId === queryParam) return;
    const found = queries.find((q) => q.id === queryParam);
    if (found) load(found);
    // load は選択の切替でだけ呼ぶ(依存に入れると読込のたびに走る)。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryParam, queries]);

  function confirmDiscard(): boolean {
    return !dirty || window.confirm("編集中の条件を破棄しますか？");
  }

  function handleRun() {
    const errors = validateExtractQuery(body);
    setValidation(errors);
    if (errors.length > 0) return;
    recordForRef.current = selected && !dirty ? selected.id : null;
    void extract.run(body, leafLabel);
  }

  const ranAt = extract.result?.ranAt;
  useEffect(() => {
    const queryId = recordForRef.current;
    const result = extract.result;
    if (!queryId || !result) return;
    recordForRef.current = null;
    recordRun.mutate({
      queryId,
      payload: {
        patient_count: result.rows.length,
        leaf_counts: Object.fromEntries(result.leaves.map((leaf) => [leaf.key, result.hits.get(leaf.key)?.size ?? 0])),
        ran_by_id: practitionerId,
        ran_by_name: practitionerName || undefined,
      },
    });
    // 結果が出た(ranAt が変わった)ときにだけ記録する。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ranAt]);

  async function handleOverwrite() {
    if (!selected) return;
    const errors = validateExtractQuery(body);
    setValidation(errors);
    if (errors.length) return;
    const saved = await mutations.update.mutateAsync({ id: selected.id, payload: { definition: body } });
    setSavedJson(JSON.stringify(saved.definition));
  }

  function handleDelete() {
    if (!selected || !window.confirm(`「${selected.name}」を削除しますか？`)) return;
    mutations.remove.mutate(selected.id, { onSuccess: () => load(null) });
  }

  // 出力項目は今の条件のものを使う(実行し直さなくても、出す列を変えれば結果に反映する)。
  const outputLeaves = useMemo(() => {
    const current = new Map(collectLeaves(body.root).map((leaf) => [leaf.key, leaf]));
    return (extract.result?.leaves ?? []).map((leaf) => {
      const now = current.get(leaf.key);
      return now ? { ...leaf, output_fields: now.output_fields } : leaf;
    });
  }, [body.root, extract.result]);

  const mutationError =
    mutations.create.error ?? mutations.update.error ?? mutations.remove.error ?? recordRun.error ?? runs.error;

  return (
    <>
      <div className="data-extract__toolbar">
        <label className="extract-field extract-field--inline">
          条件
          <ExtractQuerySelect
            queries={queries}
            value={selectedId}
            emptyLabel="新しい条件"
            onChange={(query) => {
              if (!confirmDiscard()) return;
              load(query);
            }}
          />
        </label>
        {dirty && <span className="data-extract__dirty">未保存</span>}
        {selected && canEditSelected && (
          <button type="button" onClick={handleOverwrite} disabled={!dirty || mutations.update.isPending}>
            保存
          </button>
        )}
        <button type="button" onClick={() => setSaving(true)}>
          {selected ? "別名保存" : "保存"}
        </button>
        {selected && canEditSelected && (
          <button
            type="button"
            className="rp-card__icon-button"
            title="条件を削除"
            aria-label="条件を削除"
            onClick={handleDelete}
          >
            <TrashIcon />
          </button>
        )}
      </div>

      <ErrorBanner error={list.error ?? mutationError} />

      <ExtractConditionBuilder
        root={body.root}
        onChange={(root) => setBody({ ...body, root })}
        progress={extract.progress}
      />

      <PatientColumnsField
        value={patientColumnsOf(body.output)}
        selected={Boolean(body.output?.patient_columns?.length)}
        onChange={(patient_columns) =>
          setBody({ ...body, output: patient_columns.length ? { ...body.output, patient_columns } : undefined })
        }
      />

      {validation.length > 0 && (
        <div className="error-banner" role="alert">
          {validation.map((message) => (
            <p key={message} className="error-banner__line error-banner__line--error">
              {message}
            </p>
          ))}
        </div>
      )}

      <div className="data-extract__actions">
        {extract.running ? (
          <button type="button" onClick={extract.cancel}>
            中止
          </button>
        ) : (
          <button type="button" onClick={handleRun}>
            実行
          </button>
        )}
        <button type="button" className="rp-card__compact-button" disabled={extract.running} onClick={extract.clearCache}>
          再読込
        </button>
        {(extract.running || extract.requests > 0) && (
          <span className="order-select__muted">{`検索 ${extract.requests} 回${extract.running ? "・実行中" : ""}`}</span>
        )}
        {extract.result && (
          <span className="data-extract__exports">
            {detail.exporting && (
              <span className="order-select__muted">{`明細を読込中(検索 ${detail.requests} 回)`}</span>
            )}
            <FolderRegisterButton patientIds={extract.result.rows.map((r) => r.patientId)} />
            <button
              type="button"
              onClick={() =>
                downloadBlob(
                  extractCsv(extract.result!.rows, outputLeaves, body.output),
                  `extract_${selected?.name ?? "条件"}_${today()}.csv`,
                )
              }
            >
              CSV
            </button>
            {detail.exporting ? (
              <button type="button" onClick={detail.cancel}>
                中止
              </button>
            ) : (
              <button
                type="button"
                disabled={extract.result.rows.length === 0}
                onClick={() =>
                  void detail.exportCsv(
                    extract.result!,
                    `extract_detail_${selected?.name ?? "条件"}_${today()}.csv`,
                    body.output,
                  )
                }
              >
                明細CSV
              </button>
            )}
          </span>
        )}
      </div>

      <ErrorBanner error={extract.error ?? detail.error} />
      {extract.result && (
        <ExtractResults
          result={extract.result}
          leaves={outputLeaves}
          output={body.output}
          history={selected && !dirty ? (runs.data ?? []) : undefined}
        />
      )}

      {saving && (
        <SaveQueryModal
          owners={owners}
          initialName={selected ? `${selected.name}のコピー` : ""}
          pending={mutations.create.isPending}
          error={mutations.create.error}
          onClose={() => setSaving(false)}
          onSave={async (name, owner) => {
            const errors = validateExtractQuery(body);
            setValidation(errors);
            if (errors.length) {
              setSaving(false);
              return;
            }
            const created = await mutations.create.mutateAsync({
              scope: owner.scope,
              owner_id: owner.ownerId,
              owner_name: owner.ownerName,
              name,
              definition: body,
            });
            setSaving(false);
            setSelectedId(created.id);
            setSavedJson(JSON.stringify(created.definition));
            setSearchParams({ query: String(created.id) }, { replace: true });
          }}
        />
      )}
    </>
  );
}
