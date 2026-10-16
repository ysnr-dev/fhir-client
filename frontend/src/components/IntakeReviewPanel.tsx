import { useIntakeResponse, useMarkIntakeResponse } from "../api/intakeQueries";
import { useQuestionnaireByCanonical } from "../api/queries";
import { intakeSourceExtension } from "../fhir/intakeHelpers";
import { dateTimeLabel } from "../lib/dates";
import { ErrorBanner } from "./ErrorBanner";
import { QuestionnaireResponseCreatePanel } from "./QuestionnaireResponsePanels";

// Web 問診の回答の取込(docs/web-intake-design.md §3.2)。患者の答えを初期値にしてテンプレート記入の
// パネルを開き、職員が確認・修正して保存する。保存した回答の id を backend に書き戻して「取込済」にする。
// 「破棄」はカルテに書かずに閉じる。

export function IntakeReviewPanel({
  patientId,
  responseId,
  onSaved,
}: {
  patientId: string;
  responseId: number;
  onSaved: () => void;
}) {
  const record = useIntakeResponse(responseId);
  const canonical = record.data
    ? `${record.data.questionnaire_url}${record.data.questionnaire_version ? `|${record.data.questionnaire_version}` : ""}`
    : undefined;
  const { questionnaire, isLoading, error } = useQuestionnaireByCanonical(canonical);
  const mark = useMarkIntakeResponse();

  if (record.isPending || isLoading) return <p>読み込み中...</p>;
  if (record.error || error) return <ErrorBanner error={record.error ?? error} />;
  if (!record.data) return <p className="patient-table__empty">この回答は見つかりませんでした。</p>;
  if (record.data.status !== "pending") return <p className="patient-table__empty">この回答は取込済みです。</p>;
  if (!questionnaire) return <p className="patient-table__empty">質問票のテンプレートが見つかりません。</p>;

  const submitted = record.data.submitted_at;
  return (
    <>
      <ErrorBanner error={mark.error} />
      <div className="qr-template-select">
        <span className="qr-copy-previous__note">患者が {dateTimeLabel(submitted)} に回答</span>
        <button
          type="button"
          className="rp-card__compact-button"
          disabled={mark.isPending}
          onClick={() => {
            if (!window.confirm("この回答をカルテに取り込まずに破棄しますか？")) return;
            mark.mutate({ id: responseId, status: "discarded" }, { onSuccess: onSaved });
          }}
        >
          破棄
        </button>
      </div>
      <QuestionnaireResponseCreatePanel
        patientId={patientId}
        fixedQuestionnaire={questionnaire}
        initialResponse={{ resourceType: "QuestionnaireResponse", status: "in-progress", item: record.data.answers }}
        authored={submitted}
        extension={[intakeSourceExtension()]}
        onSaved={(saved) => {
          if (saved?.id) {
            mark.mutate({ id: responseId, status: "imported", imported_qr_id: saved.id }, { onSettled: onSaved });
          } else {
            onSaved();
          }
        }}
      />
    </>
  );
}
