import type { ReactNode } from "react";
import { splitConditions, summarizeCondition } from "../../fhir/conditionHelpers";
import { KartePrintEmptyRow, KartePrintGroupRow, KartePrintSheet } from "./KartePrintSheet";

// カルテ印刷の病名・プロブレム。1 号用紙の傷病名欄と同じく期間で切らずに累積で出し、
// 開始日・終了日・転帰で期間中の状態を読む。

const COLUMNS = ["番号", "病名", "開始日", "終了日", "転帰"];
const WIDTHS = ["8%", "50%", "14%", "14%", "14%"];

export function RecordExportConditions({ header, conditions }: { header: ReactNode; conditions: fhir4.Condition[] }) {
  const { problems, billings, pasts } = splitConditions(conditions);
  const groups: { label: string; conditions: fhir4.Condition[] }[] = [
    { label: "プロブレム", conditions: problems },
    { label: "病名", conditions: billings },
    { label: "既往歴", conditions: pasts },
  ];
  return (
    <KartePrintSheet header={header} title="病名・プロブレム" columns={COLUMNS} widths={WIDTHS}>
      {conditions.length === 0 ? (
        <KartePrintEmptyRow span={COLUMNS.length}>登録されている病名はありません。</KartePrintEmptyRow>
      ) : (
        groups
          .filter((group) => group.conditions.length > 0)
          .map((group) => (
            <ConditionGroup key={group.label} label={group.label} conditions={group.conditions} />
          ))
      )}
    </KartePrintSheet>
  );
}

function ConditionGroup({ label, conditions }: { label: string; conditions: fhir4.Condition[] }) {
  return (
    <>
      <KartePrintGroupRow span={COLUMNS.length}>{label}</KartePrintGroupRow>
      {conditions.map((condition) => {
        const summary = summarizeCondition(condition);
        return (
          <tr key={summary.id}>
            <td>{summary.problemNumber === undefined ? "" : `#${summary.problemNumber}`}</td>
            <td>{summary.name}</td>
            <td>{summary.startDate}</td>
            <td>{summary.endDate}</td>
            <td>{summary.outcomeDisplay}</td>
          </tr>
        );
      })}
    </>
  );
}
