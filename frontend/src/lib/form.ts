import type { Dispatch, SetStateAction } from "react";

/** フォーム state から「1項目だけ差し替える update(key, value)」を作る。 */
export function makeFieldUpdater<T>(setState: Dispatch<SetStateAction<T>>) {
  return <K extends keyof T>(key: K, value: T[K]) => {
    setState((v) => ({ ...v, [key]: value }));
  };
}

let nextDraftKey = 1;
/** 行の React key。保存済みの id とは無関係で、画面を開いている間だけ一意。 */
export function newDraftKey(): number {
  return nextDraftKey++;
}

/** 入力欄の文字列を数値にする。空欄と数値として読めない値は null。 */
export function numOrNull(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/** 入力欄の文字列。空欄(空白だけ)は null。 */
export function textOrNull(text: string): string | null {
  return text.trim() === "" ? null : text;
}

/** 保存済みの値を入力欄の文字列にする。null・undefined は空文字。 */
export function inputText(value: string | number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}
