import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { LabResultItem } from "../api/masterClient";
import {
  useLabResultImport,
  useLabResultImportMutations,
  useLabResultItemsByCodes,
} from "../api/masterQueries";
import { ErrorBanner } from "../components/ErrorBanner";
import { LabImportGroupCard } from "../components/LabImportGroupCard";
import { groupImportRows, type LabImportGroup } from "../fhir/labImportHelpers";
import { labInstantLabel } from "../fhir/labResultHelpers";
import type { LabImportGroupContext } from "../hooks/useLabImportGroupContext";
import { useLabImportRegistration } from "../hooks/useLabImportRegistration";

// 取込バッチの詳細。候補(ORC/OBR 群)ごとにカードを並べ、保留行を片付けてから
// 上流に登録する。登録そのものは手入力と同じ道を通る。

// 文字コードの判定根拠。ずれたときに原因を追えるように画面に出す。
const ENCODING_REASONS: Record<string, string> = {
  manual: "指定",
  bom: "BOM",
  escape: "ESC シーケンス",
  msh18: "MSH-18 の宣言",
  utf8_valid: "UTF-8 として妥当",
  fallback: "自動判定",
};

export function LabResultImportDetailPage() {
  const { id } = useParams<{ id: string }>();
  const importId = Number(id);
  const detail = useLabResultImport(Number.isFinite(importId) ? importId : undefined);
  const { resolve } = useLabResultImportMutations();
  const { registerGroup, registerAll, registering } = useLabImportRegistration();
  const [failures, setFailures] = useState<Record<number, string>>({});
  const [error, setError] = useState<unknown>(null);
  // カードが解決した文脈。「すべて登録」がここから対象を集める。
  const contexts = useRef(new Map<number, LabImportGroupContext>());
  const handleContextResolved = useCallback(
    (groupNo: number, context: LabImportGroupContext | undefined) => {
      if (context) contexts.current.set(groupNo, context);
      else contexts.current.delete(groupNo);
    },
    [],
  );

  // 列が多く、既定の幅では結果項目や値まで折り返すので、この画面だけ幅を広げる
  // (部門業務の一覧と同じやり方)。
  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  const groups = useMemo(() => groupImportRows(detail.data?.rows ?? []), [detail.data]);
  const codes = useMemo(
    () =>
      (detail.data?.rows ?? [])
        .map((row) => row.result_item_code)
        .filter((code): code is string => Boolean(code)),
    [detail.data],
  );
  const items = useLabResultItemsByCodes(codes);
  const itemsByCode = useMemo(
    () => new Map<string, LabResultItem>((items.data?.items ?? []).map((i) => [i.result_item_code, i])),
    [items.data],
  );

  async function handleRegister(group: LabImportGroup, context: LabImportGroupContext) {
    setError(null);
    try {
      await registerGroup(group, context);
      setFailures((current) => ({ ...current, [group.groupNo]: "" }));
    } catch (caught) {
      setError(caught);
    }
  }

  async function handleRegisterAll() {
    setError(null);
    const entries = groups
      .map((group) => ({ group, context: contexts.current.get(group.groupNo) }))
      .filter((entry): entry is { group: LabImportGroup; context: LabImportGroupContext } =>
        Boolean(entry.context),
      );
    const results = await registerAll(entries);
    setFailures(Object.fromEntries(results.map((f) => [f.groupNo, f.message])));
  }

  const batch = detail.data;

  return (
    <div className="page">
      <div className="page__header">
        <h1>検査結果取込</h1>
        <div className="page__header-actions">
          <Link to="/lab-result-imports" className="button">
            取込一覧
          </Link>
          <button
            type="button"
            disabled={!batch || resolve.isPending}
            onClick={() => batch && resolve.mutate(batch.id)}
          >
            保留行を引き当て直す
          </button>
          <button type="button" disabled={registering || groups.length === 0} onClick={handleRegisterAll}>
            {registering ? "登録中..." : "すべて登録"}
          </button>
        </div>
      </div>

      {batch && (
        <p className="lab-import-summary">
          {batch.file_name ?? ""} / {batch.message_type ?? batch.format} / 取込元{" "}
          {batch.source ?? "(不明)"} / 文字コード {batch.encoding}(
          {ENCODING_REASONS[batch.encoding_reason ?? ""] ?? batch.encoding_reason}) / 取込日時{" "}
          {labInstantLabel(batch.created_at)} / {batch.row_count} 行
          {batch.skipped_count > 0 && `(結果なし・削除で読み飛ばし ${batch.skipped_count} 行)`}
        </p>
      )}

      {(batch?.duplicate_ids ?? []).length > 0 && (
        <p className="lab-import-card__warning">
          同じメッセージ ID のバッチが他にあります(
          {batch?.duplicate_ids.map((duplicateId, index) => (
            <span key={duplicateId}>
              {index > 0 && "、"}
              <Link to={`/lab-result-imports/${duplicateId}`}>#{duplicateId}</Link>
            </span>
          ))}
          )。同じ内容を二重に登録していないか確かめてください。
        </p>
      )}

      <ErrorBanner error={detail.error ?? resolve.error ?? error} />
      {resolve.isSuccess && <p role="status">{resolve.data.resolved} 行を引き当てました。</p>}

      {groups.map((group) => (
        <LabImportGroupCard
          key={group.groupNo}
          group={group}
          itemsByCode={itemsByCode}
          onRegister={handleRegister}
          onContextResolved={handleContextResolved}
          registering={registering}
          failure={failures[group.groupNo] || undefined}
        />
      ))}
      {groups.length === 0 && !detail.isLoading && <p>取り込んだ行がありません。</p>}
    </div>
  );
}
