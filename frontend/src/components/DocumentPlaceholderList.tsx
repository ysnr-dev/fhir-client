import { isKnownPlaceholder } from "../fhir/documentPlaceholders";

// 文書テンプレートのファイルから見つかったプレースホルダーの一覧。
// 変数一覧に無い名前(書き間違い)は差し込まれないので、見分けられるようにする。

export function DocumentPlaceholderList({ tokens }: { tokens: string[] }) {
  if (tokens.length === 0) {
    return <p className="document-placeholders__empty">プレースホルダーがありません。</p>;
  }
  return (
    <ul className="document-placeholders">
      {tokens.map((token) => {
        const known = isKnownPlaceholder(token);
        return (
          <li
            key={token}
            className={
              known
                ? "document-placeholders__item"
                : "document-placeholders__item document-placeholders__item--unknown"
            }
          >
            <code>{`{{${token}}}`}</code>
            {!known && <span>一覧にありません</span>}
          </li>
        );
      })}
    </ul>
  );
}
