import { useId } from "react";

/**
 * 短いラベルの横に置く小さな「?」。乗せるかフォーカスすると説明をツールチップで出す(押しても何も起きない)。
 * 説明はラベルを単語に保つためのもので、長い使い方は画面の「?」(使い方のモーダル)に書く。
 * 画面の左端近くに置くときは align="start" で吹き出しを左揃えにする(中央寄せだと左に見切れる)。
 */
export function HelpTip({ text, align = "center" }: { text: string; align?: "center" | "start" }) {
  const id = useId();
  return (
    <span className={align === "start" ? "help-tip help-tip--start" : "help-tip"}>
      <button type="button" className="help-tip__icon" aria-label="説明" aria-describedby={id}>
        ?
      </button>
      <span id={id} role="tooltip" className="help-tip__text">
        {text}
      </span>
    </span>
  );
}
