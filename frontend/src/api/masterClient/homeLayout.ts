import type { HomeLayoutBody } from "../../fhir/homeCards";
import { buildError, masterFetch } from "./core";

// ---- ホームのカードの並び(docs/features/home.md)。ログイン中の医療従事者につき 1 つ ----

export interface HomeLayout {
  practitioner_id: string;
  /** 保存していなければ null(職種の既定で出す)。形は fhir/homeCards.ts の HomeLayoutBody。 */
  definition: HomeLayoutBody | null;
  updated_at: string | null;
}

const PATH = "/master/home_layout";
const JSON_HEADERS = { "Content-Type": "application/json" };

// practitioner_id はセッションでログインしていれば backend が本人に固定して無視する。
// 認証なしの環境でも動くよう常に付ける。
function url(practitionerId: string) {
  return `${PATH}?practitioner_id=${encodeURIComponent(practitionerId)}`;
}

export async function fetchHomeLayout(practitionerId: string): Promise<HomeLayout> {
  const res = await masterFetch(url(practitionerId));
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as HomeLayout;
}

export async function saveHomeLayout(practitionerId: string, definition: HomeLayoutBody): Promise<HomeLayout> {
  const res = await masterFetch(url(practitionerId), {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify({ definition }),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as HomeLayout;
}

export async function resetHomeLayout(practitionerId: string): Promise<void> {
  const res = await masterFetch(url(practitionerId), { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}
