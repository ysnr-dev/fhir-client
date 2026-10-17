import { useState } from "react";
import { itemOptions, ORAL_EXAM_MATERIALS, type OralExamCodeBook, type ToothRecord } from "../fhir/oralExamHelpers";
import {
  applyBridge,
  BRIDGE_KIND_OPTIONS,
  bridgeNumberOptions,
  isSemiFixed,
  JAW_OPTIONS,
  nextBridgeNumber,
  removeBridge,
  validateBridge,
  type BridgeDraft,
  type BridgeKind,
  type Jaw,
} from "../fhir/oralExamProsthesisHelpers";
import { Modal } from "./Modal";
import { OralExamChart } from "./OralExamChart";

type Role = "abutment" | "pontic";

const ROLE_LABELS: Record<Role, string> = { abutment: "支台", pontic: "ポンティック" };
/** 歯に重ねる印。反映後の歯式図の略号(Br・連結・Pon)とそろえる。 */
const ROLE_MARKS: Record<BridgeKind, Record<Role, string>> = {
  bridge: { abutment: "Br", pontic: "Pon" },
  splint: { abutment: "連結", pontic: "Pon" },
};

interface OralExamBridgeModalProps {
  book: OralExamCodeBook | undefined;
  teeth: ToothRecord[];
  initial: BridgeDraft;
  /** 書いた結果の歯の記録。 */
  onApply: (teeth: ToothRecord[]) => void;
  onClose: () => void;
}

/**
 * ブリッジ・連結冠。顎の歯式図で支台・ポンティックを選び、冠・ポンティックの種類と材料をまとめて決める。
 * フォームの内側に出る(Modal は非ポータル)ので、form も文字入力も置かない。
 */
export function OralExamBridgeModal({ book, teeth, initial, onApply, onClose }: OralExamBridgeModalProps) {
  const [draft, setDraft] = useState(initial);
  const [role, setRole] = useState<Role>("abutment");
  const [errors, setErrors] = useState<string[]>([]);
  const semiFixed = isSemiFixed(draft.number);
  const update = (patch: Partial<BridgeDraft>) => setDraft((d) => ({ ...d, ...patch }));

  function changeJaw(jaw: Jaw) {
    update({ jaw, abutments: [], pontics: [], number: nextBridgeNumber(teeth, jaw, semiFixed) });
  }

  function changeKind(kind: BridgeKind) {
    update({ kind, pontics: kind === "splint" ? [] : draft.pontics });
    if (kind === "splint") setRole("abutment");
  }

  function toggle(toothCode: string) {
    setDraft((d) => {
      const has = role === "abutment" ? d.abutments.includes(toothCode) : d.pontics.includes(toothCode);
      const abutments = d.abutments.filter((c) => c !== toothCode);
      const pontics = d.pontics.filter((c) => c !== toothCode);
      if (!has) (role === "abutment" ? abutments : pontics).push(toothCode);
      return { ...d, abutments, pontics };
    });
  }

  function handleApply() {
    const found = validateBridge(teeth, draft);
    setErrors(found);
    if (!found.length) onApply(applyBridge(teeth, draft, book));
  }

  function handleRemove() {
    if (!draft.original) return;
    onApply(removeBridge(teeth, draft.original.jaw, draft.original.number));
  }

  const roleMarks = Object.fromEntries([
    ...draft.abutments.map((c) => [c, ROLE_MARKS[draft.kind].abutment]),
    ...draft.pontics.map((c) => [c, ROLE_MARKS[draft.kind].pontic]),
  ]);
  const roles: Role[] = draft.kind === "bridge" ? ["abutment", "pontic"] : ["abutment"];

  return (
    <Modal title="ブリッジ・連結冠" onClose={onClose} className="oral-exam oral-exam__device-modal">
      <div className="oral-exam__fields">
        <label className="oral-exam__field">
          種類
          <select value={draft.kind} onChange={(e) => changeKind(e.target.value as BridgeKind)}>
            {BRIDGE_KIND_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="oral-exam__field">
          顎
          <select value={draft.jaw} onChange={(e) => changeJaw(e.target.value as Jaw)}>
            {JAW_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="oral-exam__field">
          固定
          <select
            value={semiFixed ? "semi" : "fixed"}
            onChange={(e) =>
              update({ number: nextBridgeNumber(teeth, draft.jaw, e.target.value === "semi", draft.original?.number) })
            }
          >
            <option value="fixed">固定性</option>
            <option value="semi">半固定性・可撤性</option>
          </select>
        </label>
        <label className="oral-exam__field">
          番号
          <select value={draft.number} onChange={(e) => update({ number: e.target.value })}>
            {bridgeNumberOptions(semiFixed).map((o) => (
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
        selected={[...draft.abutments, ...draft.pontics]}
        onSelect={toggle}
        showDeciduous={false}
        rowKeys={[draft.jaw]}
        roleMarks={roleMarks}
      />

      <div className="oral-exam__fields">
        <label className="oral-exam__field oral-exam__field--wide">
          支台の冠
          <select value={draft.crown} onChange={(e) => update({ crown: e.target.value })}>
            {itemOptions(book, "TP-21", draft.crown).map((o) => (
              <option key={o.code} value={o.code}>
                {o.display}
              </option>
            ))}
          </select>
        </label>
        {draft.kind === "bridge" && (
          <label className="oral-exam__field oral-exam__field--wide">
            ポンティック
            <select value={draft.pontic} onChange={(e) => update({ pontic: e.target.value })}>
              {itemOptions(book, "TM-2", draft.pontic).map((o) => (
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
