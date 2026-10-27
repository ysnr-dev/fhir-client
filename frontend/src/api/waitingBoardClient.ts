// 待合表示板の職員向け API クライアント(docs/waiting-board-design.md §2)。ログインセッションで叩く。
import { masterFetch, MasterApiError } from "./masterClient";

export interface WaitingBoardLink {
  id: number;
  label: string;
  /** 出す診察室(Location の id)。空なら全部。 */
  location_ids: string[];
  created_at: string;
  created_by_name: string | null;
}

export interface IssuedWaitingBoardLink extends WaitingBoardLink {
  /** 表示板が開くパス("/board/<token>")。トークンはこの応答にだけ出る。 */
  path: string;
}

async function boardJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await masterFetch(path, init);
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      if (typeof body?.error === "string") message = body.error;
    } catch {
      // ボディが JSON でないときはステータスのまま出す。
    }
    throw new MasterApiError(message, response.status);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function send<T>(path: string, method: string, body: unknown): Promise<T> {
  return boardJson<T>(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

/** 受付番号(当日の連番)を 1 つ払い出す。 */
export function issueReceptionNumber(day: string): Promise<{ day: string; number: number }> {
  return send("/waiting_board/reception_numbers", "POST", { day });
}

export async function fetchWaitingBoardLinks(): Promise<WaitingBoardLink[]> {
  const body = await boardJson<{ items: WaitingBoardLink[] }>("/waiting_board/links");
  return body.items;
}

export function issueWaitingBoardLink(payload: { label: string; location_ids: string[] }): Promise<IssuedWaitingBoardLink> {
  return send("/waiting_board/links", "POST", payload);
}

export function revokeWaitingBoardLink(id: number): Promise<void> {
  return boardJson(`/waiting_board/links/${id}`, { method: "DELETE" });
}
