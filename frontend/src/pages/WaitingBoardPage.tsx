import { useQuery } from "@tanstack/react-query";
import {
  fetchWaitingBoard,
  WaitingBoardPublicError,
  type WaitingBoardGroup,
} from "../api/waitingBoardPublicClient";
import { useNow } from "../hooks/useNow";

// 待合表示板(docs/waiting-board-design.md §3.1)。ロビーのモニターが /board/<token> で開く。
// AuthGate の外に置き、ログインも患者の個人情報の表示も無い。診察室ごとに 呼出中の番号・待ち人数・
// 離席中・本日の平均待ち時間 を出し、30 秒ごとに読み直す。読み直しに失敗しても直前の値は残す。

const BOARD_REFRESH_INTERVAL = 30_000;

export function WaitingBoardPage({ token }: { token: string }) {
  const board = useQuery({
    queryKey: ["waiting-board-public", token],
    queryFn: () => fetchWaitingBoard(token),
    refetchInterval: BOARD_REFRESH_INTERVAL,
    retry: false,
  });
  const now = useNow(true, 1_000);
  const invalid = board.error instanceof WaitingBoardPublicError && board.error.status === 401;

  if (invalid) {
    return (
      <BoardShell now={now}>
        <p className="waiting-board__message">この表示板のリンクは無効です。</p>
      </BoardShell>
    );
  }

  const data = board.data;
  const groups = data
    ? [
        ...data.rooms.map((room) => ({ key: `room-${room.id}`, name: room.name, group: room })),
        ...data.departments.map((d) => ({ key: `dept-${d.code}`, name: d.name, group: d })),
      ]
    : [];

  return (
    <BoardShell now={now} stale={Boolean(board.error && data)}>
      {board.isPending && <p className="waiting-board__message">読み込み中...</p>}
      {board.error && !data && <p className="waiting-board__message">表示を更新できません。</p>}
      {data && groups.length === 0 && <p className="waiting-board__message">本日の受付はありません。</p>}
      {groups.length > 0 && (
        <div className="waiting-board__grid">
          {groups.map(({ key, name, group }) => (
            <RoomCard key={key} name={name} group={group} />
          ))}
        </div>
      )}
    </BoardShell>
  );
}

function BoardShell({ now, stale, children }: { now: Date; stale?: boolean; children: React.ReactNode }) {
  return (
    <div className="waiting-board">
      <header className="waiting-board__header">
        <h1 className="waiting-board__title">診察のご案内</h1>
        <span className="waiting-board__clock">
          {stale && <span className="waiting-board__stale">更新できていません</span>}
          {clockLabel(now)}
        </span>
      </header>
      {children}
    </div>
  );
}

function RoomCard({ name, group }: { name: string; group: WaitingBoardGroup }) {
  return (
    <section className="waiting-board__room">
      <h2 className="waiting-board__room-name">{name}</h2>
      <div className="waiting-board__calling">
        <span className="waiting-board__calling-label">
          {group.calling.length > 0 ? "お呼び出し中" : "お呼び出しはありません"}
        </span>
        {group.calling.length > 0 && (
          <span className="waiting-board__numbers">
            {group.calling.map((number) => (
              <span key={number} className="waiting-board__number">
                {number}
              </span>
            ))}
          </span>
        )}
      </div>
      <dl className="waiting-board__facts">
        <div>
          <dt>お待ちの方</dt>
          <dd>{group.waiting} 人</dd>
        </div>
        {group.away > 0 && (
          <div>
            <dt>検査などで離席中</dt>
            <dd>{group.away} 人</dd>
          </div>
        )}
        {group.average_wait_minutes !== null && (
          <div>
            <dt>本日の平均待ち時間</dt>
            <dd>約 {group.average_wait_minutes} 分</dd>
          </div>
        )}
      </dl>
    </section>
  );
}

function clockLabel(now: Date): string {
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return `${now.getMonth() + 1}月${now.getDate()}日 ${hh}:${mm}`;
}
