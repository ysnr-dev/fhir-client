import type { ReactNode } from "react";
import {
  clinicalNoteAttestation,
  noteBodySections,
  sectionResponseId,
  sectionTitle,
  stripSchemaImageNotes,
  summarizeClinicalNote,
} from "../fhir/clinicalNoteHelpers";
import { RichTextView } from "./RichTextView";
import { ResponseSchemaImages } from "./SchemaImageGallery";

// 診療記録の内容表示。診療記録詳細ページとカルテ画面の詳細モーダルの双方から使う。
// 編集・削除の操作ボタンは、遷移先が異なるので呼び出し側が持つ。

export function ClinicalNoteDetailPanel({
  note,
  children,
}: {
  note: fhir4.Composition;
  /** 内容の後ろに続けて出す要素(詳細ページの FHIR JSON 表示など)。 */
  children?: ReactNode;
}) {
  const summary = summarizeClinicalNote(note);
  const attestation = clinicalNoteAttestation(note);

  return (
    <div className="prescription-detail">
      <fieldset>
        <legend>記録情報</legend>
        <dl className="prescription-detail__common">
          <dt>タイトル</dt>
          <dd>{summary.title || "-"}</dd>
          <dt>記録日時</dt>
          <dd>{summary.dateTime || "-"}</dd>
          <dt>ステータス</dt>
          <dd>{summary.statusLabel || "-"}</dd>
          <dt>作成者</dt>
          <dd>{summary.authorName}</dd>
          {/* 確定した記録は「誰がいつ内容に責任を負ったか」を出す(真正性の根拠)。 */}
          {attestation && (
            <>
              <dt>確定者</dt>
              <dd>
                {attestation.name || "-"}
                {attestation.time && ` (${attestation.time.slice(0, 16).replace("T", " ")})`}
              </dd>
            </>
          )}
        </dl>
      </fieldset>

      {noteBodySections(note).map((section, index) => {
        // テンプレート由来のセクションは、記入内容のシェーマ画像を本文の下に並べる
        // (カルテのカードと同じ見せ方)。
        const responseId = sectionResponseId(section);
        return (
          <div key={index} className="clinical-note-view__section">
            <h3>{section.title || sectionTitle(section.code?.coding?.[0]?.code) || "セクション"}</h3>
            <RichTextView
              html={
                responseId ? stripSchemaImageNotes(section.text?.div) : (section.text?.div ?? "")
              }
            />
            {responseId && <ResponseSchemaImages responseId={responseId} />}
          </div>
        );
      })}

      {children}
    </div>
  );
}
