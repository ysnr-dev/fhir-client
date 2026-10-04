import { useCompleteNotifications, useNotificationCounts, useNotifications } from "../../api/queries";
import { completeNotificationEntries, NOTIFICATION_CODES, notificationRows } from "./notificationRegistry";

// 通知の hook にレジストリ(種別コード・行の組み立て・対応済みにする entry)を渡す。
// api 層はレジストリを知らない(部品に依存しない)ので、組み合わせはここで行う。

/** 未対応の通知の行。宛先を指定すると自分あてだけ。 */
export function useNotificationRows(ownerId?: string | null) {
  return useNotifications(NOTIFICATION_CODES, notificationRows, ownerId);
}

/** ヘッダーのベルに出す未対応件数(全体とアラート)。 */
export function useNotificationRowCounts(ownerId: string | null | undefined, polling: boolean) {
  return useNotificationCounts(NOTIFICATION_CODES, ownerId, polling);
}

/** 選んだ行を対応済みにする。 */
export function useCompleteNotificationRows() {
  return useCompleteNotifications(completeNotificationEntries);
}
