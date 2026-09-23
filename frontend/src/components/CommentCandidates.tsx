import { useCommentRelations } from "../api/masterQueries";

/**
 * コメントコードの入力欄に添える候補(datalist)。コメント関連テーブルから、指定した診療行為
 * コードに関係するコメントを並べる。入力欄は `list={id}` でこれを指す。
 *
 * 候補は絞り込みではなく案内で、表に無いコードも入力できる(表に無い組合せが正しいこともある)。
 * 条件区分は「算定したら要る」だけ印を付け、それ以外(記載要領の文言で決まる条件など)は
 * 候補として並べるだけにする。
 */
export function CommentCandidates({ id, procedureCodes }: { id: string; procedureCodes: string[] }) {
  const relations = useCommentRelations(procedureCodes);
  const seen = new Set<string>();

  return (
    <datalist id={id}>
      {relations.items.map((relation) => {
        if (seen.has(relation.comment_code)) return null;
        seen.add(relation.comment_code);
        const required = relation.condition_category === "01" ? "〔算定時に要る〕" : "";
        return (
          <option key={relation.comment_code} value={relation.comment_code}>
            {`${relation.comment_text ?? ""}${required}`}
          </option>
        );
      })}
    </datalist>
  );
}
