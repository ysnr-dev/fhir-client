import type { TemplateBinding } from "../fhir/questionnaireResponseHelpers";
import { TemplateSchemaImages } from "./SchemaImageGallery";

// テンプレートからも直接入力もできる 1 欄。放射線オーダーの検査目的・特別指示で
// 作った形を、栄養指導の指導目的でも使うので共通の部品にした。
//
// テンプレートから記載した場合は、回答との
// 食い違いを防ぐため直接編集は不可にし、直すときはテンプレート画面を開き直す
// (診療記録の SOAP セクションと同じ扱い)。
//
// 「解除」でテンプレートとの紐付けを外すと、記載された文言を残したまま直接入力へ戻せる。
// 保存すると、参照が外れた記入内容(QuestionnaireResponse)はオーダーの更新と同じ
// transaction で削除される。
export function TemplateTextField({
  label,
  value,
  template,
  onChange,
  onOpenTemplate,
  onClearTemplate,
}: {
  label: string;
  value: string;
  template: TemplateBinding | null;
  onChange: (value: string) => void;
  onOpenTemplate: () => void;
  onClearTemplate: () => void;
}) {
  const fromTemplate = Boolean(template);

  return (
    <label>
      {label}
      <div className="rad-gp__template-field">
        <textarea
          rows={2}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          readOnly={fromTemplate}
          title={
            fromTemplate ? "テンプレートから記載した内容です。テンプレート編集から直します" : undefined
          }
        />
        <div className="rad-gp__template-actions">
          <button
            type="button"
            onClick={onOpenTemplate}
            title={fromTemplate ? `${label}をテンプレートから直す` : `${label}をテンプレートから記入`}
          >
            {fromTemplate ? "テンプレート編集" : "テンプレート"}
          </button>
          {fromTemplate && (
            <button
              type="button"
              onClick={onClearTemplate}
              title="テンプレートとの紐付けを外して直接入力に戻す(記載された文言は残る)"
            >
              解除
            </button>
          )}
        </div>
      </div>
      {/* 記入内容にシェーマ画像があれば、平文の「あり」の印だけでは何を描いたか
          分からないので、入力中もサムネイルを出す(登録後の表示と同じ見せ方)。 */}
      <TemplateSchemaImages template={template} />
    </label>
  );
}
