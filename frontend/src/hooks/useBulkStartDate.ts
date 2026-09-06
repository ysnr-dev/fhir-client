import { useEffect, useRef } from "react";

/**
 * オーダーセットの適用日のように、外から開始日をまとめて入れるための同期。
 *
 * 値が「変わったとき」だけ apply を呼ぶので、フォームの他の入力や、ユーザーが個別に
 * 直した日付は保たれる(同じ値で再描画されても呼ばない)。初期値はフォームの
 * initialValues が既に持っている前提なので、初回は呼ばない。
 */
export function useBulkStartDate(date: string | undefined, apply: (date: string) => void) {
  const applied = useRef(date);
  // apply は毎描画で作り直される関数なので、依存に入れず最新のものを呼ぶ。
  const latest = useRef(apply);
  latest.current = apply;

  useEffect(() => {
    if (!date || applied.current === date) return;
    applied.current = date;
    latest.current(date);
  }, [date]);
}
