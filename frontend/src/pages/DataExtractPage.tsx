import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
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
import { ExtractConditionBuilder } from "../components/extract/ExtractConditionBuilder";
import { ExtractResults } from "../components/extract/ExtractResults";
import { TrashIcon } from "../components/icons/TrashIcon";
import { Modal } from "../components/Modal";
import {
  PATIENT_COLUMNS,
  collectLeaves,
  emptyExtractQuery,
  extractCsv,
  leafLabel,
  patientColumnsOf,
  validateExtractQuery,
  type ExtractQueryBody,
  type PatientColumn,
} from "../fhir/extractQueryHelpers";
import { useDefinitionOwners, type DefinitionOwnerOption } from "../hooks/useDefinitionOwners";
import { today } from "../lib/dates";
import { downloadBlob } from "../lib/download";

// データ抽出(docs/data-extract-design.md)。病名・検査結果・処方/注射・入院・外来・患者属性の
// 条件を AND / OR で組み、該当する患者を一覧・内訳・CSV にする。条件は持ち主(院内共通 /
// 診療科 / 自分)ごとに保存できる。抽出は上流 FHIR をその場で引く。

const SCOPE_LABELS: Record<string, string> = { facility: "院内共通", department: "診療科", practitioner: "自分" };

export function DataExtractPage() {
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
  const canEditSelected = selected ? ownerOf(owners, selected)?.canEdit === true : false;

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
    <div className="page data-extract">
      <div className="page__header">
        <h1>データ抽出</h1>
      </div>

      <div className="data-extract__toolbar">
        <label className="extract-field extract-field--inline">
          条件
          <select
            value={selectedId ?? ""}
            onChange={(e) => {
              if (!confirmDiscard()) return;
              load(queries.find((q) => q.id === Number(e.target.value)) ?? null);
            }}
          >
            <option value="">新しい条件</option>
            {(["practitioner", "department", "facility"] as const).map((scope) => {
              const items = queries.filter((q) => q.scope === scope);
              if (items.length === 0) return null;
              return (
                <optgroup key={scope} label={SCOPE_LABELS[scope]}>
                  {items.map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.name}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
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
        <SaveModal
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
    </div>
  );
}

function ownerOf(owners: DefinitionOwnerOption[], query: ExtractQuery): DefinitionOwnerOption | undefined {
  return owners.find((o) => o.scope === query.scope && (o.scope === "facility" || o.ownerId === query.owner_id));
}

function SaveModal({
  owners,
  initialName,
  pending,
  error,
  onClose,
  onSave,
}: {
  owners: DefinitionOwnerOption[];
  initialName: string;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (name: string, owner: DefinitionOwnerOption) => void;
}) {
  const editable = owners.filter((o) => o.canEdit);
  const [name, setName] = useState(initialName);
  const [scope, setScope] = useState(editable.find((o) => o.scope === "practitioner")?.scope ?? editable[0]?.scope);
  const owner = editable.find((o) => o.scope === scope);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !owner) return;
    onSave(name.trim(), owner);
  }

  return (
    <Modal title="条件を保存" onClose={onClose}>
      <form className="data-extract__save" onSubmit={handleSubmit}>
        <ErrorBanner error={error} />
        <label className="extract-field">
          名前
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label className="extract-field">
          保存先
          <select value={scope ?? ""} onChange={(e) => setScope(e.target.value as DefinitionOwnerOption["scope"])}>
            {editable.map((o) => (
              <option key={o.scope} value={o.scope}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <div className="lab-order-item__actions">
          <button type="submit" disabled={pending || !name.trim() || !owner}>
            {pending ? "保存中..." : "保存"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * 一覧・CSV に出す患者の列(患者番号・氏名はいつも出す)。選んでいないあいだは既定の列にチェックを
 * 付けて見せ、1 つでも変えたら選んだ列だけを出す。
 */
function PatientColumnsField({
  value,
  selected,
  onChange,
}: {
  value: PatientColumn[];
  selected: boolean;
  onChange: (columns: PatientColumn[]) => void;
}) {
  return (
    <div className="data-extract__output" role="group" aria-label="出力する患者の項目">
      <span className="extract-checks__label">出力項目</span>
      {PATIENT_COLUMNS.map((column) => (
        <label key={column.value} className="extract-checks__item">
          <input
            type="checkbox"
            checked={value.includes(column.value)}
            onChange={(e) =>
              onChange(
                e.target.checked ? [...value, column.value] : value.filter((v) => v !== column.value),
              )
            }
          />
          {column.label}
        </label>
      ))}
      {selected && (
        <button type="button" className="rp-card__compact-button" onClick={() => onChange([])}>
          既定
        </button>
      )}
    </div>
  );
}
