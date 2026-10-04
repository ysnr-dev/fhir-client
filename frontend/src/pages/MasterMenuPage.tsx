import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toKatakana } from "../lib/kana";
import { MASTER_MENU, type MasterMenuGroup } from "../masterMenu";

// かなの違い(ひらがな・カタカナ)と英字の大小を問わずに比べるための形にする。
function normalize(text: string): string {
  return toKatakana(text).toLowerCase();
}

// 領域名に当たればその領域をまるごと、項目名に当たればその項目だけを残す。
function filterGroups(groups: MasterMenuGroup[], query: string): MasterMenuGroup[] {
  const needle = normalize(query.trim());
  if (!needle) return groups;
  return groups.flatMap((group) => {
    if (normalize(group.label).includes(needle)) return [group];
    const items = group.items.filter((item) => normalize(item.label).includes(needle));
    return items.length > 0 ? [{ ...group, items }] : [];
  });
}

// マスタメンテの入口。全マスタを領域ごとのカードに並べる。項目が多くヘッダのメニューには
// 収まらないので、画面の大きさに合わせて段が減り、足りなければ縦に送れるページにしている。
// 同じ名前の項目(実施入力データセットなど)が領域をまたいであるので、領域の見出しは常に出す。
export function MasterMenuPage() {
  const [query, setQuery] = useState("");
  const groups = useMemo(() => filterGroups(MASTER_MENU, query), [query]);

  useEffect(() => {
    document.body.classList.add("page-wide-md");
    return () => document.body.classList.remove("page-wide-md");
  }, []);

  return (
    <div className="page master-hub">
      <div className="page__header">
        <h1>マスタメンテ</h1>
        <input
          type="search"
          className="master-hub__filter"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="絞り込み"
          aria-label="絞り込み"
          autoFocus
        />
      </div>

      {groups.length === 0 ? (
        <p className="master-hub__empty">該当するマスタがありません。</p>
      ) : (
        <div className="master-hub__groups">
          {groups.map((group) => (
            <section key={group.label} className="master-hub__group">
              <h2>{group.label}</h2>
              <ul>
                {group.items.map((item) => (
                  <li key={item.to}>
                    <Link to={item.to}>{item.label}</Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
