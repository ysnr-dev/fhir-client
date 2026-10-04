import { useState } from "react";

interface SnapshotSource {
  data: unknown;
  error: unknown;
  isLoading: boolean;
  isFetching: boolean;
}

/**
 * 編集フォームの元データを、開いた時点の内容(版)に固定する。
 *
 * クエリは窓に戻ったときやほかの書き込みの後に読み直され、そのたびに版(ETag / meta.versionId)が
 * 進む。フォームは入力を持ったままなので、読み直した版で保存すると、その間のほかの人の変更を
 * 見ないまま上書きしてしまう(楽観ロックが効かない)。そこで最初に読み終えた結果を持ち続け、
 * 以降の読み直しは無視する。キャッシュが古くて読み直しているあいだは読み込み中として返し、
 * 古い内容でフォームを開かせない。
 *
 * 編集を開くたびに付け直される部品(EditPanel / EditForm / 編集ページ)で使うこと。保存後も
 * 付いたままの部品で使うと、固定した版が古いままになり次の保存が 412 になる。
 * key(編集対象の id)が変わったら取り直す。同じ hook を表示用にも使う場合は enabled を false にして
 * クエリをそのまま返す(読み直しに追随する)。
 */
export function useEditSnapshot<Q extends SnapshotSource>(
  query: Q,
  key: string | undefined,
  enabled = true,
): Q {
  const [taken, setTaken] = useState<{ key: string | undefined; data: Q["data"] } | null>(null);
  if (!enabled) return query;

  let snapshot = taken && taken.key === key ? taken : null;
  if (!snapshot && query.data !== undefined && !query.isFetching) {
    snapshot = { key, data: query.data };
    setTaken(snapshot);
  }

  if (snapshot) return { ...query, data: snapshot.data, error: null, isLoading: false };
  return { ...query, data: undefined, isLoading: query.isLoading || query.isFetching };
}
