import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchConnectionSettings,
  testConnection,
  updateConnectionSettings,
  type ConnectionSettingsUpdate,
} from "./adminClient";

const CONNECTION_SETTINGS_KEY = ["admin", "connection_settings"];

export function useConnectionSettings() {
  return useQuery({
    queryKey: CONNECTION_SETTINGS_KEY,
    queryFn: fetchConnectionSettings,
  });
}

export function useUpdateConnectionSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: ConnectionSettingsUpdate) => updateConnectionSettings(payload),
    onSuccess: (data) => {
      queryClient.setQueryData(CONNECTION_SETTINGS_KEY, data);
    },
  });
}

// 接続テストは Render コールドスタート時に最大 ~90 秒かかり得る。
export function useTestConnection() {
  return useMutation({
    mutationFn: () => testConnection(),
  });
}
