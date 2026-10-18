import { useState } from "react";
import type { NewOauthClient, OauthClientCreated } from "../api/adminClient";
import { useCreateOauthClient } from "../api/adminQueries";
import { ErrorBanner } from "./ErrorBanner";
import { ContextScopeSelector, ScopeSelector, type ScopeFamily } from "./ScopeSelector";

// クライアントの「形」は判別フィールドではなく、送るフィールドの組み合わせで
// 決まる(上流の OauthClient.register がそうなっている)。この画面のラジオは
// あくまで入力補助で、排他性の担保はサーバー側の検証に任せる -- 二重に持つと
// いずれ食い違う。
// delegated は CDS Hooks のサービス。user/ の参照スコープだけを持ち、リダイレクト URI もシークレットも持たない
// (トークンは EHR が hook を呼ぶたびに発行して fhirAuthorization で渡す)。
type Shape = "backend" | "launch" | "delegated";
// アプリ連携の相手: 患者本人(standalone、patient/)か、カルテから起動する医療者向け
// (EHR launch、user/)。上流は両方の混在を 422 で弾く。
type Audience = Extract<ScopeFamily, "patient" | "user">;

interface Props {
  onCreated: (client: OauthClientCreated) => void;
  onCancel: () => void;
}

export function OauthClientCreateForm({ onCreated, onCancel }: Props) {
  const [shape, setShape] = useState<Shape>("backend");
  const [name, setName] = useState("");
  const [systemScopes, setSystemScopes] = useState<string[]>([]);
  const [audience, setAudience] = useState<Audience>("patient");
  const [patientScopes, setPatientScopes] = useState<string[]>([]);
  const [userScopes, setUserScopes] = useState<string[]>([]);
  const [delegatedScopes, setDelegatedScopes] = useState<string[]>([]);
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
    setUserScopes([]);
    setDelegatedScopes([]);
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
    } else if (shape === "delegated") {
      if (delegatedScopes.length === 0) return setValidationError("スコープを1つ以上選択してください");
      payload.scopes = delegatedScopes;
      payload.client_type = "public";
    } else {
      const resourceScopes = audience === "user" ? userScopes : patientScopes;
      if (resourceScopes.length === 0) return setValidationError("スコープを1つ以上選択してください");
      const uris = redirectUris.map((uri) => uri.trim()).filter(Boolean);
      if (uris.length === 0) return setValidationError("リダイレクトURIを1つ以上入力してください");

      payload.scopes = [...resourceScopes, ...contextScopes];
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
        </label>
        <label>
          <input
            type="radio"
            name="shape"
            checked={shape === "launch"}
            onChange={() => setShape("launch")}
          />
          アプリ連携（SMART App Launch）
        </label>
        <label>
          <input
            type="radio"
            name="shape"
            checked={shape === "delegated"}
            onChange={() => setShape("delegated")}
          />
          CDS サービス（CDS Hooks）
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

      {shape === "delegated" ? (
        <fieldset>
          <legend>スコープ</legend>
          <ScopeSelector family="user" readOnly value={delegatedScopes} onChange={setDelegatedScopes} />
        </fieldset>
      ) : shape === "backend" ? (
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
          </label>
        </>
      ) : (
        <>
          <fieldset className="oauth-client-form__shape">
            <legend>利用者</legend>
            <label>
              <input
                type="radio"
                name="audience"
                checked={audience === "patient"}
                onChange={() => setAudience("patient")}
              />
              患者本人（patient/）
            </label>
            <label>
              <input
                type="radio"
                name="audience"
                checked={audience === "user"}
                onChange={() => setAudience("user")}
              />
              医療従事者（user/、カルテから起動）
            </label>
          </fieldset>

          <fieldset>
            <legend>スコープ</legend>
            {audience === "user" ? (
              <ScopeSelector family="user" value={userScopes} onChange={setUserScopes} />
            ) : (
              <ScopeSelector family="patient" value={patientScopes} onChange={setPatientScopes} />
            )}
          </fieldset>

          <fieldset>
            <legend>アクセスの継続・ユーザー識別・起動の文脈（任意）</legend>
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
              URI追加
            </button>
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
            </label>
            <label>
              <input
                type="radio"
                name="client_type"
                checked={clientType === "confidential"}
                onChange={() => setClientType("confidential")}
              />
              confidential（シークレットあり）
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
