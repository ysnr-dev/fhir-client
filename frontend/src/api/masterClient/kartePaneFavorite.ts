import { buildError, masterFetch } from "./core";

// ---- カルテ右ペインの頻用メニュー(docs/features/karte.md)。ログイン中の医療従事者につき 1 つ ----

export interface KartePaneFavorite {
  practitioner_id: string;
  /** 表示順のメニューのキー(components/karteMenu.ts)。保存していなければ空。 */
  menu_keys: string[];
  updated_at: string | null;
}

const PATH = "/master/karte_pane_favorite";

// practitioner_id はセッションでログインしていれば backend が本人に固定して無視する。
// 認証なしの環境でも動くよう常に付ける。
function url(practitionerId: string) {
  return `${PATH}?practitioner_id=${encodeURIComponent(practitionerId)}`;
}

export async function fetchKartePaneFavorite(practitionerId: string): Promise<KartePaneFavorite> {
  const res = await masterFetch(url(practitionerId));
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as KartePaneFavorite;
}

export async function saveKartePaneFavorite(practitionerId: string, menuKeys: string[]): Promise<KartePaneFavorite> {
  const res = await masterFetch(url(practitionerId), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ menu_keys: menuKeys }),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as KartePaneFavorite;
}
