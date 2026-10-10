import type { ExtractQuery } from "../../api/masterClient";
import { EXTRACT_KIND_LABELS, newLeaf } from "../../fhir/extractQueryHelpers";
import { EXTRACT_KINDS, type ExtractKind, type ExtractLeaf } from "../../fhir/extractQueryModel";
import { MAX_STRATA, type ExtractStratum } from "../../fhir/extractRecordQuery";
import { stratumName } from "../../hooks/useExtractPatientScope";
import { TrashIcon } from "../icons/TrashIcon";
import { Modal } from "../Modal";
import { ExtractLeafFields } from "./ExtractLeafFields";
import { ExtractQuerySelect } from "./ExtractQuerySelect";

// 記録タブの比較群の入力(docs/data-extract-design.md §21)。比較群ごとに名前と、条件 1 件か「患者」タブに保存した条件。

type StratumKind = Exclude<ExtractKind, "patient">;

const STRATUM_KINDS = EXTRACT_KINDS.filter((kind): kind is StratumKind => kind !== "patient");

/** 期間を省けるもの(省いたらタブの期間で数える)。入院・外来は期間が要る。 */
const OPTIONAL_PERIOD_KINDS = new Set<StratumKind>(["condition", "observation", "medication", "order"]);

const SAVED = "saved";

function newStratum(kind: StratumKind | typeof SAVED): ExtractStratum {
  const leaf = newLeaf(kind === SAVED ? "condition" : kind);
  if (kind === SAVED) return { key: leaf.key, query_code: "" };
  const { not: _not, relation: _relation, output_fields: _fields, ...rest } = leaf;
  return { ...rest, kind, period: OPTIONAL_PERIOD_KINDS.has(kind) ? null : rest.period };
}

interface Props {
  strata: ExtractStratum[];
  queries: ExtractQuery[];
  onChange: (strata: ExtractStratum[]) => void;
  onClose: () => void;
}

export function StrataEditorModal({ strata, queries, onChange, onClose }: Props) {
  const update = (index: number, next: ExtractStratum) =>
    onChange(strata.map((s, i) => (i === index ? next : s)));
  const remove = (index: number) => onChange(strata.filter((_, i) => i !== index));

  return (
    <Modal title="比較群" onClose={onClose} className="modal--wide">
      <div className="extract-group__children">
        {strata.map((stratum, index) => (
          <div key={stratum.key} className="extract-leaf">
            <div className="extract-leaf__head">
              <span className="extract-leaf__kind">
                {stratum.kind ? EXTRACT_KIND_LABELS[stratum.kind] : "保存した条件"}
              </span>
              <label className="extract-field extract-field--inline">
                比較群の名前
                <input
                  type="text"
                  className="extract-field__label"
                  value={stratum.label ?? ""}
                  placeholder={stratumName({ ...stratum, label: "" }, queries)}
                  onChange={(e) => update(index, { ...stratum, label: e.target.value })}
                />
              </label>
              <button
                type="button"
                className="rp-card__icon-button extract-leaf__remove"
                title="比較群を削除"
                aria-label="比較群を削除"
                onClick={() => remove(index)}
              >
                <TrashIcon />
              </button>
            </div>
            {stratum.kind ? (
              <ExtractLeafFields
                leaf={stratum as ExtractLeaf}
                onChange={(leaf) => {
                  const { not: _not, relation: _relation, output_fields: _fields, ...rest } = leaf;
                  update(index, { ...rest, kind: stratum.kind });
                }}
              />
            ) : (
              <label className="extract-field">
                条件
                <ExtractQuerySelect
                  queries={queries}
                  value={queries.find((q) => q.code === stratum.query_code)?.id ?? null}
                  emptyLabel="選択"
                  onChange={(query) => update(index, { ...stratum, query_code: query?.code ?? "" })}
                />
              </label>
            )}
          </div>
        ))}
      </div>
      {strata.length < MAX_STRATA && (
        <div className="data-extract__toolbar">
          <select
            aria-label="比較群を追加"
            value=""
            onChange={(e) => {
              const kind = e.target.value as StratumKind | typeof SAVED | "";
              if (kind) onChange([...strata, newStratum(kind)]);
            }}
          >
            <option value="">＋比較群</option>
            {STRATUM_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {EXTRACT_KIND_LABELS[kind]}
              </option>
            ))}
            <option value={SAVED}>保存した条件</option>
          </select>
        </div>
      )}
    </Modal>
  );
}
