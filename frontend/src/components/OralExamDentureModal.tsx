import { useState } from "react";
import {
  DENTURE_NUMBERS,
  itemOptions,
  ORAL_EXAM_MATERIALS,
  type OralExamCodeBook,
  type ToothRecord,
} from "../fhir/oralExamHelpers";
import {
  applyDenture,
  DENTURE_TYPE_OPTIONS,
  dentureBaseFilter,
  JAW_OPTIONS,
  loadDenture,
  removeDenture,
  validateDenture,
  withDentureType,
  type DentureDraft,
  type DentureType,
  type Jaw,
} from "../fhir/oralExamProsthesisHelpers";
import { Modal } from "./Modal";
import { OralExamChart } from "./OralExamChart";

type Role = "replaced" | "clasp" | "rest";

const ROLE_LABELS: Record<Role, string> = { replaced: "人工歯", clasp: "クラスプ", rest: "レスト" };

interface OralExamDentureModalProps {
  book: OralExamCodeBook | undefined;
  teeth: ToothRecord[];
  initial: DentureDraft;
  onApply: (teeth: ToothRecord[]) => void;
  onClose: () => void;
}

/**
 * 有床義歯。顎と床番号を選び、顎の歯式図で人工歯・クラスプ・レストの歯を選んで、床・人工歯・大連結子などを
 * まとめて決める。顎・床番号を変えると、その義歯が既にあれば読み込む。
 */
export function OralExamDentureModal({ book, teeth, initial, onApply, onClose }: OralExamDentureModalProps) {
  const [draft, setDraft] = useState(initial);
  const [role, setRole] = useState<Role>("replaced");
  const [errors, setErrors] = useState<string[]>([]);
  const update = (patch: Partial<DentureDraft>) => setDraft((d) => ({ ...d, ...patch }));

  function changeTarget(jaw: Jaw, number: string) {
    setDraft(loadDenture(teeth, jaw, number));
    setRole("replaced");
  }

  function changeType(type: DentureType) {
    setDraft((d) => withDentureType(d, type));
    setRole("replaced");
  }

  // 人工歯と鉤(クラスプ・レスト)は同じ歯に付かない。クラスプとレストは同じ歯に付けられる。
  function toggle(toothCode: string) {
    setDraft((d) => {
      const without = (list: string[]) => list.filter((c) => c !== toothCode);
      const list = role === "replaced" ? d.replaced : role === "clasp" ? d.clasps : d.rests;
      const adding = !list.includes(toothCode);
      if (role === "replaced") {
        return {
          ...d,
          replaced: adding ? [...d.replaced, toothCode] : without(d.replaced),
          clasps: adding ? without(d.clasps) : d.clasps,
          rests: adding ? without(d.rests) : d.rests,
        };
      }
      const next = adding ? [...list, toothCode] : without(list);
      return {
        ...d,
        replaced: adding ? without(d.replaced) : d.replaced,
        clasps: role === "clasp" ? next : d.clasps,
        rests: role === "rest" ? next : d.rests,
      };
    });
  }

  function handleApply() {
    const found = validateDenture(teeth, draft);
    setErrors(found);
    if (!found.length) onApply(applyDenture(teeth, draft, book));
  }

  function handleRemove() {
    if (!draft.original) return;
    onApply(removeDenture(teeth, draft.original.jaw, draft.original.number));
  }

  // 歯に重ねる印。反映後の歯式図の略号(PD・FD・Cl・R)とそろえる。
  const roleMarks: Record<string, string> = {};
  for (const c of draft.replaced) roleMarks[c] = draft.type;
  for (const c of draft.clasps) roleMarks[c] = "Cl";
  for (const c of draft.rests) roleMarks[c] = roleMarks[c] ? `${roleMarks[c]}·R` : "R";
  const roles: Role[] = draft.type === "FD" ? ["replaced"] : ["replaced", "clasp", "rest"];
  const baseFilter = dentureBaseFilter(draft.type);

  return (
    <Modal title="有床義歯" onClose={onClose} className="oral-exam oral-exam__device-modal">
      <div className="oral-exam__fields">
        <label className="oral-exam__field">
          顎
          <select value={draft.jaw} onChange={(e) => changeTarget(e.target.value as Jaw, draft.number)}>
            {JAW_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="oral-exam__field">
          床番号
          <select value={draft.number} onChange={(e) => changeTarget(draft.jaw, e.target.value)}>
            {DENTURE_NUMBERS.map((n) => (
              <option key={n.code} value={n.code}>
                {n.label}
              </option>
            ))}
          </select>
        </label>
        <label className="oral-exam__field">
          種類
          <select value={draft.type} onChange={(e) => changeType(e.target.value as DentureType)}>
            {DENTURE_TYPE_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="oral-exam__roles" role="toolbar" aria-label="役割">
        {roles.map((r) => (
          <button
            key={r}
            type="button"
            className={role === r ? "oral-exam__stamp is-active" : "oral-exam__stamp"}
            aria-pressed={role === r}
            onClick={() => setRole(r)}
          >
            {ROLE_LABELS[r]}
          </button>
        ))}
      </div>

      <OralExamChart
        teeth={teeth}
        selected={[...draft.replaced, ...draft.clasps, ...draft.rests]}
        onSelect={toggle}
        showDeciduous={false}
        rowKeys={[draft.jaw]}
        roleMarks={roleMarks}
      />

      <div className="oral-exam__fields">
        <label className="oral-exam__field oral-exam__field--wide">
          床
          <select value={draft.base} onChange={(e) => update({ base: e.target.value })}>
            {itemOptions(book, "TM-4", draft.base)
              .filter((o) => baseFilter(o.code))
              .map((o) => (
                <option key={o.code} value={o.code}>
                  {o.display}
                </option>
              ))}
          </select>
        </label>
        <label className="oral-exam__field">
          人工歯
          <select value={draft.artificial} onChange={(e) => update({ artificial: e.target.value })}>
            <option value="" />
            {itemOptions(book, "TM-6", draft.artificial).map((o) => (
              <option key={o.code} value={o.code}>
                {o.display}
              </option>
            ))}
          </select>
        </label>
        <label className="oral-exam__field">
          大連結子
          <select value={draft.connector} onChange={(e) => update({ connector: e.target.value })}>
            <option value="" />
            {itemOptions(book, "TM-8", draft.connector).map((o) => (
              <option key={o.code} value={o.code}>
                {o.display}
              </option>
            ))}
          </select>
        </label>
        <label className="oral-exam__check">
          <input
            type="checkbox"
            checked={draft.reinforcement}
            onChange={(e) => update({ reinforcement: e.target.checked })}
          />
          補強線
        </label>
        {draft.type === "PD" && (
          <label className="oral-exam__field oral-exam__field--wide">
            クラスプ
            <select value={draft.clasp} onChange={(e) => update({ clasp: e.target.value })}>
              {itemOptions(book, "TP-26", draft.clasp).map((o) => (
                <option key={o.code} value={o.code}>
                  {o.display}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="oral-exam__field">
          材料
          <select value={draft.material} onChange={(e) => update({ material: e.target.value })}>
            <option value="" />
            {ORAL_EXAM_MATERIALS.map((m) => (
              <option key={m.name} value={m.name}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {errors.length > 0 && (
        <div className="error-banner" role="alert">
          {errors.map((e) => (
            <p key={e} className="error-banner__line error-banner__line--error">
              {e}
            </p>
          ))}
        </div>
      )}

      <div className="oral-exam__modal-actions">
        <button type="button" onClick={handleApply}>
          反映
        </button>
        {draft.original && (
          <button type="button" onClick={handleRemove}>
            削除
          </button>
        )}
        <button type="button" onClick={onClose}>
          取消
        </button>
      </div>
    </Modal>
  );
}
