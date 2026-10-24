import { EXAM_REPORT_KINDS } from "../fhir/examReportHelpers";
import type { KarteTimelineItem } from "../fhir/karteTimeline";
import type { KarteDetailTarget, KarteOtherTabKey } from "../karteUrl";
import { KarteAllergyTab } from "./KarteAllergyTab";
import { KarteAppointmentTab } from "./KarteAppointmentTab";
import { KarteBroughtMedicationTab } from "./KarteBroughtMedicationTab";
import { KarteChartTab } from "./KarteChartTab";
import { KarteChemoTab } from "./KarteChemoTab";
import { KarteConditionTab } from "./KarteConditionTab";
import { KarteExamReportTab } from "./KarteExamReportTab";
import { KarteFileTab } from "./KarteFileTab";
import { KarteImagingTab } from "./KarteImagingTab";
import { KarteInjectionTab } from "./KarteInjectionTab";
import { KarteLabResultTab } from "./KarteLabResultTab";
import { KarteMealTab } from "./KarteMealTab";
import { KarteMedicationHistoryTab } from "./KarteMedicationHistoryTab";
import { KarteMicroResultTab } from "./KarteMicroResultTab";
import { KarteNursingCarePlanTab } from "./KarteNursingCarePlanTab";
import { KarteNursingProfileTab } from "./KarteNursingProfileTab";
import { KarteNursingTab } from "./KarteNursingTab";
import { KarteOralExamTab } from "./KarteOralExamTab";
import { KartePathoResultTab } from "./KartePathoResultTab";
import { KartePathwayTab } from "./KartePathwayTab";
import { KartePrintTab } from "./KartePrintTab";
import { KarteProfileTab } from "./KarteProfileTab";
import type { KartePaneState } from "./KarteRightPane";
import { KarteSmartAppsTab } from "./KarteSmartAppsTab";
import { LabResultTimelinePanel } from "./LabResultTimelinePanel";
import { VitalFlowsheetPanel } from "./VitalFlowsheetPanel";

// カルテ左ペインのタブ(カルテのタイムラインと診療ダッシュボード以外)の中身。タブ表示・
// 上下分割の下ペイン・診療ダッシュボードのカードが、同じ部品を同じ props で描く
// (診療ダッシュボード自身はカードの中にこれを置くので、KartePage が直接描く)。
// タブを足すときは karteUrl.ts の KARTE_TABS とここに 1 行ずつ加える。

/** タブの中からカルテ画面の右ペイン・詳細モーダルを開くための操作。KartePage が束ねて渡す。 */
export interface KartePanelActions {
  /** 右ペインでフォームを開く(別タブ表示ではメインタブに頼む)。 */
  openForm: (next: KartePaneState) => void;
  /** カルテのカードと同じ詳細モーダルを開く。 */
  openDetail: (target: KarteDetailTarget) => void;
  /** 選択中のプロブレム(登録フォームの対象の初期値)。 */
  selectedProblem?: { conditionId: string; display: string };
  /** 外来の診察中の受診(SMART アプリの起動の文脈)。 */
  examEncounterId?: string;
  /** タイムラインのカードの操作(診療ダッシュボードの「カルテ」カード用)。 */
  timeline: {
    onEdit: (item: KarteTimelineItem) => void;
    onDo: (item: KarteTimelineItem) => void;
    onDeleted: (item: KarteTimelineItem) => void;
    onOpenRadiotherapyPane: (kind: "adverse" | "review", srId: string) => void;
  };
}

/** この部品が描くタブ。 */
export type KartePanelTabKey = Exclude<KarteOtherTabKey, "clinical-dashboard">;

export interface KarteTabPanelProps {
  tab: KartePanelTabKey;
  patientId: string;
  /** 選択中のタブで開いているもの(URL の view、またはカードごとの state)。 */
  view: string;
  onViewChange: (view: string | null) => void;
  /** 表示の既定を決める日(診療ダッシュボードの基準日)。無ければ今日。 */
  baseDate?: string;
  actions: KartePanelActions;
}

export function KarteTabPanel({ tab: key, patientId, view, onViewChange, baseDate, actions }: KarteTabPanelProps) {
  const { openForm, openDetail, selectedProblem } = actions;
  const props = { patientId, view, onViewChange };
  if (key === "condition") return <KarteConditionTab {...props} />;
  if (key === "allergy") return <KarteAllergyTab {...props} />;
  // 継続は右ペインの処方登録を、選んだ持参薬から作った初期値で開く。
  if (key === "brought-medication") {
    return (
      <KarteBroughtMedicationTab
        {...props}
        onContinue={(broughtIds) => openForm({ kind: "prescription-create", broughtIds })}
        onOpenPrescription={(srId) => openDetail({ kind: "prescription", id: srId })}
      />
    );
  }
  if (key === "profile") return <KarteProfileTab {...props} />;
  if (key === "oral-exam") return <KarteOralExamTab {...props} />;
  // 経過表は view に「基準日(と全画面)」を載せる(どの週を見ているかが読む位置
  // そのものなので、リロード・共有で戻れるようにする)。イベント一覧からはカルテの
  // カードと同じオーダー詳細モーダル、測定の時刻からはバイタル編集を開く。
  if (key === "flowsheet") {
    return (
      <VitalFlowsheetPanel
        {...props}
        baseDate={baseDate}
        onOpenDetail={openDetail}
        onOpenVital={(entryId) => openForm({ kind: "vital-edit", entryId })}
      />
    );
  }
  // 検査結果時系列は読み取り専用で、詳細を開く導線が無いので view は使わない。
  if (key === "lab-timeline") {
    return (
      <div className="karte-tabpanel">
        <LabResultTimelinePanel patientId={patientId} splittable />
      </div>
    );
  }
  // チャートは view に「基準日・横軸・見ているチャート」を載せる(経過表と同じ考え)。
  // 帯のイベントからはカルテのカードと同じオーダー詳細モーダルを開く。
  if (key === "chart") return <KarteChartTab {...props} baseDate={baseDate} onOpenDetail={openDetail} />;
  // 投薬歴も view に「基準日・列・絞り込み」を載せ、セルからオーダー詳細モーダルを開く。
  if (key === "medication-history") {
    return <KarteMedicationHistoryTab {...props} baseDate={baseDate} onOpenDetail={openDetail} />;
  }
  if (key === "micro") return <KarteMicroResultTab {...props} baseDate={baseDate} />;
  if (key === "patho") return <KartePathoResultTab {...props} baseDate={baseDate} />;
  if (key === "rad-report" || key === "physio-report" || key === "endoscopy-report") {
    const config = EXAM_REPORT_KINDS.find((kind) => kind.tabKey === key);
    return config ? <KarteExamReportTab key={key} config={config} {...props} baseDate={baseDate} /> : null;
  }
  // 食事オーダーの編集も、登録と同じ右ペインで開く(暦は表示に徹する)。
  if (key === "meal") {
    return (
      <KarteMealTab
        patientId={patientId}
        baseDate={baseDate}
        // オーダーが始まった日のマスは、そのオーダーの編集。
        onEdit={(srId) => openForm({ kind: "meal-order-edit", srId })}
        // それ以外の日は、その日に出ている食事を引き継いだ新規登録(= その日からの食事変更)。
        onCreate={(date, sourceSrId) => openForm({ kind: "meal-order-create", sourceSrId, startDate: date })}
      />
    );
  }
  // 注射カレンダー。view は表示開始日と全画面。マスはタブのモーダルで開き、
  // 変更・登録の入力は右ペインで行う。
  if (key === "injection") {
    return (
      <KarteInjectionTab
        {...props}
        baseDate={baseDate}
        onEdit={(srId) => openForm({ kind: "injection-edit", srId })}
        onCreate={(startDate, endDate, sourceSrId) =>
          openForm({ kind: "injection-create", sourceSrId, startDate, endDate, problem: selectedProblem })
        }
      />
    );
  }
  // 化学療法。暦とレジメン詳細は左ペインのタブで切り替え、オーダーを作る操作
  // (適用・次クールの登録)と投与日の操作は右ペインで行う。
  if (key === "chemo") {
    return (
      <KarteChemoTab
        {...props}
        baseDate={baseDate}
        onAddCycle={(regimenSrId) => openForm({ kind: "regimen-cycle", regimenSrId })}
        onOpenDay={(regimenSrId, date) => openForm({ kind: "regimen-day", regimenSrId, date })}
        onOpenAdverseEvents={(regimenSrId, cycle) => openForm({ kind: "regimen-adverse", regimenSrId, cycle })}
        onEditHeader={(regimenSrId) => openForm({ kind: "regimen-header", regimenSrId })}
      />
    );
  }
  // クリニカルパス。適用したパスを病日 × OAT ユニットのシートで見る。適用は右ペインの
  // 「クリニカルパス」から、評価の入力も右ペインの担当。
  if (key === "pathway") {
    return (
      <KartePathwayTab
        {...props}
        baseDate={baseDate}
        onOpenOrder={(kind, srId) => openForm({ kind: `${kind}-edit`, srId } as KartePaneState)}
        onApplyPhase={(applyId, phaseKey) => openForm({ kind: "pathway-phase", applyId, phaseKey })}
      />
    );
  }
  // 指示簿。登録・編集は他のオーダーと同じ右ペインで開く。
  if (key === "nursing") {
    return (
      <KarteNursingTab
        {...props}
        baseDate={baseDate}
        onCreate={() => openForm({ kind: "nursing-order-create", problem: selectedProblem })}
        onEdit={(srId) => openForm({ kind: "nursing-order-edit", srId })}
      />
    );
  }
  // 看護計画。立案・編集は右ペインで開く(評価・指示展開はタブの中のモーダル)。
  if (key === "nursing-care-plan") {
    return (
      <KarteNursingCarePlanTab
        patientId={patientId}
        baseDate={baseDate}
        onCreate={(entry) => openForm({ kind: "nursing-problem-create", entry })}
        onEdit={(carePlanId) => openForm({ kind: "nursing-problem-edit", carePlanId })}
      />
    );
  }
  // 看護プロファイル。区画の記入・編集は右ペインの「プロファイル」と同じ画面で開く。
  if (key === "nursing-profile") {
    return (
      <KarteNursingProfileTab
        {...props}
        onEdit={(encounterId, templateUrl) => openForm({ kind: "nursing-profile", encounterId, templateUrl })}
      />
    );
  }
  // 予約の日時変更は枠を選ぶ操作なので、登録と同じ右ペインで開く。
  if (key === "appointment") {
    return (
      <KarteAppointmentTab
        patientId={patientId}
        baseDate={baseDate}
        onReschedule={(appointmentId) => openForm({ kind: "appointment-reschedule", appointmentId })}
      />
    );
  }
  // 取り込んだファイル。登録・編集・削除はタブ内で完結し、右ペインを使うのは様式文書の内容編集
  // (右ペインの「文書作成」で作ったものの編集)だけ。
  if (key === "file") {
    return (
      <KarteFileTab
        {...props}
        onEditDocument={(documentId) => openForm({ kind: "document-edit", documentId })}
      />
    );
  }
  if (key === "imaging") return <KarteImagingTab {...props} />;
  if (key === "karte-print") return <KartePrintTab patientId={patientId} />;
  // 外来の診察中なら、その受診を起動の文脈(encounter)として渡す。
  if (key === "smart-apps") return <KarteSmartAppsTab {...props} encounterId={actions.examEncounterId} />;
  return <KarteLabResultTab {...props} baseDate={baseDate} />;
}
