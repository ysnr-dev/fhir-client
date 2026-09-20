import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createFileCategory,
  createOauthClient,
  createQuestionnaireCategory,
  createReportLayout,
  deleteFileCategory,
  deleteOauthClient,
  deleteQuestionnaireCategory,
  deleteReportLayout,
  fetchAdminFacilitySettings,
  fetchAdminSession,
  fetchConnectionSettings,
  fetchExternalCodeCandidates,
  fetchExternalCodeMappings,
  fetchExternalSystem,
  fetchExternalSystems,
  fetchFileCategories,
  fetchOauthClients,
  fetchQuestionnaireCategories,
  fetchReportLayout,
  fetchReportLayouts,
  fetchScopeOptions,
  login,
  logout,
  testConnection,
  regenerateInboundToken,
  testExternalSystem,
  updateExternalCodeMappings,
  updateExternalSystem,
  updateAdminFacilitySettings,
  type FacilitySettingsPayload,
  updateConnectionSettings,
  updateFileCategory,
  updateQuestionnaireCategory,
  updateReportLayout,
  type ConnectionSettingsUpdate,
  type ExternalSystemUpdate,
  type FileCategoryPayload,
  type NewOauthClient,
  type QuestionnaireCategoryPayload,
  type ReportLayoutPayload,
} from "./adminClient";

const CONNECTION_SETTINGS_KEY = ["admin", "connection_settings"];
const EXTERNAL_SYSTEMS_KEY = ["admin", "external_systems"];
const EXTERNAL_CODE_MAPPINGS_KEY = ["admin", "external_code_mappings"];
const EXTERNAL_CODE_CANDIDATES_KEY = ["admin", "external_code_candidates"];
const FACILITY_SETTINGS_KEY = ["admin", "facility_settings"];
export const ADMIN_SESSION_KEY = ["admin", "session"];
const OAUTH_CLIENTS_KEY = ["admin", "oauth_clients"];
const SCOPE_OPTIONS_KEY = ["admin", "scope_options"];
const REPORT_LAYOUTS_KEY = ["admin", "report_layouts"];
const QUESTIONNAIRE_CATEGORIES_KEY = ["admin", "questionnaire_categories"];
const FILE_CATEGORIES_KEY = ["admin", "file_categories"];

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

// --- 外部システム連携 ---------------------------------------------------------

export function useExternalSystems() {
  return useQuery({
    queryKey: EXTERNAL_SYSTEMS_KEY,
    queryFn: fetchExternalSystems,
    retry: false,
  });
}

export function useExternalSystem(systemKey: string) {
  return useQuery({
    queryKey: [...EXTERNAL_SYSTEMS_KEY, systemKey],
    queryFn: () => fetchExternalSystem(systemKey),
    enabled: Boolean(systemKey),
    retry: false,
  });
}

export function useUpdateExternalSystem(systemKey: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: ExternalSystemUpdate) => updateExternalSystem(systemKey, payload),
    retry: false,
    onSuccess: (data) => {
      queryClient.setQueryData([...EXTERNAL_SYSTEMS_KEY, systemKey], data);
      // 一覧の有効/無効も同じ行を見ている。
      queryClient.invalidateQueries({ queryKey: EXTERNAL_SYSTEMS_KEY, exact: true });
      // 向き先や資格情報が変われば、外部システム側のコード候補も別物になる。
      queryClient.removeQueries({ queryKey: [...EXTERNAL_CODE_CANDIDATES_KEY, systemKey] });
    },
  });
}

export function useTestExternalSystem(systemKey: string) {
  return useMutation({
    mutationFn: () => testExternalSystem(systemKey),
    retry: false,
  });
}

export function useRegenerateInboundToken(systemKey: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => regenerateInboundToken(systemKey),
    retry: false,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...EXTERNAL_SYSTEMS_KEY, systemKey] });
    },
  });
}

export function useExternalCodeMappings(systemKey: string) {
  return useQuery({
    queryKey: [...EXTERNAL_CODE_MAPPINGS_KEY, systemKey],
    queryFn: () => fetchExternalCodeMappings(systemKey),
    enabled: Boolean(systemKey),
    retry: false,
  });
}

// 対応先の候補は外部システム側のマスタ。連携が無効・未設定なら落ちるので retry しない。
export function useExternalCodeCandidates(systemKey: string, kind: string, enabled: boolean) {
  return useQuery({
    queryKey: [...EXTERNAL_CODE_CANDIDATES_KEY, systemKey, kind],
    queryFn: () => fetchExternalCodeCandidates(systemKey, kind),
    enabled,
    retry: false,
  });
}

export function useUpdateExternalCodeMappings(systemKey: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      kind,
      items,
    }: {
      kind: string;
      items: { local_key: string; external_code: string; label?: string }[];
    }) => updateExternalCodeMappings(systemKey, kind, items),
    retry: false,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...EXTERNAL_CODE_MAPPINGS_KEY, systemKey] });
    },
  });
}

// --- 施設設定 ----------------------------------------------------------------
// 読み取りは全ユーザー向けの useFacilitySettings(api/queries.ts)が別にある。
// 保存したらそちらのキャッシュも捨てて、各画面の所属既定値を追従させる。

export function useAdminFacilitySettings() {
  return useQuery({
    queryKey: FACILITY_SETTINGS_KEY,
    queryFn: fetchAdminFacilitySettings,
    retry: false,
  });
}

export function useUpdateFacilitySettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: FacilitySettingsPayload) => updateAdminFacilitySettings(payload),
    retry: false,
    onSuccess: (data) => {
      queryClient.setQueryData(FACILITY_SETTINGS_KEY, data);
      queryClient.invalidateQueries({ queryKey: ["facility", "settings"] });
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
    queryFn: () => fetchReportLayouts(),
    retry: false,
  });
}

// 編集フォームで mapping 本文を読み込むための詳細取得。
export function useReportLayout(id: number | undefined) {
  return useQuery({
    queryKey: [...REPORT_LAYOUTS_KEY, id],
    queryFn: () => fetchReportLayout(id as number),
    enabled: id !== undefined,
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

// テンプレートカテゴリは選択プルダウン(診療画面)からも読む。件数が少なく
// 変更も稀なので、画面遷移のたびに引き直さないよう staleTime を長めに取る。
export function useQuestionnaireCategories() {
  return useQuery({
    queryKey: QUESTIONNAIRE_CATEGORIES_KEY,
    queryFn: fetchQuestionnaireCategories,
    retry: false,
    staleTime: 5 * 60_000,
  });
}

export function useCreateQuestionnaireCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: QuestionnaireCategoryPayload) => createQuestionnaireCategory(payload),
    retry: false,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUESTIONNAIRE_CATEGORIES_KEY });
    },
  });
}

export function useUpdateQuestionnaireCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: QuestionnaireCategoryPayload }) =>
      updateQuestionnaireCategory(id, payload),
    retry: false,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUESTIONNAIRE_CATEGORIES_KEY });
    },
  });
}

export function useDeleteQuestionnaireCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteQuestionnaireCategory(id),
    retry: false,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUESTIONNAIRE_CATEGORIES_KEY });
    },
  });
}

// ファイルカテゴリもテンプレートカテゴリと同じく、件数が少なく変更も稀なので
// staleTime を長めに取る。
export function useFileCategories() {
  return useQuery({
    queryKey: FILE_CATEGORIES_KEY,
    queryFn: fetchFileCategories,
    retry: false,
    staleTime: 5 * 60_000,
  });
}

export function useCreateFileCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: FileCategoryPayload) => createFileCategory(payload),
    retry: false,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: FILE_CATEGORIES_KEY });
    },
  });
}

export function useUpdateFileCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: FileCategoryPayload }) =>
      updateFileCategory(id, payload),
    retry: false,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: FILE_CATEGORIES_KEY });
    },
  });
}

export function useDeleteFileCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteFileCategory(id),
    retry: false,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: FILE_CATEGORIES_KEY });
    },
  });
}
