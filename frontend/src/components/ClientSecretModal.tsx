import { useState } from "react";
import type { OauthClientCreated } from "../api/adminClient";
import { Modal } from "./Modal";

// client_secret は登録レスポンスにしか現れない(サーバーは SHA-256 ダイジェスト
// しか保持しない)。閉じたら二度と取得できないので、保存を確認するまで閉じる
// ボタンを解放しない。
export function ClientSecretModal({
  client,
  onClose,
}: {
  client: OauthClientCreated;
  onClose: () => void;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const hasSecret = Boolean(client.client_secret);

  return (
    <Modal title="クライアントを登録しました" onClose={hasSecret && !acknowledged ? () => {} : onClose}>
      <div className="client-secret-modal">
        <Field label="client_id" value={client.client_id} />
        {hasSecret ? (
          <>
            <Field label="client_secret" value={client.client_secret!} />
            <p className="client-secret-modal__warning" role="alert">
              この画面を閉じると <strong>client_secret は二度と表示できません</strong>。
              いま安全な場所に保存してください。
            </p>
            <label className="client-secret-modal__ack">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
              />
              保存しました
            </label>
          </>
        ) : (
          <p className="client-secret-modal__note">
            {client.auth_method === "private_key_jwt"
              ? "JWKS を登録したため client_secret は発行されていません（private_key_jwt で認証します）。"
              : "public クライアントのため client_secret は発行されていません（PKCE が所有証明になります）。"}
          </p>
        )}

        <div className="client-secret-modal__actions">
          <button type="button" onClick={onClose} disabled={hasSecret && !acknowledged}>
            閉じる
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // クリップボードが使えない環境(非セキュアコンテキスト等)では手動コピー
    }
  }

  return (
    <div className="client-secret-modal__field">
      <span className="client-secret-modal__label">{label}</span>
      <pre className="client-secret-modal__value">{value}</pre>
      <button type="button" onClick={copy}>
        {copied ? "コピーしました" : "コピー"}
      </button>
    </div>
  );
}
