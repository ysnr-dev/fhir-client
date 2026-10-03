import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { displayName } from "../fhir/patientHelpers";
import { KarteProfileTab } from "./KarteProfileTab";
import { useReturnLinkState } from "../returnTo";

interface PatientProfileDrawerProps {
  patient: fhir4.Patient & { id: string };
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
export function PatientProfileDrawer({ patient, onClose }: PatientProfileDrawerProps) {
  // 別の患者に切り替えたら表示対象は持ち越さない。ドロワー自体は作り直さない
  // (開くときのアニメーションを患者を替えるたびに繰り返さないため)。
  const [viewState, setViewState] = useState({ patientId: patient.id, view: "" });
  const view = viewState.patientId === patient.id ? viewState.view : "";
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
          <span className="patient-drawer__number">{patient.identifier?.[0]?.value}</span>
          {displayName(patient) || patient.id}
        </h2>
        <div className="patient-drawer__actions">
          <Link className="button" to={`/patients/${patient.id}/karte`} state={returnLinkState}>
            カルテ
          </Link>
          <button type="button" className="modal__close" onClick={onClose} aria-label="閉じる">
            ×
          </button>
        </div>
      </div>
      <KarteProfileTab
        key={patient.id}
        patientId={patient.id}
        view={view}
        onViewChange={(v) => setViewState({ patientId: patient.id, view: v ?? "" })}
      />
    </aside>
  );
}
