import { useMutation, useQuery } from "@tanstack/react-query";
import {
  fetchLaunchableSmartApps,
  launchSmartApp,
  type SmartAppLaunch,
  type SmartAppLaunchParams,
} from "./smartAppsClient";

const SMART_APPS_KEY = ["smart_apps"];

export function useLaunchableSmartApps() {
  return useQuery({
    queryKey: [...SMART_APPS_KEY, "list"],
    queryFn: fetchLaunchableSmartApps,
    retry: false,
    staleTime: 5 * 60_000,
  });
}

export interface EmbeddedLaunchTarget {
  appId: number;
  patientId: string;
  encounterId?: string;
}

/**
 * 埋め込み表示のアプリの起動。開いた時点で 1 回だけ POST するので、mutation ではなく
 * 起動対象と nonce をキーにした useQuery にする(StrictMode の二重 effect で 2 回
 * 発行しない)。患者・アプリ・受診が変わればキーが変わり、新しい launch を発行する。
 * launch は単回使用なので、キャッシュは観測者がいなくなったら捨てる(再び開けば新しい起動)。
 */
export function useEmbeddedSmartAppLaunch(target: EmbeddedLaunchTarget | null, nonce: number) {
  return useQuery<SmartAppLaunch>({
    queryKey: [...SMART_APPS_KEY, "launch", target?.appId, target?.patientId, target?.encounterId ?? "", nonce],
    queryFn: () =>
      launchSmartApp(target!.appId, { patient_id: target!.patientId, encounter_id: target!.encounterId }),
    enabled: target !== null,
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

/** 別ウィンドウ表示のアプリの起動(ボタンを押したときだけ発行する)。 */
export function useSmartAppWindowLaunch() {
  return useMutation({
    mutationFn: ({ appId, params }: { appId: number; params: SmartAppLaunchParams }) =>
      launchSmartApp(appId, params),
    retry: false,
  });
}
