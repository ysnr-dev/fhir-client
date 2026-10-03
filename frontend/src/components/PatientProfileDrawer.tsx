import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { displayName } from "../fhir/patientHelpers";
import { KarteProfileTab } from "./KarteProfileTab";
import { useReturnLinkState } from "../returnTo";

interface PatientProfileDrawerProps {
  patientId: string;
  patient?: fhir4.Patient;
  /** patient が引けていないときの見出し。 */
  fallbackName?: string;
  /**
   * 行と同じ操作。行のボタン(カルテを除く)を先に、ケバブメニューの項目
   * (.row-menu__item)を後に渡すと、ドロワーの中ではどちらもボタンとして並ぶ。
   */
  actions?: ReactNode;
  /** 見出しのカルテの左に置く操作。カルテを開く前後に続けて押すもの。 */
  headerActions?: ReactNode;
  onClose: () => void;
}

// Escape を先に受け取るもの(モーダル、ケバブメニュー、ピクトグラムの吹き出し)。
// これらが開いているときの Escape はそちらを閉じるだけにする。
const ESCAPE_OWNERS = ".modal-overlay, .row-menu__items, .patient-header__popover";

/**
 * 一覧の右から出す患者プロファイル。カルテを開かずに中身を確かめるためのもの。
 * 一覧を覆わない(背景を暗くしない)ので、開いたまま別の行を選べる。
 * 中身はカルテのプロファイルタブそのもので、注意の詳細などの表示対象は
 * URL に載せずこの中だけで持つ。
 */
export function PatientProfileDrawer({
  patientId,
  patient,
  fallbackName,
  actions,
  headerActions,
  onClose,
}: PatientProfileDrawerProps) {
  // 別の患者に切り替えたら表示対象は持ち越さない。ドロワー自体は作り直さない
  // (開くときのアニメーションを患者を替えるたびに繰り返さないため)。
  const [viewState, setViewState] = useState({ patientId, view: "" });
  const view = viewState.patientId === patientId ? viewState.view : "";
  const returnLinkState = useReturnLinkState();

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector(ESCAPE_OWNERS)) return;
      onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <aside className="patient-drawer" aria-label="患者プロファイル">
      <div className="patient-drawer__header">
        <h2>
          <span className="patient-drawer__number">{patient?.identifier?.[0]?.value}</span>
          {(patient && displayName(patient)) || fallbackName || patientId}
        </h2>
        <div className="patient-drawer__actions">
          {headerActions}
          <Link className="button" to={`/patients/${patientId}/karte`} state={returnLinkState}>
            カルテ
          </Link>
          <button type="button" className="modal__close" onClick={onClose} aria-label="閉じる">
            ×
          </button>
        </div>
      </div>
      {actions && <div className="patient-drawer__menu">{actions}</div>}
      <KarteProfileTab
        key={patientId}
        patientId={patientId}
        view={view}
        onViewChange={(v) => setViewState({ patientId, view: v ?? "" })}
      />
    </aside>
  );
}

/**
 * 一覧の行を押してドロワーを開くための選択状態。
 *
 * `scope` は同じ画面で表を切り替えるとき(入院患者一覧のタブなど)に渡す。
 * 選んだときと違う scope の表では選択していないものとして扱う。
 */
export function useRowDrawer(scope = "") {
  const [state, setState] = useState<{ scope: string; key: string } | null>(null);
  const selectedKey = state?.scope === scope ? state.key : null;

  /** 行(tr)に付ける className と onClick。key が無い行(空床など)は押せない。 */
  function rowProps(key: string | undefined, className?: string) {
    if (!key) return { className };
    const selected = key === selectedKey;
    return {
      className: [
        className,
        "patient-table__row--clickable",
        selected ? "patient-table__row--selected" : "",
      ]
        .filter(Boolean)
        .join(" "),
      onClick: (event: MouseEvent<HTMLTableRowElement>) => {
        if (!isRowSelectClick(event)) return;
        setState(selected ? null : { scope, key });
      },
    };
  }

  return { selectedKey, rowProps, close: () => setState(null) };
}

// 行の中のボタン・リンク(カルテ、ピクトグラム、ケバブ)は各自の操作を優先する。
// ピクトグラムの吹き出しやメニューは body 直下へ出すことがあるが、React のイベントは
// 行まで伝わってくるので、行の DOM の外からのクリックも除く。複数行にまたがる
// セル(入院患者一覧の病室)は、どの行を選んだのか決まらないので押せない。
function isRowSelectClick(event: MouseEvent<HTMLTableRowElement>): boolean {
  const target = event.target as HTMLElement;
  if (!event.currentTarget.contains(target)) return false;
  if (target.closest("a, button, input, select, label, [role='menu']")) return false;
  const cell = target.closest("td");
  return !(cell && cell.rowSpan > 1);
}
