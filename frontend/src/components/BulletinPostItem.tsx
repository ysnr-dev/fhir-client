import { useState } from "react";
import type { BulletinPost } from "../api/masterClient";
import { today } from "../lib/dates";

interface BulletinPostItemProps {
  post: BulletinPost;
  /** ホームのカード向け。長い本文は畳んで「続き」で開く。 */
  compact?: boolean;
  /** 直せる投稿に「編集」を出す。省略すると出さない。 */
  onEdit?: (post: BulletinPost) => void;
}

// 畳むかどうかの目安。行数か文字数のどちらかを超えたら畳む。
const COMPACT_LINES = 3;
const COMPACT_CHARS = 160;

/** 掲載期間の外にある投稿の印。掲載中は空。 */
export function bulletinStatusLabel(post: BulletinPost): string {
  if (post.current) return "";
  return post.published_from > today() ? "掲載前" : "掲載終了";
}

function periodLabel(post: BulletinPost): string {
  return post.published_until ? `${post.published_from} 〜 ${post.published_until}` : post.published_from;
}

// 掲示板の投稿 1 件。ホームのカードと掲示板の画面で同じ見た目にする。
export function BulletinPostItem({ post, compact = false, onEdit }: BulletinPostItemProps) {
  const [expanded, setExpanded] = useState(false);
  const status = bulletinStatusLabel(post);
  const foldable =
    compact && (post.body.split("\n").length > COMPACT_LINES || post.body.length > COMPACT_CHARS);
  const folded = foldable && !expanded;

  return (
    <article
      className={`bulletin__post${post.pinned ? " bulletin__post--pinned" : ""}${
        status ? " bulletin__post--inactive" : ""
      }`}
    >
      <div className="bulletin__post-header">
        {post.pinned && <span className="bulletin__badge bulletin__badge--pinned">固定</span>}
        {status && <span className="bulletin__badge">{status}</span>}
        <h3 className="bulletin__post-title">{post.title}</h3>
        <span className="bulletin__post-meta">
          <span>{periodLabel(post)}</span>
          {post.author_name && <span>{post.author_name}</span>}
        </span>
        {onEdit && post.editable && (
          <button type="button" className="bulletin__post-edit" onClick={() => onEdit(post)}>
            編集
          </button>
        )}
      </div>
      {post.body && (
        <p className={`bulletin__post-body${folded ? " bulletin__post-body--folded" : ""}`}>
          {post.body}
        </p>
      )}
      {foldable && (
        <button
          type="button"
          className="bulletin__post-toggle"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "閉じる" : "続き"}
        </button>
      )}
    </article>
  );
}
