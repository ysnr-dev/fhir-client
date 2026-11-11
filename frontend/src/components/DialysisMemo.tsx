import { useState } from "react";
import { useDialysisMemo, useQuestionnaireOptions } from "../api/queries";
import { DIALYSIS_MEMO_TAG, dialysisMemoTemplate, type DialysisMemo } from "../fhir/dialysisMemoHelpers";
import {
  questionnaireResponsePlainText,
  schemaAnnotatedLines,
  schemaImageRefs,
  summarizeQuestionnaireResponse,
} from "../fhir/questionnaireResponseHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";
import { QuestionnaireResponseCreatePanel, QuestionnaireResponseEditPanel } from "./QuestionnaireResponsePanels";
import { SchemaImageGallery } from "./SchemaImageGallery";

// 透析の患者メモ(docs/dialysis-order-design.md §6.1)。患者 1 人に 1 件のテンプレート回答を、
// 透析オーダーの詳細と透析部門のボードから読み書きする。

/** メモの中身(平文 + 描き込んだシェーマ)。 */
function DialysisMemoBody({ memo }: { memo: DialysisMemo }) {
  const { response, questionnaire } = memo;
  if (!response) return <p className="patient-table__empty">未記入</p>;
  if (!questionnaire) {
    return (
      <p className="patient-table__empty">
        元テンプレート({response.questionnaire})が見つからないため内容を表示できません。
      </p>
    );
  }
  // シェーマは下に実物を出すので、平文の「あり」の印は落とす。
  const lines = schemaAnnotatedLines(questionnaireResponsePlainText(questionnaire, response));
  const schemas = schemaImageRefs(response);
  if (lines.length === 0 && schemas.length === 0) return <p className="patient-table__empty">回答がありません。</p>;
  return (
    <>
      {lines.length > 0 && (
        <ul className="karte-qr__lines">
          {lines.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
      )}
      <SchemaImageGallery refs={schemas} />
    </>
  );
}

function memoStamp(memo: DialysisMemo | undefined): string {
  if (!memo?.response) return "";
  const summary = summarizeQuestionnaireResponse(memo.response);
  return [summary.authored, summary.authorName].filter(Boolean).join(" / ");
}

/** 記入・編集の入力欄。回答があれば更新、無ければ雛形のテンプレートで新規。 */
function DialysisMemoForm({
  patientId,
  memo,
  onSaved,
}: {
  patientId: string;
  memo: DialysisMemo;
  onSaved: () => void;
}) {
  const options = useQuestionnaireOptions({ status: "active" });
  if (memo.response?.id) {
    return (
      <QuestionnaireResponseEditPanel
        patientId={patientId}
        qrId={memo.response.id}
        showProblem={false}
        onSaved={onSaved}
      />
    );
  }
  if (options.isLoading) return <p>読み込み中...</p>;
  const template = dialysisMemoTemplate(options.questionnaires);
  return (
    <>
      <ErrorBanner error={options.error} />
      {template ? (
        <QuestionnaireResponseCreatePanel
          patientId={patientId}
          fixedQuestionnaire={template}
          showProblem={false}
          tag={[DIALYSIS_MEMO_TAG]}
          onSaved={onSaved}
        />
      ) : (
        <p className="patient-table__empty">
          透析の患者メモのテンプレート(HD_MEMO_01)に有効な版がありません。テンプレート一覧のインポートから取り込んでください。
        </p>
      )}
    </>
  );
}

/** 透析オーダーの詳細に置く区画。編集はモーダルで開く。 */
export function DialysisMemoSection({ patientId }: { patientId: string }) {
  const memo = useDialysisMemo(patientId);
  const [editing, setEditing] = useState(false);
  const stamp = memoStamp(memo.data);

  return (
    <fieldset className="dialysis-memo">
      <legend>患者メモ</legend>
      <ErrorBanner error={memo.error} />
      <div className="dialysis-memo__head">
        <span className="dialysis-memo__stamp">{stamp}</span>
        <button
          type="button"
          className="rp-card__compact-button"
          disabled={!memo.isSuccess}
          onClick={() => setEditing(true)}
        >
          {memo.data?.response ? "編集" : "記入"}
        </button>
      </div>
      {memo.isLoading ? <p>読み込み中...</p> : memo.data && <DialysisMemoBody memo={memo.data} />}
      {editing && memo.data && (
        <Modal title="患者メモ" className="modal--wide" onClose={() => setEditing(false)}>
          <DialysisMemoForm patientId={patientId} memo={memo.data} onSaved={() => setEditing(false)} />
        </Modal>
      )}
    </fieldset>
  );
}

/** 透析部門のボードから開くモーダル。読むのが主なので表示から始め、「編集」で入力欄に切り替える。 */
export function DialysisMemoModal({
  patientId,
  patientName,
  onClose,
}: {
  patientId: string;
  patientName: string;
  onClose: () => void;
}) {
  const memo = useDialysisMemo(patientId);
  const [editing, setEditing] = useState(false);
  const stamp = memoStamp(memo.data);

  return (
    <Modal
      title={patientName ? `患者メモ: ${patientName}` : "患者メモ"}
      className="modal--wide"
      onClose={onClose}
    >
      <ErrorBanner error={memo.error} />
      {memo.isLoading ? (
        <p>読み込み中...</p>
      ) : (
        memo.data &&
        (editing ? (
          <DialysisMemoForm patientId={patientId} memo={memo.data} onSaved={() => setEditing(false)} />
        ) : (
          <div className="dialysis-memo">
            <div className="dialysis-memo__head">
              <span className="dialysis-memo__stamp">{stamp}</span>
              <button type="button" className="rp-card__compact-button" onClick={() => setEditing(true)}>
                {memo.data.response ? "編集" : "記入"}
              </button>
            </div>
            <DialysisMemoBody memo={memo.data} />
          </div>
        ))
      )}
    </Modal>
  );
}
