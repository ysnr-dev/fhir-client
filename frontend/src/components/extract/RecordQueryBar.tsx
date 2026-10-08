import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { ExtractQuery } from "../../api/masterClient";
import { useExtractQueries, useExtractQueryMutations } from "../../api/masterQueries";
import {
  recordDefinitionOf,
  stableJson,
  type ExtractRecordDefinition,
  type ExtractRecordTab,
} from "../../fhir/extractRecordQuery";
import { definitionOwnerOf, useDefinitionOwners } from "../../hooks/useDefinitionOwners";
import { ErrorBanner } from "../ErrorBanner";
import { TrashIcon } from "../icons/TrashIcon";
import { ExtractQuerySelect } from "./ExtractQuerySelect";
import { SaveQueryModal } from "./SaveQueryModal";

interface Props<T extends ExtractRecordDefinition> {
  tab: ExtractRecordTab;
  /** 今の入力欄の値(空の値を落としたもの)。 */
  current: T;
  /** 保存した条件を入力欄に戻す。null は「新しい条件」(入力欄を初期値に戻す)。 */
  onLoad: (definition: T | null) => void;
}

/**
 * 記録を表にするタブの「条件」の帯(docs/data-extract-design.md §17)。そのタブに保存した条件を選んで
 * 入力欄に戻し、今の入力を保存・別名保存・削除する。「患者」タブと同じく持ち主は院内共通 / 診療科 / 自分で、
 * `?tab=<タブ>&query=<id>` で開くと読み込む(実行はしない)。
 */
export function RecordQueryBar<T extends ExtractRecordDefinition>({ tab, current, onLoad }: Props<T>) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { owners, ready, departmentId, practitionerId } = useDefinitionOwners("自分の条件");
  const list = useExtractQueries(departmentId, practitionerId, ready, tab);
  const queries = useMemo(() => list.data?.items ?? [], [list.data]);
  const mutations = useExtractQueryMutations();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [savedJson, setSavedJson] = useState("");
  const [saving, setSaving] = useState(false);

  const selected = queries.find((q) => q.id === selectedId) ?? null;
  const dirty = selected !== null && stableJson(current) !== savedJson;
  const canEditSelected = selected ? definitionOwnerOf(owners, selected)?.canEdit === true : false;

  function load(query: ExtractQuery | null) {
    const definition = query ? recordDefinitionOf<T>(query) : null;
    onLoad(definition);
    setSelectedId(query?.id ?? null);
    setSavedJson(definition ? stableJson(definition) : "");
    setSearchParams(query ? { tab, query: String(query.id) } : { tab }, { replace: true });
  }

  // ?query=<id> で開いたら読み込む。
  const queryParam = Number(searchParams.get("query"));
  useEffect(() => {
    if (!queryParam || selectedId === queryParam) return;
    const found = queries.find((q) => q.id === queryParam);
    if (found) load(found);
    // load は選択の切替でだけ呼ぶ(依存に入れると読込のたびに走る)。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryParam, queries]);

  async function handleOverwrite() {
    if (!selected) return;
    const saved = await mutations.update.mutateAsync({ id: selected.id, payload: { definition: current } });
    setSavedJson(stableJson(saved.definition));
  }

  function handleDelete() {
    if (!selected || !window.confirm(`「${selected.name}」を削除しますか？`)) return;
    mutations.remove.mutate(selected.id, { onSuccess: () => load(null) });
  }

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
              if (dirty && !window.confirm("編集中の条件を破棄しますか？")) return;
              load(query);
            }}
          />
        </label>
        {dirty && <span className="data-extract__dirty">未保存</span>}
        {selected && canEditSelected && (
          <button type="button" onClick={() => void handleOverwrite()} disabled={!dirty || mutations.update.isPending}>
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
      <ErrorBanner error={list.error ?? mutations.update.error ?? mutations.remove.error} />
      {saving && (
        <SaveQueryModal
          owners={owners}
          initialName={selected ? `${selected.name}のコピー` : ""}
          pending={mutations.create.isPending}
          error={mutations.create.error}
          onClose={() => setSaving(false)}
          onSave={async (name, owner) => {
            const created = await mutations.create.mutateAsync({
              scope: owner.scope,
              owner_id: owner.ownerId,
              owner_name: owner.ownerName,
              name,
              tab,
              definition: current,
            });
            setSaving(false);
            setSelectedId(created.id);
            setSavedJson(stableJson(created.definition));
            setSearchParams({ tab, query: String(created.id) }, { replace: true });
          }}
        />
      )}
    </>
  );
}
