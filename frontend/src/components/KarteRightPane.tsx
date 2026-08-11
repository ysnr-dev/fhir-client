import type { ProblemRef } from "../fhir/conditionHelpers";
import { ClinicalNoteCreatePanel, ClinicalNoteEditPanel } from "./ClinicalNotePanels";
import { InjectionCreatePanel, InjectionEditPanel } from "./InjectionPanels";
import { LabOrderCreatePanel, LabOrderEditPanel } from "./LabOrderPanels";
import { MicroOrderCreatePanel, MicroOrderEditPanel } from "./MicroOrderPanels";
import { PrescriptionCreatePanel, PrescriptionEditPanel } from "./PrescriptionPanels";
import { RadOrderCreatePanel, RadOrderEditPanel } from "./RadOrderPanels";
import {
  QuestionnaireResponseCreatePanel,
  QuestionnaireResponseEditPanel,
} from "./QuestionnaireResponsePanels";

// カルテ画面の右ペイン。登録・編集 UI は既存ページと共通のパネルを使う。

export type KartePaneState =
  | { kind: "empty" }
  // problem: 登録ボタンを押した時点で選択されていたプロブレム(対象の初期値)。
  | { kind: "note-create"; problem?: ProblemRef }
  | { kind: "note-edit"; noteId: string }
  // DO(sourceSrId あり)では対象プロブレムも DO 元から引き継ぐので problem は使わない。
  | { kind: "prescription-create"; sourceSrId?: string; problem?: ProblemRef }
  | { kind: "prescription-edit"; srId: string }
  | { kind: "injection-create"; sourceSrId?: string; problem?: ProblemRef }
  | { kind: "injection-edit"; srId: string }
  | { kind: "lab-order-create"; sourceSrId?: string; problem?: ProblemRef }
  | { kind: "lab-order-edit"; srId: string }
  | { kind: "micro-order-create"; sourceSrId?: string; problem?: ProblemRef }
  | { kind: "micro-order-edit"; srId: string }
  | { kind: "rad-order-create"; sourceSrId?: string; problem?: ProblemRef }
  | { kind: "rad-order-edit"; srId: string }
  | { kind: "qr-create" }
  | { kind: "qr-edit"; qrId: string };

const PANE_TITLES: Record<KartePaneState["kind"], string> = {
  empty: "",
  "note-create": "診療記録登録",
  "note-edit": "診療記録編集",
  "prescription-create": "処方登録",
  "prescription-edit": "処方編集",
  "injection-create": "注射登録",
  "injection-edit": "注射編集",
  "lab-order-create": "検体検査登録",
  "lab-order-edit": "検体検査編集",
  "micro-order-create": "細菌検査登録",
  "micro-order-edit": "細菌検査編集",
  "rad-order-create": "放射線検査登録",
  "rad-order-edit": "放射線検査編集",
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
    case "injection-edit":
    case "lab-order-edit":
    case "micro-order-edit":
    case "rad-order-edit":
      return `${state.kind}:${state.srId}`;
    case "qr-edit":
      return `${state.kind}:${state.qrId}`;
    // 別のプロブレムを選んで登録し直したときに初期値を反映させる(選択を変えただけでは
    // state が変わらないので、入力中のフォームが勝手に作り直されることはない)。
    case "prescription-create":
    case "injection-create":
    case "lab-order-create":
    case "micro-order-create":
    case "rad-order-create":
      return `${state.kind}:${state.sourceSrId ?? ""}:${state.problem?.conditionId ?? ""}`;
    case "note-create":
      return `${state.kind}:${state.problem?.conditionId ?? ""}`;
    default:
      return state.kind;
  }
}

interface KarteRightPaneProps {
  patientId: string;
  state: KartePaneState;
  // プロブレムリストで選択中のプロブレム。診療記録・処方の新規登録の初期値にする。
  selectedProblem?: ProblemRef;
  onStateChange: (state: KartePaneState) => void;
}

export function KarteRightPane({
  patientId,
  state,
  selectedProblem,
  onStateChange,
}: KarteRightPaneProps) {
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
        <button
          type="button"
          onClick={() => onStateChange({ kind: "note-create", problem: selectedProblem })}
        >
          診療記録
        </button>
        <button type="button" onClick={() => onStateChange({ kind: "qr-create" })}>
          テンプレート
        </button>
        <button
          type="button"
          onClick={() => onStateChange({ kind: "prescription-create", problem: selectedProblem })}
        >
          処方
        </button>
        <button
          type="button"
          onClick={() => onStateChange({ kind: "injection-create", problem: selectedProblem })}
        >
          注射
        </button>
        <button
          type="button"
          onClick={() => onStateChange({ kind: "lab-order-create", problem: selectedProblem })}
        >
          検体検査
        </button>
        <button
          type="button"
          onClick={() => onStateChange({ kind: "micro-order-create", problem: selectedProblem })}
        >
          細菌検査
        </button>
        <button
          type="button"
          onClick={() => onStateChange({ kind: "rad-order-create", problem: selectedProblem })}
        >
          放射線検査
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
      return (
        <ClinicalNoteCreatePanel
          patientId={patientId}
          defaultProblem={state.problem}
          onSaved={onSaved}
        />
      );
    case "note-edit":
      return (
        <ClinicalNoteEditPanel patientId={patientId} noteId={state.noteId} onSaved={onSaved} />
      );
    case "prescription-create":
      return (
        <PrescriptionCreatePanel
          patientId={patientId}
          sourceSrId={state.sourceSrId}
          defaultProblem={state.problem}
          onSaved={onSaved}
        />
      );
    case "prescription-edit":
      return <PrescriptionEditPanel patientId={patientId} srId={state.srId} onSaved={onSaved} />;
    case "injection-create":
      return (
        <InjectionCreatePanel
          patientId={patientId}
          sourceSrId={state.sourceSrId}
          defaultProblem={state.problem}
          onSaved={onSaved}
        />
      );
    case "injection-edit":
      return <InjectionEditPanel patientId={patientId} srId={state.srId} onSaved={onSaved} />;
    case "lab-order-create":
      return (
        <LabOrderCreatePanel
          patientId={patientId}
          sourceSrId={state.sourceSrId}
          defaultProblem={state.problem}
          onSaved={onSaved}
        />
      );
    case "lab-order-edit":
      return <LabOrderEditPanel patientId={patientId} srId={state.srId} onSaved={onSaved} />;
    case "micro-order-create":
      return (
        <MicroOrderCreatePanel
          patientId={patientId}
          sourceSrId={state.sourceSrId}
          defaultProblem={state.problem}
          onSaved={onSaved}
        />
      );
    case "micro-order-edit":
      return <MicroOrderEditPanel patientId={patientId} srId={state.srId} onSaved={onSaved} />;
    case "rad-order-create":
      return (
        <RadOrderCreatePanel
          patientId={patientId}
          sourceSrId={state.sourceSrId}
          defaultProblem={state.problem}
          onSaved={onSaved}
        />
      );
    case "rad-order-edit":
      return <RadOrderEditPanel patientId={patientId} srId={state.srId} onSaved={onSaved} />;
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
