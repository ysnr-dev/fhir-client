import { lazy, Suspense, useRef, useState, type ReactNode } from "react";
import { fetchSchema } from "../api/masterClient";
import {
  newSectionDraft,
  templateHtml,
  type ClinicalNoteSectionDraft,
  type SectionOption,
} from "../fhir/clinicalNoteHelpers";
import type { TemplateDraft } from "../fhir/questionnaireResponseHelpers";
import { TemplateEntryModal } from "./TemplateEntryModal";
import { RichTextEditor, type RichTextEditorHandle } from "./RichTextEditor";
import { TemplateSchemaImages } from "./SchemaImageGallery";
import { SchemaPickerModal } from "./SchemaPickerModal";

// ペイントモーダル(fabric.js)は重いので、開くまで読み込まない。
const SchemaPaintModal = lazy(() => import("./SchemaPaintModal"));

// 診療記録・退院時サマリーで共用する本文セクションの編集部品。セクションごとに
// リッチテキストのエディタを置き、テンプレート記入(回答の平文を本文にする)と
// シェーマの描き込み・挿入を同じ操作バーから行う。
//
// arrangeable なら種別の選択・並べ替え・削除・追加ができる(診療記録の SOAP)。
// 固定ならエディタだけを出す(自由記載・退院時サマリーの固定セクション。見出しは
// 呼び出し側が置く)。
//
// フックの形にしてあるのは、モーダル(テンプレート記入・シェーマ)を呼び出し側の
// <form> の外に置くため。モーダル内の QuestionnaireResponseForm は独自の <form> を
// 持ち、Modal は非ポータルなので、form の子孫に置くと入れ子になって送信が外へ漏れる。
// 呼び出し側は sections を form の中に、modals を form の兄弟として描画する。

interface NoteSectionsEditorProps {
  // テンプレート記入モーダルが患者リソースと初期値式コンテキストを引くのに使う。
  patientId: string;
  sections: ClinicalNoteSectionDraft[];
  onChange: (sections: ClinicalNoteSectionDraft[]) => void;
  sectionOptions: readonly SectionOption[];
  arrangeable: boolean;
}

export function useNoteSectionsEditor({
  patientId,
  sections,
  onChange,
  sectionOptions,
  arrangeable,
}: NoteSectionsEditorProps): {
  /** 全セクション(と追加行)をまとめた描画。 */
  sections: ReactNode;
  /** セクションごとの描画(uid → node)。固定の並びの中に 1 つずつ差し込むとき用。 */
  items: Map<string, ReactNode>;
  modals: ReactNode;
} {
  // セクション追加セレクトの選択値(追加ボタンを押すまで反映しない)
  const [addCode, setAddCode] = useState<string>(sectionOptions[0]?.code ?? "");
  // テンプレート記入モーダルを開いているセクションの uid。
  const [templateTarget, setTemplateTarget] = useState<string | null>(null);
  // シェーマ選択モーダルを開いているセクションの uid。
  const [schemaPickTarget, setSchemaPickTarget] = useState<string | null>(null);
  // シェーマのペイント中(台紙を取得済み)。
  const [schemaPaint, setSchemaPaint] = useState<{
    uid: string;
    name: string;
    background: string;
  } | null>(null);
  // セクションごとのエディタ操作ハンドル。key の付け替えでエディタが作り直され
  // ても追随するよう、callback ref で登録・解除する。
  const editorHandles = useRef(new Map<string, RichTextEditorHandle>());

  function updateSection(uid: string, patch: Partial<{ code: string; html: string }>) {
    onChange(sections.map((s) => (s.uid === uid ? { ...s, ...patch } : s)));
  }

  function removeSection(uid: string) {
    onChange(sections.filter((s) => s.uid !== uid));
  }

  function moveSection(uid: string, delta: -1 | 1) {
    const index = sections.findIndex((s) => s.uid === uid);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= sections.length) return;
    const next = [...sections];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  // テンプレート記入モーダルの登録。回答の平文をセクション本文に反映し、
  // 以後このセクションは直接編集不可(テンプレートからのみ編集)にする。
  function applyTemplate(uid: string, draft: TemplateDraft) {
    onChange(
      sections.map((s) =>
        s.uid === uid
          ? {
              ...s,
              html: templateHtml(draft.questionnaire, draft.response),
              template: { responseId: s.template?.responseId ?? null, draft },
            }
          : s,
      ),
    );
    setTemplateTarget(null);
  }

  // シェーマ選択 → 台紙(image)を取得してペイントへ進む。
  async function pickSchema(uid: string, schemaId: number) {
    try {
      const detail = await fetchSchema(schemaId);
      setSchemaPaint({ uid, name: detail.name, background: detail.image });
      setSchemaPickTarget(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : "シェーマを取得できませんでした。");
    }
  }

  // ペイント完了。合成画像をそのセクションのカーソル位置に挿入する。
  function insertSchema(uid: string, dataUrl: string) {
    editorHandles.current.get(uid)?.insertImage(dataUrl);
    setSchemaPaint(null);
  }

  const templateSection = sections.find((s) => s.uid === templateTarget);

  const items = new Map<string, ReactNode>();
  sections.forEach((section, index) => {
    items.set(
      section.uid,
      (
        // key は uid。並べ替えでもエディタのインスタンスが section に追随する。
        <div key={section.uid} className="clinical-note-section">
          {/* セクション種別・並べ替え・削除はエディタの操作バーに同居させる
              (枠を入れ子にしないため)。固定のセクションは見出しだけを出す。 */}
          <RichTextEditor
            // エディタは非制御なので、テンプレート反映で本文が外から変わったら
            // key を変えて作り直す(authored は記入のたびに更新される)。
            key={`${section.uid}:${section.template?.draft?.response.authored ?? (section.template ? "saved" : "plain")}`}
            initialHtml={section.html}
            onChange={(html) => updateSection(section.uid, { html })}
            // テンプレート由来の本文は直接編集させない(回答との差異を防ぐ)。
            editable={!section.template}
            apiRef={(handle) => {
              if (handle) editorHandles.current.set(section.uid, handle);
              else editorHandles.current.delete(section.uid);
            }}
            actions={
              <>
                <button
                  type="button"
                  className="rich-text-editor__tool"
                  title={
                    section.template
                      ? "テンプレートから再編集"
                      : "テンプレートで記載(以後この本文はテンプレートからのみ編集)"
                  }
                  onClick={() => setTemplateTarget(section.uid)}
                >
                  {section.template ? "テンプレート編集" : "テンプレート"}
                </button>
                {!section.template && (
                  <button
                    type="button"
                    className="rich-text-editor__tool"
                    title="シェーマを選んで描き込み、カーソル位置に挿入"
                    onClick={() => setSchemaPickTarget(section.uid)}
                  >
                    シェーマ
                  </button>
                )}
              </>
            }
            leading={
              arrangeable ? (
                <select
                  value={section.code}
                  onChange={(e) => updateSection(section.uid, { code: e.target.value })}
                  aria-label="セクション種別"
                >
                  {sectionOptions.map((o) => (
                    <option key={o.code} value={o.code}>
                      {o.title}
                    </option>
                  ))}
                </select>
              ) : undefined
            }
            trailing={
              arrangeable ? (
                <div className="clinical-note-section__actions">
                  <button
                    type="button"
                    onClick={() => moveSection(section.uid, -1)}
                    disabled={index === 0}
                    title="上へ移動"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => moveSection(section.uid, 1)}
                    disabled={index === sections.length - 1}
                    title="下へ移動"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => removeSection(section.uid)}
                    title="セクションを削除"
                  >
                    削除
                  </button>
                </div>
              ) : undefined
            }
          />
          {/* テンプレート由来の本文は平文なので、記入内容にシェーマ画像があっても
              「あり」の印しか出ない。何を描いたか分かるよう、入力中も本文の下に
              サムネイルを出す(カルテでの表示と同じ見せ方)。 */}
          <TemplateSchemaImages template={section.template ?? null} />
        </div>
      ),
    );
  });

  const sectionsNode = (
    <>
      {arrangeable && sections.length === 0 && (
        <p className="patient-table__empty">セクションがありません。下の「追加」から追加してください。</p>
      )}
      {sections.map((section) => items.get(section.uid))}

      {arrangeable && (
        <div className="clinical-note-form__add">
          <select value={addCode} onChange={(e) => setAddCode(e.target.value)}>
            {sectionOptions.map((o) => (
              <option key={o.code} value={o.code}>
                {o.title}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => onChange([...sections, newSectionDraft(addCode)])}>
            + セクション追加
          </button>
        </div>
      )}
    </>
  );

  const modals = (
    <>
      {templateSection && (
        <TemplateEntryModal
          patientId={patientId}
          draft={templateSection.template?.draft ?? null}
          responseId={templateSection.template?.responseId ?? null}
          extractsObservations
          onSubmit={(draft) => applyTemplate(templateSection.uid, draft)}
          onClose={() => setTemplateTarget(null)}
        />
      )}

      {schemaPickTarget && (
        <SchemaPickerModal
          onSelect={(schemaId) => void pickSchema(schemaPickTarget, schemaId)}
          onClose={() => setSchemaPickTarget(null)}
        />
      )}
      {schemaPaint && (
        <Suspense fallback={null}>
          <SchemaPaintModal
            title={`シェーマ: ${schemaPaint.name}`}
            backgroundDataUrl={schemaPaint.background}
            saveLabel="記録に挿入"
            onSave={(dataUrl) => insertSchema(schemaPaint.uid, dataUrl)}
            onClose={() => setSchemaPaint(null)}
          />
        </Suspense>
      )}
    </>
  );

  return { sections: sectionsNode, items, modals };
}
