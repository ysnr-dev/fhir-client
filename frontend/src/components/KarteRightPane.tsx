import type { ProblemRef } from "../fhir/conditionHelpers";
import { AppointmentCreatePanel, AppointmentReschedulePanel } from "./AppointmentPanels";
import { ClinicalNoteCreatePanel, ClinicalNoteEditPanel } from "./ClinicalNotePanels";
import { InjectionCreatePanel, InjectionEditPanel } from "./InjectionPanels";
import { LabOrderCreatePanel, LabOrderEditPanel } from "./LabOrderPanels";
import { MicroOrderCreatePanel, MicroOrderEditPanel } from "./MicroOrderPanels";
import { PathoOrderCreatePanel, PathoOrderEditPanel } from "./PathoOrderPanels";
import { PrescriptionCreatePanel, PrescriptionEditPanel } from "./PrescriptionPanels";
import { RadOrderCreatePanel, RadOrderEditPanel } from "./RadOrderPanels";
import { PhysioOrderCreatePanel, PhysioOrderEditPanel } from "./PhysioOrderPanels";
import { EndoscopyOrderCreatePanel, EndoscopyOrderEditPanel } from "./EndoscopyOrderPanels";
import { TreatmentOrderCreatePanel, TreatmentOrderEditPanel } from "./TreatmentOrderPanels";
import { SurgeryOrderCreatePanel, SurgeryOrderEditPanel } from "./SurgeryOrderPanels";
import { MealOrderCreatePanel, MealOrderEditPanel } from "./MealOrderPanels";
import { NursingOrderCreatePanel, NursingOrderEditPanel } from "./NursingOrderPanels";
import {
  TransfusionOrderCreatePanel,
  TransfusionOrderEditPanel,
} from "./TransfusionOrderPanels";
import { RehabOrderCreatePanel, RehabOrderEditPanel } from "./RehabOrderPanels";
import {
  NutritionGuidanceOrderCreatePanel,
  NutritionGuidanceOrderEditPanel,
} from "./NutritionGuidanceOrderPanels";
import { ConsultOrderCreatePanel, ConsultOrderEditPanel } from "./ConsultOrderPanels";
import {
  QuestionnaireResponseCreatePanel,
  QuestionnaireResponseEditPanel,
} from "./QuestionnaireResponsePanels";
import { VitalCreatePanel, VitalEditPanel } from "./VitalPanels";
import { OrderSetApplyPanel } from "./OrderSetApplyPanel";

// カルテ画面の右ペイン。登録・編集 UI は既存ページと共通のパネルを使う。

export type KartePaneState =
  | { kind: "empty" }
  // problem: 登録ボタンを押した時点で選択されていたプロブレム(対象の初期値)。
  | { kind: "note-create"; problem?: ProblemRef }
  | { kind: "note-edit"; noteId: string }
  | { kind: "vital-create"; problem?: ProblemRef }
  // 1 回の測定は複数の Observation なので、束ねている identifier で対象を指す。
  | { kind: "vital-edit"; entryId: string }
  // DO(sourceSrId あり)では対象プロブレムも DO 元から引き継ぐので problem は使わない。
  | { kind: "prescription-create"; sourceSrId?: string; problem?: ProblemRef }
  | { kind: "prescription-edit"; srId: string }
  | { kind: "injection-create"; sourceSrId?: string; problem?: ProblemRef }
  | { kind: "injection-edit"; srId: string }
  | { kind: "lab-order-create"; sourceSrId?: string; problem?: ProblemRef }
  | { kind: "lab-order-edit"; srId: string }
  | { kind: "micro-order-create"; sourceSrId?: string; problem?: ProblemRef }
  | { kind: "micro-order-edit"; srId: string }
  | { kind: "patho-order-create"; sourceSrId?: string; problem?: ProblemRef }
  | { kind: "patho-order-edit"; srId: string }
  | { kind: "rad-order-create"; sourceSrId?: string; problem?: ProblemRef }
  | { kind: "rad-order-edit"; srId: string }
  | { kind: "physio-order-create"; sourceSrId?: string; problem?: ProblemRef }
  | { kind: "physio-order-edit"; srId: string }
  | { kind: "endoscopy-order-create"; sourceSrId?: string; problem?: ProblemRef }
  | { kind: "endoscopy-order-edit"; srId: string }
  | { kind: "treatment-order-create"; sourceSrId?: string; problem?: ProblemRef }
  | { kind: "treatment-order-edit"; srId: string }
  | { kind: "surgery-order-create"; sourceSrId?: string; problem?: ProblemRef }
  | { kind: "surgery-order-edit"; srId: string }
  // startDate: 暦(食事タブ)で食事の無い日を押したときの、その日。
  | { kind: "meal-order-create"; sourceSrId?: string; problem?: ProblemRef; startDate?: string }
  | { kind: "meal-order-edit"; srId: string }
  | { kind: "transfusion-order-create"; sourceSrId?: string; problem?: ProblemRef }
  | { kind: "transfusion-order-edit"; srId: string }
  | { kind: "rehab-order-create"; sourceSrId?: string; problem?: ProblemRef }
  | { kind: "rehab-order-edit"; srId: string }
  | { kind: "nutrition-guidance-order-create"; sourceSrId?: string; problem?: ProblemRef }
  | { kind: "nutrition-guidance-order-edit"; srId: string }
  | { kind: "consult-order-create"; sourceSrId?: string; problem?: ProblemRef }
  | { kind: "consult-order-edit"; srId: string }
  | { kind: "nursing-order-create"; problem?: ProblemRef }
  | { kind: "nursing-order-edit"; srId: string }
  | { kind: "qr-create"; problem?: ProblemRef }
  | { kind: "qr-edit"; qrId: string }
  // 予約は枠を押さえるだけで内容の編集は無く、変えられるのは日時(押さえる枠)だけ。
  // 日時変更は予約タブの一覧から開く。
  | { kind: "appointment-create"; problem?: ProblemRef }
  | { kind: "appointment-reschedule"; appointmentId: string }
  // オーダーセットの適用。setId 未指定はセット選択の状態(ペイン内のツリーから選ぶ)。
  | { kind: "order-set"; setId?: number; problem?: ProblemRef };

const PANE_TITLES: Record<KartePaneState["kind"], string> = {
  empty: "",
  "note-create": "診療記録登録",
  "note-edit": "診療記録編集",
  "vital-create": "バイタル登録",
  "vital-edit": "バイタル編集",
  "prescription-create": "処方登録",
  "prescription-edit": "処方編集",
  "injection-create": "注射登録",
  "injection-edit": "注射編集",
  "lab-order-create": "検体検査登録",
  "lab-order-edit": "検体検査編集",
  "micro-order-create": "細菌検査登録",
  "micro-order-edit": "細菌検査編集",
  "patho-order-create": "病理検査登録",
  "patho-order-edit": "病理検査編集",
  "rad-order-create": "放射線検査登録",
  "rad-order-edit": "放射線検査編集",
  "physio-order-create": "生理検査登録",
  "physio-order-edit": "生理検査編集",
  "endoscopy-order-create": "内視鏡登録",
  "endoscopy-order-edit": "内視鏡編集",
  "treatment-order-create": "処置登録",
  "treatment-order-edit": "処置編集",
  "surgery-order-create": "手術申込",
  "surgery-order-edit": "手術編集",
  "meal-order-create": "食事登録",
  "meal-order-edit": "食事編集",
  "transfusion-order-create": "輸血登録",
  "transfusion-order-edit": "輸血編集",
  "rehab-order-create": "リハビリ登録",
  "rehab-order-edit": "リハビリ編集",
  "nutrition-guidance-order-create": "栄養指導登録",
  "nutrition-guidance-order-edit": "栄養指導編集",
  "consult-order-create": "他科依頼登録",
  "consult-order-edit": "他科依頼編集",
  "nursing-order-create": "看護指示登録",
  "nursing-order-edit": "看護指示編集",
  "qr-create": "テンプレート登録",
  "qr-edit": "テンプレート編集",
  "appointment-create": "予約登録",
  "appointment-reschedule": "予約の日時変更",
  "order-set": "セット適用",
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
    case "patho-order-edit":
    case "rad-order-edit":
    case "physio-order-edit":
    case "endoscopy-order-edit":
    case "treatment-order-edit":
    case "surgery-order-edit":
    case "meal-order-edit":
    case "transfusion-order-edit":
    case "rehab-order-edit":
    case "nutrition-guidance-order-edit":
    case "consult-order-edit":
      return `${state.kind}:${state.srId}`;
    case "qr-edit":
      return `${state.kind}:${state.qrId}`;
    case "appointment-reschedule":
      return `${state.kind}:${state.appointmentId}`;
    case "vital-edit":
      return `${state.kind}:${state.entryId}`;
    // 別のセットを選び直したらフォームを作り直す(初期値は初回描画時のみ反映される)。
    case "order-set":
      return `${state.kind}:${state.setId ?? ""}:${state.problem?.conditionId ?? ""}`;
    // 別のプロブレムを選んで登録し直したときに初期値を反映させる(選択を変えただけでは
    // state が変わらないので、入力中のフォームが勝手に作り直されることはない)。
    case "prescription-create":
    case "injection-create":
    case "lab-order-create":
    case "micro-order-create":
    case "patho-order-create":
    case "rad-order-create":
    case "physio-order-create":
    case "endoscopy-order-create":
    case "treatment-order-create":
    case "surgery-order-create":
    case "transfusion-order-create":
    case "rehab-order-create":
    case "nutrition-guidance-order-create":
    case "consult-order-create":
      return `${state.kind}:${state.sourceSrId ?? ""}:${state.problem?.conditionId ?? ""}`;
    // 食事は暦の別の日を押したときも初期値(開始日)が変わるので、日付もキーに入れる。
    case "meal-order-create":
      return `${state.kind}:${state.sourceSrId ?? ""}:${state.problem?.conditionId ?? ""}:${state.startDate ?? ""}`;
    case "note-create":
    case "qr-create":
    case "vital-create":
    case "appointment-create":
    case "nursing-order-create":
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
              <PaneContent
                patientId={patientId}
                state={state}
                onSaved={close}
                onStateChange={onStateChange}
              />
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
        <button
          type="button"
          onClick={() => onStateChange({ kind: "vital-create", problem: selectedProblem })}
        >
          バイタル
        </button>
        <button
          type="button"
          onClick={() => onStateChange({ kind: "qr-create", problem: selectedProblem })}
        >
          テンプレート
        </button>
        <button
          type="button"
          onClick={() => onStateChange({ kind: "appointment-create", problem: selectedProblem })}
        >
          予約
        </button>
        {/* よく出すオーダーをまとめて出す入口。個別の種別ボタンより前に置く
            (「セットにあればセット、無ければ個別」の順で探すため)。 */}
        <button
          type="button"
          onClick={() => onStateChange({ kind: "order-set", problem: selectedProblem })}
        >
          セット
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
          onClick={() => onStateChange({ kind: "patho-order-create", problem: selectedProblem })}
        >
          病理検査
        </button>
        <button
          type="button"
          onClick={() => onStateChange({ kind: "rad-order-create", problem: selectedProblem })}
        >
          放射線検査
        </button>
        <button
          type="button"
          onClick={() => onStateChange({ kind: "physio-order-create", problem: selectedProblem })}
        >
          生理検査
        </button>
        <button
          type="button"
          onClick={() => onStateChange({ kind: "endoscopy-order-create", problem: selectedProblem })}
        >
          内視鏡
        </button>
        <button
          type="button"
          onClick={() => onStateChange({ kind: "treatment-order-create", problem: selectedProblem })}
        >
          処置
        </button>
        <button
          type="button"
          onClick={() => onStateChange({ kind: "surgery-order-create", problem: selectedProblem })}
        >
          手術
        </button>
        <button
          type="button"
          onClick={() => onStateChange({ kind: "meal-order-create", problem: selectedProblem })}
        >
          食事
        </button>
        <button
          type="button"
          onClick={() =>
            onStateChange({ kind: "transfusion-order-create", problem: selectedProblem })
          }
        >
          輸血
        </button>
        <button
          type="button"
          onClick={() => onStateChange({ kind: "rehab-order-create", problem: selectedProblem })}
        >
          リハビリ
        </button>
        <button
          type="button"
          onClick={() =>
            onStateChange({ kind: "nutrition-guidance-order-create", problem: selectedProblem })
          }
        >
          栄養指導
        </button>
        <button
          type="button"
          onClick={() => onStateChange({ kind: "nursing-order-create", problem: selectedProblem })}
        >
          看護指示
        </button>
        {/* 他科依頼は部門ではなく人(他の診療科の医師)への依頼なので、部門オーダーを
            並べた最後に置く。 */}
        <button
          type="button"
          onClick={() => onStateChange({ kind: "consult-order-create", problem: selectedProblem })}
        >
          他科依頼
        </button>
      </div>
    </section>
  );
}

function PaneContent({
  patientId,
  state,
  onSaved,
  onStateChange,
}: {
  patientId: string;
  state: KartePaneState;
  onSaved: () => void;
  onStateChange: (state: KartePaneState) => void;
}) {
  switch (state.kind) {
    case "order-set":
      return (
        <OrderSetApplyPanel
          patientId={patientId}
          setId={state.setId}
          defaultProblem={state.problem}
          onSelectSet={(setId) => onStateChange({ ...state, setId })}
          onBack={() => onStateChange({ ...state, setId: undefined })}
          onSaved={onSaved}
        />
      );
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
    case "vital-create":
      return (
        <VitalCreatePanel patientId={patientId} defaultProblem={state.problem} onSaved={onSaved} />
      );
    case "vital-edit":
      return <VitalEditPanel patientId={patientId} entryId={state.entryId} onSaved={onSaved} />;
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
    case "patho-order-create":
      return (
        <PathoOrderCreatePanel
          patientId={patientId}
          sourceSrId={state.sourceSrId}
          defaultProblem={state.problem}
          onSaved={onSaved}
        />
      );
    case "patho-order-edit":
      return <PathoOrderEditPanel patientId={patientId} srId={state.srId} onSaved={onSaved} />;
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
    case "physio-order-create":
      return (
        <PhysioOrderCreatePanel
          patientId={patientId}
          sourceSrId={state.sourceSrId}
          defaultProblem={state.problem}
          onSaved={onSaved}
        />
      );
    case "physio-order-edit":
      return <PhysioOrderEditPanel patientId={patientId} srId={state.srId} onSaved={onSaved} />;
    case "endoscopy-order-create":
      return (
        <EndoscopyOrderCreatePanel
          patientId={patientId}
          sourceSrId={state.sourceSrId}
          defaultProblem={state.problem}
          onSaved={onSaved}
        />
      );
    case "endoscopy-order-edit":
      return <EndoscopyOrderEditPanel patientId={patientId} srId={state.srId} onSaved={onSaved} />;
    case "treatment-order-create":
      return (
        <TreatmentOrderCreatePanel
          patientId={patientId}
          sourceSrId={state.sourceSrId}
          defaultProblem={state.problem}
          onSaved={onSaved}
        />
      );
    case "treatment-order-edit":
      return <TreatmentOrderEditPanel patientId={patientId} srId={state.srId} onSaved={onSaved} />;
    case "surgery-order-create":
      return (
        <SurgeryOrderCreatePanel
          patientId={patientId}
          sourceSrId={state.sourceSrId}
          defaultProblem={state.problem}
          onSaved={onSaved}
        />
      );
    case "surgery-order-edit":
      return <SurgeryOrderEditPanel patientId={patientId} srId={state.srId} onSaved={onSaved} />;
    case "meal-order-create":
      return (
        <MealOrderCreatePanel
          patientId={patientId}
          sourceSrId={state.sourceSrId}
          defaultStartDate={state.startDate}
          defaultProblem={state.problem}
          onSaved={onSaved}
        />
      );
    case "meal-order-edit":
      return <MealOrderEditPanel patientId={patientId} srId={state.srId} onSaved={onSaved} />;
    case "nursing-order-create":
      return (
        <NursingOrderCreatePanel
          patientId={patientId}
          defaultProblem={state.problem}
          onSaved={onSaved}
        />
      );
    case "nursing-order-edit":
      return <NursingOrderEditPanel patientId={patientId} srId={state.srId} onSaved={onSaved} />;
    case "transfusion-order-create":
      return (
        <TransfusionOrderCreatePanel
          patientId={patientId}
          sourceSrId={state.sourceSrId}
          defaultProblem={state.problem}
          onSaved={onSaved}
        />
      );
    case "transfusion-order-edit":
      return (
        <TransfusionOrderEditPanel patientId={patientId} srId={state.srId} onSaved={onSaved} />
      );
    case "rehab-order-create":
      return (
        <RehabOrderCreatePanel
          patientId={patientId}
          sourceSrId={state.sourceSrId}
          defaultProblem={state.problem}
          onSaved={onSaved}
        />
      );
    case "rehab-order-edit":
      return <RehabOrderEditPanel patientId={patientId} srId={state.srId} onSaved={onSaved} />;
    case "nutrition-guidance-order-create":
      return (
        <NutritionGuidanceOrderCreatePanel
          patientId={patientId}
          sourceSrId={state.sourceSrId}
          defaultProblem={state.problem}
          onSaved={onSaved}
        />
      );
    case "nutrition-guidance-order-edit":
      return (
        <NutritionGuidanceOrderEditPanel
          patientId={patientId}
          srId={state.srId}
          onSaved={onSaved}
        />
      );
    case "consult-order-create":
      return (
        <ConsultOrderCreatePanel
          patientId={patientId}
          sourceSrId={state.sourceSrId}
          defaultProblem={state.problem}
          onSaved={onSaved}
        />
      );
    case "consult-order-edit":
      return <ConsultOrderEditPanel patientId={patientId} srId={state.srId} onSaved={onSaved} />;
    case "qr-create":
      return (
        <QuestionnaireResponseCreatePanel
          patientId={patientId}
          defaultProblem={state.problem}
          onSaved={onSaved}
        />
      );
    case "qr-edit":
      return (
        <QuestionnaireResponseEditPanel patientId={patientId} qrId={state.qrId} onSaved={onSaved} />
      );
    case "appointment-create":
      return (
        <AppointmentCreatePanel
          patientId={patientId}
          defaultProblem={state.problem}
          onSaved={onSaved}
        />
      );
    case "appointment-reschedule":
      return (
        <AppointmentReschedulePanel appointmentId={state.appointmentId} onSaved={onSaved} />
      );
    case "empty":
      return null;
  }
}
