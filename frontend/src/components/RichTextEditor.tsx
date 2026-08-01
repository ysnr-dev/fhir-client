import { useRef } from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Color, FontSize, TextStyle } from "@tiptap/extension-text-style";
import Image from "@tiptap/extension-image";
import { normalizeImageFile } from "../fhir/schemaImage";

// 診療記録本文のリッチテキストエディタ(Tiptap)。
// 装飾はフォントサイズと文字色のみ(要件)。出力は HTML で、FHIR へは
// clinicalNoteHelpers の htmlToXhtml で XHTML 化して保存する。
// 画像は Binary を使わず data: URI のまま本文に埋め込む。

interface RichTextEditorProps {
  // 非制御。初期値を渡し、変更は onChange で受け取る。
  // 編集ページは読込完了後にマウントするので初期値の再セットは不要。
  initialHtml: string;
  onChange: (html: string) => void;
}

// SchemaImageAnnotator の PEN_COLORS と同じパレット(アプリ内で装飾色を統一する)。
const TEXT_COLORS = [
  { code: "#d32f2f", label: "赤" },
  { code: "#1565c0", label: "青" },
  { code: "#2e7d32", label: "緑" },
] as const;

const FONT_SIZES = [
  { value: "13px", label: "小" },
  { value: "18px", label: "大" },
  { value: "24px", label: "特大" },
] as const;

export function RichTextEditor({ initialHtml, onChange }: RichTextEditorProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    extensions: [
      StarterKit,
      TextStyle,
      Color,
      FontSize,
      // allowBase64 がないと data: URI の画像が黙って除去される
      Image.configure({ allowBase64: true, inline: false }),
    ],
    content: initialHtml,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  // v3 の useEditor はトランザクションで再レンダーしないため、
  // ツールバーの活性表示は useEditorState で購読する。
  const toolbarState = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor?.isActive("bold") ?? false,
      color: (editor?.getAttributes("textStyle").color as string | undefined) ?? null,
      fontSize: (editor?.getAttributes("textStyle").fontSize as string | undefined) ?? null,
    }),
  });

  if (!editor) return null;

  async function handleImageSelect(file: File | undefined) {
    if (!file || !editor) return;
    try {
      // 既存のシェーマ画像と同じ縮小処理(長辺1600px・JPEG化)を通してから挿入する。
      // Base64 が Composition 本体に入るため、原寸のまま埋め込まない。
      const { dataUrl } = await normalizeImageFile(file);
      editor.chain().focus().setImage({ src: dataUrl }).run();
    } catch (e) {
      alert(e instanceof Error ? e.message : "画像を挿入できませんでした。");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="rich-text-editor">
      <div className="rich-text-editor__toolbar" role="toolbar">
        <button
          type="button"
          className={`rich-text-editor__tool${toolbarState.bold ? " is-active" : ""}`}
          title="太字"
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          B
        </button>
        <span className="rich-text-editor__separator" />
        <button
          type="button"
          className={`rich-text-editor__tool${toolbarState.fontSize === null ? " is-active" : ""}`}
          title="標準サイズ"
          onClick={() => editor.chain().focus().unsetFontSize().run()}
        >
          標準
        </button>
        {FONT_SIZES.map((size) => (
          <button
            key={size.value}
            type="button"
            className={`rich-text-editor__tool${toolbarState.fontSize === size.value ? " is-active" : ""}`}
            title={`フォントサイズ: ${size.label}`}
            style={{ fontSize: `min(${size.value}, 18px)` }}
            onClick={() => editor.chain().focus().setFontSize(size.value).run()}
          >
            {size.label}
          </button>
        ))}
        <span className="rich-text-editor__separator" />
        <button
          type="button"
          className={`rich-text-editor__swatch${toolbarState.color === null ? " is-active" : ""}`}
          style={{ backgroundColor: "#1f1f1f" }}
          title="文字色: 黒(標準)"
          onClick={() => editor.chain().focus().unsetColor().run()}
        />
        {TEXT_COLORS.map((color) => (
          <button
            key={color.code}
            type="button"
            className={`rich-text-editor__swatch${toolbarState.color === color.code ? " is-active" : ""}`}
            style={{ backgroundColor: color.code }}
            title={`文字色: ${color.label}`}
            onClick={() => editor.chain().focus().setColor(color.code).run()}
          />
        ))}
        <span className="rich-text-editor__separator" />
        <button
          type="button"
          className="rich-text-editor__tool"
          title="装飾を解除"
          onClick={() => editor.chain().focus().unsetAllMarks().run()}
        >
          解除
        </button>
        <button
          type="button"
          className="rich-text-editor__tool"
          title="画像を挿入"
          onClick={() => fileInputRef.current?.click()}
        >
          画像
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => void handleImageSelect(e.target.files?.[0])}
        />
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
