import { useBinaryImage, useQuestionnaireResponse } from "../api/queries";
import { schemaImageRefs, type SchemaImageRef } from "../fhir/questionnaireResponseHelpers";

// テンプレートに記載した描き込み済みシェーマ画像の表示。カルテのテンプレート回答
// カードと、放射線オーダーの検査目的・特別指示(記入内容が別リソースの
// QuestionnaireResponse にある)で共用する。

export function SchemaImageGallery({ refs }: { refs: SchemaImageRef[] }) {
  if (refs.length === 0) return null;

  return (
    <div className="karte-qr__schemas">
      {refs.map((ref) => (
        <SchemaImageThumb key={ref.key} binaryId={ref.binaryId} label={ref.label} />
      ))}
    </div>
  );
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
function SchemaImageThumb({ binaryId, label }: { binaryId: string; label: string }) {
  const { data, isLoading } = useBinaryImage(binaryId);

  return (
    <figure className="karte-qr__schema">
      {data ? (
        <img className="karte-qr__schema-image" src={data} alt={label || "シェーマ画像"} />
      ) : (
        <p className="karte-card__empty">
          {isLoading ? "画像を読み込み中..." : "画像を表示できません。"}
        </p>
      )}
      {label && <figcaption className="karte-qr__schema-caption">{label}</figcaption>}
    </figure>
  );
}
