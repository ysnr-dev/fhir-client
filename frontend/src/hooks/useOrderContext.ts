import { useCallback, useSyncExternalStore } from "react";
import { useCurrentPractitioner } from "../api/authQueries";
import {
  emptyOrderContext,
  orderContextSnapshot,
  subscribeOrderContext,
  type OrderContext,
} from "../orderContext";

// カルテ画面ヘッダー(OrderContextPicker)で選択中の依頼科・依頼医師。
// オーダーを登録するときの依頼元として使う。ヘッダーで選び直すと購読側も追従する。
// 医療従事者と紐付かないログイン(管理者など)では空のまま。
export function useOrderContext(): OrderContext {
  const { practitionerId } = useCurrentPractitioner();

  const getSnapshot = useCallback(
    () => (practitionerId ? orderContextSnapshot(practitionerId) : emptyOrderContext),
    [practitionerId],
  );

  return useSyncExternalStore(subscribeOrderContext, getSnapshot);
}
