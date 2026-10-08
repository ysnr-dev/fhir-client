import { useId } from "react";

/**
 * 短いラベルの横に置く小さな「?」。乗せるかフォーカスすると説明をツールチップで出す(押しても何も起きない)。
 * 説明はラベルを単語に保つためのもので、長い使い方は画面の「?」(使い方のモーダル)に書く。
 */
export function HelpTip({ text }: { text: string }) {
  const id = useId();
  return (
    <span className="help-tip">
      <button type="button" className="help-tip__icon" aria-label="説明" aria-describedby={id}>
        ?
      </button>
      <span id={id} role="tooltip" className="help-tip__text">
        {text}
      </span>
    </span>
  );
}
