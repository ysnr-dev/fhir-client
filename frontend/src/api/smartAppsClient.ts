// カルテの「SMARTアプリ」タブ用の API(docs/smart-app-launch-design.md)。
//
// 起動できるアプリの一覧と、EHR launch の起動 URL の取得。認可そのものはアプリと上流の
// 間で行われ、この backend はログイン中の医療者と開いている患者を名乗って launch
// トークンを発行してもらうだけ。登録・編集は api/adminClient.ts。
import { buildError, masterFetch } from "./masterClient";
import type { SmartAppDisplay } from "./adminClient";

export interface LaunchableSmartApp {
  id: number;
  name: string;
  display: SmartAppDisplay;
}

export interface SmartAppLaunch {
  /** iss と launch を添えた起動 URL。launch は 5 分・単回なので使い回せない。 */
  launch_url: string;
  display: SmartAppDisplay;
  expires_in: number | null;
}

export interface SmartAppLaunchParams {
  patient_id: string;
  encounter_id?: string;
  /** CDS Hooks のカードのリンクが持つ appContext。上流がトークン応答の appContext でアプリに渡す。 */
  app_context?: string;
}

const SMART_APPS = "/smart_apps";

export async function fetchLaunchableSmartApps(): Promise<LaunchableSmartApp[]> {
  const res = await masterFetch(SMART_APPS);
  if (!res.ok) throw await buildError(res);
  const body = (await res.json()) as { items: LaunchableSmartApp[] };
  return body.items;
}

export async function launchSmartApp(id: number, params: SmartAppLaunchParams): Promise<SmartAppLaunch> {
  const res = await masterFetch(`${SMART_APPS}/${id}/launch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as SmartAppLaunch;
}
