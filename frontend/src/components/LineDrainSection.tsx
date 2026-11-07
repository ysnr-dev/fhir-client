import { useState } from "react";
import { usePatientLineDrains, useUpdateLineDrainProcedure } from "../api/queries";
import { useLineDrainTypes } from "../api/masterQueries";
import {
  daysInsertedLabel,
  isOverWarnDays,
  lineDrainLabel,
  markLineDrainEnteredInError,
  removalReasonLabel,
  reopenLineDrain,
  siteObservationSummary,
  sortLineDrains,
  type LineDrainRecord,
} from "../fhir/lineDrainHelpers";
import { dateTimeLabel, today } from "../lib/dates";
import { ErrorBanner } from "./ErrorBanner";
import { LineDrainRemovalModal } from "./LineDrainRemovalModal";
import { LineDrainSiteModal } from "./LineDrainSiteModal";
import { RowMenu } from "./RowMenu";

/**
 * プロファイルタブの「ライン・ドレーン」区画(docs/line-drain-design.md §4.3)。既定は留置中だけ。
 * 行から刺入部観察と抜去をモーダルで書き、ケバブに編集(右ペイン)・抜去取消・誤登録を畳む。
 */
export function LineDrainSection({
  patientId,
  onEdit,
}: {
  patientId: string;
  /** 右ペインの編集を開く。開けない場所(患者ドロワー)では渡さない。 */
  onEdit?: (procedureId: string) => void;
}) {
  const [currentOnly, setCurrentOnly] = useState(true);
  const [dialog, setDialog] = useState<{ kind: "remove" | "site"; record: LineDrainRecord } | null>(null);
  const { data, isLoading, error } = usePatientLineDrains(patientId);
  const types = useLineDrainTypes();
  const update = useUpdateLineDrainProcedure();
  const todayValue = today();

  const rows = sortLineDrains((data ?? []).filter((r) => !currentOnly || r.status === "in-progress"));

  function handleReopen(record: LineDrainRecord) {
    update.mutate(reopenLineDrain(record.procedure));
  }

  function handleEnteredInError(record: LineDrainRecord) {
    if (!window.confirm(`${lineDrainLabel(record)} を誤登録にしますか？`)) return;
    update.mutate(markLineDrainEnteredInError(record.procedure));
  }

  return (
    <section className="karte-profile__section">
      <div className="karte-tabpanel__header">
        <h3>ライン・ドレーン</h3>
        <div className="karte-tabpanel__actions">
          <label className="profile-tab__toggle">
            <input type="checkbox" checked={!currentOnly} onChange={(e) => setCurrentOnly(!e.target.checked)} />
            抜去したものも表示
          </label>
        </div>
      </div>

      <ErrorBanner error={error} />
      <ErrorBanner error={update.error} />

      {isLoading ? (
        <p>読み込み中...</p>
      ) : rows.length === 0 ? (
        <p className="patient-table__empty">
          {currentOnly ? "留置中のライン・ドレーンはありません。" : "ライン・ドレーンの記録がありません。"}
        </p>
      ) : (
        <ul className="regimen-adverse__list">
          {rows.map((row) => {
            const latest = row.observations[0];
            const over = isOverWarnDays(row, types, todayValue);
            return (
              <li key={row.id} className="regimen-adverse__item">
                <span className="regimen-adverse__term">{lineDrainLabel(row)}</span>
                {row.deviceLabel && <span className="regimen-adverse__meta">{row.deviceLabel}</span>}
                <span className="regimen-adverse__period">
                  {dateTimeLabel(row.insertedAt)}
                  {row.removedAt ? ` 〜 ${dateTimeLabel(row.removedAt)}` : " 〜"}
                </span>
                <span className={over ? "line-drain__days line-drain__days--over" : "line-drain__days"}>
                  {daysInsertedLabel(row, todayValue)}
                </span>
                {row.removalReason && <span className="regimen-adverse__meta">{removalReasonLabel(row.removalReason)}</span>}
                <span className="regimen-adverse__actions">
                  {row.status === "in-progress" && (
                    <>
                      <button
                        type="button"
                        className="rp-card__compact-button"
                        onClick={() => setDialog({ kind: "site", record: row })}
                      >
                        観察
                      </button>
                      <button
                        type="button"
                        className="rp-card__compact-button"
                        onClick={() => setDialog({ kind: "remove", record: row })}
                      >
                        抜去
                      </button>
                    </>
                  )}
                  <RowMenu label="操作">
                    <button type="button" className="row-menu__item" onClick={() => setDialog({ kind: "site", record: row })}>
                      観察履歴
                    </button>
                    {onEdit && (
                      <button type="button" className="row-menu__item" onClick={() => onEdit(row.id)}>
                        編集
                      </button>
                    )}
                    {row.status === "completed" && (
                      <button type="button" className="row-menu__item" onClick={() => handleReopen(row)} disabled={update.isPending}>
                        抜去取消
                      </button>
                    )}
                    <button
                      type="button"
                      className="row-menu__item row-menu__item--danger"
                      onClick={() => handleEnteredInError(row)}
                      disabled={update.isPending}
                    >
                      誤登録
                    </button>
                  </RowMenu>
                </span>
                {(row.performer?.display || row.purpose) && (
                  <span className="regimen-adverse__meta">
                    {[row.performer?.display, row.purpose].filter(Boolean).join(" ・ ")}
                  </span>
                )}
                {latest && (
                  <span className="regimen-adverse__note">
                    {`観察 ${dateTimeLabel(latest.effectiveAt)}: ${siteObservationSummary(latest)}`}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {dialog?.kind === "remove" && <LineDrainRemovalModal record={dialog.record} onClose={() => setDialog(null)} />}
      {dialog?.kind === "site" && (
        <LineDrainSiteModal
          patientId={patientId}
          // 保存のたびに読み直された最新の観察を履歴に出す。
          record={(data ?? []).find((r) => r.id === dialog.record.id) ?? dialog.record}
          onClose={() => setDialog(null)}
        />
      )}
    </section>
  );
}
