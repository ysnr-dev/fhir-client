import { useState, type ChangeEvent } from "react";
import { useBinaryImage } from "../api/queries";
import {
  changeItemType,
  ITEM_CONTROLS,
  ITEM_TYPE_LABELS,
  ITEM_TYPES,
  newAnswerOption,
  type EditorAnswerOption,
  type EditorItem,
  type EditorItemType,
} from "../fhir/questionnaireHelpers";
import { ORGANIZATION_FIELD_OPTIONS } from "../fhir/organizationField";
import { PRACTITIONER_FIELD_OPTIONS } from "../fhir/practitionerField";
import { PRACTITIONER_ROLE_OPTIONS } from "../fhir/practitionerRoleHelpers";
import { normalizeImageFile } from "../fhir/schemaImage";

interface QuestionnaireItemEditorProps {
  item: EditorItem;
  index: number;
  siblingCount: number;
  // item が choice 配下の条件付き group のとき、その親 choice(表示条件の参照先)。
  parentChoice: EditorItem | null;
  onUpdate: (id: string, updater: (item: EditorItem) => EditorItem) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, direction: "up" | "down") => void;
  onAppendChild: (parentId: string) => void;
}

const INITIAL_INPUT_TYPES: Partial<Record<EditorItemType, string>> = {
  integer: "number",
  decimal: "number",
  date: "date",
  dateTime: "datetime-local",
  time: "time",
};

export function QuestionnaireItemEditor({
  item,
  index,
  siblingCount,
  parentChoice,
  onUpdate,
  onRemove,
  onMove,
  onAppendChild,
}: QuestionnaireItemEditorProps) {
  const [imageError, setImageError] = useState<string | null>(null);
  // 保存済み画像のサムネイル。未アップロードの dataUrl があるときは取得しない。
  const savedImage = useBinaryImage(item.image?.dataUrl ? undefined : (item.image?.binaryId ?? undefined));
  const imageSrc = item.image?.dataUrl ?? (item.image?.binaryId ? savedImage.data : undefined);

  function patch(partial: Partial<EditorItem>) {
    onUpdate(item.id, (it) => ({ ...it, ...partial }));
  }

  async function handleImageSelect(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // 同じファイルの再選択でも change が発火するようリセットする。
    e.target.value = "";
    if (!file) return;
    try {
      const { dataUrl, contentType } = await normalizeImageFile(file);
      setImageError(null);
      patch({ image: { binaryId: null, contentType, dataUrl } });
    } catch (err) {
      setImageError(err instanceof Error ? err.message : "画像の読み込みに失敗しました。");
    }
  }

  function handleTypeChange(type: EditorItemType) {
    onUpdate(item.id, (it) => changeItemType(it, type));
  }

  function handleRemove() {
    if (item.children.length > 0) {
      if (!window.confirm(`配下の子項目 ${item.children.length} 件も削除されます。よろしいですか?`)) {
        return;
      }
    }
    onRemove(item.id);
  }

  function updateOption(optionId: string, partial: Partial<EditorAnswerOption>) {
    patch({
      answerOptions: item.answerOptions.map((o) => (o.id === optionId ? { ...o, ...partial } : o)),
    });
  }

  // チェックボックス以外は初期選択を1つに保つ(ラジオ的に排他)。
  function setInitialSelected(optionId: string, selected: boolean) {
    patch({
      answerOptions: item.answerOptions.map((o) => ({
        ...o,
        initialSelected:
          o.id === optionId ? selected : item.itemControl === "check-box" ? o.initialSelected : false,
      })),
    });
  }

  function moveOption(optionId: string, direction: "up" | "down") {
    const options = [...item.answerOptions];
    const i = options.findIndex((o) => o.id === optionId);
    const target = direction === "up" ? i - 1 : i + 1;
    if (i < 0 || target < 0 || target >= options.length) return;
    [options[i], options[target]] = [options[target], options[i]];
    patch({ answerOptions: options });
  }

  const isGroup = item.type === "group";
  const isChoice = item.type === "choice";
  const isNumeric = item.type === "integer" || item.type === "decimal";
  const isTextual = item.type === "string" || item.type === "text";
  const hasInitial = !isGroup && !isChoice && item.type !== "display";
  // choice 配下の条件付き group(jsp-9)。type 変更・繰り返し不可、表示条件は必須。
  const isConditionalGroup = isGroup && parentChoice !== null;

  return (
    <div className={`qe-item${item.type === "group" ? " qe-item--group" : ""}`}>
      <div className="qe-item__header">
        <span className="qe-item__type-badge">{ITEM_TYPE_LABELS[item.type]}</span>
        <span className="qe-item__header-text">{item.text || item.linkId}</span>
        <span className="qe-item__header-actions">
          <button
            type="button"
            aria-label="上へ移動"
            disabled={index === 0}
            onClick={() => onMove(item.id, "up")}
          >
            ↑
          </button>
          <button
            type="button"
            aria-label="下へ移動"
            disabled={index === siblingCount - 1}
            onClick={() => onMove(item.id, "down")}
          >
            ↓
          </button>
          <button type="button" className="qe-item__remove" onClick={handleRemove}>
            削除
          </button>
        </span>
      </div>

      <div className="qe-item__grid">
        <label>
          種類
          <select
            value={item.type}
            disabled={isConditionalGroup}
            title={isConditionalGroup ? "条件付きグループの種類は変更できません" : undefined}
            onChange={(e) => handleTypeChange(e.target.value as EditorItemType)}
          >
            {ITEM_TYPES.map((type) => (
              <option key={type} value={type}>
                {ITEM_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </label>
        <label>
          linkId
          <input
            type="text"
            value={item.linkId}
            onChange={(e) => patch({ linkId: e.target.value })}
            placeholder="半角英数字と - . _ など"
          />
        </label>
        <label className="qe-item__text-field">
          {item.type === "display" ? "表示テキスト" : "質問文"}
          <input type="text" value={item.text} onChange={(e) => patch({ text: e.target.value })} />
        </label>
        {!isGroup && item.type !== "display" && (
          <label className="qe-item__checkbox">
            <input
              type="checkbox"
              checked={item.required}
              onChange={(e) => patch({ required: e.target.checked })}
            />
            必須
          </label>
        )}
      </div>

      {isChoice && (
        <div className="qe-item__panel">
          <div className="qe-item__grid">
            <label>
              描画形式
              <select value={item.itemControl} onChange={(e) => patch({ itemControl: e.target.value })}>
                {ITEM_CONTROLS.map((control) => (
                  <option key={control.code} value={control.code}>
                    {control.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              並び方向
              <select
                value={item.choiceOrientation}
                onChange={(e) =>
                  patch({ choiceOrientation: e.target.value as "" | "horizontal" | "vertical" })
                }
              >
                <option value="">指定なし</option>
                <option value="vertical">縦</option>
                <option value="horizontal">横</option>
              </select>
            </label>
          </div>
          <table className="qe-options">
            <thead>
              <tr>
                <th>コード</th>
                <th>表示名</th>
                <th>システム(任意)</th>
                <th>初期選択</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {item.answerOptions.map((option, optionIndex) => (
                <tr key={option.id}>
                  <td>
                    <input
                      type="text"
                      value={option.code}
                      onChange={(e) => updateOption(option.id, { code: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={option.display}
                      onChange={(e) => updateOption(option.id, { display: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={option.system}
                      onChange={(e) => updateOption(option.id, { system: e.target.value })}
                    />
                  </td>
                  <td className="qe-options__center">
                    <input
                      type="checkbox"
                      checked={option.initialSelected}
                      onChange={(e) => setInitialSelected(option.id, e.target.checked)}
                    />
                  </td>
                  <td className="qe-options__actions">
                    <button
                      type="button"
                      aria-label="選択肢を上へ"
                      disabled={optionIndex === 0}
                      onClick={() => moveOption(option.id, "up")}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label="選択肢を下へ"
                      disabled={optionIndex === item.answerOptions.length - 1}
                      onClick={() => moveOption(option.id, "down")}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        patch({ answerOptions: item.answerOptions.filter((o) => o.id !== option.id) })
                      }
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            type="button"
            onClick={() => patch({ answerOptions: [...item.answerOptions, newAnswerOption()] })}
          >
            + 選択肢を追加
          </button>

          <div className="qe-item__children">
            <span className="qe-enable-when__title">
              条件付きグループ(特定の選択肢が選ばれたときだけ表示する項目)
            </span>
            {item.children.map((child, childIndex) => (
              <QuestionnaireItemEditor
                key={child.id}
                item={child}
                index={childIndex}
                siblingCount={item.children.length}
                parentChoice={item}
                onUpdate={onUpdate}
                onRemove={onRemove}
                onMove={onMove}
                onAppendChild={onAppendChild}
              />
            ))}
            <button
              type="button"
              className="qe-add-item"
              onClick={() => onAppendChild(item.id)}
              disabled={item.answerOptions.length === 0}
              title={
                item.answerOptions.length === 0 ? "選択肢を追加すると設定できます" : undefined
              }
            >
              + 条件付きグループを追加
            </button>
          </div>
        </div>
      )}

      {isNumeric && (
        <div className="qe-item__grid">
          <label>
            最小値
            <input
              type="number"
              value={item.minValue}
              onChange={(e) => patch({ minValue: e.target.value })}
            />
          </label>
          <label>
            最大値
            <input
              type="number"
              value={item.maxValue}
              onChange={(e) => patch({ maxValue: e.target.value })}
            />
          </label>
          {item.type === "decimal" && (
            <label>
              小数点以下桁数
              <input
                type="number"
                min="0"
                value={item.maxDecimalPlaces}
                onChange={(e) => patch({ maxDecimalPlaces: e.target.value })}
              />
            </label>
          )}
          <label>
            単位(UCUMコード)
            <input
              type="text"
              value={item.unit}
              onChange={(e) => patch({ unit: e.target.value })}
              placeholder="kg, cm, mmHg など"
            />
          </label>
        </div>
      )}

      {isTextual && (
        <div className="qe-item__grid">
          <label>
            最大文字数
            <input
              type="number"
              min="1"
              value={item.maxLength}
              onChange={(e) => patch({ maxLength: e.target.value })}
            />
          </label>
          <label>
            正規表現制約
            <input
              type="text"
              value={item.regex}
              onChange={(e) => patch({ regex: e.target.value })}
              placeholder="例: ^([ -~]|\n|\t)+$"
            />
          </label>
        </div>
      )}

      {hasInitial && (
        <div className="qe-item__grid">
          <label>
            初期値
            <input
              type={INITIAL_INPUT_TYPES[item.type] ?? "text"}
              value={item.initialValue}
              onChange={(e) => patch({ initialValue: e.target.value })}
            />
          </label>
        </div>
      )}

      {isGroup && (
        <div className="qe-item__panel">
          {/* jsp-8: 表示条件付きグループは繰り返し不可 */}
          {!isConditionalGroup && (
            <div className="qe-item__grid">
              <label className="qe-item__checkbox">
                <input
                  type="checkbox"
                  checked={item.repeats}
                  onChange={(e) => patch({ repeats: e.target.checked, maxOccurs: "" })}
                />
                繰り返し入力を許可
              </label>
              {item.repeats && (
                <label>
                  最大繰り返し数
                  <input
                    type="number"
                    min="1"
                    value={item.maxOccurs}
                    onChange={(e) => patch({ maxOccurs: e.target.value })}
                    placeholder="無制限"
                  />
                </label>
              )}
            </div>
          )}

          {/* 表示条件は親 choice の回答との一致のみ(jsp-2: 参照先は親、演算子は "=" 固定) */}
          {parentChoice && (
            <div className="qe-enable-when">
              <span className="qe-enable-when__title">表示条件</span>
              <div className="qe-enable-when__row">
                <span>{parentChoice.text || parentChoice.linkId}</span>
                <span className="qe-enable-when__operator">=</span>
                <select
                  aria-label="比較値"
                  value={item.enableWhen?.answerCode ?? ""}
                  onChange={(e) => {
                    const option = parentChoice.answerOptions.find((o) => o.code === e.target.value);
                    patch({
                      enableWhen: {
                        answerCode: e.target.value,
                        answerSystem: option?.system ?? "",
                      },
                    });
                  }}
                >
                  <option value="">値を選択</option>
                  {parentChoice.answerOptions.map((option) => (
                    <option key={option.id} value={option.code}>
                      {option.display || option.code}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div className="qe-item__children">
            {item.children.map((child, childIndex) => (
              <QuestionnaireItemEditor
                key={child.id}
                item={child}
                index={childIndex}
                siblingCount={item.children.length}
                parentChoice={null}
                onUpdate={onUpdate}
                onRemove={onRemove}
                onMove={onMove}
                onAppendChild={onAppendChild}
              />
            ))}
            <button type="button" className="qe-add-item" onClick={() => onAppendChild(item.id)}>
              + 子項目を追加
            </button>
          </div>
        </div>
      )}

      <details className="qe-item__advanced">
        <summary>詳細設定</summary>
        <div className="qe-item__grid">
          <label className="qe-item__checkbox">
            <input
              type="checkbox"
              checked={item.hidden}
              onChange={(e) => patch({ hidden: e.target.checked })}
            />
            非表示(hidden)
          </label>
          <label className="qe-item__text-field">
            設計メモ(designNote)
            <input
              type="text"
              value={item.designNote}
              onChange={(e) => patch({ designNote: e.target.value })}
            />
          </label>
          {hasInitial && (
            <>
              <label className="qe-item__text-field">
                初期値式(FHIRPath)
                <input
                  type="text"
                  value={item.initialExpression}
                  onChange={(e) => patch({ initialExpression: e.target.value })}
                  disabled={Boolean(item.calculatedExpression)}
                  placeholder="計算式とは同時に設定できません"
                />
              </label>
              <label className="qe-item__text-field">
                計算式(FHIRPath)
                <input
                  type="text"
                  value={item.calculatedExpression}
                  onChange={(e) => patch({ calculatedExpression: e.target.value })}
                  disabled={Boolean(item.initialExpression)}
                  placeholder="例: %weight / (%height / 100 * %height / 100)"
                />
              </label>
            </>
          )}
        </div>
      </details>

      <details className="qe-item__advanced">
        <summary>拡張設定</summary>
        {isTextual && (
          <div className="qe-item__grid">
            <label>
              医療機関の項目
              <select
                value={item.organizationField}
                disabled={Boolean(item.practitionerField)}
                onChange={(e) =>
                  patch({
                    organizationField: e.target.value,
                    // 入れる値の種類が無くなると自動入力は意味を持たない。
                    ...(e.target.value ? {} : { loginAutofill: false }),
                  })
                }
              >
                <option value="">設定しない</option>
                {ORGANIZATION_FIELD_OPTIONS.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              医療従事者の項目
              <select
                value={item.practitionerField}
                disabled={Boolean(item.organizationField)}
                onChange={(e) =>
                  patch({
                    practitionerField: e.target.value,
                    // 職種の初期値は医療従事者の項目にのみ意味がある。
                    ...(e.target.value ? {} : { practitionerRoleDefault: "", loginAutofill: false }),
                  })
                }
              >
                <option value="">設定しない</option>
                {PRACTITIONER_FIELD_OPTIONS.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {item.practitionerField && (
              <label>
                職種の初期値
                <select
                  value={item.practitionerRoleDefault}
                  onChange={(e) => patch({ practitionerRoleDefault: e.target.value })}
                >
                  <option value="">指定しない</option>
                  {PRACTITIONER_ROLE_OPTIONS.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {(item.organizationField || item.practitionerField) && (
              <label className="qe-item__checkbox">
                <input
                  type="checkbox"
                  checked={item.loginAutofill}
                  onChange={(e) => patch({ loginAutofill: e.target.checked })}
                />
                {item.organizationField
                  ? "ログイン中の医療従事者の所属医療機関から自動入力"
                  : "ログイン中の医療従事者から自動入力"}
              </label>
            )}
            {(item.organizationField || item.practitionerField) && (
              <p className="qe-hint">
                回答画面で、このグループ内に出る「
                {item.organizationField ? "医療機関を選択" : "医療従事者を選択"}
                」ボタンから一括入力されます。
                {item.practitionerField &&
                  "職種の初期値は、選択モーダルの職種フィルタの初期値になります。"}
                {item.loginAutofill &&
                  "自動入力を設定すると、テンプレート登録画面を開いた時点でログイン中の医療従事者の値が入ります(その後の選択・手入力で上書きできます)。"}
              </p>
            )}
          </div>
        )}
        <div className="schema-image">
          <label className="schema-image__label">
            シェーマ画像
            <input type="file" accept="image/*" onChange={handleImageSelect} />
          </label>
          {imageError && <p className="schema-image__error">{imageError}</p>}
          {imageSrc && (
            <div className="schema-image__preview">
              <img className="schema-image__thumb" src={imageSrc} alt="シェーマ画像" />
              <button type="button" onClick={() => patch({ image: null })}>
                画像を削除
              </button>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}
