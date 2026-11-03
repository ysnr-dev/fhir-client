import { useMemo, useState } from "react";
import { useCurrentPractitioner } from "../api/authQueries";
import type { AdvisoryRule } from "../api/masterClient";
import { useAdvisoryRules } from "../api/masterQueries";
import { useCreateFlag, useEndFlag } from "../api/queries";
import { evaluateAdvisoryRule, sortAdvisoryRules } from "../fhir/advisoryRuleHelpers";
import {
  MAINTENANCE_STATE_LABELS,
  type MaintenanceStatus,
  buildMaintenanceFlag,
  maintenanceStatusOf,
} from "../fhir/healthMaintenanceHelpers";
import { useAdvisoryRuleEvaluation } from "../hooks/useAdvisoryRuleAdvisories";
import { addDays, today } from "../lib/dates";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

// プロファイルの「定期検査」区画(docs/advisory-design.md §2.10)。定期項目を持つ施設の規則のうち、
// 条件式がこの患者で真になるものを並べ、最終実施日・期限・状態を出す。延期・対象外は Flag に残し、解除で終了にする。

interface Row {
  rule: AdvisoryRule;
  status: MaintenanceStatus;
  flagId: string | undefined;
}

type Action = { rule: AdvisoryRule; mode: "defer" | "exempt" };

export function HealthMaintenanceSection({ patientId }: { patientId: string }) {
  const allRules = useAdvisoryRules();
  const rules = useMemo(
    () => sortAdvisoryRules(allRules.filter((rule) => rule.enabled && rule.maintenance)),
    [allRules],
  );
  const { env, records, error } = useAdvisoryRuleEvaluation(patientId, rules);
  const [action, setAction] = useState<Action | null>(null);
  const endFlag = useEndFlag();

  const rows: Row[] = env
    ? rules.flatMap((rule) => {
        if (!evaluateAdvisoryRule(rule.expression, env.patient, env.env).matched) return [];
        const record = records.get(rule.code);
        if (!record || !rule.maintenance) return [];
        return [{ rule, status: maintenanceStatusOf(rule.maintenance, record), flagId: record.flag?.id }];
      })
    : [];

  return (
    <section className="karte-profile__section">
      <div className="karte-tabpanel__header">
        <h3>定期検査・検診</h3>
      </div>

      <ErrorBanner error={error ?? endFlag.error} />

      {rules.length > 0 && !env ? (
        <p>読み込み中...</p>
      ) : rows.length === 0 ? (
        <p className="patient-table__empty">対象になる定期項目がありません。</p>
      ) : (
        <ul className="profile-list">
          {rows.map(({ rule, status, flagId }) => {
            const item = rule.maintenance!;
            const meta = [
              `${item.name ?? item.code} / ${item.interval_days} 日ごと`,
              `最終 ${status.lastDate ?? "なし"}`,
              status.dueDate ? `期限 ${status.dueDate}` : "",
            ]
              .filter(Boolean)
              .join(" ・ ");
            const note =
              status.state === "deferred"
                ? `〜${status.deferredUntil}${status.reason ? ` ${status.reason}` : ""}`
                : status.state === "exempt"
                  ? status.reason
                  : "";
            const paused = status.state === "deferred" || status.state === "exempt";
            return (
              <li key={rule.code} className="profile-list__item">
                <span className="profile-list__name">{rule.name}</span>
                <span className={`maintenance-state maintenance-state--${status.state}`}>
                  {MAINTENANCE_STATE_LABELS[status.state]}
                </span>
                <span className="profile-list__actions">
                  {paused && flagId ? (
                    <button
                      type="button"
                      className="rp-card__compact-button"
                      disabled={endFlag.isPending}
                      onClick={() => endFlag.mutate(flagId)}
                    >
                      解除
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="rp-card__compact-button"
                        onClick={() => setAction({ rule, mode: "defer" })}
                      >
                        延期
                      </button>
                      <button
                        type="button"
                        className="rp-card__compact-button"
                        onClick={() => setAction({ rule, mode: "exempt" })}
                      >
                        対象外
                      </button>
                    </>
                  )}
                </span>
                <span className="profile-list__meta">{meta}</span>
                {note && <span className="profile-list__note">{note}</span>}
              </li>
            );
          })}
        </ul>
      )}

      {action && <MaintenanceFlagModal action={action} patientId={patientId} onClose={() => setAction(null)} />}
    </section>
  );
}

/** 延期(期限日つき)・対象外(期限なし)の登録。理由は任意。 */
function MaintenanceFlagModal({ action, patientId, onClose }: { action: Action; patientId: string; onClose: () => void }) {
  const { practitionerId } = useCurrentPractitioner();
  const createFlag = useCreateFlag();
  const [until, setUntil] = useState(() =>
    action.mode === "defer" ? addDays(today(), action.rule.maintenance?.interval_days ?? 30) : "",
  );
  const [reason, setReason] = useState("");
  const minDate = addDays(today(), 1);
  const canSave = action.mode === "exempt" || until >= minDate;

  async function handleSave() {
    if (!canSave) return;
    await createFlag.mutateAsync(
      buildMaintenanceFlag(action.rule, patientId, practitionerId ?? null, {
        until: action.mode === "defer" ? until : null,
        reason,
      }),
    );
    onClose();
  }

  return (
    <Modal title={`${action.rule.name} を${action.mode === "defer" ? "延期" : "対象外に"}`} onClose={onClose}>
      <div className="maintenance-flag__fields">
        {action.mode === "defer" && (
          <label>
            期限
            <input type="date" value={until} min={minDate} onChange={(e) => setUntil(e.target.value)} />
          </label>
        )}
        <label>
          理由
          <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
      </div>
      <ErrorBanner error={createFlag.error} />
      <div className="lab-order-item__actions">
        <button type="button" disabled={!canSave || createFlag.isPending} onClick={handleSave}>
          登録
        </button>
        <button type="button" onClick={onClose}>
          取消
        </button>
      </div>
    </Modal>
  );
}
