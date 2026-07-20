import type { ReactNode } from "react";

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}

export function Modal({ title, onClose, children, className }: ModalProps) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className={className ? `modal ${className}` : "modal"}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__header">
          <h2>{title}</h2>
          <button type="button" className="modal__close" onClick={onClose} aria-label="閉じる">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
