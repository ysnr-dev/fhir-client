import { useState } from "react";
import {
  questionnairePlaceholders,
  RESERVED_PLACEHOLDERS,
} from "../fhir/reportPlaceholders";

// レイアウト(.tlf)に設定できるアイテム ID の一覧。
// ThinReports Basic Editor でレイアウトを作る際の対応表として表示する。
export function ReportPlaceholderList({
  questionnaire,
}: {
  questionnaire: fhir4.Questionnaire;
}) {
  const rows = questionnairePlaceholders(questionnaire);
  const hasCollision = rows.some((row) => row.collision);

  return (
    <details className="placeholder-list">
      <summary>使用可能なプレースホルダー一覧({rows.length + RESERVED_PLACEHOLDERS.length}件)</summary>

      {hasCollision && (
        <p className="error-banner">
          変換後の ID が衝突している linkId があります(下表の赤い行)。このままでは PDF
          生成がエラーになるため、テンプレート側の linkId を変更してください。
        </p>
      )}

      <table className="patient-table placeholder-list__table">
        <thead>
          <tr>
            <th>アイテム ID</th>
            <th>内容</th>
            <th>種類</th>
            <th>単位</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.tlfId}
              className={row.collision ? "placeholder-list__row--collision" : undefined}
            >
              <td>
                <code>{row.tlfId}</code>
                {row.inRepeatingGroup && <span className="placeholder-list__hint">(繰り返し)</span>}
              </td>
              <td>{row.label}</td>
              <td>{row.typeLabel}</td>
              <td>{row.unit ?? ""}</td>
              <td>
                <CopyButton text={row.tlfId} />
              </td>
            </tr>
          ))}
          {RESERVED_PLACEHOLDERS.map((row) => (
            <tr key={row.tlfId}>
              <td>
                <code>{row.tlfId}</code>
              </td>
              <td>{row.label}</td>
              <td>text-block(予約)</td>
              <td></td>
              <td>
                <CopyButton text={row.tlfId} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // clipboard API が使えない環境(非セキュアコンテキスト等)へのフォールバック
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  return (
    <button type="button" className="placeholder-list__copy" onClick={() => void copy()}>
      {copied ? "コピーしました" : "コピー"}
    </button>
  );
}
