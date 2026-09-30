import { useState } from "react";
import type { BulletinPost } from "../api/masterClient";
import { useBulletinPosts } from "../api/masterQueries";
import { BulletinPostItem } from "../components/BulletinPostItem";
import { BulletinPostModal } from "../components/BulletinPostModal";
import { ErrorBanner } from "../components/ErrorBanner";

const PER_PAGE = 20;

// 掲示板(院内のお知らせ)。ホームのカードには今日掲載中のものだけが出るのに対し、ここは
// 掲載前・掲載終了も含めて全件を新しい順に並べる。投稿はログインした人なら誰でもできる。
export function BulletinPage() {
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<BulletinPost | "new" | null>(null);
  const list = useBulletinPosts({ page, per: PER_PAGE });

  const items = list.data?.items ?? [];
  const hasNext = list.data ? page * PER_PAGE < list.data.total : false;

  return (
    <div className="page">
      <div className="page__header">
        <h1>掲示板</h1>
        <div className="page__header-actions">
          <button type="button" onClick={() => setEditing("new")}>
            投稿
          </button>
        </div>
      </div>

      <ErrorBanner error={list.error} />

      {list.isPending ? (
        <p>読み込み中...</p>
      ) : items.length === 0 ? (
        <p className="home__empty">投稿はありません。</p>
      ) : (
        <div className="bulletin__list">
          {items.map((post) => (
            <BulletinPostItem key={post.id} post={post} onEdit={setEditing} />
          ))}
        </div>
      )}

      {list.data && list.data.total > PER_PAGE && (
        <div className="master-search__pager">
          <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            前へ
          </button>
          <span>{page}</span>
          <button type="button" disabled={!hasNext} onClick={() => setPage((p) => p + 1)}>
            次へ
          </button>
        </div>
      )}

      {editing !== null && (
        <BulletinPostModal post={editing === "new" ? null : editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
