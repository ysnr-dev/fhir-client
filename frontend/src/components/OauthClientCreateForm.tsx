import { useState } from "react";
import type { NewOauthClient, OauthClientCreated } from "../api/adminClient";
import { useCreateOauthClient } from "../api/adminQueries";
import { ErrorBanner } from "./ErrorBanner";
import { ContextScopeSelector, ScopeSelector } from "./ScopeSelector";

// クライアントの「形」は判別フィールドではなく、送るフィールドの組み合わせで
// 決まる(上流の OauthClient.register がそうなっている)。この画面のラジオは
// あくまで入力補助で、排他性の担保はサーバー側の検証に任せる -- 二重に持つと
// いずれ食い違う。
type Shape = "backend" | "launch";

interface Props {
  onCreated: (client: OauthClientCreated) => void;
  onCancel: () => void;
}

export function OauthClientCreateForm({ onCreated, onCancel }: Props) {
  const [shape, setShape] = useState<Shape>("backend");
  const [name, setName] = useState("");
  const [systemScopes, setSystemScopes] = useState<string[]>([]);
  const [patientScopes, setPatientScopes] = useState<string[]>([]);
  const [contextScopes, setContextScopes] = useState<string[]>([]);
  const [redirectUris, setRedirectUris] = useState<string[]>([""]);
  const [clientType, setClientType] = useState<"public" | "confidential">("public");
  const [jwksText, setJwksText] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  const create = useCreateOauthClient();

  function reset() {
    setName("");
    setSystemScopes([]);
    setPatientScopes([]);
    setContextScopes([]);
    setRedirectUris([""]);
    setJwksText("");
    setValidationError(null);
  }

  // クライアント側の検証は最小限に留める。残りはサーバーの 422 をそのまま
  // 表示する(2つの検証実装がずれないようにするため)。
  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setValidationError(null);

    if (!name.trim()) return setValidationError("名称を入力してください");

    const payload: NewOauthClient = { name: name.trim(), scopes: [] };

    if (shape === "backend") {
      if (systemScopes.length === 0) return setValidationError("スコープを1つ以上選択してください");
      payload.scopes = systemScopes;
      payload.client_type = "confidential";

      if (jwksText.trim()) {
        try {
          payload.jwks = JSON.parse(jwksText);
        } catch {
          return setValidationError("JWKS が JSON として解釈できません");
        }
      }
    } else {
      if (patientScopes.length === 0) return setValidationError("スコープを1つ以上選択してください");
      const uris = redirectUris.map((uri) => uri.trim()).filter(Boolean);
      if (uris.length === 0) return setValidationError("リダイレクトURIを1つ以上入力してください");

      payload.scopes = [...patientScopes, ...contextScopes];
      payload.redirect_uris = uris;
      payload.client_type = clientType;
    }

    create.mutate(payload, {
      onSuccess: (client) => {
        reset();
        onCreated(client);
      },
    });
  }

  return (
    <form className="oauth-client-form" onSubmit={handleSubmit}>
      <fieldset className="oauth-client-form__shape">
        <legend>クライアントの種別</legend>
        <label>
          <input
            type="radio"
            name="shape"
            checked={shape === "backend"}
            onChange={() => setShape("backend")}
          />
          バックエンド連携（SMART Backend Services）
          <span className="oauth-client-form__hint">
            サーバー間連携。<code>system/</code> スコープで、患者を限定せず読み書きします。
          </span>
        </label>
        <label>
          <input
            type="radio"
            name="shape"
            checked={shape === "launch"}
            onChange={() => setShape("launch")}
          />
          アプリ連携（SMART App Launch）
          <span className="oauth-client-form__hint">
            患者本人がログインして同意するアプリ。<code>patient/</code> スコープの参照のみです。
          </span>
        </label>
      </fieldset>

      <label>
        名称
        <input
          type="text"
          value={name}
          placeholder="my-mcp-server"
          onChange={(e) => setName(e.target.value)}
        />
      </label>

      {shape === "backend" ? (
        <>
          <fieldset>
            <legend>スコープ</legend>
            <ScopeSelector family="system" value={systemScopes} onChange={setSystemScopes} />
          </fieldset>

          <label>
            JWKS（任意）
            <textarea
              rows={4}
              value={jwksText}
              placeholder='{"keys":[...]}  private_key_jwt で認証する場合のみ'
              onChange={(e) => setJwksText(e.target.value)}
            />
            <span className="oauth-client-form__hint">
              入力すると公開鍵による認証（private_key_jwt）になり、client_secret は発行されません。
            </span>
          </label>
        </>
      ) : (
        <>
          <fieldset>
            <legend>スコープ</legend>
            <ScopeSelector family="patient" value={patientScopes} onChange={setPatientScopes} />
          </fieldset>

          <fieldset>
            <legend>アクセスの継続・ユーザー識別（任意）</legend>
            <ContextScopeSelector value={contextScopes} onChange={setContextScopes} />
          </fieldset>

          <fieldset>
            <legend>リダイレクトURI</legend>
            {redirectUris.map((uri, index) => (
              <div key={index} className="oauth-client-form__uri-row">
                <input
                  type="url"
                  value={uri}
                  placeholder="https://app.example/callback"
                  aria-label={`リダイレクトURI ${index + 1}`}
                  onChange={(e) =>
                    setRedirectUris(redirectUris.map((u, i) => (i === index ? e.target.value : u)))
                  }
                />
                {redirectUris.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setRedirectUris(redirectUris.filter((_, i) => i !== index))}
                  >
                    削除
                  </button>
                )}
              </div>
            ))}
            <button type="button" onClick={() => setRedirectUris([...redirectUris, ""])}>
              URIを追加
            </button>
            <p className="oauth-client-form__hint">
              完全一致で照合します（前方一致やワイルドカードは使えません）。
            </p>
          </fieldset>

          <fieldset>
            <legend>クライアント種別</legend>
            <label>
              <input
                type="radio"
                name="client_type"
                checked={clientType === "public"}
                onChange={() => setClientType("public")}
              />
              public（シークレットなし）
              <span className="oauth-client-form__hint">
                SPA・モバイルアプリ向け。シークレットの代わりに PKCE が所有証明になります。
              </span>
            </label>
            <label>
              <input
                type="radio"
                name="client_type"
                checked={clientType === "confidential"}
                onChange={() => setClientType("confidential")}
              />
              confidential（シークレットあり）
              <span className="oauth-client-form__hint">
                サーバー側でシークレットを秘匿できるアプリ向け。
              </span>
            </label>
          </fieldset>
        </>
      )}

      {validationError && (
        <p className="oauth-client-form__validation" role="alert">
          {validationError}
        </p>
      )}
      <ErrorBanner error={create.error} />

      <div className="oauth-client-form__actions">
        <button type="submit" disabled={create.isPending}>
          {create.isPending ? "登録中..." : "登録"}
        </button>
        <button type="button" onClick={onCancel} disabled={create.isPending}>
          キャンセル
        </button>
      </div>
    </form>
  );
}
