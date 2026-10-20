import type { ReactNode } from "react";
import { useEscapeClose } from "../hooks/useEscapeClose";

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  /** 見出しのすぐ右に置くもの(使い方を開くボタンなど)。 */
  titleAction?: ReactNode;
}

export function Modal({ title, onClose, children, className, titleAction }: ModalProps) {
  // Escape は × と同じ。重ねて開いたときは一番上から閉じる(useEscapeClose)。
  useEscapeClose(onClose);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className={className ? `modal ${className}` : "modal"}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__header">
          {titleAction ? (
            <div className="modal__title">
              <h2>{title}</h2>
              {titleAction}
            </div>
          ) : (
            <h2>{title}</h2>
          )}
          <button type="button" className="modal__close" onClick={onClose} aria-label="閉じる">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
