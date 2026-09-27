import { useStoredToggle } from "./useStoredToggle";

// ヘッダーのベルの自動更新を入れるかどうか。端末ごとの設定なので localStorage に持つ。
//
// 既定は切ってある。上流の FHIR サーバーはリクエストごとに AuditEvent を 1 行書くので、
// 開きっぱなしの画面が毎分件数を引くと、無償のサーバーでは監査ログとインスタンスの
// 稼働時間を食う。常に見張りたい端末(外来の診察室など)でだけ入れる運用にする。

const STORAGE_KEY = "fhir-client.notifications.polling";

export function useNotificationPolling(): [boolean, (value: boolean) => void] {
  return useStoredToggle(STORAGE_KEY);
}
