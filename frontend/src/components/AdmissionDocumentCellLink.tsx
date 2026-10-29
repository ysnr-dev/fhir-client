import { Link } from "react-router-dom";
import type { AdmissionDocumentCell, AdmissionDocumentKind } from "../fhir/admissionDocumentHelpers";
import { formatKarteOpen, KARTE_OPEN_PARAM, type KarteOpenTarget } from "../karteUrl";
import type { useReturnLinkState } from "../returnTo";

// 入退院文書の 1 セル(入退院文書・栄養管理の一覧で共用)。押せるセルはカルテへのリンクで、
// 未作成なら登録を始め、作成済・作成中はその文書を開く。

/**
 * カルテで開く先。未作成なら登録を始め、作成済・作成中はその文書を開く。
 * 計画書は再評価日を過ぎていれば書き直し(新しい計画書)を始める。
 */
function openTargetOf(
  kind: AdmissionDocumentKind,
  cell: AdmissionDocumentCell,
  encounterId: string,
  templateUrl: string,
): KarteOpenTarget {
  switch (kind) {
    case "admission-plan":
      return cell.state === "missing"
        ? { kind: "admission-plan", encounterId }
        : { kind: "questionnaire-response", responseId: cell.resourceId };
    case "nutrition-screening":
    case "nutrition-plan":
    case "pressure-ulcer-risk":
    case "pressure-ulcer-plan":
      return cell.state === "missing" || (cell.state === "done" && cell.overdue)
        ? { kind: "encounter-template", encounterId, url: templateUrl }
        : { kind: "questionnaire-response", responseId: cell.resourceId };
    case "discharge-summary":
      return { kind: "discharge-summary", encounterId };
    case "nursing-summary":
      return cell.resourceId
        ? { kind: "nursing-summary", compositionId: cell.resourceId }
        : { kind: "nursing-summary-create", encounterId };
  }
}

export function AdmissionDocumentCellLink({
  kind,
  templateUrl,
  cell,
  encounterId,
  patientId,
  returnLinkState,
}: {
  kind: AdmissionDocumentKind;
  templateUrl: string;
  cell: AdmissionDocumentCell;
  encounterId: string;
  patientId: string;
  returnLinkState: ReturnType<typeof useReturnLinkState>;
}) {
  if (cell.state === "pending" || cell.state === "not-required") {
    // 退院前で、まだ書き始めていない退院系の文書と、必要性が判定前・無の計画書。
    return <span className="order-select__muted">{cell.label || "退院後"}</span>;
  }
  const target = openTargetOf(kind, cell, encounterId, templateUrl);
  const href = `/patients/${patientId}/karte?${KARTE_OPEN_PARAM}=${encodeURIComponent(formatKarteOpen(target))}`;
  const due = cell.due ? `期限 ${cell.due.slice(5).replace("-", "/")}` : "";
  // 押すと登録を始めるセル(未作成・再評価)は、カルテを開くだけのセルより目立たせる。
  const starts = cell.state === "missing" || (cell.state === "done" && cell.overdue);
  return (
    <Link
      to={href}
      state={returnLinkState}
      className={[
        "admission-documents__cell",
        `admission-documents__cell--${cell.state}`,
        starts ? "admission-documents__cell--start" : "",
        cell.overdue ? "admission-documents__cell--overdue" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      title={`${starts ? "登録を開始" : "カルテを開く"}${cell.due ? `(期限 ${cell.due})` : ""}`}
    >
      {cell.state === "missing" ? "未作成" : cell.label}
      {(cell.state !== "done" || cell.overdue) && due && <span className="admission-documents__due">{due}</span>}
    </Link>
  );
}
