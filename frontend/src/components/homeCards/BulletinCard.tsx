import { useState } from "react";
import { Link } from "react-router-dom";
import type { BulletinPost } from "../../api/masterClient";
import { useBulletinPosts } from "../../api/masterQueries";
import { BulletinPostItem } from "../BulletinPostItem";
import { BulletinPostModal } from "../BulletinPostModal";
import { ErrorBanner } from "../ErrorBanner";
import { HomeCardFrame, HomeCardLoading } from "./shared";

const BULLETIN_ROWS = 5;

/** 掲示板。今日掲載中の投稿だけを、固定を先頭に新しい順で数件。 */
export function BulletinCard() {
  const posts = useBulletinPosts({ current: true, per: BULLETIN_ROWS });
  const [editing, setEditing] = useState<BulletinPost | "new" | null>(null);
  const items = posts.data?.items ?? [];
  const rest = (posts.data?.total ?? 0) - items.length;

  return (
    <HomeCardFrame
      title="掲示板"
      link={{ to: "/bulletin", label: "すべて見る" }}
      actions={
        <button type="button" onClick={() => setEditing("new")}>
          投稿
        </button>
      }
    >
      <ErrorBanner error={posts.error} />
      {posts.isPending ? (
        <HomeCardLoading />
      ) : items.length === 0 ? (
        <p className="home__empty">掲載中のお知らせはありません。</p>
      ) : (
        <div className="bulletin__list bulletin__list--compact">
          {items.map((post) => (
            <BulletinPostItem key={post.id} post={post} compact onEdit={setEditing} />
          ))}
        </div>
      )}
      {rest > 0 && (
        <p className="home__more">
          <Link to="/bulletin">他 {rest} 件</Link>
        </p>
      )}
      {editing !== null && (
        <BulletinPostModal post={editing === "new" ? null : editing} onClose={() => setEditing(null)} />
      )}
    </HomeCardFrame>
  );
}
