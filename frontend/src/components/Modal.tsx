import { useRef, type ReactNode } from "react";
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
  // 背景のクリックで閉じるのは、押し始めも背景だったときだけ(中の文字を選んで外で離しても閉じない)。
  // 中の入力欄を一度でも触ったら背景では閉じず、× か Escape で閉じる(入力を失わないように)。
  const pressedOnOverlay = useRef(false);
  const edited = useRef(false);
  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        pressedOnOverlay.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target !== e.currentTarget || !pressedOnOverlay.current || edited.current) return;
        onClose();
      }}
    >
      <div
        className={className ? `modal ${className}` : "modal"}
        onClick={(e) => e.stopPropagation()}
        onInput={() => {
          edited.current = true;
        }}
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
