import type { Dispatch, SetStateAction } from "react";

/** フォーム state から「1項目だけ差し替える update(key, value)」を作る。 */
export function makeFieldUpdater<T>(setState: Dispatch<SetStateAction<T>>) {
  return <K extends keyof T>(key: K, value: T[K]) => {
    setState((v) => ({ ...v, [key]: value }));
  };
}
