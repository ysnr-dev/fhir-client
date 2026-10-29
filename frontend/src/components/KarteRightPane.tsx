import type { ComponentType } from "react";
import { useFacilitySettings } from "../api/queries";
import type { ProblemRef } from "../fhir/conditionHelpers";
import { isOrderKind, ORDER_KINDS, type OrderKind } from "../fhir/orderKinds";
import { AppointmentCreatePanel, AppointmentReschedulePanel } from "./AppointmentPanels";
import { ClinicalNoteCreatePanel, ClinicalNoteEditPanel } from "./ClinicalNotePanels";
import { DischargeSummaryCreatePanel, DischargeSummaryEditPanel } from "./DischargeSummaryPanels";
import { DpcForm1CreatePanel, DpcForm1EditPanel, type DpcPaneTab } from "./DpcForm1Panels";
import { DocumentCreatePanel } from "./DocumentCreatePanel";
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
import { NursingProblemCreatePanel, NursingProblemEditPanel } from "./NursingCarePlanPanels";
import type { NursingProblemEntry } from "../fhir/nursingCarePlanHelpers";
import { NursingSummaryCreatePanel, NursingSummaryEditPanel } from "./NursingSummaryPanels";
import { NursingProfilePanel } from "./NursingProfilePanels";
import { NursingOrderCreatePanel, NursingOrderEditPanel } from "./NursingOrderPanels";
import {
  TransfusionOrderCreatePanel,
  TransfusionOrderEditPanel,
} from "./TransfusionOrderPanels";
import {
  RadiotherapyOrderCreatePanel,
  RadiotherapyOrderEditPanel,
} from "./RadiotherapyOrderPanels";
import { RehabOrderCreatePanel, RehabOrderEditPanel } from "./RehabOrderPanels";
import {
  NutritionGuidanceOrderCreatePanel,
  NutritionGuidanceOrderEditPanel,
} from "./NutritionGuidanceOrderPanels";
import {
  MedicationGuidanceOrderCreatePanel,
  MedicationGuidanceOrderEditPanel,
} from "./MedicationGuidanceOrderPanels";
import { ConsultOrderCreatePanel, ConsultOrderEditPanel } from "./ConsultOrderPanels";
import { TeamRequestCreatePanel, TeamRequestEditPanel } from "./TeamRequestPanels";
import {
  QuestionnaireResponseCreatePanel,
  QuestionnaireResponseEditPanel,
} from "./QuestionnaireResponsePanels";
import { VitalCreatePanel, VitalEditPanel } from "./VitalPanels";
import { PlannedAdmissionCreatePanel } from "./PlannedAdmissionPanel";
import { OrderSetApplyPanel } from "./OrderSetApplyPanel";
import { PathwayApplyPanel, PathwayPhasePanel } from "./PathwayApplyPanel";
import { RegimenApplyPanel } from "./RegimenApplyPanel";
import { RegimenCycleLoader, RegimenDayPanel, RegimenHeaderPanel } from "./RegimenPanels";
import { IntakeReviewPanel } from "./IntakeReviewPanel";
import { RadiotherapyAdverseEventPanel } from "./RadiotherapyAdverseEventPanel";
import { RadiotherapyReviewPanel } from "./RadiotherapyReviewPanel";
import { RegimenAdverseEventPanel } from "./RegimenAdverseEventPanel";
import { KartePaneMenu } from "./KartePaneMenu";

// カルテ画面の右ペイン。登録・編集 UI は既存ページと共通のパネルを使う。

/**
 * 部門オーダー(fhir/orderKinds.ts の種別)の登録。DO(sourceSrId あり)では対象プロブレムも
 * DO 元から引き継ぐので problem は使わない。startDate は食事の暦で食事の無い日を押したときの、その日。
 */
interface OrderCreateState {
  kind: `${OrderKind}-create`;
  sourceSrId?: string;
  problem?: ProblemRef;
  startDate?: string;
  /** チーム依頼の宛先を選択済みで開く(スクリーニング一覧・褥瘡管理からのリンク)。 */
  teamId?: string;
}

interface OrderEditState {
  kind: `${OrderKind}-edit`;
  srId: string;
}

function isOrderCreateState(state: KartePaneState): state is OrderCreateState {
  return state.kind.endsWith("-create") && isOrderKind(state.kind.slice(0, -"-create".length));
}

function isOrderEditState(state: KartePaneState): state is OrderEditState {
  return state.kind.endsWith("-edit") && isOrderKind(state.kind.slice(0, -"-edit".length));
}

export type KartePaneState =
  | { kind: "empty" }
  // problem: 登録ボタンを押した時点で選択されていたプロブレム(対象の初期値)。
  | { kind: "note-create"; problem?: ProblemRef }
  | { kind: "note-edit"; noteId: string }
  // 退院時サマリー。encounterId は対象の入院の初期値(通知・入院患者一覧のリンクから)。
  | { kind: "summary-create"; encounterId?: string }
  | { kind: "summary-edit"; noteId: string }
  // 看護サマリー(中間・転棟・退院)。承認者もこの編集から承認する。
  | { kind: "nursing-summary-create"; encounterId?: string }
  | { kind: "nursing-summary-edit"; noteId: string }
  // DPC 様式1。encounterId は対象の入院の初期値(提出ファイルの一覧から)。
  | { kind: "dpc-form1-create"; encounterId?: string; tab?: DpcPaneTab }
  | { kind: "dpc-form1-edit"; responseId: string; tab?: DpcPaneTab }
  // 文書テンプレート(Word / Excel / 様式)から文書を作る。作った文書は「ファイル」タブに入る。
  | { kind: "document-create" }
  // 様式テンプレートから作った文書の内容を直す(ファイルタブの「内容編集」)。documentId は DocumentReference。
  | { kind: "document-edit"; documentId: string }
  | { kind: "vital-create"; problem?: ProblemRef }
  // 1 回の測定は複数の Observation なので、束ねている identifier で対象を指す。
  | { kind: "vital-edit"; entryId: string }
  // DO(sourceSrId あり)では対象プロブレムも DO 元から引き継ぐので problem は使わない。
  // broughtIds: 持参薬タブの「継続」で選んだ持参薬。その持参薬から初期値を作る。
  | {
      kind: "prescription-create";
      sourceSrId?: string;
      problem?: ProblemRef;
      broughtIds?: string[];
    }
  | { kind: "prescription-edit"; srId: string }
  // startDate / endDate: 注射カレンダーで選んだ日(その日から、または複写先の期間)。
  | {
      kind: "injection-create";
      sourceSrId?: string;
      problem?: ProblemRef;
      startDate?: string;
      endDate?: string;
    }
  | { kind: "injection-edit"; srId: string }
  | OrderCreateState
  | OrderEditState
  | { kind: "nursing-order-create"; problem?: ProblemRef }
  | { kind: "nursing-order-edit"; srId: string }
  // 看護計画の立案・編集。carePlanId は看護問題 1 件の CarePlan(評価・指示展開は看護計画タブのモーダル)。
  | { kind: "nursing-problem-create"; entry: NursingProblemEntry }
  | { kind: "nursing-problem-edit"; carePlanId: string }
  // 看護プロファイル。入院 × 区画(テンプレートの url)で 1 件の回答を書く・直す。
  | { kind: "nursing-profile"; encounterId?: string; templateUrl?: string }
  // templateCanonical を渡すとそのテンプレートを選択済みで開く(褥瘡管理の DESIGN-R 評価から)。
  // partOf を渡すと回答がその記録の一部になる(NCD の症例登録は手術の実施記録を指す)。
  // encounterId を渡すと回答がその入院に紐付く(入退院文書の栄養スクリーニング・栄養管理計画書から)。
  | {
      kind: "qr-create";
      problem?: ProblemRef;
      templateCanonical?: string;
      partOf?: fhir4.Reference[];
      encounterId?: string;
    }
  // 入院診療計画書。施設設定のテンプレートで、その入院に紐付けて書き始める(入退院文書の作成状況から)。
  | { kind: "admission-plan-create"; encounterId: string }
  | { kind: "qr-edit"; qrId: string }
  // Web 問診の回答の取込(患者帯のピクトグラム・?open=intake から)。
  | { kind: "intake-review"; responseId: number }
  // 予約は枠を押さえるだけで内容の編集は無く、変えられるのは日時(押さえる枠)だけ。
  // 日時変更は予約タブの一覧から開く。
  | { kind: "appointment-create"; problem?: ProblemRef }
  | { kind: "appointment-reschedule"; appointmentId: string }
  // 入院予定(status=planned の Encounter)。病棟だけ決めて日付は未定にもできる。
  | { kind: "planned-admission-create" }
  // オーダーセットの適用。setId 未指定はセット選択の状態(ペイン内のツリーから選ぶ)。
  | { kind: "order-set"; setId?: number; problem?: ProblemRef }
  // 化学療法レジメンの適用。regimenId 未指定はレジメン選択の状態。
  | { kind: "regimen-apply"; regimenId?: number; problem?: ProblemRef }
  // クリニカルパスの適用。pathwayId 未指定はパス選択の状態。
  | { kind: "pathway-apply"; pathwayId?: number }
  | { kind: "pathway-phase"; applyId: string; phaseKey: string }
  // パスシートの 1 セル(病日 × OAT ユニット)の評価入力。unitId は OAT ユニットの CarePlan。
  // 適用済みレジメンへの次クールの登録。regimenSrId はヘッダ ServiceRequest。
  | { kind: "regimen-cycle"; regimenSrId: string }
  // 暦の 1 日(その日のオーダーの編集・移動・中止)。
  | { kind: "regimen-day"; regimenSrId: string; date: string }
  // クールの有害事象(CTCAE Grade)の記録。
  | { kind: "regimen-adverse"; regimenSrId: string; cycle: number }
  // 適用のヘッダ(予定クール数・入外区分・プロブレム・コメント)の編集。
  | { kind: "regimen-header"; regimenSrId: string }
  // 放射線治療コースの有害事象(CTCAE Grade)の記録。srId は治療処方。
  | { kind: "radiotherapy-adverse"; srId: string }
  // 放射線治療コースの週次レビュー(治療中の診察)。テンプレート回答として残す。
  | { kind: "radiotherapy-review"; srId: string };

interface OrderCreatePanelProps {
  patientId: string;
  sourceSrId?: string;
  defaultProblem?: ProblemRef;
  startDate?: string;
  teamId?: string;
  onSaved: () => void;
}

interface OrderEditPanelProps {
  patientId: string;
  srId: string;
  onSaved: () => void;
}

// 部門オーダーの登録・編集フォーム。種別を足したら 1 要素足す(足し忘れは型エラーになる)。
const ORDER_PANES: Record<
  OrderKind,
  {
    create: { title: string; Panel: ComponentType<OrderCreatePanelProps> };
    edit: { title: string; Panel: ComponentType<OrderEditPanelProps> };
  }
> = {
  "lab-order": {
    create: { title: "検体検査登録", Panel: LabOrderCreatePanel },
    edit: { title: "検体検査編集", Panel: LabOrderEditPanel },
  },
  "micro-order": {
    create: { title: "細菌検査登録", Panel: MicroOrderCreatePanel },
    edit: { title: "細菌検査編集", Panel: MicroOrderEditPanel },
  },
  "patho-order": {
    create: { title: "病理検査登録", Panel: PathoOrderCreatePanel },
    edit: { title: "病理検査編集", Panel: PathoOrderEditPanel },
  },
  "rad-order": {
    create: { title: "放射線検査登録", Panel: RadOrderCreatePanel },
    edit: { title: "放射線検査編集", Panel: RadOrderEditPanel },
  },
  "physio-order": {
    create: { title: "生理検査登録", Panel: PhysioOrderCreatePanel },
    edit: { title: "生理検査編集", Panel: PhysioOrderEditPanel },
  },
  "endoscopy-order": {
    create: { title: "内視鏡登録", Panel: EndoscopyOrderCreatePanel },
    edit: { title: "内視鏡編集", Panel: EndoscopyOrderEditPanel },
  },
  "treatment-order": {
    create: { title: "処置登録", Panel: TreatmentOrderCreatePanel },
    edit: { title: "処置編集", Panel: TreatmentOrderEditPanel },
  },
  "surgery-order": {
    create: { title: "手術申込", Panel: SurgeryOrderCreatePanel },
    edit: { title: "手術編集", Panel: SurgeryOrderEditPanel },
  },
  "meal-order": {
    create: {
      title: "食事登録",
      Panel: ({ startDate, ...props }) => <MealOrderCreatePanel {...props} defaultStartDate={startDate} />,
    },
    edit: { title: "食事編集", Panel: MealOrderEditPanel },
  },
  "transfusion-order": {
    create: { title: "輸血登録", Panel: TransfusionOrderCreatePanel },
    edit: { title: "輸血編集", Panel: TransfusionOrderEditPanel },
  },
  "rehab-order": {
    create: { title: "リハビリ登録", Panel: RehabOrderCreatePanel },
    edit: { title: "リハビリ編集", Panel: RehabOrderEditPanel },
  },
  "radiotherapy-order": {
    create: { title: "放射線治療登録", Panel: RadiotherapyOrderCreatePanel },
    edit: { title: "放射線治療編集", Panel: RadiotherapyOrderEditPanel },
  },
  "nutrition-guidance-order": {
    create: { title: "栄養指導登録", Panel: NutritionGuidanceOrderCreatePanel },
    edit: { title: "栄養指導編集", Panel: NutritionGuidanceOrderEditPanel },
  },
  "medication-guidance-order": {
    create: { title: "服薬指導登録", Panel: MedicationGuidanceOrderCreatePanel },
    edit: { title: "服薬指導編集", Panel: MedicationGuidanceOrderEditPanel },
  },
  "consult-order": {
    create: { title: "他科依頼登録", Panel: ConsultOrderCreatePanel },
    edit: { title: "他科依頼編集", Panel: ConsultOrderEditPanel },
  },
  "team-request": {
    create: { title: "チーム依頼登録", Panel: TeamRequestCreatePanel },
    edit: { title: "チーム依頼編集", Panel: TeamRequestEditPanel },
  },
};

const orderKindOfPane = (state: OrderCreateState | OrderEditState) =>
  state.kind.replace(/-(create|edit)$/, "") as OrderKind;

const ORDER_PANE_TITLES = Object.fromEntries(
  ORDER_KINDS.flatMap((kind) => [
    [`${kind}-create`, ORDER_PANES[kind].create.title],
    [`${kind}-edit`, ORDER_PANES[kind].edit.title],
  ]),
) as Record<OrderCreateState["kind"] | OrderEditState["kind"], string>;

const PANE_TITLES: Record<KartePaneState["kind"], string> = {
  ...ORDER_PANE_TITLES,
  empty: "",
  "note-create": "診療記録登録",
  "note-edit": "診療記録編集",
  "summary-create": "退院時サマリー登録",
  "summary-edit": "退院時サマリー編集",
  "nursing-summary-create": "看護サマリー登録",
  "nursing-summary-edit": "看護サマリー",
  "dpc-form1-create": "DPC登録",
  "dpc-form1-edit": "DPC編集",
  "document-create": "文書作成",
  "document-edit": "文書編集",
  "vital-create": "バイタル登録",
  "vital-edit": "バイタル編集",
  "prescription-create": "処方登録",
  "prescription-edit": "処方編集",
  "injection-create": "注射登録",
  "injection-edit": "注射編集",
  "nursing-order-create": "看護指示登録",
  "nursing-order-edit": "看護指示編集",
  "nursing-problem-create": "看護計画登録",
  "nursing-problem-edit": "看護計画編集",
  "nursing-profile": "看護プロファイル",
  "qr-create": "テンプレート登録",
  "admission-plan-create": "入院診療計画書",
  "qr-edit": "テンプレート編集",
  "intake-review": "問診取込",
  "appointment-create": "予約登録",
  "appointment-reschedule": "予約の日時変更",
  "planned-admission-create": "入院予定登録",
  "order-set": "セット適用",
  "regimen-apply": "化学療法(レジメン適用)",
  "pathway-apply": "クリニカルパス(適用)",
  "pathway-phase": "クリニカルパス(次のフェーズ)",
  "regimen-cycle": "化学療法(クール登録)",
  "regimen-day": "化学療法(投与日)",
  "regimen-adverse": "化学療法(有害事象)",
  "radiotherapy-adverse": "放射線治療(有害事象)",
  "radiotherapy-review": "放射線治療(週次レビュー)",
  "regimen-header": "化学療法(適用の編集)",
};

// 対象が切り替わったらフォームを作り直すためのキー。各フォームは初期値を useState の
// 初期値としてのみ読むため、同じ種類の別リソースへ切り替えるにはリマウントが要る。
function paneKey(state: KartePaneState): string {
  if (isOrderEditState(state)) return `${state.kind}:${state.srId}`;
  // 別のプロブレムを選んで登録し直したときに初期値を反映させる(選択を変えただけでは
  // state が変わらないので、入力中のフォームが勝手に作り直されることはない)。
  // 食事は暦の別の日を押したときも開始日が変わるので、日付もキーに入れる。
  if (isOrderCreateState(state)) {
    return `${state.kind}:${state.sourceSrId ?? ""}:${state.problem?.conditionId ?? ""}:${state.startDate ?? ""}:${state.teamId ?? ""}`;
  }
  switch (state.kind) {
    case "note-edit":
    case "summary-edit":
    case "nursing-summary-edit":
      return `${state.kind}:${state.noteId}`;
    case "nursing-summary-create":
    case "admission-plan-create":
      return `${state.kind}:${state.encounterId ?? ""}`;
    case "summary-create":
    case "dpc-form1-create":
      return `${state.kind}:${state.encounterId ?? ""}`;
    case "intake-review":
      return `${state.kind}:${state.responseId}`;
    case "dpc-form1-edit":
      return `${state.kind}:${state.responseId}`;
    case "prescription-edit":
    case "injection-edit":
      return `${state.kind}:${state.srId}`;
    case "qr-edit":
      return `${state.kind}:${state.qrId}`;
    case "nursing-problem-edit":
      return `${state.kind}:${state.carePlanId}`;
    case "nursing-problem-create":
      return `${state.kind}:${state.entry}`;
    case "nursing-profile":
      return `${state.kind}:${state.encounterId ?? ""}:${state.templateUrl ?? ""}`;
    case "appointment-reschedule":
      return `${state.kind}:${state.appointmentId}`;
    case "vital-edit":
      return `${state.kind}:${state.entryId}`;
    // 別のセットを選び直したらフォームを作り直す(初期値は初回描画時のみ反映される)。
    case "order-set":
      return `${state.kind}:${state.setId ?? ""}:${state.problem?.conditionId ?? ""}`;
    case "regimen-apply":
      return `${state.kind}:${state.regimenId ?? ""}:${state.problem?.conditionId ?? ""}`;
    case "pathway-apply":
      return `${state.kind}:${state.pathwayId ?? ""}`;
    case "pathway-phase":
      return `${state.kind}:${state.applyId}:${state.phaseKey}`;
    case "regimen-cycle":
      return `${state.kind}:${state.regimenSrId}`;
    case "regimen-day":
      return `${state.kind}:${state.regimenSrId}:${state.date}`;
    case "regimen-adverse":
      return `${state.kind}:${state.regimenSrId}:${state.cycle}`;
    case "radiotherapy-adverse":
    case "radiotherapy-review":
      return `${state.kind}:${state.srId}`;
    case "regimen-header":
      return `${state.kind}:${state.regimenSrId}`;
    case "prescription-create":
      return `${state.kind}:${state.sourceSrId ?? ""}:${state.problem?.conditionId ?? ""}:${(state.broughtIds ?? []).join(",")}`;
    // 注射は暦の別の日を押したときも初期値(開始日)が変わるので、日付もキーに入れる。
    case "injection-create":
      return `${state.kind}:${state.sourceSrId ?? ""}:${state.problem?.conditionId ?? ""}:${state.startDate ?? ""}:${state.endDate ?? ""}`;
    case "qr-create":
      return `${state.kind}:${state.problem?.conditionId ?? ""}:${state.templateCanonical ?? ""}:${state.encounterId ?? ""}`;
    case "note-create":
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
            右のボタンから新規登録、またはカードのメニューの「編集」から編集を開始してください。
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

      <KartePaneMenu patientId={patientId} selectedProblem={selectedProblem} onStateChange={onStateChange} />
    </section>
  );
}

/** 入院診療計画書を書き始める。テンプレートは施設設定(入退院文書の作成状況と同じもの)。 */
function AdmissionPlanCreatePanel({
  patientId,
  encounterId,
  onSaved,
}: {
  patientId: string;
  encounterId: string;
  onSaved: () => void;
}) {
  const facility = useFacilitySettings();
  return (
    <QuestionnaireResponseCreatePanel
      patientId={patientId}
      defaultQuestionnaireCanonical={facility.data?.admission_documents?.admission_plan_template || undefined}
      encounterId={encounterId}
      onSaved={onSaved}
    />
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
  if (isOrderCreateState(state)) {
    const { Panel } = ORDER_PANES[orderKindOfPane(state)].create;
    return (
      <Panel
        patientId={patientId}
        sourceSrId={state.sourceSrId}
        defaultProblem={state.problem}
        startDate={state.startDate}
        teamId={state.teamId}
        onSaved={onSaved}
      />
    );
  }
  if (isOrderEditState(state)) {
    const { Panel } = ORDER_PANES[orderKindOfPane(state)].edit;
    return <Panel patientId={patientId} srId={state.srId} onSaved={onSaved} />;
  }
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
    case "regimen-apply":
      return (
        <RegimenApplyPanel
          patientId={patientId}
          regimenId={state.regimenId}
          defaultProblem={state.problem}
          onSelectRegimen={(regimenId) => onStateChange({ ...state, regimenId })}
          onBack={() => onStateChange({ ...state, regimenId: undefined })}
          onSaved={onSaved}
        />
      );
    case "pathway-apply":
      return (
        <PathwayApplyPanel
          patientId={patientId}
          pathwayId={state.pathwayId}
          onSelectPathway={(pathwayId) => onStateChange({ ...state, pathwayId })}
          onBack={() => onStateChange({ ...state, pathwayId: undefined })}
          onSaved={onSaved}
        />
      );
    case "pathway-phase":
      return (
        <PathwayPhasePanel
          patientId={patientId}
          applyId={state.applyId}
          phaseKey={state.phaseKey}
          onSaved={onSaved}
        />
      );
    case "regimen-cycle":
      return <RegimenCycleLoader patientId={patientId} regimenSrId={state.regimenSrId} onSaved={onSaved} />;
    case "regimen-day":
      return (
        <RegimenDayPanel
          patientId={patientId}
          regimenSrId={state.regimenSrId}
          date={state.date}
          onEditInjection={(srId) => onStateChange({ kind: "injection-edit", srId })}
          onEditPrescription={(srId) => onStateChange({ kind: "prescription-edit", srId })}
          onSaved={onSaved}
        />
      );
    case "regimen-adverse":
      return (
        <RegimenAdverseEventPanel patientId={patientId} regimenSrId={state.regimenSrId} cycle={state.cycle} />
      );
    case "radiotherapy-adverse":
      return <RadiotherapyAdverseEventPanel patientId={patientId} srId={state.srId} />;
    case "radiotherapy-review":
      return <RadiotherapyReviewPanel patientId={patientId} srId={state.srId} onSaved={onSaved} />;
    case "regimen-header":
      return <RegimenHeaderPanel patientId={patientId} regimenSrId={state.regimenSrId} onSaved={onSaved} />;
    case "note-create":
      return (
        <ClinicalNoteCreatePanel
          patientId={patientId}
          defaultProblem={state.problem}
          onSaved={onSaved}
        />
      );
    case "summary-create":
      return (
        <DischargeSummaryCreatePanel
          patientId={patientId}
          defaultEncounterId={state.encounterId}
          onSaved={onSaved}
          onStateChange={onStateChange}
        />
      );
    case "summary-edit":
      return <DischargeSummaryEditPanel patientId={patientId} noteId={state.noteId} onSaved={onSaved} />;
    case "nursing-summary-create":
      return (
        <NursingSummaryCreatePanel
          patientId={patientId}
          defaultEncounterId={state.encounterId}
          onSaved={onSaved}
          onStateChange={onStateChange}
        />
      );
    case "nursing-summary-edit":
      return <NursingSummaryEditPanel patientId={patientId} noteId={state.noteId} onSaved={onSaved} />;
    case "dpc-form1-create":
      return (
        <DpcForm1CreatePanel
          patientId={patientId}
          defaultEncounterId={state.encounterId}
          tab={state.tab}
          onSaved={onSaved}
          onStateChange={onStateChange}
        />
      );
    case "dpc-form1-edit":
      return (
        <DpcForm1EditPanel
          patientId={patientId}
          responseId={state.responseId}
          tab={state.tab}
          onSaved={onSaved}
        />
      );
    case "document-create":
      return <DocumentCreatePanel patientId={patientId} onSaved={onSaved} />;
    case "document-edit":
      return (
        <DocumentCreatePanel patientId={patientId} edit={{ documentId: state.documentId }} onSaved={onSaved} />
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
          broughtIds={state.broughtIds}
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
          startDate={state.startDate}
          endDate={state.endDate}
          onSaved={onSaved}
        />
      );
    case "injection-edit":
      return <InjectionEditPanel patientId={patientId} srId={state.srId} onSaved={onSaved} />;
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
    case "nursing-problem-create":
      return <NursingProblemCreatePanel patientId={patientId} entry={state.entry} onSaved={onSaved} />;
    case "nursing-problem-edit":
      return <NursingProblemEditPanel patientId={patientId} carePlanId={state.carePlanId} onSaved={onSaved} />;
    case "nursing-profile":
      return (
        <NursingProfilePanel
          patientId={patientId}
          defaultEncounterId={state.encounterId}
          defaultTemplateUrl={state.templateUrl}
          onSaved={onSaved}
        />
      );
    case "admission-plan-create":
      return <AdmissionPlanCreatePanel patientId={patientId} encounterId={state.encounterId} onSaved={onSaved} />;
    case "qr-create":
      return (
        <QuestionnaireResponseCreatePanel
          patientId={patientId}
          defaultProblem={state.problem}
          defaultQuestionnaireCanonical={state.templateCanonical}
          partOf={state.partOf}
          encounterId={state.encounterId}
          onSaved={onSaved}
        />
      );
    case "qr-edit":
      return (
        <QuestionnaireResponseEditPanel patientId={patientId} qrId={state.qrId} onSaved={onSaved} />
      );
    case "intake-review":
      return <IntakeReviewPanel patientId={patientId} responseId={state.responseId} onSaved={onSaved} />;
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
    case "planned-admission-create":
      return <PlannedAdmissionCreatePanel patientId={patientId} onSaved={onSaved} />;
    case "empty":
      return null;
  }
}
