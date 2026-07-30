import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createOauthClient,
  createReportLayout,
  deleteOauthClient,
  deleteReportLayout,
  fetchAdminSession,
  fetchConnectionSettings,
  fetchOauthClients,
  fetchReportLayouts,
  fetchScopeOptions,
  login,
  logout,
  testConnection,
  updateConnectionSettings,
  updateReportLayout,
  type ConnectionSettingsUpdate,
  type NewOauthClient,
  type ReportLayoutPayload,
} from "./adminClient";

const CONNECTION_SETTINGS_KEY = ["admin", "connection_settings"];
export const ADMIN_SESSION_KEY = ["admin", "session"];
const OAUTH_CLIENTS_KEY = ["admin", "oauth_clients"];
const SCOPE_OPTIONS_KEY = ["admin", "scope_options"];
const REPORT_LAYOUTS_KEY = ["admin", "report_layouts"];

// 管理系はすべて retry: false。自動リトライされた 401 は上流 fhir-server の
// レート制限(admin/ip)を無駄に消費するだけで、状況を改善しない。

export function useAdminSession() {
  return useQuery({
    queryKey: ADMIN_SESSION_KEY,
    queryFn: fetchAdminSession,
    retry: false,
    staleTime: 60_000,
  });
}

export function useAdminLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => login(token),
    retry: false,
    onSuccess: (session) => {
      queryClient.setQueryData(ADMIN_SESSION_KEY, session);
      // ログイン前に 401 で失敗したクエリを引き直す
      queryClient.invalidateQueries({ queryKey: ["admin"] });
    },
  });
}

export function useAdminLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => logout(),
    retry: false,
    onSuccess: (session) => {
      queryClient.setQueryData(ADMIN_SESSION_KEY, session);
      queryClient.removeQueries({ queryKey: OAUTH_CLIENTS_KEY });
      queryClient.removeQueries({ queryKey: CONNECTION_SETTINGS_KEY });
    },
  });
}

export function useConnectionSettings() {
  return useQuery({
    queryKey: CONNECTION_SETTINGS_KEY,
    queryFn: fetchConnectionSettings,
    retry: false,
  });
}

export function useUpdateConnectionSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: ConnectionSettingsUpdate) => updateConnectionSettings(payload),
    retry: false,
    onSuccess: (data) => {
      queryClient.setQueryData(CONNECTION_SETTINGS_KEY, data);
    },
  });
}

// 接続テストは Render コールドスタート時に最大 ~90 秒かかり得る。
export function useTestConnection() {
  return useMutation({
    mutationFn: () => testConnection(),
    retry: false,
  });
}

export function useOauthClients() {
  return useQuery({
    queryKey: OAUTH_CLIENTS_KEY,
    queryFn: fetchOauthClients,
    retry: false,
  });
}

// 対応リソース型とラベルは実質固定なので、セッション中は取り直さない。
export function useScopeOptions() {
  return useQuery({
    queryKey: SCOPE_OPTIONS_KEY,
    queryFn: fetchScopeOptions,
    retry: false,
    staleTime: Infinity,
  });
}

export function useCreateOauthClient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: NewOauthClient) => createOauthClient(payload),
    retry: false,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: OAUTH_CLIENTS_KEY });
    },
  });
}

export function useDeleteOauthClient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (clientId: string) => deleteOauthClient(clientId),
    retry: false,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: OAUTH_CLIENTS_KEY });
    },
  });
}

export function useReportLayouts() {
  return useQuery({
    queryKey: REPORT_LAYOUTS_KEY,
    queryFn: fetchReportLayouts,
    retry: false,
  });
}

export function useCreateReportLayout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: ReportLayoutPayload) => createReportLayout(payload),
    retry: false,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: REPORT_LAYOUTS_KEY });
    },
  });
}

export function useUpdateReportLayout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<ReportLayoutPayload> }) =>
      updateReportLayout(id, payload),
    retry: false,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: REPORT_LAYOUTS_KEY });
    },
  });
}

export function useDeleteReportLayout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteReportLayout(id),
    retry: false,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: REPORT_LAYOUTS_KEY });
    },
  });
}
