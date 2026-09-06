import { useCallback, useRef } from "react";

// 縦に積んだ複数のオーダーフォームを外から一括 submit して、各フォームが onSubmit に
// 返した値を集めるフック。オーダーセットの登録画面(患者なし)と適用パネル(患者あり)が
// 共有する。
//
// 仕組み: form.requestSubmit() は submit イベントを同期的に発火し、React のハンドラ
// (各フォームの handleSubmit → 検証 → onSubmit)もその呼び出しの中で同期に走る。
// なので for ループで requestSubmit() を呼び、onSubmit から collect() された値を ref の
// Map に貯めれば、ループを抜けた時点で全件そろっている(await は要らない)。
// フォームは検証に落ちたとき onSubmit を呼ばないので、Map に無いキー = 検証に落ちた
// エントリ。1 件でも欠けたら submitAll は null を返し、呼び出し側は登録を中止する。
//
// 折りたたんだ・除外したエントリもアンマウントせず hidden で隠すこと(アンマウント
// すると入力中の値が消える)。display:none の form でも requestSubmit() は動く。

export interface SubmittedValues {
  values: unknown;
  /** onSubmit の 2 番目以降の引数(放射線などの即実施・予約)。 */
  extra: unknown[];
}

/** submitAll の結果。検証に落ちたエントリがあれば failedKey にその最初の 1 件。 */
export type SubmitAllResult<K> =
  | { ok: true; collected: Map<K, SubmittedValues> }
  | { ok: false; failedKey: K };

export interface StackedOrderForms<K extends string | number> {
  /** 各エントリの入れ物 div に渡す ref コールバック。 */
  registerContainer: (key: K) => (el: HTMLDivElement | null) => void;
  /** keys の順に requestSubmit し、集まった値を返す。1 件でも欠けたら失敗。 */
  submitAll: (keys: K[]) => SubmitAllResult<K>;
  /** 各フォームの onSubmit に仕込む収集口。 */
  collect: (key: K, values: unknown, ...extra: unknown[]) => void;
  /** 検証に落ちたエントリまでスクロールする。 */
  scrollTo: (key: K) => void;
}

export function useStackedOrderForms<K extends string | number>(): StackedOrderForms<K> {
  const containers = useRef(new Map<K, HTMLDivElement>());
  const collected = useRef(new Map<K, SubmittedValues>());

  const registerContainer = useCallback(
    (key: K) => (el: HTMLDivElement | null) => {
      if (el) containers.current.set(key, el);
      else containers.current.delete(key);
    },
    [],
  );

  const collect = useCallback((key: K, values: unknown, ...extra: unknown[]) => {
    collected.current.set(key, { values, extra });
  }, []);

  const submitAll = useCallback((keys: K[]): SubmitAllResult<K> => {
    collected.current = new Map();
    for (const key of keys) {
      const form = containers.current.get(key)?.querySelector("form");
      // 入れ物が無い(描画されていない)エントリは検証できないので欠け扱いにする。
      form?.requestSubmit();
      if (!collected.current.has(key)) return { ok: false, failedKey: key };
    }
    return { ok: true, collected: collected.current };
  }, []);

  const scrollTo = useCallback((key: K) => {
    // 自動化環境では smooth スクロールが動かないため既定の挙動で寄せる。
    containers.current.get(key)?.scrollIntoView({ block: "start" });
  }, []);

  return { registerContainer, submitAll, collect, scrollTo };
}
