import type { ReactNode } from "react";
import { HelpTip } from "../HelpTip";

// データ抽出の入力フォームの 1 行。左に役割の見出し語(記録 / 患者 / 比較 / 表)、右に欄を折り返して並べる。
// 見出し語の横には短い説明(HelpTip)か、使い方のモーダルを開く「?」を置ける。

interface Props {
  label: string;
  help?: string;
  onGuide?: () => void;
  children: ReactNode;
}

export function ExtractFormRow({ label, help, onGuide, children }: Props) {
  return (
    <div className="extract-form-row" role="group" aria-label={label}>
      <div className="extract-form-row__label">
        <span>{label}</span>
        {help && <HelpTip text={help} align="start" />}
        {onGuide && (
          <button
            type="button"
            className="modal__help"
            aria-label={`${label}の使い方`}
            title={`${label}の使い方`}
            onClick={onGuide}
          >
            ?
          </button>
        )}
      </div>
      <div className="extract-form-row__fields">{children}</div>
    </div>
  );
}
