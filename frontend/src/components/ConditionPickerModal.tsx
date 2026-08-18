import { useMemo, useState } from "react";
import { useKarteConditions } from "../api/queries";
import {
  CATEGORY_LABELS,
  OUTCOME_OPTIONS,
  summarizeCondition,
  type ConditionCategory,
} from "../fhir/conditionHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

// 患者に登録済みの病名から 1 つ選ぶモーダル。放射線オーダーの依頼病名のように、
// 「登録されている病名を写して入力欄に入れる」用途で使う。
//
// 候補はカルテと同じ 1 回の取得(useKarteConditions)で全区分ぶん揃うので、
// 絞り込みはサーバーへ問い合わせず手元で行う(入力のたびに即反映する)。
// プロブレム・既往歴・保険病名を区別せず並べるのは、依頼先が読むのは病名そのもので、
// どの区分として登録されているかは関係ないため。

interface ConditionPickerModalProps {
  patientId: string;
  title?: string;
  /** 選んだ病名。conditionId は「どの登録病名から取ったか」の紐付けに使う。 */
  onSelect: (selected: { conditionId: string; name: string }) => void;
  onClose: () => void;
}

/** 転帰区分のコード。Condition.clinicalStatus に直接対応する。 */
function outcomeCodeOf(condition: fhir4.Condition): string {
  return condition.clinicalStatus?.coding?.[0]?.code ?? "";
}

export function ConditionPickerModal({
  patientId,
  title = "病名を選択",
  onSelect,
  onClose,
}: ConditionPickerModalProps) {
  const { conditions, isLoading, error } = useKarteConditions(patientId);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<ConditionCategory | "">("");
  const [outcome, setOutcome] = useState("");

  const rows = useMemo(() => {
    const keyword = name.trim();
    return conditions
      .map((condition) => ({
        summary: summarizeCondition(condition),
        outcomeCode: outcomeCodeOf(condition),
      }))
      .filter((row) => row.summary.id && row.summary.name)
      .filter((row) => !keyword || row.summary.name.includes(keyword))
      .filter((row) => !category || row.summary.category === category)
      .filter((row) => !outcome || row.outcomeCode === outcome);
  }, [conditions, name, category, outcome]);

  return (
    <Modal title={title} onClose={onClose} className="modal--condition-picker">
      {/* オーダーフォーム(form 要素)の中から開くモーダルなので、form の入れ子は
          作らない(入れ子は外側フォームのネイティブ submit を誘発する)。 */}
      <div className="patient-search-form">
        <label>
          病名
          <input
            type="text"
            value={name}
            placeholder="病名の一部"
            onChange={(e) => setName(e.target.value)}
            // 絞り込みは入力のたびに効くので、Enter は何もせず外へも漏らさない。
            onKeyDown={(e) => {
              if (e.key === "Enter") e.preventDefault();
            }}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
          />
        </label>
        <label>
          区分
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as ConditionCategory | "")}
          >
            <option value="">すべて</option>
            {(Object.keys(CATEGORY_LABELS) as ConditionCategory[]).map((key) => (
              <option key={key} value={key}>
                {CATEGORY_LABELS[key]}
              </option>
            ))}
          </select>
        </label>
        <label>
          転帰区分
          <select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            <option value="">すべて</option>
            {OUTCOME_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.display}
              </option>
            ))}
          </select>
        </label>
      </div>

      <ErrorBanner error={error} />

      <div className="master-search__table-wrap">
        <table className="master-search__table">
          <thead>
            <tr>
              <th>区分</th>
              <th>病名</th>
              <th>開始日</th>
              <th>終了日</th>
              <th>転帰</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ summary }) => (
              <tr key={summary.id}>
                <td>
                  <span
                    className={`condition-badge condition-badge--${summary.category}`}
                    title={CATEGORY_LABELS[summary.category]}
                  >
                    {summary.category === "problem"
                      ? summary.problemNumber === undefined
                        ? "P"
                        : `#${summary.problemNumber}`
                      : summary.category === "past"
                        ? "既往"
                        : "保険"}
                  </span>
                </td>
                <td>{summary.name}</td>
                <td>{summary.startDate || "-"}</td>
                <td>{summary.endDate || "-"}</td>
                <td>{summary.outcomeDisplay || "-"}</td>
                <td className="master-search__actions">
                  <button
                    type="button"
                    onClick={() => onSelect({ conditionId: summary.id, name: summary.name })}
                  >
                    選択
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="master-search__empty">
                  {isLoading
                    ? "読み込み中..."
                    : conditions.length === 0
                      ? "登録されている病名がありません。"
                      : "条件に該当する病名がありません。"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
