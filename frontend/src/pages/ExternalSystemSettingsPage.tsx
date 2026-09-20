import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  useExternalSystem,
  useRegenerateInboundToken,
  useTestExternalSystem,
  useUpdateExternalSystem,
} from "../api/adminQueries";
import type { ExternalSystemDetail, ExternalSystemField } from "../api/adminClient";
import { ErrorBanner } from "../components/ErrorBanner";

/**
 * 外部システム 1 つの設定。何を出すかは backend の定義が宣言する
 * 区画(sections)と項目(fields / option_fields)で決まる。
 */
export function ExternalSystemSettingsPage() {
  const { systemKey = "" } = useParams();
  const { data, isLoading, error } = useExternalSystem(systemKey);

  return (
    <div className="page">
      <div className="page__header">
        <h2>{data?.label ?? "外部システム連携"}</h2>
        <Link to="/external-systems">外部システム一覧</Link>
      </div>
      <ErrorBanner error={error} />
      {isLoading && <p>読み込み中...</p>}
      {data && <SettingsForm key={data.key} system={data} />}
    </div>
  );
}

function SettingsForm({ system }: { system: ExternalSystemDetail }) {
  const [enabled, setEnabled] = useState(system.enabled);
  const [systemType, setSystemType] = useState(system.system_type || system.system_types[0] || "");
  const [baseUrl, setBaseUrl] = useState(system.base_url ?? "");
  const [username, setUsername] = useState(system.username ?? "");
  const [password, setPassword] = useState("");
  const [options, setOptions] = useState<Record<string, string>>(system.options ?? {});

  const update = useUpdateExternalSystem(system.key);
  const test = useTestExternalSystem(system.key);
  const regenerate = useRegenerateInboundToken(system.key);

  const hasConnection = system.sections.includes("connection");
  const hasInboundToken = system.sections.includes("inbound_token");
  const hasCodeMappings = system.sections.includes("code_mappings");

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    update.mutate({
      enabled,
      system_type: systemType,
      base_url: baseUrl,
      username,
      password,
      options,
    });
    setPassword("");
  }

  function setOption(key: string, value: string) {
    setOptions({ ...options, [key]: value });
  }

  return (
    <form className="connection-settings-form" onSubmit={handleSubmit}>
      <ErrorBanner error={update.error ?? regenerate.error} />

      <label className="connection-settings-form__checkbox">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        連携を有効にする
      </label>

      {system.system_types.length > 0 && (
        <label>
          種別
          <select value={systemType} onChange={(e) => setSystemType(e.target.value)}>
            {system.system_types.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
      )}

      {hasConnection && (
        <>
          <label>
            接続先 URL
            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          </label>

          <label>
            ユーザー
            <input value={username} onChange={(e) => setUsername(e.target.value)} />
          </label>

          <label>
            パスワード
            <input
              type="password"
              value={password}
              placeholder={system.password_set ? "設定済み" : ""}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        </>
      )}

      {system.fields.map((field) => (
        <SystemField
          key={field.key}
          field={field}
          value={options[field.key] ?? field.default ?? ""}
          onChange={(value) => setOption(field.key, value)}
        />
      ))}

      {system.option_fields.map((field) => (
        <label key={field.key}>
          {field.label}
          <input
            value={options[field.key] ?? field.default ?? ""}
            onChange={(e) => setOption(field.key, e.target.value)}
          />
        </label>
      ))}

      <p className="connection-settings-form__status">
        {system.usable
          ? "設定は足りています"
          : enabled
            ? "設定が足りません"
            : "連携は無効です"}
      </p>

      {update.isSuccess && (
        <p className="connection-settings-form__success" role="status">
          保存しました
        </p>
      )}

      {test.data?.ok && (
        <p className="connection-settings-form__success" role="status">
          接続できました
          {test.data.facility_name ? `（${test.data.facility_name}` : ""}
          {test.data.facility_number ? ` / ${test.data.facility_number}` : ""}
          {test.data.facility_name ? "）" : ""}
        </p>
      )}
      {test.data && !test.data.ok && (
        <p className="connection-settings-form__test-error" role="alert">
          {test.data.error ?? test.data.message}
        </p>
      )}

      <div className="connection-settings-form__actions">
        <button type="submit" disabled={update.isPending}>
          {update.isPending ? "保存中..." : "保存"}
        </button>
        {hasConnection && (
          <button type="button" disabled={test.isPending} onClick={() => test.mutate()}>
            {test.isPending ? "接続中..." : "接続テスト"}
          </button>
        )}
      </div>

      {hasInboundToken && (
        <>
          <h3 className="receipt-mapping__title">通知の受信</h3>
          <p className="connection-settings-form__status">
            {system.inbound_token_set ? "トークン発行済み" : "トークン未発行"}
          </p>
          {regenerate.data && (
            <p className="connection-settings-form__success" role="status">
              {regenerate.data.inbound_token}
            </p>
          )}
          <div className="connection-settings-form__actions">
            <button type="button" disabled={regenerate.isPending} onClick={() => regenerate.mutate()}>
              {regenerate.isPending ? "発行中..." : "受信トークンを再発行"}
            </button>
          </div>
        </>
      )}

      {hasCodeMappings && (
        <>
          <h3 className="receipt-mapping__title">コード変換設定</h3>
          <Link to={`/external-systems/${system.key}/code-mappings`}>コード変換設定を編集</Link>
        </>
      )}
    </form>
  );
}

function SystemField({
  field,
  value,
  onChange,
}: {
  field: ExternalSystemField;
  value: string;
  onChange: (value: string) => void;
}) {
  if (field.type === "boolean") {
    return (
      <label className="connection-settings-form__checkbox">
        <input
          type="checkbox"
          checked={value === "true"}
          onChange={(e) => onChange(e.target.checked ? "true" : "false")}
        />
        {field.label}
      </label>
    );
  }

  if (field.type === "select") {
    return (
      <label>
        {field.label}
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">未設定</option>
          {(field.choices ?? []).map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <label>
      {field.label}
      <input value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
