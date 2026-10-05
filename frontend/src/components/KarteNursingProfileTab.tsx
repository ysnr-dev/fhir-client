import { useMemo } from "react";
import {
  useNursingProfileResponses,
  useNursingProfileSettings,
  usePatientAdmissions,
  useQuestionnaireOptions,
} from "../api/queries";
import { ADMISSION_STATUS, admissionLabel } from "../fhir/encounterHelpers";
import { nursingProfileSections, type NursingProfileSection } from "../fhir/nursingProfileHelpers";
import {
  questionnaireCanonical,
  questionnaireResponsePlainText,
  summarizeQuestionnaireResponse,
} from "../fhir/questionnaireResponseHelpers";
import { ErrorBanner } from "./ErrorBanner";

interface KarteNursingProfileTabProps {
  patientId: string;
  /** 見ている入院の id。空なら今の入院(無ければ最新の退院)。 */
  view: string;
  onViewChange: (view: string) => void;
  /** 区画の記入・編集(右ペイン)。 */
  onEdit: (encounterId: string, templateUrl: string) => void;
}

// 看護プロファイル(docs/nursing-profile-design.md)。入院ごとに、施設設定で並べた区画の最新の回答を
// 読む。時系列のカードにはしない(入院中に書き直していく「今の状態」なので)。記入・編集は右ペイン。
export function KarteNursingProfileTab({ patientId, view, onViewChange, onEdit }: KarteNursingProfileTabProps) {
  const admissions = usePatientAdmissions(patientId);
  const encounter =
    admissions.data?.find((e) => e.id === view) ??
    admissions.data?.find((e) => e.status === ADMISSION_STATUS) ??
    admissions.data?.[0];
  const encounterId = encounter?.id ?? "";

  const profile = useNursingProfileSettings();
  const options = useQuestionnaireOptions({ status: "active" });
  const answered = useNursingProfileResponses(encounterId || undefined);
  const sections = useMemo(
    () =>
      nursingProfileSections(
        profile.settings,
        options.questionnaires,
        answered.data?.responses ?? [],
        answered.data?.questionnaires,
      ),
    [profile.settings, options.questionnaires, answered.data],
  );

  const loading = admissions.isLoading || profile.isLoading || options.isLoading;

  return (
    <div className="karte-tabpanel">
      <div className="karte-tabpanel__header">
        <h3>看護プロファイル</h3>
        {Boolean(admissions.data?.length) && (
          <div className="nursing-tab__toolbar">
            <select
              className="nursing-profile__encounter"
              aria-label="対象の入院"
              value={encounterId}
              onChange={(e) => onViewChange(e.target.value)}
            >
              {admissions.data?.map((e) => (
                <option key={e.id} value={e.id}>
                  {admissionLabel(e)}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <ErrorBanner error={admissions.error ?? profile.error ?? options.error ?? answered.error} />

      {loading || (encounterId && answered.isPending) ? (
        <p>読み込み中...</p>
      ) : !encounterId ? (
        <p className="patient-table__empty">この患者に入院の記録がありません。</p>
      ) : sections.length === 0 ? (
        <p className="patient-table__empty">
          看護プロファイルの区画が設定されていません。管理の施設設定で区画のテンプレートを選んでください。
        </p>
      ) : (
        <div className="nursing-plan__list">
          {sections.map((section) => (
            <SectionCard
              key={section.url}
              section={section}
              included={answered.data?.questionnaires ?? []}
              onEdit={() => onEdit(encounterId, section.url)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SectionCard({
  section,
  included,
  onEdit,
}: {
  section: NursingProfileSection;
  included: fhir4.Questionnaire[];
  onEdit: () => void;
}) {
  const { response } = section;
  // 平文は回答を書いた版のテンプレートで組み立てる(単位を引くため)。
  const written = response
    ? included.find((q) => questionnaireCanonical(q) === response.questionnaire)
    : undefined;
  const summary = response ? summarizeQuestionnaireResponse(response) : undefined;
  const text = response && written ? questionnaireResponsePlainText(written, response) : "";
  const canWrite = Boolean(response || section.questionnaire);

  return (
    <article className="nursing-plan__card">
      <header className="nursing-plan__head">
        <span className="nursing-plan__title">{section.title}</span>
        <span className="nursing-plan__dates">
          {summary
            ? [summary.statusLabel, summary.authored, summary.authorName].filter(Boolean).join(" / ")
            : "未記入"}
        </span>
        <span className="nursing-plan__actions">
          <button
            type="button"
            className="rp-card__compact-button"
            disabled={!canWrite}
            title={canWrite ? undefined : "この区画のテンプレートに有効な版がありません"}
            onClick={onEdit}
          >
            {response ? "編集" : "記入"}
          </button>
        </span>
      </header>
      {response &&
        (text ? (
          <div className="nursing-profile__text">{text}</div>
        ) : (
          <p className="patient-table__empty">
            {written ? "記入された項目はありません。" : "元テンプレートが見つからないため、内容を表示できません。"}
          </p>
        ))}
    </article>
  );
}
