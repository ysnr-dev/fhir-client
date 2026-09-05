import { useBloodType, usePregnancy } from "../api/queries";
import { summarizeBloodType } from "../fhir/bloodTypeHelpers";
import { summarizePregnancy } from "../fhir/pregnancyHelpers";
import { bloodTypeLabel } from "../fhir/transfusionOrderHelpers";
import { ErrorBanner } from "./ErrorBanner";

/**
 * プロファイルタブの「身体」区画。今は血液型と妊娠・授乳で、身長・体重
 * (バイタルの最新値)・腎機能を後から足す。
 *
 * 血液型は輸血オーダーの初期値として使うので、検査で確定した型かどうかを
 * 必ず併記する(申告のままの型で製剤は出せないため)。妊娠・授乳は状態が
 * 変わるので、いつ時点の確認かを必ず併記する。
 */
export function PatientBodySection({
  patientId,
  onEditBloodType,
  onEditPregnancy,
}: {
  patientId: string;
  onEditBloodType: () => void;
  onEditPregnancy: () => void;
}) {
  const { observations, isLoading, error } = useBloodType(patientId);
  const summary = summarizeBloodType(observations);
  const pregnancy = usePregnancy(patientId);
  const pregnancySummary = summarizePregnancy(pregnancy.observations);

  return (
    <section className="karte-profile__section">
      <div className="karte-tabpanel__header">
        <h3>身体</h3>
        <div className="karte-tabpanel__actions">
          <button type="button" onClick={onEditBloodType}>
            {summary ? "血液型を編集" : "血液型を登録"}
          </button>
          <button type="button" onClick={onEditPregnancy}>
            {pregnancySummary ? "妊娠・授乳を編集" : "妊娠・授乳を登録"}
          </button>
        </div>
      </div>

      <ErrorBanner error={error ?? pregnancy.error} />

      {isLoading ? (
        <p>読み込み中...</p>
      ) : (
        <div className="prescription-detail">
          <fieldset>
            <legend>血液型</legend>
            {summary ? (
              <dl className="prescription-detail__common">
                <dt>血液型</dt>
                <dd>
                  <span className="blood-type__value">
                    {bloodTypeLabel(summary.abo, summary.rhd) || "-"}
                  </span>
                  {!summary.tested && (
                    <span className="blood-type__unconfirmed">検査未確定</span>
                  )}
                </dd>
                <dt>情報源</dt>
                <dd>{summary.sourceLabel || "-"}</dd>
                <dt>確認日</dt>
                <dd>{summary.effectiveDate || "-"}</dd>
                <dt>備考</dt>
                <dd>{summary.note || "-"}</dd>
              </dl>
            ) : (
              <p className="patient-table__empty">血液型が登録されていません。</p>
            )}
          </fieldset>

          <fieldset>
            <legend>妊娠・授乳</legend>
            {pregnancySummary ? (
              <dl className="prescription-detail__common">
                <dt>妊娠</dt>
                <dd>
                  <span className={pregnancySummary.pregnant ? "pregnancy__value--pregnant" : ""}>
                    {pregnancySummary.statusLabel || "-"}
                  </span>
                </dd>
                {pregnancySummary.pregnant && (
                  <>
                    <dt>分娩予定日</dt>
                    <dd>{pregnancySummary.dueDate || "-"}</dd>
                  </>
                )}
                <dt>授乳</dt>
                <dd>
                  <span className={pregnancySummary.lactating ? "pregnancy__value--pregnant" : ""}>
                    {pregnancySummary.lactationLabel || "-"}
                  </span>
                </dd>
                <dt>確認日</dt>
                <dd>{pregnancySummary.effectiveDate || "-"}</dd>
                <dt>備考</dt>
                <dd>{pregnancySummary.note || "-"}</dd>
              </dl>
            ) : (
              <p className="patient-table__empty">妊娠・授乳が登録されていません。</p>
            )}
          </fieldset>
        </div>
      )}
    </section>
  );
}
