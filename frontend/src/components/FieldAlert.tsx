import type { ReactNode } from "react";
import type { ValidationFailure } from "../lib/validation";

/**
 * 必須チェックで弾かれた項目の印。
 *
 * エラーバナーはフォームの先頭に出るだけなので、長いフォームではどの欄を直せばよいか
 * 探すことになる。弾いた項目のラベルの文字の右に警告アイコンを置き、入力欄を赤枠にして
 * その場で気付けるようにする。文言はアイコンの吹き出し(title)にも出す。
 *
 * 使い方: `useValidationError` の 4 つ目(項目の鍵)と文言を `useFieldAlert` に渡し、
 * 各ラベルの文字を `label(鍵, 文字)` で包み、ラベル要素に `className(鍵)` を付ける。
 * 文言は `shownValidationError` で「弾いた項目がまだ直っていないときだけ」に絞る。
 */
export function FieldAlertIcon({ message }: { message: string }) {
  return (
    <span className="field-alert" role="img" title={message} aria-label={message}>
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
        <path
          d="M8 1.8 15 14H1z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <path d="M8 6v3.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="8" cy="11.8" r="0.9" fill="currentColor" />
      </svg>
    </span>
  );
}

export function useFieldAlert<Field extends string>(
  invalidField: Field | null,
  message: string | null,
) {
  const active = (field: Field) => invalidField === field && message !== null;
  return {
    /** ラベル要素に付ける class。入力欄を赤枠にする。 */
    className: (field: Field, base?: string) =>
      [base, active(field) ? "field-alert__field" : undefined].filter(Boolean).join(" ") ||
      undefined,
    /** ラベルの文字。弾かれていればアイコンを添える。 */
    label: (field: Field, text: ReactNode) => (
      <span className="field-alert__label">
        {text}
        {active(field) && message && <FieldAlertIcon message={message} />}
      </span>
    ),
    /** アイコンだけ(見出しや空欄の案内文の横に置く)。 */
    icon: (field: Field) =>
      active(field) && message ? <FieldAlertIcon message={message} /> : null,
  };
}

/** `useFieldAlert` の戻り値。印の出し先を別コンポーネントに渡すときの props の型。 */
export type FieldAlert<Field extends string> = ReturnType<typeof useFieldAlert<Field>>;

/**
 * バナーと印に出す文言。弾いた項目が直された(今の値で同じ項目が同じ文言で落ちなくなった)ら
 * 消す。同じ項目でも別の文言に変わったときは直したと見なし、次の登録で新しい文言が出る。
 * 鍵なしで出した文言(警告の差し止めなど)は次の登録までそのまま出す。
 */
export function shownValidationError<Field extends string>(
  message: string | null,
  invalidField: Field | null,
  liveFailure: ValidationFailure<Field> | null,
): string | null {
  if (!invalidField) return message;
  if (liveFailure?.field !== invalidField || liveFailure.message !== message) return null;
  return message;
}
