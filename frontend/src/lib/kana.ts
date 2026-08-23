// かな文字の判定と変換。IME が変換前に見せる読みからカナ氏名を作るのに使う。

// ひらがな・カタカナと長音符・濁点。変換前の読みはこの範囲に収まる。
const KANA_ONLY = /^[ぁ-ゖァ-ヺー゛゜]+$/;

/** 変換前の読み(かなだけ)かどうか。漢字や英数が混ざっていれば false。 */
export function isKanaOnly(text: string): boolean {
  return text.length > 0 && KANA_ONLY.test(text);
}

/** ひらがなをカタカナにする。カタカナ・長音符はそのまま。 */
export function toKatakana(text: string): string {
  return text.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
}
