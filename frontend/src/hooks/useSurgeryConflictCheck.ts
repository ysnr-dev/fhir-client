import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { surgeryWorklistQuery, type SurgeryWorklistResult, type SurgeryWorklistRow } from "../api/queries";
import {
  conflictingRows,
  rangeLabel,
  roomDayRows,
  timeRange,
} from "../fhir/surgeryConflictHelpers";

// 登録の直前に、同じ手術室・同じ時間帯の手術がいないかを確かめる。
//
// 手術は予約枠(Slot)を持たないので、部屋の取り合いを止められる場所は「日程が
// 書かれる瞬間」しかない。日程を書く経路は 2 つ(手術部の日程確定モーダルと、
// 診療科の申込・編集フォーム)で、どちらも同じ手順を踏むためにここへ切り出した。
//
// ［提案］サーバー側の排他は入れない。上流 FHIR サーバーに手術専用の予約テーブルを
// 足す話になり、Slot を使わない判断(surgery-order-design §1)と釣り合わない。
// ここで塞ぐのは「一覧を見てから登録するまでの間に他の端末が入れた」ぶんで、
// 残るのは submit の前後数秒に同時登録が重なるケースだけ。麻酔チャートの同時編集と
// 同じく、そこは運用(手術部が日程を握る)で足りているうちは楽観のままにする。
//
// キャッシュは見ない(staleTime: 0 の fetchQuery)。一覧を開いた直後に確定モーダルを
// 開くとキャッシュがそのまま効いてしまい、「一覧を見た後に他端末が入れたぶん」という
// この確認の目的そのものが果たせないため。

export interface SurgeryConflictTarget {
  /** 予定手術日(YYYY-MM-DD)。 */
  date: string;
  /** 入室予定時刻(HH:mm)。 */
  time: string;
  /** 予定所要時間(分)。入力欄の値なので文字列も受ける。 */
  durationMinutes: number | string | null | undefined;
  roomId: string;
  roomName: string;
  /** 編集中のオーダー。自分自身は取り合いの相手にしない。 */
  excludeOrderId?: string;
}

export interface SurgeryConflictState {
  rows: SurgeryWorklistRow[];
  plannedLabel: string;
  truncated: boolean;
  /** 読み込みに失敗して確かめられなかった。 */
  unknown: boolean;
}

export function useSurgeryConflictCheck() {
  const queryClient = useQueryClient();
  const [checking, setChecking] = useState(false);
  const [conflict, setConflict] = useState<SurgeryConflictState | null>(null);

  /**
   * 確認が要るなら state を立てて false を返す。要らなければ true。
   *
   * 部屋・時刻・日付のどれかが未定なら取り合う相手が定まらないので、確認せず通す
   * (部屋未定のまま日程だけ入れる申込は普通にある)。
   */
  async function check(target: SurgeryConflictTarget): Promise<boolean> {
    const planned = timeRange(target.time, target.durationMinutes);
    if (!target.date || !target.roomId || !planned) return true;

    setChecking(true);
    let result: SurgeryWorklistResult | null = null;
    try {
      result = await queryClient.fetchQuery({
        ...surgeryWorklistQuery(target.date),
        staleTime: 0,
      });
    } catch {
      result = null;
    } finally {
      setChecking(false);
    }

    const plannedLabel = `${target.roomName || "選んだ手術室"} ${target.date} ${rangeLabel(
      target.time,
      toMinutes(target.durationMinutes),
    )}`;

    // 読めなかったときは「重なりなし」と言い切れないので、確認を出す。
    if (!result) {
      setConflict({ rows: [], plannedLabel, truncated: false, unknown: true });
      return false;
    }

    const rows = conflictingRows(
      roomDayRows(result.rows, {
        roomId: target.roomId,
        excludeOrderId: target.excludeOrderId,
      }),
      planned,
    );

    // 読み切れていないなら、見えている範囲で重なりが無くても嘘になりうる。
    if (rows.length === 0 && !result.truncated) return true;

    setConflict({ rows, plannedLabel, truncated: result.truncated, unknown: false });
    return false;
  }

  return {
    /** 確認が不要なら true。必要なら state を立てて false。 */
    check,
    /** 立っている間は確認モーダルを出す。 */
    conflict,
    /** 一覧を引き直している間。 */
    checking,
    dismiss: () => setConflict(null),
  };
}

function toMinutes(value: number | string | null | undefined): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
