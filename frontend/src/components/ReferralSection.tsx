import { useState } from "react";
import { usePatientReferrals } from "../api/queries";
import {
  REFERRAL_DIRECTION_OPTIONS,
  REFERRAL_STATUS_LABEL,
  replyKindDisplay,
  type ReferralDirection,
  type ReferralRow,
} from "../fhir/referralHelpers";
import { displayOf } from "../fhir/shared";
import { ErrorBanner } from "./ErrorBanner";
import { ReferralFormModal } from "./ReferralModals";
import { TruncatedNotice } from "./TruncatedNotice";

/** プロファイルタブの「紹介」区画。患者の紹介受・紹介を新しい順に並べ、行から内容を編集する(docs/referral-design.md)。 */
export function ReferralSection({ patientId }: { patientId: string }) {
  const { data, isLoading, error } = usePatientReferrals(patientId);
  const [creating, setCreating] = useState<ReferralDirection | null>(null);
  const [editing, setEditing] = useState<ReferralRow | null>(null);
  const rows = data?.rows ?? [];

  return (
    <section className="karte-profile__section">
      <div className="karte-tabpanel__header">
        <h3>紹介</h3>
        <div className="karte-tabpanel__actions">
          {REFERRAL_DIRECTION_OPTIONS.map((option) => (
            <button key={option.code} type="button" onClick={() => setCreating(option.code)}>
              {option.display}登録
            </button>
          ))}
        </div>
      </div>

      <ErrorBanner error={error} />
      <TruncatedNotice show={data?.truncated} />

      {isLoading ? (
        <p>読み込み中...</p>
      ) : error ? null : rows.length === 0 ? (
        <p className="patient-table__empty">紹介がありません。</p>
      ) : (
        <ul className="profile-list">
          {rows.map((row) => {
            const lastReply = row.replies[row.replies.length - 1];
            return (
              <li key={row.id}>
                <button type="button" className="profile-list__item encounter-history__row" onClick={() => setEditing(row)}>
                  <span className="profile-list__name">
                    {displayOf(REFERRAL_DIRECTION_OPTIONS, row.direction)}({row.kindLabel})
                  </span>
                  <span>{row.referralDate}</span>
                  <span className="encounter-history__status">{REFERRAL_STATUS_LABEL[row.status]}</span>
                  <span className="profile-list__meta">
                    {[row.partnerOrganizationName, row.partnerPractitionerName, row.departmentName, row.practitionerName]
                      .filter(Boolean)
                      .join(" / ")}
                  </span>
                  {(row.purpose || lastReply) && (
                    <span className="profile-list__note">
                      {[
                        row.purpose,
                        lastReply && `${lastReply.date} ${replyKindDisplay(row.direction, lastReply.kind)}`,
                      ]
                        .filter(Boolean)
                        .join(" / ")}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {creating && <ReferralFormModal direction={creating} patientId={patientId} onClose={() => setCreating(null)} />}
      {editing && (
        <ReferralFormModal
          direction={editing.direction}
          patientId={patientId}
          row={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}
