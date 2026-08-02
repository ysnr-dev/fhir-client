import { useEffect, useRef, useState } from "react";
import {
  QR_STATUS_OPTIONS,
  validateQuestionnaireResponseMeta,
  type QuestionnaireResponseMetaValues,
  type QuestionnaireResponseStatus,
} from "../fhir/questionnaireResponseHelpers";

interface QuestionnaireResponseMetaFieldsProps {
  values: QuestionnaireResponseMetaValues;
  onChange: (values: QuestionnaireResponseMetaValues) => void;
}

function statusLabel(status: QuestionnaireResponseStatus): string {
  return QR_STATUS_OPTIONS.find((option) => option.code === status)?.label ?? status;
}

// テンプレート回答の登録情報(ステータス・記入者・保険医療機関番号)。
// QuestionnaireResponseForm の children としてフォーム先頭に描画する。
// 初期値が揃っていれば折り畳んで表示し、テンプレート項目の入力を妨げない。
export function QuestionnaireResponseMetaFields({
  values,
  onChange,
}: QuestionnaireResponseMetaFieldsProps) {
  const complete = validateQuestionnaireResponseMeta(values) === null;
  const [open, setOpen] = useState(!complete);
  // ユーザーが開閉または編集したら、以降は自動で閉じない。
  const pinned = useRef(false);

  // 記入者名はログイン中の医療従事者の取得後(マウントの1テンポ後)に入る場合がある。
  // 揃った時点で閉じる。
  useEffect(() => {
    if (pinned.current || !complete) return;
    setOpen(false);
  }, [complete]);

  function update<K extends keyof QuestionnaireResponseMetaValues>(
    key: K,
    value: QuestionnaireResponseMetaValues[K],
  ) {
    pinned.current = true;
    onChange({ ...values, [key]: value });
  }

  return (
    <details
      className="qp-group qp-meta"
      open={open}
      onToggle={(e) => {
        pinned.current = true;
        setOpen(e.currentTarget.open);
      }}
    >
      <summary className="qp-meta__summary">
        登録情報
        {!open &&
          (complete ? (
            <span className="qp-meta__digest">
              {[statusLabel(values.status), values.authorName, values.institutionNumber].join(" / ")}
            </span>
          ) : (
            <span className="qp-meta__digest qp-meta__digest--warn">必須項目が未入力です</span>
          ))}
      </summary>
      <div className="qp-meta__body">
        <div className="qp-field">
          <label>
            <span className="qp-field__label">
              ステータス
              <span className="qp-field__required">必須</span>
            </span>
            <select
              value={values.status}
              onChange={(e) => update("status", e.target.value as QuestionnaireResponseStatus)}
            >
              {QR_STATUS_OPTIONS.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="qp-field">
          <label>
            <span className="qp-field__label">
              記入者名
              <span className="qp-field__required">必須</span>
            </span>
            {/* 折り畳み中は required がブラウザのフォーカス移動に失敗するため、
                必須判定は validateQuestionnaireResponseMeta に任せる。 */}
            <input
              type="text"
              value={values.authorName}
              onChange={(e) => update("authorName", e.target.value)}
            />
          </label>
        </div>
        <div className="qp-field">
          <label>
            <span className="qp-field__label">
              保険医療機関番号
              <span className="qp-field__required">必須</span>
            </span>
            <input
              type="text"
              value={values.institutionNumber}
              maxLength={10}
              onChange={(e) => update("institutionNumber", e.target.value)}
            />
          </label>
          <p className="qp-field__note">
            10桁の数字(都道府県2桁 + 点数表1桁 + 医療機関コード7桁)。
          </p>
        </div>
      </div>
    </details>
  );
}
