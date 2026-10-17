import type { ExtractQuery, PatientFolder } from "../../api/masterClient";
import { EXTRACT_KIND_LABELS, newLeaf } from "../../fhir/extractQueryHelpers";
import { EXTRACT_KINDS, type ExtractLeaf } from "../../fhir/extractQueryModel";
import {
  INDEX_DATE_MODES,
  MAX_STRATA,
  isFolderStratum,
  type ExtractStratum,
  type IndexDateMode,
  type StratumKind,
} from "../../fhir/extractRecordQuery";
import { stratumName } from "../../hooks/useExtractPatientScope";
import { TrashIcon } from "../icons/TrashIcon";
import { Modal } from "../Modal";
import { ExtractLeafFields } from "./ExtractLeafFields";
import { ExtractQuerySelect } from "./ExtractQuerySelect";
import { PatientFolderSelect } from "./PatientFolderSelect";

// 記録タブの比較群の入力(docs/data-extract-design.md §21)。比較群ごとに名前と、条件 1 件・「患者」タブに保存した条件・
// 患者フォルダのどれか。クラスタタブ(§22)のクラスタと指標(条件 1 件だけ)の入力にも使う。

const STRATUM_KINDS = EXTRACT_KINDS.filter((kind): kind is StratumKind => kind !== "patient");

/** 期間を省けるもの(省いたらタブの期間で数える)。入院・外来は期間が要る。 */
const OPTIONAL_PERIOD_KINDS = new Set<StratumKind>(["condition", "observation", "medication", "order"]);

const SAVED = "saved";
const FOLDER = "folder";

function newStratum(kind: StratumKind | typeof SAVED | typeof FOLDER): ExtractStratum {
  const leaf = newLeaf(kind === SAVED || kind === FOLDER ? "condition" : kind);
  if (kind === SAVED) return { key: leaf.key, query_code: "" };
  if (kind === FOLDER) return { key: leaf.key, patient_folder_id: null };
  const { not: _not, relation: _relation, output_fields: _fields, ...rest } = leaf;
  return { ...rest, kind, period: OPTIONAL_PERIOD_KINDS.has(kind) ? null : rest.period };
}

function kindLabel(stratum: ExtractStratum): string {
  if (stratum.kind) return EXTRACT_KIND_LABELS[stratum.kind];
  return isFolderStratum(stratum) ? "患者フォルダ" : "保存した条件";
}

interface Props {
  strata: ExtractStratum[];
  queries: ExtractQuery[];
  folders: PatientFolder[];
  onChange: (strata: ExtractStratum[]) => void;
  onClose: () => void;
  /** 呼び名(見出し・名前欄・追加・削除の語)。既定は「比較群」。 */
  itemLabel?: string;
  /** 保存した条件・患者フォルダを選べるか(既定はどちらも選べる)。 */
  allow?: { saved?: boolean; folder?: boolean };
  max?: number;
  /** 条件型に基準日(§24)を選ばせるか(既定は選ばせる。クラスタの指標・指標タブの分母・分子は選ばせない)。 */
  indexDate?: boolean;
}

export function StrataEditorModal({
  strata,
  queries,
  folders,
  onChange,
  onClose,
  itemLabel = "比較群",
  allow = { saved: true, folder: true },
  max = MAX_STRATA,
  indexDate = true,
}: Props) {
  const update = (index: number, next: ExtractStratum) =>
    onChange(strata.map((s, i) => (i === index ? next : s)));
  const remove = (index: number) => onChange(strata.filter((_, i) => i !== index));

  return (
    <Modal title={itemLabel} onClose={onClose} className="modal--wide">
      <div className="extract-group__children">
        {strata.map((stratum, index) => (
          <div key={stratum.key} className="extract-leaf">
            <div className="extract-leaf__head">
              <span className="extract-leaf__kind">{kindLabel(stratum)}</span>
              <label className="extract-field extract-field--inline">
                {`${itemLabel}の名前`}
                <input
                  type="text"
                  className="extract-field__label"
                  value={stratum.label ?? ""}
                  placeholder={stratumName({ ...stratum, label: "" }, queries, folders)}
                  onChange={(e) => update(index, { ...stratum, label: e.target.value })}
                />
              </label>
              {indexDate && stratum.kind && (
                <label className="extract-field extract-field--inline">
                  基準日
                  <select
                    value={stratum.index_date ?? ""}
                    onChange={(e) =>
                      update(index, { ...stratum, index_date: (e.target.value || undefined) as IndexDateMode | undefined })
                    }
                  >
                    <option value="">なし</option>
                    {INDEX_DATE_MODES.map((mode) => (
                      <option key={mode.value} value={mode.value}>
                        {mode.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <button
                type="button"
                className="rp-card__icon-button extract-leaf__remove"
                title={`${itemLabel}を削除`}
                aria-label={`${itemLabel}を削除`}
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
            ) : isFolderStratum(stratum) ? (
              <label className="extract-field">
                患者フォルダ
                <PatientFolderSelect
                  folders={folders}
                  value={stratum.patient_folder_id ?? null}
                  emptyLabel="選択"
                  onChange={(folder) => update(index, { ...stratum, patient_folder_id: folder?.id ?? null })}
                />
              </label>
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
      {strata.length < max && (
        <div className="data-extract__toolbar">
          <select
            aria-label={`${itemLabel}を追加`}
            value=""
            onChange={(e) => {
              const kind = e.target.value as StratumKind | typeof SAVED | typeof FOLDER | "";
              if (kind) onChange([...strata, newStratum(kind)]);
            }}
          >
            <option value="">{`＋${itemLabel}`}</option>
            {allow.saved && <option value={SAVED}>保存した条件</option>}
            {allow.folder && <option value={FOLDER}>患者フォルダ</option>}
            {STRATUM_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {EXTRACT_KIND_LABELS[kind]}
              </option>
            ))}
          </select>
        </div>
      )}
    </Modal>
  );
}
