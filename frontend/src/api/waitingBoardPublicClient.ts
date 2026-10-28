// 待合表示板の公開 API クライアント(docs/waiting-board-design.md §2)。
//
// ログインは無く、リンクのトークンをヘッダで送る。職員のセッション Cookie は送らず(credentials: "omit")、
// 401 を AuthGate に知らせる仕組み(notifyUnauthorized)も通さない(表示板は AuthGate の外)。

/** 待っている受付 1 件。患者を特定できるものは入らない。 */
export interface WaitingBoardEntry {
  /** 受付番号。番号の無い受付は null。 */
  number: string | null;
  /** 予約時間「09:30」。当日受付は null。 */
  booked_time: string | null;
  /** 受付時刻「09:12」。 */
  checked_in_time: string | null;
}

export interface WaitingBoardGroup {
  /** 呼出中の受付番号。区画に 1 人で、最後に呼んだ受付(診察開始の呼出か「患者呼出」)。無ければ null。 */
  calling: string | null;
  /** 受付済で診察が始まっていない人数。 */
  waiting: number;
  /** 待っている受付(予約時間の順)。 */
  waiting_list: WaitingBoardEntry[];
  /** 検査などで離席中(一時終了)の人数。 */
  away: number;
  /** 本日の受付→診察開始の平均(分)。実測が無ければ null。 */
  average_wait_minutes: number | null;
}

export interface WaitingBoardRoom extends WaitingBoardGroup {
  id: string;
  name: string;
}

export interface WaitingBoardDepartment extends WaitingBoardGroup {
  code: string;
  name: string;
}

export interface WaitingBoardSnapshot {
  generated_at: string;
  rooms: WaitingBoardRoom[];
  /** 診察室の無い受付を診療科でまとめたもの。 */
  departments: WaitingBoardDepartment[];
}

export class WaitingBoardPublicError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function fetchWaitingBoard(token: string): Promise<WaitingBoardSnapshot> {
  const response = await fetch("/waiting_board/public", {
    credentials: "omit",
    headers: { "X-Board-Token": token },
  });
  let parsed: { error?: string } | null = null;
  try {
    parsed = (await response.json()) as { error?: string };
  } catch {
    parsed = null;
  }
  if (!response.ok) {
    throw new WaitingBoardPublicError(parsed?.error ?? `${response.status} ${response.statusText}`, response.status);
  }
  return parsed as unknown as WaitingBoardSnapshot;
}
