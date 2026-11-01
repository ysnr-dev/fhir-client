import {
  useBloodType,
  useBodyMeasures,
  usePatient,
  usePregnancy,
  useRecentLabResults,
  useTransfusionProfile,
} from "../api/queries";
import { transfusionCardPdfUrl } from "../api/reportsClient";
import { bloodTypeUnconfirmedLabel, labComponentLabel } from "../fhir/bloodTypeHelpers";
import {
  measurementLabel,
  summarizeBodyMeasures,
  summarizeRenal,
} from "../fhir/bodyMeasureHelpers";
import { calculateAge } from "../fhir/patientHelpers";
import { summarizePregnancy } from "../fhir/pregnancyHelpers";
import { bloodTypeLabel, rhdDisplay } from "../fhir/transfusionOrderHelpers";
import { ErrorBanner } from "./ErrorBanner";

/**
 * プロファイルタブの「身体」区画。血液型・妊娠/授乳はここで編集し、
 * 身長・体重(バイタル)と腎機能(検体検査)は**読み取り専用**で最新値を出す
 * (本体はそれぞれの画面で、同じ情報を 2 経路に持たない)。
 *
 * 血液型は輸血オーダーの初期値として使うので、検査で確定した型かどうかを
 * 必ず併記する(申告のままの型で製剤は出せないため)。妊娠・授乳は状態が
 * 変わるので、いつ時点の確認かを必ず併記する。
 */
export function PatientBodySection({
  patientId,
  onEditBloodType,
  onEditPregnancy,
  onEditAntibody,
  onEditTransplant,
}: {
  patientId: string;
  onEditBloodType: () => void;
  onEditPregnancy: () => void;
  onEditAntibody: () => void;
  onEditTransplant: () => void;
}) {
  const { summary, isLoading, error } = useBloodType(patientId);
  // 輸血に関わる手入力の属性(不規則抗体の特異性・移植後の血液型)。
  const profile = useTransfusionProfile(patientId);
  const unconfirmed = bloodTypeUnconfirmedLabel(summary);
  const pregnancy = usePregnancy(patientId);
  const pregnancySummary = summarizePregnancy(pregnancy.observations);

  const bodyMeasures = useBodyMeasures(patientId);
  const body = summarizeBodyMeasures(bodyMeasures.observations);

  // eGFR の算出に年齢と性別が要るので患者本体も読む。
  const patient = usePatient(patientId).data?.data;
  const renalResults = useRecentLabResults(patientId);
  const renal = summarizeRenal(renalResults.observations, {
    age: patient?.birthDate ? calculateAge(patient.birthDate) : undefined,
    gender: patient?.gender,
    weight: body.weight?.value ?? null,
  });

  return (
    <section className="karte-profile__section">
      <div className="karte-tabpanel__header">
        <h3>身体</h3>
        <div className="karte-tabpanel__actions">
          <button type="button" onClick={onEditBloodType}>
            {summary?.manual ? "申告編集" : "申告登録"}
          </button>
          <button type="button" onClick={onEditAntibody}>
            {profile.antibody ? "抗体編集" : "抗体登録"}
          </button>
          <button type="button" onClick={onEditTransplant}>
            {profile.transplant ? "移植編集" : "移植登録"}
          </button>
          {/* 輸血関連情報カード(血液型・不規則抗体・移植後の型・輸血歴・副作用歴)。 */}
          <a className="button" href={transfusionCardPdfUrl(patientId)} target="_blank" rel="noopener">
            輸血カード
          </a>
          <button type="button" onClick={onEditPregnancy}>
            {pregnancySummary ? "妊娠・授乳編集" : "妊娠・授乳登録"}
          </button>
        </div>
      </div>

      <ErrorBanner error={error ?? pregnancy.error ?? bodyMeasures.error ?? renalResults.error ?? profile.error} />

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
                  {unconfirmed && (
                    <span
                      className={`blood-type__unconfirmed${
                        summary.labStatus === "conflict" ? " blood-type__unconfirmed--conflict" : ""
                      }`}
                    >
                      {unconfirmed}
                    </span>
                  )}
                </dd>
                <dt>ABO 検査</dt>
                <dd>{labComponentLabel(summary.lab.abo, (value) => `${value}型`) || "-"}</dd>
                <dt>RhD 検査</dt>
                <dd>{labComponentLabel(summary.lab.rhd, (value) => `RhD${rhdDisplay(value)}`) || "-"}</dd>
                <dt>不規則抗体</dt>
                <dd>
                  {summary.antibodyScreen
                    ? `${summary.antibodyScreen.value} ${summary.antibodyScreen.date}`
                    : "-"}
                </dd>
                <dt>抗体の特異性</dt>
                <dd>
                  {profile.antibody
                    ? [profile.antibody.label, profile.antibody.effectiveDate].filter(Boolean).join(" ")
                    : "-"}
                </dd>
                <dt>移植後の型</dt>
                <dd>
                  {profile.transplant
                    ? `赤血球 ${bloodTypeLabel(profile.transplant.rbcAbo, profile.transplant.rbcRhd) || "-"} / 血漿・血小板 ${
                        bloodTypeLabel(profile.transplant.plasmaAbo, profile.transplant.plasmaRhd) || "-"
                      }（移植 ${profile.transplant.transplantDate || "日付不明"}）`
                    : "-"}
                </dd>
                <dt>申告</dt>
                <dd>
                  {summary.manual
                    ? [
                        bloodTypeLabel(summary.manual.abo, summary.manual.rhd),
                        summary.manual.sourceLabel,
                        summary.manual.effectiveDate,
                      ]
                        .filter(Boolean)
                        .join(" ")
                    : "-"}
                </dd>
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

          {/* ここから下は読み取り専用。編集はバイタル・検体検査で行う。 */}
          <fieldset>
            <legend>身長・体重</legend>
            {body.height || body.weight ? (
              <dl className="prescription-detail__common">
                <dt>身長</dt>
                <dd>
                  {measurementLabel(body.height) || "-"}
                  {body.height?.date && (
                    <span className="body-measure__date">{body.height.date}</span>
                  )}
                </dd>
                <dt>体重</dt>
                <dd>
                  {measurementLabel(body.weight) || "-"}
                  {body.weight?.date && (
                    <span className="body-measure__date">{body.weight.date}</span>
                  )}
                </dd>
                <dt>BMI</dt>
                <dd>{body.bmi ?? "-"}</dd>
              </dl>
            ) : (
              <p className="patient-table__empty">身長・体重の測定がありません。</p>
            )}
          </fieldset>

          <fieldset>
            <legend>腎機能</legend>
            {renal.creatinine || renal.cystatinC ? (
              <dl className="prescription-detail__common">
                <dt>血清クレアチニン</dt>
                <dd>
                  {measurementLabel(renal.creatinine) || "-"}
                  {renal.creatinine?.date && (
                    <span className="body-measure__date">{renal.creatinine.date}</span>
                  )}
                </dd>
                <dt>eGFR</dt>
                <dd>
                  {renal.egfr !== null ? (
                    `${renal.egfr} mL/分/1.73m²`
                  ) : (
                    <span className="body-measure__unavailable">{renal.egfrUnavailable || "-"}</span>
                  )}
                </dd>
                <dt>CCr</dt>
                <dd>
                  {renal.ccr !== null ? (
                    `${renal.ccr} mL/分`
                  ) : (
                    <span className="body-measure__unavailable">{renal.ccrUnavailable || "-"}</span>
                  )}
                </dd>
                {renal.cystatinC && (
                  <>
                    <dt>シスタチンC</dt>
                    <dd>
                      {measurementLabel(renal.cystatinC)}
                      <span className="body-measure__date">{renal.cystatinC.date}</span>
                    </dd>
                  </>
                )}
              </dl>
            ) : (
              <p className="patient-table__empty">腎機能の検査結果がありません。</p>
            )}
          </fieldset>
        </div>
      )}
    </section>
  );
}
