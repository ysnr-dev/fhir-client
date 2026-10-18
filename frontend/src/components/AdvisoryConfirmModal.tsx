import { useState, type ReactNode } from "react";
import { useAdvisoryOverrideReasons } from "../api/masterQueries";
import {
  type Advisory,
  type AdvisoryOverride,
  ADVISORY_OVERRIDE_REASON_SYSTEM,
  advisoryKindLabel,
  sortBySeverity,
} from "../fhir/advisoryHelpers";
import { Modal } from "./Modal";

// 登録前の確認(docs/advisory-design.md §2.6)。確認を要する警告ごとに理由を選ぶまで登録できない。
// 表示のみの警告(外部の判断支援の情報など)も並べるが理由は要らない。
// フォームの中に置くので、ボタンは type="button"(外側の form を submit させない)。

export interface AdvisoryReasonOption {
  code: string;
  display: string;
  system?: string;
}

interface AdvisoryConfirmModalProps {
  advisories: Advisory[];
  submitting?: boolean;
  onConfirm: (overrides: AdvisoryOverride[]) => void;
  onCancel: () => void;
  /** 警告ごとの理由の候補。返さなければマスタ(警告の確認理由)。 */
  reasonOptions?: (advisory: Advisory) => AdvisoryReasonOption[] | undefined;
  /** 警告の下に足す内容(外部の判断支援のリンクなど)。 */
  renderExtra?: (advisory: Advisory) => ReactNode;
}

export function AdvisoryConfirmModal({
  advisories,
  submitting = false,
  onConfirm,
  onCancel,
  reasonOptions,
  renderExtra,
}: AdvisoryConfirmModalProps) {
  const masterReasons = useAdvisoryOverrideReasons();
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [texts, setTexts] = useState<Record<string, string>>({});

  const defaultOptions: AdvisoryReasonOption[] = masterReasons.map((reason) => ({
    code: reason.code,
    display: reason.name,
    system: ADVISORY_OVERRIDE_REASON_SYSTEM,
  }));
  const optionsFor = (advisory: Advisory) => reasonOptions?.(advisory) ?? defaultOptions;

  const required = advisories.filter((advisory) => advisory.severity !== "info");
  const missing = required.filter((advisory) => !reasons[advisory.key]);

  function confirm() {
    const overrides: AdvisoryOverride[] = required.flatMap((advisory) => {
      const option = optionsFor(advisory).find((o) => o.code === reasons[advisory.key]);
      if (!option) return [];
      return [
        {
          advisory,
          reasonCode: option.code,
          reasonName: option.display,
          reasonSystem: option.system,
          text: (texts[advisory.key] ?? "").trim(),
        },
      ];
    });
    onConfirm(overrides);
  }

  return (
    <Modal title="警告の確認" onClose={onCancel} className="advisory-confirm-modal">
      <ul className="advisory-confirm-modal__list">
        {sortBySeverity(advisories).map((advisory) => (
          <li key={advisory.key} className={`advisory-confirm-modal__item advisory--${advisory.severity}`}>
            <div className="advisory-confirm-modal__head">
              <span className="advisory-confirm-modal__kind">{advisoryKindLabel(advisory.kind)}</span>
              <span className="advisory-confirm-modal__message" title={advisory.detail}>
                {advisory.message}
              </span>
            </div>
            {advisory.detail && <p className="advisory-confirm-modal__detail">{advisory.detail}</p>}
            {advisory.source && (
              <div className="advisory-confirm-modal__source">
                {advisory.source.url ? (
                  <a href={advisory.source.url} target="_blank" rel="noopener noreferrer">
                    {advisory.source.label}
                  </a>
                ) : (
                  advisory.source.label
                )}
              </div>
            )}
            {renderExtra?.(advisory)}
            {advisory.severity !== "info" && (
              <div className="advisory-confirm-modal__reason">
                <select
                  aria-label="理由"
                  value={reasons[advisory.key] ?? ""}
                  onChange={(e) => setReasons((current) => ({ ...current, [advisory.key]: e.target.value }))}
                >
                  <option value="">理由…</option>
                  {optionsFor(advisory).map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.display}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  aria-label="補足"
                  placeholder="補足"
                  value={texts[advisory.key] ?? ""}
                  onChange={(e) => setTexts((current) => ({ ...current, [advisory.key]: e.target.value }))}
                />
              </div>
            )}
          </li>
        ))}
      </ul>
      <div className="lab-order-item__actions">
        <button type="button" onClick={confirm} disabled={missing.length > 0 || submitting}>
          登録
        </button>
        <button type="button" onClick={onCancel} disabled={submitting}>
          戻る
        </button>
      </div>
    </Modal>
  );
}
