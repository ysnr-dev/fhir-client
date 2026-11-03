import { useMemo } from "react";
import {
  useCompleteNotifications,
  useMyCareTeams,
  useNotificationCounts,
  useNotifications,
  type NotificationOwners,
} from "../../api/queries";
import { completeNotificationEntries, NOTIFICATION_CODES, notificationRows } from "./notificationRegistry";

// 通知の hook にレジストリ(種別コード・行の組み立て・対応済みにする entry)を渡す。
// api 層はレジストリを知らない(部品に依存しない)ので、組み合わせはここで行う。

/**
 * 自分あての通知の宛先。自分と、自分がメンバーの有効なチーム。医療従事者に紐付かない
 * アカウントは絞らない(null)。チームが読めるまでは ready が false(自分だけで一度引いて
 * から引き直さない)。チームが読めなかったときは自分だけにする。
 */
export function useNotificationOwners(practitionerId: string | null | undefined): {
  owners: NotificationOwners;
  teamIds: Set<string>;
  ready: boolean;
} {
  const teams = useMyCareTeams(practitionerId);
  const teamIds = useMemo(
    () => new Set((teams.data ?? []).map((team) => team.id ?? "").filter(Boolean)),
    [teams.data],
  );
  const owners = useMemo(
    () =>
      practitionerId
        ? [`Practitioner/${practitionerId}`, ...Array.from(teamIds, (id) => `CareTeam/${id}`)]
        : null,
    [practitionerId, teamIds],
  );
  return { owners, teamIds, ready: !practitionerId || !teams.isPending };
}

/** 未対応の通知の行。医療従事者を渡すと自分あて(自分のチームあてを含む)だけ。 */
export function useNotificationRows(practitionerId?: string | null) {
  const { owners, ready } = useNotificationOwners(practitionerId);
  return useNotifications(NOTIFICATION_CODES, notificationRows, owners, ready);
}

/** ヘッダーのベルに出す未対応件数(全体とアラート)と、更新の新しい順の数件。 */
export function useNotificationRowCounts(practitionerId: string | null | undefined, polling: boolean) {
  const { owners, ready } = useNotificationOwners(practitionerId);
  return useNotificationCounts(NOTIFICATION_CODES, owners, polling, notificationRows, ready);
}

/** 選んだ行を対応済みにする。 */
export function useCompleteNotificationRows() {
  return useCompleteNotifications(completeNotificationEntries);
}
