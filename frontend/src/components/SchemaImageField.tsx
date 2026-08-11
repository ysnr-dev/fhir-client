import { lazy, Suspense, useState } from "react";
import { useBinaryImage } from "../api/queries";
import { binaryIdFromAttachment, itemMediaOf } from "../fhir/schemaImage";

// テンプレート項目のシェーマ画像表示 + 描き込み(フォーム入力時のみ)。
// 表示の優先順: 描き込み(未保存 dataUrl → 保存済み Binary) → テンプレートの元画像。

// 描き込みは診療記録のシェーマと同じツール(fabric.js)を使う。重いので開くまで読み込まない。
const SchemaPaintModal = lazy(() => import("./SchemaPaintModal"));

// 項目インスタンスへの描き込み状態。binaryId は保存(アップロード)済み、
// dataUrl は描き込んだがまだアップロードしていない合成画像。
export interface AnnotationState {
  binaryId: string | null;
  dataUrl: string | null;
}

interface SchemaImageFieldProps {
  item: fhir4.QuestionnaireItem;
  // 回答 state と同じ規約のインスタンスパス(繰り返しは "group#0" など)。
  instanceKey: string;
  canAnnotate: boolean;
  annotation?: AnnotationState;
  onChange: (key: string, next: AnnotationState | null) => void;
}

export function SchemaImageField({
  item,
  instanceKey,
  canAnnotate,
  annotation,
  onChange,
}: SchemaImageFieldProps) {
  const [annotating, setAnnotating] = useState(false);

  const mediaBinaryId = binaryIdFromAttachment(itemMediaOf(item)) ?? undefined;
  // dataUrl を持っているときは Binary の取得を省く。
  const annotationImage = useBinaryImage(
    annotation?.dataUrl ? undefined : (annotation?.binaryId ?? undefined),
  );
  const baseImage = useBinaryImage(mediaBinaryId);
  const displaySrc =
    annotation?.dataUrl ??
    (annotation?.binaryId ? annotationImage.data : undefined) ??
    baseImage.data;

  if (!mediaBinaryId) return null;

  return (
    <div className="schema-image">
      {displaySrc ? (
        <img className="schema-image__thumb" src={displaySrc} alt={item.text ?? "シェーマ画像"} />
      ) : (
        <p className="schema-image__loading">画像を読み込み中...</p>
      )}
      {canAnnotate && (
        <div className="schema-image__actions">
          <button type="button" disabled={!displaySrc} onClick={() => setAnnotating(true)}>
            編集
          </button>
          {annotation && (
            <button type="button" onClick={() => onChange(instanceKey, null)}>
              編集を削除
            </button>
          )}
        </div>
      )}
      {annotating && displaySrc && (
        <Suspense fallback={null}>
          <SchemaPaintModal
            title={item.text ? `シェーマ編集: ${item.text}` : "シェーマ編集"}
            backgroundDataUrl={displaySrc}
            saveLabel="編集を保存"
            onClose={() => setAnnotating(false)}
            onSave={(dataUrl) => {
              onChange(instanceKey, { binaryId: null, dataUrl });
              setAnnotating(false);
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
