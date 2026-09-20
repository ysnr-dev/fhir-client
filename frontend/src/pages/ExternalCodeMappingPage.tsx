import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { ExternalCodeKind, ExternalCodeMapping } from "../api/adminClient";
import {
  useExternalCodeCandidates,
  useExternalCodeMappings,
  useExternalSystem,
  useUpdateExternalCodeMappings,
} from "../api/adminQueries";
import { ErrorBanner } from "../components/ErrorBanner";
import { useDepartmentList, usePractitionerOptions } from "../api/queries";
import { departmentCode, departmentDisplayName } from "../fhir/departmentHelpers";
import { displayJapaneseName } from "../fhir/humanName";

/**
 * カルテのコード ↔ 外部システムのコードの対応表。
 *
 * どの種別を持つかは外部システムのアダプタが宣言する(code_kinds)。
 * 画面はそれを見て、カルテ側の一覧を local の種類で選んで描くだけ。
 */
export function ExternalCodeMappingPage() {
  const { systemKey = "" } = useParams();
  const system = useExternalSystem(systemKey);
  const mappings = useExternalCodeMappings(systemKey);
  const usable = system.data?.usable ?? false;

  return (
    <div className="page">
      <div className="page__header">
        <h1>コード変換設定{system.data ? `（${system.data.label}）` : ""}</h1>
        <Link to={`/external-systems/${systemKey}`}>設定へ戻る</Link>
      </div>
      {system.data && !usable && (
        <p className="connection-settings-form__test-error" role="alert">
          このシステムの連携が有効になっていません。先に設定を済ませてください。
        </p>
      )}
      <ErrorBanner error={system.error ?? mappings.error} />
      {mappings.data?.kinds.map((kind) => (
        <MappingSection
          key={kind.key}
          systemKey={systemKey}
          kind={kind}
          mappings={mappings.data.items}
          candidatesEnabled={usable}
        />
      ))}
    </div>
  );
}

function useDraft(mappings: ExternalCodeMapping[], kind: string) {
  const initial = useMemo(() => {
    const map: Record<string, string> = {};
    for (const row of mappings) {
      if (row.kind === kind) map[row.local_key] = row.external_code;
    }
    return map;
  }, [mappings, kind]);

  const [draft, setDraft] = useState<Record<string, string>>(initial);
  const [baseline, setBaseline] = useState(initial);
  // 保存後に一覧が入れ替わったら編集内容を作り直す。
  if (baseline !== initial) {
    setBaseline(initial);
    setDraft(initial);
  }
  return [draft, setDraft] as const;
}

/** カルテ側の一覧。アダプタが宣言する local の種類ごとに引く。 */
function useLocalRows(local: string) {
  const departments = useDepartmentList({});
  const practitioners = usePractitionerOptions();

  if (local === "ssmix2_department") {
    // ここに出すのは自院に登録した科だけ。コード表を丸ごと並べても直す対象にならない。
    return {
      rows: departments.departments
        .map((d) => ({ key: departmentCode(d), label: departmentDisplayName(d) }))
        .filter((r) => r.key),
      error: departments.error,
      emptyMessage: "コードを持つ診療科が登録されていません",
    };
  }

  if (local === "practitioner") {
    return {
      rows: practitioners.practitioners
        .map((p) => ({ key: p.id ?? "", label: displayJapaneseName(p.name) || p.id || "" }))
        .filter((r) => r.key),
      error: practitioners.error,
      emptyMessage: "医療従事者が登録されていません",
    };
  }

  return { rows: [], error: null, emptyMessage: "対応付けられる項目がありません" };
}

function MappingSection({
  systemKey,
  kind,
  mappings,
  candidatesEnabled,
}: {
  systemKey: string;
  kind: ExternalCodeKind;
  mappings: ExternalCodeMapping[];
  candidatesEnabled: boolean;
}) {
  const [draft, setDraft] = useDraft(mappings, kind.key);
  const update = useUpdateExternalCodeMappings(systemKey);
  const candidates = useExternalCodeCandidates(systemKey, kind.key, candidatesEnabled);
  const { rows, error, emptyMessage } = useLocalRows(kind.local);
  const options = candidates.data?.items ?? [];

  function handleSave() {
    update.mutate({
      kind: kind.key,
      items: Object.entries(draft)
        .filter(([, code]) => code)
        .map(([localKey, externalCode]) => ({
          local_key: localKey,
          external_code: externalCode,
          label: rows.find((r) => r.key === localKey)?.label,
        })),
    });
  }

  return (
    <section className="receipt-mapping">
      <h2 className="receipt-mapping__title">{kind.label}</h2>
      <ErrorBanner error={error ?? candidates.error ?? update.error} />
      {rows.length === 0 ? (
        <p className="receipt-mapping__empty">{emptyMessage}</p>
      ) : (
        <table className="receipt-mapping__table">
          <thead>
            <tr>
              <th>カルテ</th>
              <th>外部システム</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td>{row.label}</td>
                <td>
                  <select
                    value={draft[row.key] ?? ""}
                    onChange={(e) => setDraft({ ...draft, [row.key]: e.target.value })}
                  >
                    <option value="">
                      {kind.fallback === "identity" ? "未設定（同じコードを使う）" : "未設定"}
                    </option>
                    {options.map((option) => (
                      <option key={option.code} value={option.code}>
                        {option.code} {option.label}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="connection-settings-form__actions">
        <button
          type="button"
          onClick={handleSave}
          disabled={update.isPending || rows.length === 0}
        >
          {update.isPending ? "保存中..." : "保存"}
        </button>
      </div>
    </section>
  );
}
