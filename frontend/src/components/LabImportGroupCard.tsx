import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { LabResultImportRow, LabResultItem } from "../api/masterClient";
import { useLabResultImportMutations } from "../api/masterQueries";
import {
  importInterpretationOf,
  type LabImportGroup,
} from "../fhir/labImportHelpers";
import { labResultSubjectOf, parseCodeValueList } from "../fhir/labResultHelpers";
import {
  useLabImportGroupContext,
  type LabImportGroupContext,
} from "../hooks/useLabImportGroupContext";
import { registrationBlocker } from "../hooks/useLabImportRegistration";
import { ErrorBanner } from "./ErrorBanner";
import { LabImportResolveModal } from "./LabImportResolveModal";

// 取込の候補(ORC/OBR 群)1 件 = カード 1 枚。1 群が上流の検査結果 1 件になる。

const PENDING_REASONS: Record<string, string> = {
  item_unresolved: "結果項目が見つかりません",
  item_ambiguous: "結果項目の候補が複数あります",
  value_unmatched: "値が選択肢にありません",
  value_not_numeric: "数値ではありません",
};

interface Props {
  group: LabImportGroup;
  itemsByCode: Map<string, LabResultItem>;
  onRegister: (group: LabImportGroup, context: LabImportGroupContext) => void;
  /** 解決した文脈を親に預ける(「すべて登録」がカードを開かずに使うため)。 */
  onContextResolved: (groupNo: number, context: LabImportGroupContext | undefined) => void;
  registering: boolean;
  failure?: string;
}

export function LabImportGroupCard({
  group,
  itemsByCode,
  onRegister,
  onContextResolved,
  registering,
  failure,
}: Props) {
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [resolving, setResolving] = useState<LabResultImportRow | null>(null);
  const contextQuery = useLabImportGroupContext(group, selectedOrderId, true);
  const context = contextQuery.data;
  const subject = labResultSubjectOf(context?.patient);
  const blocker = registrationBlocker(group, context);

  useEffect(() => {
    onContextResolved(group.groupNo, context);
  }, [group.groupNo, context, onContextResolved]);

  return (
    <section className="lab-import-card">
      <header className="lab-import-card__header">
        <div>
          <strong>
            {group.patientName || "(氏名なし)"} ({group.patientNumber || "患者番号なし"})
          </strong>
          <span>{group.patientBirthDate}</span>
          <span>採取日 {group.collectedDate || "不明"}</span>
          <span>{group.specimenMaterialName}</span>
          {group.labelNumber && <span>ラベル {group.labelNumber}</span>}
          <span>{group.reportStatus === "preliminary" ? "中間報告" : "最終報告"}</span>
        </div>
        <div className="lab-import-card__actions">
          {group.registeredReportId && context?.patient?.id ? (
            <Link to={`/patients/${context.patient.id}/karte`} className="button">
              カルテ
            </Link>
          ) : (
            <button
              type="button"
              disabled={Boolean(blocker) || registering}
              title={blocker ?? undefined}
              onClick={() => context && onRegister(group, context)}
            >
              この候補を登録
            </button>
          )}
        </div>
      </header>

      <div className="lab-import-card__link">
        {contextQuery.isLoading && <span>患者とオーダーを照会中...</span>}
        {context?.order && (
          <span>
            オーダー: {context.orderContext.departmentName} {context.order.occurrenceDateTime ?? ""}
            {context.existingReportId ? "(既に結果あり。追記・訂正になります)" : ""}
          </span>
        )}
        {context?.resolvedBy === "patient-multiple" && (
          <label>
            オーダーを選ぶ
            <select
              value={selectedOrderId}
              onChange={(event) => setSelectedOrderId(event.target.value)}
            >
              <option value="">選択してください</option>
              {context.orderCandidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {context?.resolvedBy === "patient-none" && (
          <span>採取日のオーダーがありません。オーダーに紐付けずに登録します。</span>
        )}
        {(context?.warnings ?? []).map((warning) => (
          <span key={warning} className="lab-import-card__warning">
            {warning}
          </span>
        ))}
        {blocker && !group.registeredReportId && (
          <span className="lab-import-card__warning">{blocker}</span>
        )}
        {failure && <span className="lab-import-card__warning">{failure}</span>}
      </div>

      <ErrorBanner error={contextQuery.error} />

      <div className="lab-import-card__table">
        <table className="master-search__table">
          <thead>
            <tr>
              <th>ファイルの項目</th>
              <th>結果項目</th>
              <th>値</th>
              <th>単位</th>
              <th>ファイルの基準値</th>
              <th>ファイルの判定</th>
              <th>登録する判定</th>
              <th>コメント</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {group.rows.map((row) => (
              <LabImportRowCells
                key={row.id}
                row={row}
                group={group}
                item={row.result_item_code ? itemsByCode.get(row.result_item_code) : undefined}
                subject={subject}
                onResolve={() => setResolving(row)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {resolving && (
        <LabImportResolveModal row={resolving} onClose={() => setResolving(null)} />
      )}
    </section>
  );
}

interface RowProps {
  row: LabResultImportRow;
  group: LabImportGroup;
  item: LabResultItem | undefined;
  subject: ReturnType<typeof labResultSubjectOf>;
  onResolve: () => void;
}

function LabImportRowCells({ row, group, item, subject, onResolve }: RowProps) {
  const { updateRow } = useLabResultImportMutations();
  const pending = row.status === "pending";
  const options = item ? parseCodeValueList(item.code_value_list) : [];

  return (
    <tr className={pending ? "lab-import-row--pending" : undefined}>
      <td>
        {row.external_name ?? ""}
        <small>{row.external_code ?? ""}</small>
      </td>
      <td>
        {item ? `${item.name} (${item.result_item_code})` : ""}
        {pending && (
          <span className="lab-import-row__reason">
            {PENDING_REASONS[row.pending_reason ?? ""] ?? "保留"}
          </span>
        )}
      </td>
      <td>
        {row.pending_reason === "value_unmatched" && options.length > 0 ? (
          <select
            value={row.value ?? ""}
            onChange={(event) =>
              updateRow.mutate({ id: row.id, payload: { value: event.target.value } })
            }
          >
            <option value="">選択してください</option>
            {options.map((option) => (
              <option key={option.code} value={option.code}>
                {option.display}
              </option>
            ))}
          </select>
        ) : row.pending_reason === "value_not_numeric" ? (
          <input
            type="text"
            defaultValue={row.value ?? ""}
            onBlur={(event) =>
              updateRow.mutate({ id: row.id, payload: { value: event.target.value } })
            }
          />
        ) : (
          (row.value ?? "")
        )}
      </td>
      <td>{row.unit ?? ""}</td>
      <td>{row.reference_range ?? ""}</td>
      <td>{row.abnormal_flag ?? ""}</td>
      <td>{importInterpretationOf(row, item, subject, group.collectedDate)}</td>
      <td>{row.note ?? ""}</td>
      <td>
        {pending && (
          <button type="button" onClick={onResolve}>
            結果項目を選ぶ
          </button>
        )}
        {row.status !== "registered" && (
          <button
            type="button"
            onClick={() =>
              updateRow.mutate({
                id: row.id,
                payload: { status: row.status === "skipped" ? "pending" : "skipped" },
              })
            }
          >
            {row.status === "skipped" ? "戻す" : "対象外"}
          </button>
        )}
      </td>
    </tr>
  );
}
