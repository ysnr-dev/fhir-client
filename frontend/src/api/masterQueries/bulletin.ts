import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type BulletinPostListParams,
  type BulletinPostPayload,
  createBulletinPost,
  deleteBulletinPost,
  fetchBulletinPosts,
  updateBulletinPost,
} from "../masterClient";

// ---- 掲示板(院内のお知らせ) ----

const BULLETIN_POSTS_KEY = ["master", "bulletin_posts"];

// ホームのカードと掲示板の画面が同じキーの下に乗るので、投稿すると両方が引き直される。
export function useBulletinPosts(params: BulletinPostListParams = {}) {
  return useQuery({
    queryKey: [...BULLETIN_POSTS_KEY, "list", params],
    queryFn: () => fetchBulletinPosts(params),
    staleTime: 60 * 1000,
  });
}

export function useBulletinPostMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: BULLETIN_POSTS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: BulletinPostPayload) => createBulletinPost(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: BulletinPostPayload }) =>
        updateBulletinPost(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteBulletinPost(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}
