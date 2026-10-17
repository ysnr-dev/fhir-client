// 「自院」がどの Organization かと施設ごとの業務設定(/facility_settings)。
//
// 各マスタ画面の所属既定値・帳票の自院欄・各画面の既定値が見る値で、ログイン済みユーザー
// 全員が読み書きする。
import { notifyUnauthorized, withCsrfHeaders } from "./session";
import type { FacilitySettings, FacilitySettingsPayload } from "./adminClient";

export type { FacilitySettings, FacilitySettingsPayload };

const FACILITY_SETTINGS = "/facility_settings";

export async function fetchFacilitySettings(): Promise<FacilitySettings> {
  const res = await fetch(FACILITY_SETTINGS);
  if (res.status === 401) notifyUnauthorized();
  if (!res.ok) throw new Error(`施設設定を取得できませんでした (HTTP ${res.status})`);
  return (await res.json()) as FacilitySettings;
}

// 渡した項目だけを書き換える(backend は無い項目を触らない)。
export async function updateFacilitySettings(
  payload: FacilitySettingsPayload,
): Promise<FacilitySettings> {
  const res = await fetch(FACILITY_SETTINGS, {
    method: "PATCH",
    headers: withCsrfHeaders("PATCH", { "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
  if (res.status === 401) notifyUnauthorized();
  if (!res.ok) {
    let message = `施設設定を保存できませんでした (HTTP ${res.status})`;
    try {
      const body = (await res.json()) as { error?: string; errors?: string[] };
      if (body.error) message = body.error;
      else if (body.errors?.length) message = body.errors.join(" / ");
    } catch {
      // 非JSONレスポンスは既定のメッセージのまま
    }
    throw new Error(message);
  }
  return (await res.json()) as FacilitySettings;
}
