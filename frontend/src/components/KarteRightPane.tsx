import { ClinicalNoteCreatePanel, ClinicalNoteEditPanel } from "./ClinicalNotePanels";
import { PrescriptionCreatePanel, PrescriptionEditPanel } from "./PrescriptionPanels";
import {
  QuestionnaireResponseCreatePanel,
  QuestionnaireResponseEditPanel,
} from "./QuestionnaireResponsePanels";

// カルテ画面の右ペイン。登録・編集 UI は既存ページと共通のパネルを使う。

export type KartePaneState =
  | { kind: "empty" }
  | { kind: "note-create" }
  | { kind: "note-edit"; noteId: string }
  | { kind: "prescription-create"; sourceSrId?: string }
  | { kind: "prescription-edit"; srId: string }
  | { kind: "qr-create" }
  | { kind: "qr-edit"; qrId: string };

const PANE_TITLES: Record<KartePaneState["kind"], string> = {
  empty: "",
  "note-create": "診療記録登録",
  "note-edit": "診療記録編集",
  "prescription-create": "処方登録",
  "prescription-edit": "処方編集",
  "qr-create": "テンプレート登録",
  "qr-edit": "テンプレート編集",
};

// 対象が切り替わったらフォームを作り直すためのキー。各フォームは初期値を useState の
// 初期値としてのみ読むため、同じ種類の別リソースへ切り替えるにはリマウントが要る。
function paneKey(state: KartePaneState): string {
  switch (state.kind) {
    case "note-edit":
      return `${state.kind}:${state.noteId}`;
    case "prescription-edit":
      return `${state.kind}:${state.srId}`;
    case "qr-edit":
      return `${state.kind}:${state.qrId}`;
    case "prescription-create":
      return `${state.kind}:${state.sourceSrId ?? ""}`;
    default:
      return state.kind;
  }
}

interface KarteRightPaneProps {
  patientId: string;
  state: KartePaneState;
  onStateChange: (state: KartePaneState) => void;
}

export function KarteRightPane({ patientId, state, onStateChange }: KarteRightPaneProps) {
  const close = () => onStateChange({ kind: "empty" });

  return (
    <section className="karte-right">
      <div className="karte-right__body">
        {state.kind === "empty" ? (
          <p className="karte-right__placeholder">
            右上のボタンから新規登録、またはカルテの「編集」から編集を開始してください。
          </p>
        ) : (
          <>
            <div className="karte-right__header">
              <h2>{PANE_TITLES[state.kind]}</h2>
              <button type="button" onClick={close}>
                閉じる
              </button>
            </div>
            {/* 対象切替でフォームを作り直す(初期値は初回描画時のみ反映されるため)。 */}
            <div key={paneKey(state)}>
              <PaneContent patientId={patientId} state={state} onSaved={close} />
            </div>
          </>
        )}
      </div>

      {/* 新規登録の入口。デザイン上は右端に縦並び。 */}
      <div className="karte-right__actions">
        <button type="button" onClick={() => onStateChange({ kind: "note-create" })}>
          診療記録
        </button>
        <button type="button" onClick={() => onStateChange({ kind: "qr-create" })}>
          テンプレート
        </button>
        <button type="button" onClick={() => onStateChange({ kind: "prescription-create" })}>
          処方
        </button>
      </div>
    </section>
  );
}

function PaneContent({
  patientId,
  state,
  onSaved,
}: {
  patientId: string;
  state: KartePaneState;
  onSaved: () => void;
}) {
  switch (state.kind) {
    case "note-create":
      return <ClinicalNoteCreatePanel patientId={patientId} onSaved={onSaved} />;
    case "note-edit":
      return (
        <ClinicalNoteEditPanel patientId={patientId} noteId={state.noteId} onSaved={onSaved} />
      );
    case "prescription-create":
      return (
        <PrescriptionCreatePanel
          patientId={patientId}
          sourceSrId={state.sourceSrId}
          onSaved={onSaved}
        />
      );
    case "prescription-edit":
      return <PrescriptionEditPanel patientId={patientId} srId={state.srId} onSaved={onSaved} />;
    case "qr-create":
      return <QuestionnaireResponseCreatePanel patientId={patientId} onSaved={onSaved} />;
    case "qr-edit":
      return (
        <QuestionnaireResponseEditPanel patientId={patientId} qrId={state.qrId} onSaved={onSaved} />
      );
    case "empty":
      return null;
  }
}
