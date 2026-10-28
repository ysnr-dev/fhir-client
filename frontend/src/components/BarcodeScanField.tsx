import { useState } from "react";

// バーコードリーダーの読み取りを受ける欄。リーダーはキーボード入力として文字と Enter を送るので、
// テキスト欄で受けて Enter で確定する。<form> を使わないのは、フォームの中に置かれても外側を
// submit させないため。手入力もできる。
export function BarcodeScanField({
  onScan,
  ariaLabel,
}: {
  onScan: (value: string) => void;
  ariaLabel: string;
}) {
  const [value, setValue] = useState("");
  return (
    <input
      type="text"
      className="barcode-scan-field"
      value={value}
      aria-label={ariaLabel}
      autoFocus
      autoComplete="off"
      spellCheck={false}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
        e.preventDefault();
        const scanned = value.normalize("NFKC").trim();
        setValue("");
        if (scanned) onScan(scanned);
      }}
    />
  );
}
