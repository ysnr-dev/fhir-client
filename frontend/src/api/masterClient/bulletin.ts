import { today } from "../../lib/dates";
import { buildError, masterFetch, type MasterSearchResult } from "./core";

// ---- 掲示板(院内のお知らせ) ----
// 患者に紐付かない施設内の連絡。掲載期間の中にあるものをホームのカードに出し、
// 掲示板の画面では期間外も出す。

export interface BulletinPost {
  id: number;
  title: string;
  body: string;
  /** 一覧の先頭に固定する。 */
  pinned: boolean;
  /** 掲載開始日(YYYY-MM-DD)。省略して投稿すると投稿した日になる。 */
  published_from: string;
  /** 掲載終了日(YYYY-MM-DD)。null は無期限。 */
  published_until: string | null;
  /** 投稿した Practitioner.id。administrator の投稿は null。 */
  author_id: string | null;
  author_name: string | null;
  /** 今日が掲載期間の中にある。 */
  current: boolean;
  /** ログイン中の人が直せる(投稿した本人か administrator)。 */
  editable: boolean;
  created_at: string;
  updated_at: string;
}

export interface BulletinPostPayload {
  title?: string;
  body?: string;
  pinned?: boolean;
  published_from?: string | null;
  published_until?: string | null;
  /** 表示用の投稿者名。投稿者の id はサーバーがログイン本人で埋める。 */
  author_name?: string | null;
}

export interface BulletinPostListParams {
  /** true なら今日掲載中のものだけ。 */
  current?: boolean;
  page?: number;
  per?: number;
}

const BULLETIN_POSTS_PATH = "/master/bulletin_posts";

export async function fetchBulletinPosts(
  params: BulletinPostListParams = {},
): Promise<MasterSearchResult<BulletinPost>> {
  // 「今日」はブラウザの日付で渡す(サーバーの時計は UTC なので朝 9 時前は前日になる)。
  const query = new URLSearchParams({ date: today() });
  if (params.current) query.set("current", "true");
  if (params.page) query.set("page", String(params.page));
  if (params.per) query.set("per", String(params.per));
  const res = await masterFetch(`${BULLETIN_POSTS_PATH}?${query.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<BulletinPost>;
}

export async function createBulletinPost(payload: BulletinPostPayload): Promise<BulletinPost> {
  const res = await masterFetch(BULLETIN_POSTS_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as BulletinPost;
}

export async function updateBulletinPost(
  id: number,
  payload: BulletinPostPayload,
): Promise<BulletinPost> {
  const res = await masterFetch(`${BULLETIN_POSTS_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as BulletinPost;
}

export async function deleteBulletinPost(id: number): Promise<void> {
  const res = await masterFetch(`${BULLETIN_POSTS_PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}
