import { useState, type FormEvent } from "react";
import { useCurrentPractitioner } from "../api/authQueries";
import type { BulletinPost } from "../api/masterClient";
import { useBulletinPostMutations } from "../api/masterQueries";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { today } from "../lib/dates";

interface BulletinPostModalProps {
  /** null は新規投稿。 */
  post: BulletinPost | null;
  onClose: () => void;
}

// 掲示板の投稿・編集。投稿者の id はサーバーがログイン本人で埋めるので、ここは表示名だけ送る。
export function BulletinPostModal({ post, onClose }: BulletinPostModalProps) {
  const mutations = useBulletinPostMutations();
  const { user, practitioner } = useCurrentPractitioner();
  const [draft, setDraft] = useState({
    title: post?.title ?? "",
    body: post?.body ?? "",
    pinned: post?.pinned ?? false,
    publishedFrom: post?.published_from ?? today(),
    publishedUntil: post?.published_until ?? "",
  });

  const authorName = practitioner
    ? practitionerDisplayName(practitioner)
    : user?.administrator
      ? "管理者"
      : (user?.login_id ?? null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!draft.title.trim()) return;

    const payload = {
      title: draft.title.trim(),
      body: draft.body,
      pinned: draft.pinned,
      published_from: draft.publishedFrom || null,
      published_until: draft.publishedUntil || null,
    };
    if (post === null) {
      await mutations.create.mutateAsync({ ...payload, author_name: authorName });
    } else {
      await mutations.update.mutateAsync({ id: post.id, payload });
    }
    onClose();
  }

  async function handleDelete() {
    if (post === null) return;
    if (!window.confirm(`「${post.title}」を削除しますか？`)) return;

    await mutations.remove.mutateAsync(post.id);
    onClose();
  }

  return (
    <Modal title={post === null ? "掲示板に投稿" : "投稿を編集"} onClose={onClose}>
      <form onSubmit={handleSubmit} className="bulletin-form">
        <div className="lab-order-item__fields">
          <label className="bulletin-form__title">
            件名
            <input
              type="text"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              maxLength={200}
              required
              autoFocus
            />
          </label>
          <label className="bulletin-form__body">
            本文
            <textarea
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              rows={8}
              maxLength={10000}
            />
          </label>
          <label>
            掲載開始日
            <input
              type="date"
              value={draft.publishedFrom}
              onChange={(e) => setDraft({ ...draft, publishedFrom: e.target.value })}
              required
            />
          </label>
          <label>
            掲載終了日
            <input
              type="date"
              value={draft.publishedUntil}
              min={draft.publishedFrom || undefined}
              onChange={(e) => setDraft({ ...draft, publishedUntil: e.target.value })}
            />
          </label>
          <label className="bulletin-form__check">
            <input
              type="checkbox"
              checked={draft.pinned}
              onChange={(e) => setDraft({ ...draft, pinned: e.target.checked })}
            />
            先頭に固定
          </label>
        </div>

        <ErrorBanner
          error={mutations.create.error ?? mutations.update.error ?? mutations.remove.error}
        />

        <div className="lab-order-item__actions">
          <button type="submit" disabled={mutations.create.isPending || mutations.update.isPending}>
            {post === null ? "投稿" : "保存"}
          </button>
          {post !== null && (
            <button type="button" onClick={handleDelete} disabled={mutations.remove.isPending}>
              削除
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
