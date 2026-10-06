import { useMemo, useState } from "react";
import { FhirError } from "../api/fhirClient";
import { useBulkUpdateConditions, useKarteConditions } from "../api/queries";
import {
  applyBulkConditionChange,
  bulkConditionChangeError,
  isActiveCondition,
  OUTCOME_OPTIONS,
  summarizeCondition,
  type BulkConditionChange,
  type OutcomeCode,
} from "../fhir/conditionHelpers";
import { today } from "../lib/dates";
import { ConditionCategoryBadge } from "./ConditionTable";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";
import { TruncatedNotice } from "./TruncatedNotice";

// 病名タブの一括操作。選んだ病名に同じ転帰区分・終了日を付けるか、開始日をそろえる。
// 対象はページングせず患者の病名全件から選ぶ(20 件ずつの一覧ではページをまたいで選べないため)。

type BulkKind = BulkConditionChange["kind"];
type EndOutcome = Exclude<OutcomeCode, "active">;

const END_OUTCOMES = OUTCOME_OPTIONS.filter(
  (o): o is (typeof OUTCOME_OPTIONS)[number] & { code: EndOutcome } => o.code !== "active",
);

export function ConditionBulkModal({
  patientId,
  onClose,
}: {
  patientId: string;
  onClose: () => void;
}) {
  const { conditions, data, isLoading, error, refetch } = useKarteConditions(patientId);
  const bulkUpdate = useBulkUpdateConditions();

  const [kind, setKind] = useState<BulkKind>("outcome");
  const [outcome, setOutcome] = useState<EndOutcome>("resolved");
  const [endDate, setEndDate] = useState(today());
  const [startDate, setStartDate] = useState("");
  const [showEnded, setShowEnded] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [conflict, setConflict] = useState(false);

  const change: BulkConditionChange =
    kind === "outcome" ? { kind, outcome, endDate } : { kind, startDate };

  const visible = useMemo(
    () => conditions.filter((c) => showEnded || isActiveCondition(c)),
    [conditions, showEnded],
  );
  const targets = visible.filter((c) => c.id && selected.has(c.id));
  const targetErrors = targets.map((c) => bulkConditionChangeError(c, change));
  const hasError = targetErrors.some(Boolean);
  const allChecked = visible.length > 0 && visible.every((c) => c.id && selected.has(c.id));
  const total = data?.data.total;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allChecked ? new Set() : new Set(visible.flatMap((c) => (c.id ? [c.id] : []))));
  }

  function handleSubmit() {
    if (targets.length === 0 || hasError) return;
    setConflict(false);
    bulkUpdate.mutate(
      targets.map((c) => applyBulkConditionChange(c, change)),
      {
        onSuccess: onClose,
        onError: (err) => {
          // 版違いは最新を読み直す。選択はそのまま残るので、内容を確かめて登録し直せる。
          if (err instanceof FhirError && err.status === 412) {
            setConflict(true);
            void refetch();
          }
        },
      },
    );
  }

  return (
    <Modal title="病名の一括変更" onClose={onClose} className="condition-bulk">
      <ErrorBanner error={error} />
      <ErrorBanner error={conflict ? undefined : bulkUpdate.error} />
      {conflict && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">
            選んだ病名のいずれかが他の操作によって更新されていたため、最新の内容を読み直しました。確認してから再度登録してください。
          </p>
        </div>
      )}
      <TruncatedNotice show={total !== undefined && total > conditions.length} />

      <div className="clinical-note-form__mode">
        <span className="clinical-note-form__mode-legend">操作</span>
        <div className="clinical-note-form__mode-options">
          {(
            [
              ["outcome", "転帰"],
              ["onset", "開始日変更"],
            ] as const
          ).map(([value, label]) => (
            <label className="clinical-note-form__mode-option" key={value}>
              <input
                type="radio"
                name="condition-bulk-kind"
                checked={kind === value}
                onChange={() => setKind(value)}
              />
              {label}
            </label>
          ))}
        </div>
      </div>

      <div className="walk-in__fields">
        {kind === "outcome" ? (
          <>
            <label>
              転帰区分
              <select value={outcome} onChange={(e) => setOutcome(e.target.value as EndOutcome)}>
                {END_OUTCOMES.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.display}
                  </option>
                ))}
              </select>
            </label>
            <label>
              終了日
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </label>
          </>
        ) : (
          <label>
            開始日
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
        )}
        <label className="condition-bulk__show-ended">
          <input
            type="checkbox"
            checked={showEnded}
            onChange={(e) => setShowEnded(e.target.checked)}
          />
          転帰済みも表示
        </label>
      </div>

      {isLoading ? (
        <p>読み込み中...</p>
      ) : visible.length === 0 ? (
        <p className="patient-table__empty">対象の病名がありません。</p>
      ) : (
        <table className="patient-table condition-bulk__table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  checked={allChecked}
                  onChange={toggleAll}
                  aria-label="すべて選択"
                />
              </th>
              <th>区分</th>
              <th>病名</th>
              <th>開始日</th>
              <th>終了日</th>
              <th>転帰</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((condition) => {
              const summary = summarizeCondition(condition);
              const checked = selected.has(summary.id);
              const rowError = checked ? bulkConditionChangeError(condition, change) : null;
              return (
                <tr key={summary.id} className={rowError ? "condition-bulk__row--error" : undefined}>
                  <td>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(summary.id)}
                      aria-label={`${summary.name} を選択`}
                    />
                  </td>
                  <td>
                    <ConditionCategoryBadge summary={summary} />
                  </td>
                  <td>
                    {summary.name}
                    {rowError && <div className="condition-bulk__error">{rowError}</div>}
                  </td>
                  <td>{summary.startDate || "-"}</td>
                  <td>{summary.endDate || "-"}</td>
                  <td>{summary.outcomeDisplay || "-"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <div className="walk-in__actions condition-bulk__actions">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={targets.length === 0 || hasError || bulkUpdate.isPending}
        >
          {bulkUpdate.isPending ? "登録中..." : `登録(${targets.length} 件)`}
        </button>
        <button type="button" onClick={onClose} disabled={bulkUpdate.isPending}>
          キャンセル
        </button>
      </div>
    </Modal>
  );
}
