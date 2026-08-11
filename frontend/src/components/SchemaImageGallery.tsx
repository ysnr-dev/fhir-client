import { useBinaryImage, useQuestionnaireResponse } from "../api/queries";
import {
  schemaImageRefs,
  type SchemaImageRef,
  type TemplateBinding,
} from "../fhir/questionnaireResponseHelpers";

// テンプレートに記載した描き込み済みシェーマ画像の表示。カルテのテンプレート回答
// カード・放射線オーダー(記入内容が別リソースの QuestionnaireResponse にある)と、
// 診療記録・放射線オーダーの入力画面で共用する。

export function SchemaImageGallery({ refs }: { refs: SchemaImageRef[] }) {
  if (refs.length === 0) return null;

  return (
    <div className="schema-gallery">
      {refs.map((ref) => (
        <SchemaImageThumb key={ref.key} imageRef={ref} />
      ))}
    </div>
  );
}

// 入力画面用。記入したてで未保存(draft)なら同梱の画像から、再編集していない
// 保存済みなら参照先の回答から出す。
export function TemplateSchemaImages({ template }: { template: TemplateBinding | null }) {
  if (template?.draft) {
    return (
      <SchemaImageGallery
        refs={schemaImageRefs(template.draft.response, template.draft.imageEntries)}
      />
    );
  }
  if (template?.responseId) return <ResponseSchemaImages responseId={template.responseId} />;
  return null;
}

// 回答そのものを持っていない画面(放射線オーダーは明細の拡張から id で参照する)向け。
// 読み込み中・取得できないときは何も出さない — 平文の記載は既に出ているので、
// 画像だけのために枠やエラーを見せない。
export function ResponseSchemaImages({ responseId }: { responseId: string }) {
  const { data } = useQuestionnaireResponse(responseId);
  const response = data?.data;

  return <SchemaImageGallery refs={response ? schemaImageRefs(response) : []} />;
}

// 描き込み済みシェーマ画像のサムネイル。Binary は staleTime: Infinity で
// キャッシュされるので、同じ画像を何枚出しても取得は 1 回で済む。
function SchemaImageThumb({ imageRef }: { imageRef: SchemaImageRef }) {
  // 未保存の dataURL を持っているときは Binary の取得を省く(SchemaImageField と同じ規約)。
  const { data, isLoading } = useBinaryImage(
    imageRef.dataUrl ? undefined : (imageRef.binaryId ?? undefined),
  );
  const src = imageRef.dataUrl ?? data;

  return (
    <figure className="schema-gallery__item">
      {src ? (
        <img className="schema-gallery__image" src={src} alt={imageRef.label || "シェーマ画像"} />
      ) : (
        <p className="schema-gallery__empty">
          {isLoading ? "画像を読み込み中..." : "画像を表示できません。"}
        </p>
      )}
      {imageRef.label && (
        <figcaption className="schema-gallery__caption">{imageRef.label}</figcaption>
      )}
    </figure>
  );
}
