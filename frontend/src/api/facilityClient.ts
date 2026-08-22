// 「自院」がどの Organization かの参照(/facility_settings)。
//
// 各マスタ画面の所属既定値・帳票の自院欄が見る値で、ログイン済みユーザー全員が
// 読める。変更は管理者専用なので adminClient.ts 側(/admin/facility_settings)。
// GET しかないので CSRF トークンは不要。
import { notifyUnauthorized } from "./session";
import type { FacilitySettings } from "./adminClient";

export type { FacilitySettings };

export async function fetchFacilitySettings(): Promise<FacilitySettings> {
  const res = await fetch("/facility_settings");
  if (res.status === 401) notifyUnauthorized();
  if (!res.ok) throw new Error(`自院設定を取得できませんでした (HTTP ${res.status})`);
  return (await res.json()) as FacilitySettings;
}
