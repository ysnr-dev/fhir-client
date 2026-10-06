import type { LeafProgress } from "../../api/queries";
import { extractKindDef } from "../../fhir/extractKinds";
import {
  EXTRACT_KIND_LABELS,
  EXTRACT_KINDS,
  EXTRACT_MAX_DEPTH,
  LEAF_OUTPUT_FIELDS,
  leafOutputFieldsOf,
  canNegate,
  isGroup,
  leafLabel,
  relationAnchors,
  newGroup,
  newLeaf,
  type ExtractGroup,
  type ExtractKind,
  type ExtractLeaf,
  type ExtractNode,
  type LeafOutputField,
} from "../../fhir/extractQueryHelpers";
import { TrashIcon } from "../icons/TrashIcon";
import { ExtractLeafFields } from "./ExtractLeafFields";

interface Props {
  root: ExtractGroup;
  onChange: (root: ExtractGroup) => void;
  progress: Record<string, LeafProgress>;
}

/** 条件の組み立て。グループ(AND / OR)の中に条件とグループを入れ子で並べる。 */
export function ExtractConditionBuilder({ root, onChange, progress }: Props) {
  return <GroupEditor group={root} depth={1} onChange={onChange} progress={progress} />;
}

function GroupEditor({
  group,
  depth,
  onChange,
  onRemove,
  progress,
}: {
  group: ExtractGroup;
  depth: number;
  onChange: (group: ExtractGroup) => void;
  onRemove?: () => void;
  progress: Record<string, LeafProgress>;
}) {
  const replaceChild = (index: number, child: ExtractNode | null) => {
    const children = [...group.children];
    if (child) children[index] = child;
    else children.splice(index, 1);
    // 除外は AND の直下でしか成り立たないので、OR にしたり兄弟を消したりで外れた除外は戻す。
    onChange(normalizeNegation({ ...group, children }));
  };
  const setOp = (op: "and" | "or") => onChange(normalizeNegation({ ...group, op }));

  return (
    <div className={`extract-group extract-group--depth-${depth}`}>
      <div className="extract-group__head">
        <span className="extract-group__ops" role="group" aria-label="条件のつなぎ方">
          {(["and", "or"] as const).map((op) => (
            <button
              key={op}
              type="button"
              aria-pressed={group.op === op}
              className={`extract-group__op${group.op === op ? " is-active" : ""}`}
              onClick={() => setOp(op)}
            >
              {op === "and" ? "AND" : "OR"}
            </button>
          ))}
        </span>
        <select
          aria-label="条件を追加"
          className="extract-group__add"
          value=""
          onChange={(e) => {
            const kind = e.target.value as ExtractKind;
            if (kind) onChange({ ...group, children: [...group.children, newLeaf(kind)] });
          }}
        >
          <option value="">＋条件</option>
          {EXTRACT_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {EXTRACT_KIND_LABELS[kind]}
            </option>
          ))}
        </select>
        {depth < EXTRACT_MAX_DEPTH - 1 && (
          <button
            type="button"
            className="rp-card__compact-button"
            onClick={() => onChange({ ...group, children: [...group.children, newGroup(group.op === "and" ? "or" : "and")] })}
          >
            ＋グループ
          </button>
        )}
        {onRemove && (
          <button
            type="button"
            className="rp-card__icon-button extract-group__remove"
            title="グループを削除"
            aria-label="グループを削除"
            onClick={onRemove}
          >
            <TrashIcon />
          </button>
        )}
      </div>
      <div className="extract-group__children">
        {group.children.map((child, index) =>
          isGroup(child) ? (
            <GroupEditor
              key={index}
              group={child}
              depth={depth + 1}
              onChange={(next) => replaceChild(index, next)}
              onRemove={() => replaceChild(index, null)}
              progress={progress}
            />
          ) : (
            <LeafEditor
              key={child.key}
              leaf={child}
              negatable={canNegate(group, child)}
              anchors={relationAnchors(group, child)}
              onChange={(next) => replaceChild(index, next)}
              onRemove={() => replaceChild(index, null)}
              progress={progress[child.key]}
            />
          ),
        )}
      </div>
    </div>
  );
}

/**
 * 置けなくなった除外と時間関係を外す(OR に切り替えた、兄弟や基準の条件を消した、基準を除外にした
 * など)。時間関係を外すと基準になれる条件が変わるので、時間関係は外し終えた状態で確かめる。
 */
function normalizeNegation(group: ExtractGroup): ExtractGroup {
  let children = group.children.map((child) =>
    !isGroup(child) && child.not && !canNegate(group, child) ? { ...child, not: false } : child,
  );
  const draft = { ...group, children };
  children = children.map((child) => {
    if (isGroup(child) || !child.relation) return child;
    const valid = relationAnchors(draft, child).some((a) => a.key === child.relation!.key);
    return valid ? child : { ...child, relation: undefined };
  });
  return { ...group, children };
}

function LeafEditor({
  leaf,
  negatable,
  anchors,
  onChange,
  onRemove,
  progress,
}: {
  leaf: ExtractLeaf;
  negatable: boolean;
  anchors: ExtractLeaf[];
  onChange: (leaf: ExtractLeaf) => void;
  onRemove: () => void;
  progress: LeafProgress | undefined;
}) {
  return (
    <div className={`extract-leaf${leaf.not ? " extract-leaf--not" : ""}`}>
      <div className="extract-leaf__head">
        <span className="extract-leaf__kind">{EXTRACT_KIND_LABELS[leaf.kind]}</span>
        <label className="extract-field extract-field--inline">
          表示名
          <input
            type="text"
            className="extract-field__label"
            value={leaf.label ?? ""}
            onChange={(e) => onChange({ ...leaf, label: e.target.value })}
          />
        </label>
        <label className="extract-checks__item">
          <input
            type="checkbox"
            checked={Boolean(leaf.not)}
            disabled={!negatable && !leaf.not}
            onChange={(e) => onChange({ ...leaf, not: e.target.checked })}
          />
          除外
        </label>
        <LeafStatus progress={progress} />
        <button
          type="button"
          className="rp-card__icon-button extract-leaf__remove"
          title="条件を削除"
          aria-label="条件を削除"
          onClick={onRemove}
        >
          <TrashIcon />
        </button>
      </div>
      <ExtractLeafFields leaf={leaf} onChange={onChange} />
      {leaf.kind !== "patient" && (anchors.length > 0 || leaf.relation) && (
        <RelationFields leaf={leaf} anchors={anchors} onChange={onChange} />
      )}
      {leaf.kind !== "patient" && !leaf.not && <OutputFields leaf={leaf} onChange={onChange} />}
    </div>
  );
}

/** 一覧・CSV にこの条件のどの項目を出すか。全部選んだら既定(未指定)に戻し、最後の 1 つは外せない。 */
function OutputFields({ leaf, onChange }: { leaf: ExtractLeaf; onChange: (leaf: ExtractLeaf) => void }) {
  const fields = leafOutputFieldsOf(leaf);
  const toggle = (field: LeafOutputField, checked: boolean) => {
    const next = LEAF_OUTPUT_FIELDS.map((f) => f.value).filter((value) =>
      value === field ? checked : fields.includes(value),
    );
    if (next.length === 0) return;
    onChange({ ...leaf, output_fields: next.length === LEAF_OUTPUT_FIELDS.length ? undefined : next });
  };
  return (
    <div className="extract-leaf__row">
      <span className="extract-checks" role="group" aria-label="出力する項目">
        <span className="extract-checks__label">出力</span>
        {LEAF_OUTPUT_FIELDS.map((field) => (
          <label key={field.value} className="extract-checks__item">
            <input
              type="checkbox"
              checked={fields.includes(field.value)}
              disabled={fields.length === 1 && fields.includes(field.value)}
              onChange={(e) => toggle(field.value, e.target.checked)}
            />
            {field.label}
          </label>
        ))}
      </span>
    </div>
  );
}

function numberOr(value: string, fallback: number): number {
  const number = Number(value);
  return value.trim() !== "" && Number.isFinite(number) ? Math.trunc(number) : fallback;
}

/** 時間関係(同じグループの別の条件の記録の日から何日〜何日)。 */
function RelationFields({
  leaf,
  anchors,
  onChange,
}: {
  leaf: ExtractLeaf;
  anchors: ExtractLeaf[];
  onChange: (leaf: ExtractLeaf) => void;
}) {
  const relation = leaf.relation;
  const anchor = anchors.find((a) => a.key === relation?.key);
  const hasEnd = anchor ? Boolean(extractKindDef(anchor.kind).hasEndDay?.(anchor)) : false;
  return (
    <div className="extract-leaf__row">
      <label className="extract-field">
        基準の条件
        <select
          value={relation?.key ?? ""}
          onChange={(e) =>
            onChange({
              ...leaf,
              relation: e.target.value
                ? { key: e.target.value, from_days: relation?.from_days ?? 0, to_days: relation?.to_days ?? 90 }
                : undefined,
            })
          }
        >
          <option value="">なし</option>
          {anchors.map((a) => (
            <option key={a.key} value={a.key}>
              {leafLabel(a)}
            </option>
          ))}
        </select>
      </label>
      {relation && (
        <>
          {hasEnd && (
            <label className="extract-field">
              基準の日
              <select
                value={relation.anchor_date ?? "start"}
                onChange={(e) =>
                  onChange({
                    ...leaf,
                    relation: { ...relation, anchor_date: e.target.value === "end" ? "end" : undefined },
                  })
                }
              >
                <option value="start">開始日</option>
                <option value="end">終了日</option>
              </select>
            </label>
          )}
          <label className="extract-field">
            から(日)
            <input
              type="number"
              step={1}
              className="extract-field__number"
              value={relation.from_days}
              onChange={(e) =>
                onChange({ ...leaf, relation: { ...relation, from_days: numberOr(e.target.value, relation.from_days) } })
              }
            />
          </label>
          <label className="extract-field">
            まで(日)
            <input
              type="number"
              step={1}
              className="extract-field__number"
              value={relation.to_days}
              onChange={(e) =>
                onChange({ ...leaf, relation: { ...relation, to_days: numberOr(e.target.value, relation.to_days) } })
              }
            />
          </label>
        </>
      )}
    </div>
  );
}

function LeafStatus({ progress }: { progress: LeafProgress | undefined }) {
  if (!progress || progress.state === "pending") return null;
  if (progress.state === "running") return <span className="extract-leaf__status">読込中</span>;
  if (progress.state === "error") return <span className="extract-leaf__status extract-leaf__status--error">エラー</span>;
  return <span className="extract-leaf__status">{`${progress.patients} 人`}</span>;
}
