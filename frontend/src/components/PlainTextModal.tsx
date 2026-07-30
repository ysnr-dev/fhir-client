import { useState } from "react";
import { Modal } from "./Modal";

interface PlainTextModalProps {
  title: string;
  text: string;
  onClose: () => void;
}

// 平文テキストの表示とクリップボードへのコピー。
export function PlainTextModal({ title, text, onClose }: PlainTextModalProps) {
  const [copyResult, setCopyResult] = useState<"copied" | "failed" | null>(null);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopyResult("copied");
    } catch {
      setCopyResult("failed");
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <pre className="plain-text-modal__text">{text}</pre>
      <div className="plain-text-modal__actions">
        <span className="plain-text-modal__result" role="status">
          {copyResult === "copied" && "コピーしました。"}
          {copyResult === "failed" && "コピーに失敗しました。"}
        </span>
        <button type="button" onClick={handleCopy}>
          クリップボードにコピー
        </button>
      </div>
    </Modal>
  );
}
