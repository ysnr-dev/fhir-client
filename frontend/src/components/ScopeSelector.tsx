import { useScopeOptions } from "../api/adminQueries";
import { ErrorBanner } from "./ErrorBanner";

// SMART スコープの選択UI。対応リソース型・アクセス種別・日本語ラベルは上流の
// /admin/scopes から取得する(こちらに写すとリソース型が増えた瞬間にずれる)。
//
// 生成するのは `system/Patient.read` のようなスコープ文字列。`*`(すべての
// 診療記録)を選んだときは個別型の指定に意味がなくなるので無効化する。

const WILDCARD = "*";

interface ScopeSelectorProps {
  family: "system" | "patient";
  /** 現在選択されているリソーススコープ(コンテキストスコープは含まない) */
  value: string[];
  onChange: (scopes: string[]) => void;
}

/** "system/Patient.read" -> { type: "Patient", access: "read" } */
function parseScope(scope: string): { type: string; access: string } | null {
  const match = /^(?:system|patient)\/([^.]+)\.(.+)$/.exec(scope);
  return match ? { type: match[1], access: match[2] } : null;
}

export function ScopeSelector({ family, value, onChange }: ScopeSelectorProps) {
  const { data, isLoading, error } = useScopeOptions();

  const selected = new Map<string, string>();
  for (const scope of value) {
    const parsed = parseScope(scope);
    if (parsed) selected.set(parsed.type, parsed.access);
  }
  const wildcardSelected = selected.has(WILDCARD);

  if (isLoading) return <p className="scope-selector__status">スコープ選択肢を読み込み中...</p>;
  if (error) return <ErrorBanner error={error} />;
  if (!data) return null;

  const accessOptions = family === "system" ? data.system_access : data.patient_access;
  const defaultAccess = accessOptions[0]?.value ?? "read";

  function emit(next: Map<string, string>) {
    onChange(Array.from(next, ([type, access]) => `${family}/${type}.${access}`));
  }

  function toggle(type: string, checked: boolean) {
    const next = new Map(selected);
    if (checked) {
      // ワイルドカードを選んだら個別指定は捨てる(重複して意味がない)
      if (type === WILDCARD) next.clear();
      next.set(type, defaultAccess);
    } else {
      next.delete(type);
    }
    emit(next);
  }

  function changeAccess(type: string, access: string) {
    const next = new Map(selected);
    next.set(type, access);
    emit(next);
  }

  return (
    <div className="scope-selector">
      {data.resource_types.map(({ type, label }) => {
        const isWildcard = type === WILDCARD;
        const checked = selected.has(type);
        const disabled = wildcardSelected && !isWildcard;

        return (
          <div
            key={type}
            className={`scope-selector__row${isWildcard ? " scope-selector__row--wildcard" : ""}`}
          >
            <label className="scope-selector__label">
              <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={(e) => toggle(type, e.target.checked)}
              />
              <span className="scope-selector__name">{label}</span>
              <code className="scope-selector__code">
                {family}/{type}
              </code>
            </label>
            {/* patient/ は参照のみ(サーバーが read しか返さない)なので選択肢を出さない */}
            {checked && accessOptions.length > 1 && (
              <select
                aria-label={`${label} のアクセス種別`}
                value={selected.get(type) ?? defaultAccess}
                onChange={(e) => changeAccess(type, e.target.value)}
              >
                {accessOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface ContextScopeSelectorProps {
  value: string[];
  onChange: (scopes: string[]) => void;
}

// offline_access / openid などのコンテキストスコープ。リソースへのアクセスでは
// なく、アクセスの継続期間とユーザー識別を要求するもの。
export function ContextScopeSelector({ value, onChange }: ContextScopeSelectorProps) {
  const { data } = useScopeOptions();
  if (!data) return null;

  function toggle(scope: string, checked: boolean) {
    onChange(checked ? [...value, scope] : value.filter((s) => s !== scope));
  }

  return (
    <div className="scope-selector scope-selector--context">
      {data.context_scopes.map(({ scope, label }) => (
        <label key={scope} className="scope-selector__label">
          <input
            type="checkbox"
            checked={value.includes(scope)}
            onChange={(e) => toggle(scope, e.target.checked)}
          />
          <span className="scope-selector__name">{label}</span>
          <code className="scope-selector__code">{scope}</code>
        </label>
      ))}
    </div>
  );
}
