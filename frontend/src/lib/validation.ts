/**
 * フォームの入力検証で最初に落ちた項目。
 *
 * `field` はフォームごとの項目の鍵で、`useValidationError` に文言と一緒に渡すと
 * 該当項目のラベルに印が出る(`components/FieldAlert`)。検証の規則は
 * 「values を受けて最初の失敗を返す純粋関数」にまとめ、登録時に弾くのと、
 * 弾いた項目が直されたかを表示側で見るのとで同じ規則を使う。
 */
export type ValidationFailure<Field extends string = string> = {
  field: Field;
  message: string;
};
