import { useState } from "react";
import { Modal } from "./Modal";

// 矢印・文字の注釈に書く文字の入力。ビューアの上に重ねるので <form> は使わず Enter で確定する。

export function DicomAnnotationTextModal({
  initialText,
  onDone,
}: {
  initialText: string;
  onDone: (text: string | null) => void;
}) {
  const [text, setText] = useState(initialText);
  const trimmed = text.trim();

  return (
    <Modal title="注釈の文字" onClose={() => onDone(null)} className="modal--dicom-text">
      <input
        type="text"
        className="dicom-tags__filter"
        aria-label="注釈の文字"
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing && trimmed) {
            e.preventDefault();
            onDone(trimmed);
          } else if (e.key === "Escape") {
            e.preventDefault();
            onDone(null);
          }
        }}
      />
      <div className="dicom-dialog__actions">
        <button type="button" onClick={() => onDone(null)}>
          取消
        </button>
        <button type="button" disabled={!trimmed} onClick={() => onDone(trimmed)}>
          決定
        </button>
      </div>
    </Modal>
  );
}
