import { TrashIcon } from "./icons/TrashIcon";

/** 明細の行を外すボタン(ゴミ箱アイコン)。 */
export function RemoveRowButton({ onClick, title = "外す" }: { onClick: () => void; title?: string }) {
  return (
    <button
      type="button"
      className="rp-card__icon-button"
      title={title}
      aria-label={title}
      onClick={onClick}
    >
      <TrashIcon />
    </button>
  );
}
