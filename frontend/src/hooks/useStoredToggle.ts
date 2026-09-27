import { useCallback, useEffect, useState } from "react";

// 端末ごとに覚えておく入り切りの設定(自動更新など)。localStorage にキーごとに持つ。
//
// 同じタブの中で同じキーを購読している箇所(ヘッダーのベルと通知一覧など)に、
// 切り替えを配る。

const listeners = new Map<string, Set<() => void>>();

function read(key: string): boolean {
  try {
    return localStorage.getItem(key) === "on";
  } catch {
    // localStorage が使えない環境では切ったままにする。
    return false;
  }
}

function write(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? "on" : "off");
  } catch {
    // 保存できなくてもその場の切り替えは有効にする。
  }
  for (const listener of listeners.get(key) ?? []) listener();
}

/** 既定は切った状態。 */
export function useStoredToggle(key: string): [boolean, (value: boolean) => void] {
  const [on, setOn] = useState(() => read(key));

  useEffect(() => {
    function sync() {
      setOn(read(key));
    }
    let set = listeners.get(key);
    if (!set) {
      set = new Set();
      listeners.set(key, set);
    }
    set.add(sync);
    return () => {
      set.delete(sync);
    };
  }, [key]);

  const update = useCallback(
    (value: boolean) => {
      write(key, value);
      setOn(value);
    },
    [key],
  );

  return [on, update];
}
