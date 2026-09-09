import { useCallback, useState } from "react";

// 取り消し・やり直しができる状態。スナップショット方式(操作ごとに値を丸ごと積む)。
// 病棟マップのレイアウトのように値が小さく、操作の逆演算を書くより確実なものに使う。
// 履歴も state に持つ(updater の中で ref を触ると StrictMode の二重呼び出しで
// 二重に積まれる)。

const MAX_HISTORY = 100;

interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

export function useUndoableState<T>(initial: T) {
  const [history, setHistory] = useState<History<T>>({ past: [], present: initial, future: [] });

  /**
   * 値を置き換える。record=true なら今の値を履歴に積む(ドラッグ中の途中経過は
   * record=false で置き、離したときだけ積む)。
   */
  const set = useCallback((next: T | ((current: T) => T), options: { record?: boolean } = {}) => {
    setHistory((current) => {
      const value = typeof next === "function" ? (next as (current: T) => T)(current.present) : next;
      if (value === current.present) return current;
      if (!options.record) return { ...current, present: value };
      return {
        past: [...current.past.slice(-(MAX_HISTORY - 1)), current.present],
        present: value,
        future: [],
      };
    });
  }, []);

  /**
   * before から after への変更として 1 手に記録する。ドラッグのように途中経過を
   * record=false で置いてきたあと、掴む前の値を履歴に積むために使う。
   */
  const commit = useCallback((before: T, after: T) => {
    setHistory((current) => {
      if (before === after) return { ...current, present: after };
      return {
        past: [...current.past.slice(-(MAX_HISTORY - 1)), before],
        present: after,
        future: [],
      };
    });
  }, []);

  const undo = useCallback(() => {
    setHistory((current) => {
      if (current.past.length === 0) return current;
      const previous = current.past[current.past.length - 1];
      return {
        past: current.past.slice(0, -1),
        present: previous,
        future: [current.present, ...current.future],
      };
    });
  }, []);

  const redo = useCallback(() => {
    setHistory((current) => {
      if (current.future.length === 0) return current;
      const [next, ...rest] = current.future;
      return { past: [...current.past, current.present], present: next, future: rest };
    });
  }, []);

  /** 履歴ごと値を置き換える(サーバー値へ破棄するとき)。 */
  const reset = useCallback((value: T) => {
    setHistory({ past: [], present: value, future: [] });
  }, []);

  return {
    present: history.present,
    set,
    commit,
    undo,
    redo,
    reset,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
  };
}
