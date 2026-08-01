import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteLoginAccount,
  fetchAuthSession,
  fetchLoginAccount,
  login,
  logout,
  upsertLoginAccount,
} from "./authClient";
import { usePractitioner } from "./queries";

export const AUTH_SESSION_KEY = ["auth", "session"];
const LOGIN_ACCOUNT_KEY = ["auth", "account"];

export function useAuthSession() {
  return useQuery({
    queryKey: AUTH_SESSION_KEY,
    queryFn: fetchAuthSession,
    retry: false,
    staleTime: 60_000,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ loginId, password }: { loginId: string; password: string }) =>
      login(loginId, password),
    retry: false,
    onSuccess: (session) => {
      queryClient.setQueryData(AUTH_SESSION_KEY, session);
      // ログイン前に 401 で失敗したクエリを引き直す
      queryClient.invalidateQueries();
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => logout(),
    retry: false,
    onSuccess: (session) => {
      queryClient.setQueryData(AUTH_SESSION_KEY, session);
      // 取得済みデータを次のログインユーザーに見せない。セッション状態だけ残す。
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "auth" });
    },
  });
}

/**
 * ログイン中のユーザーと、紐付く上流 Practitioner リソース。
 * 処方オーダー登録時の依頼者(requester)などに使う想定。
 * administrator や未ログイン(認証不要モード)では practitioner は null。
 */
export function useCurrentPractitioner() {
  const session = useAuthSession();
  const practitionerId = session.data?.user?.practitioner_id ?? undefined;
  const practitioner = usePractitioner(practitionerId);

  return {
    user: session.data?.user ?? null,
    practitionerId: practitionerId ?? null,
    practitioner: practitioner.data?.data ?? null,
  };
}

// --- 医療従事者のログインアカウント(医療従事者登録ページ用) -----------------

export function useLoginAccount(practitionerId: string | undefined) {
  return useQuery({
    queryKey: [...LOGIN_ACCOUNT_KEY, practitionerId],
    queryFn: () => fetchLoginAccount(practitionerId as string),
    enabled: Boolean(practitionerId),
    retry: false,
  });
}

export function useUpsertLoginAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { practitionerId: string; loginId: string; password?: string }) =>
      upsertLoginAccount(payload),
    retry: false,
    onSuccess: (account, variables) => {
      queryClient.setQueryData([...LOGIN_ACCOUNT_KEY, variables.practitionerId], account);
    },
  });
}

export function useDeleteLoginAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (practitionerId: string) => deleteLoginAccount(practitionerId),
    retry: false,
    onSuccess: (account, practitionerId) => {
      queryClient.setQueryData([...LOGIN_ACCOUNT_KEY, practitionerId], account);
    },
  });
}
