import { useCallback, useEffect, useState } from "react";

// ヘッダーのベルの自動更新を入れるかどうか。端末ごとの設定なので localStorage に持つ。
//
// 既定は切ってある。上流の FHIR サーバーはリクエストごとに AuditEvent を 1 行書くので、
// 開きっぱなしの画面が毎分件数を引くと、無償のサーバーでは監査ログとインスタンスの
// 稼働時間を食う。常に見張りたい端末(外来の診察室など)でだけ入れる運用にする。

const STORAGE_KEY = "fhir-client.notifications.polling";

// 同じタブの中の複数の購読者(ベルと設定メニュー)に変更を配る。
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "on";
  } catch {
    // localStorage が使えない環境では切ったままにする。
    return false;
  }
}

function write(value: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, value ? "on" : "off");
  } catch {
    // 保存できなくてもその場の切り替えは有効にする。
  }
  for (const listener of listeners) listener();
}

export function useNotificationPolling(): [boolean, (value: boolean) => void] {
  const [polling, setPolling] = useState(read);

  useEffect(() => {
    function sync() {
      setPolling(read());
    }
    listeners.add(sync);
    return () => {
      listeners.delete(sync);
    };
  }, []);

  const update = useCallback((value: boolean) => {
    write(value);
    setPolling(value);
  }, []);

  return [polling, update];
}
