import { Link, Navigate, NavLink, Route, Routes, useLocation, useParams } from "react-router-dom";
import "./App.css";
import { APP_MENU, type AppMenuItem } from "./appMenu";
import { AdminGate } from "./components/AdminGate";
import { AuthGate } from "./components/AuthGate";
import { CurrentUserBadge } from "./components/CurrentUserBadge";
import { HoverMenu } from "./components/HoverMenu";
import { OrderContextPicker } from "./components/OrderContextPicker";
import { SubMenu } from "./components/SubMenu";
import { ThemeToggleItem } from "./components/ThemeToggleItem";
import { WakeButton } from "./components/WakeButton";
import { ConnectionSettingsPage } from "./pages/ConnectionSettingsPage";
import { DocumentTemplatesPage } from "./pages/DocumentTemplatesPage";
import { ExternalCodeMappingPage } from "./pages/ExternalCodeMappingPage";
import { ExternalSystemListPage } from "./pages/ExternalSystemListPage";
import { ExternalSystemSettingsPage } from "./pages/ExternalSystemSettingsPage";
import { FacilitySettingsPage } from "./pages/FacilitySettingsPage";
import { OauthClientsPage } from "./pages/OauthClientsPage";
import { SmartAppsPage } from "./pages/SmartAppsPage";
import { CdsServicesPage } from "./pages/CdsServicesPage";
import { AdvisoryOverrideReasonPage } from "./pages/AdvisoryMasterPages";
import { PharmacistInterventionTypePage } from "./pages/PharmacistInterventionTypePage";
import { AdvisoryReviewPage } from "./pages/AdvisoryReviewPage";
import { MasterImportPage } from "./pages/MasterImportPage";
import { MasterMenuPage } from "./pages/MasterMenuPage";
import { LabContainerPage } from "./pages/LabContainerPage";
import { SchemaMasterPage } from "./pages/SchemaMasterPage";
import { LabOrderItemLayoutPage } from "./pages/LabOrderItemLayoutPage";
import { LabOrderItemPage } from "./pages/LabOrderItemPage";
import { LabResultItemPage } from "./pages/LabResultItemPage";
import { LabSpecimenPage } from "./pages/LabSpecimenPage";
import { RadItemLayoutPage } from "./pages/RadItemLayoutPage";
import { RadItemPage } from "./pages/RadItemPage";
import { RadJj1017CodePage } from "./pages/RadJj1017CodePage";
import { RadMaterialPage } from "./pages/RadMaterialPage";
import { RadDatasetPage } from "./pages/RadDatasetPage";
import { RegimenListPage } from "./pages/RegimenListPage";
import { RegimenEditorPage } from "./pages/RegimenEditorPage";
import { PathwayListPage } from "./pages/PathwayListPage";
import { PathwayEditorPage } from "./pages/PathwayEditorPage";
import { PhysioWorklistPage } from "./pages/PhysioWorklistPage";
import { PhysioExamTypePage } from "./pages/PhysioExamTypePage";
import { PhysioItemPage } from "./pages/PhysioItemPage";
import { PhysioItemLayoutPage } from "./pages/PhysioItemLayoutPage";
import { PhysioDatasetPage } from "./pages/PhysioDatasetPage";
import { EndoscopyWorklistPage } from "./pages/EndoscopyWorklistPage";
import { EndoscopyExamTypePage } from "./pages/EndoscopyExamTypePage";
import { EndoscopyItemPage } from "./pages/EndoscopyItemPage";
import { EndoscopyItemLayoutPage } from "./pages/EndoscopyItemLayoutPage";
import { EndoscopyDatasetPage } from "./pages/EndoscopyDatasetPage";
import { TreatmentWorklistPage } from "./pages/TreatmentWorklistPage";
import { SurgeryWorklistPage } from "./pages/SurgeryWorklistPage";
import { SurgeryCalendarPage } from "./pages/SurgeryCalendarPage";
import { AnesthesiaChartPage } from "./pages/AnesthesiaChartPage";
import { SurgeryRoomBlockPage } from "./pages/SurgeryRoomBlockPage";
import { SurgeryItemPage } from "./pages/SurgeryItemPage";
import { SurgeryCategoryPage } from "./pages/SurgeryCategoryPage";
import { MealDietPage } from "./pages/MealDietPage";
import { MealItemPage } from "./pages/MealItemPage";
import { MealCategoryPage } from "./pages/MealCategoryPage";
import { MealPatternPage } from "./pages/MealPatternPage";
import { TransfusionProductPage } from "./pages/TransfusionProductPage";
import { NursingActPage } from "./pages/NursingActPage";
import { NursingStandardPlanPage } from "./pages/NursingStandardPlanPage";
import { NursingTermMasterPage } from "./pages/NursingTermMasterPage";
import { NursingObservationPage } from "./pages/NursingObservationPage";
import { TreatmentItemPage } from "./pages/TreatmentItemPage";
import { TreatmentItemLayoutPage } from "./pages/TreatmentItemLayoutPage";
import { TreatmentDatasetPage } from "./pages/TreatmentDatasetPage";
import { MicroOrderItemPage } from "./pages/MicroOrderItemPage";
import { MicroOrganismPage } from "./pages/MicroOrganismPage";
import { MicroAntimicrobialPage } from "./pages/MicroAntimicrobialPage";
import { MicroSusceptibilityMethodPage } from "./pages/MicroSusceptibilityMethodPage";
import { MicroSpecimenTypePage } from "./pages/MicroSpecimenTypePage";
import { PathoWorklistPage } from "./pages/PathoWorklistPage";
import { TransfusionWorklistPage } from "./pages/TransfusionWorklistPage";
import { ChemoRoomWorklistPage } from "./pages/ChemoRoomWorklistPage";
import {
  RadiotherapyDevicePage,
  RadiotherapyModalityPage,
  RadiotherapyStopReasonPage,
  RadiotherapyTechniquePage,
} from "./pages/RadiotherapyMasterPages";
import { RadiotherapyProtocolPage } from "./pages/RadiotherapyProtocolPage";
import { RadiotherapyWorklistPage } from "./pages/RadiotherapyWorklistPage";
import { RehabWorklistPage } from "./pages/RehabWorklistPage";
import { NutritionGuidanceWorklistPage } from "./pages/NutritionGuidanceWorklistPage";
import { MealWorklistPage } from "./pages/MealWorklistPage";
import { MedicationGuidanceWorklistPage } from "./pages/MedicationGuidanceWorklistPage";
import { ConsultWorklistPage } from "./pages/ConsultWorklistPage";
import { TeamWorklistPage } from "./pages/TeamWorklistPage";
import { NotificationPage } from "./pages/NotificationPage";
import { CountersignListPage } from "./pages/CountersignListPage";
import { SupervisorGroupPage } from "./pages/SupervisorGroupPage";
import { CareTeamPage } from "./pages/CareTeamPage";
import { OrderSetPage } from "./pages/OrderSetPage";
import { NotificationBell } from "./components/NotificationBell";
import { NursingWorklistPage } from "./pages/NursingWorklistPage";
import { PathoOrganPage } from "./pages/PathoOrganPage";
import { PathoCollectionMethodPage } from "./pages/PathoCollectionMethodPage";
import { PatientCautionPage } from "./pages/PatientCautionPage";
import { ClinicalNoteTitlePage } from "./pages/ClinicalNoteTitlePage";
import { InsulinScaleSetPage } from "./pages/InsulinScaleSetPage";
import { InsulinWorklistPage } from "./pages/InsulinWorklistPage";
import { AstWorklistPage } from "./pages/AstWorklistPage";
import { NursingAssignmentPage } from "./pages/NursingAssignmentPage";
import { BedSchedulePage } from "./pages/BedSchedulePage";
import { BedStatusPage } from "./pages/BedStatusPage";
import { AdmissionDocumentsPage } from "./pages/AdmissionDocumentsPage";
import { ResultFollowupPage } from "./pages/ResultFollowupPage";
import { NursingAcuityPage } from "./pages/NursingAcuityPage";
import { PressureUlcerPage } from "./pages/PressureUlcerPage";
import { NursingWorksheetPage } from "./pages/NursingWorksheetPage";
import { BulkVitalEntryPage } from "./pages/BulkVitalEntryPage";
import { NursingSummaryApprovalPage } from "./pages/NursingSummaryApprovalPage";
import { MedicineDoseConversionPage } from "./pages/MedicineDoseConversionPage";
import { MedicineAttributePage } from "./pages/MedicineAttributePage";
import { FormularyPage } from "./pages/FormularyPage";
import { DrugCheckPage } from "./pages/DrugCheckPage";
import { PractitionerCreatePage } from "./pages/PractitionerCreatePage";
import { PractitionerEditPage } from "./pages/PractitionerEditPage";
import { PractitionerListPage } from "./pages/PractitionerListPage";
import { PatientCreatePage } from "./pages/PatientCreatePage";
import { PatientEditPage } from "./pages/PatientEditPage";
import { PatientListPage } from "./pages/PatientListPage";
import { KartePage } from "./pages/KartePage";
import { KartePanePage } from "./pages/KartePanePage";
import { KARTE_PANE_PATH, useKartePaneHost } from "./kartePaneChannel";
import { KartePrintPage } from "./pages/KartePrintPage";
import { INTAKE_PATH, KARTE_PRINT_PATH } from "./karteUrl";
import { IntakePage } from "./pages/IntakePage";
import { isMasterPath } from "./masterMenu";
import { DepartmentCreatePage } from "./pages/DepartmentCreatePage";
import { DepartmentEditPage } from "./pages/DepartmentEditPage";
import { DepartmentListPage } from "./pages/DepartmentListPage";
import { OrganizationCreatePage } from "./pages/OrganizationCreatePage";
import { OrganizationEditPage } from "./pages/OrganizationEditPage";
import { OrganizationListPage } from "./pages/OrganizationListPage";
import { PartnerOrganizationListPage } from "./pages/PartnerOrganizationListPage";
import { PartnerPractitionerCreatePage } from "./pages/PartnerPractitionerCreatePage";
import { PartnerPractitionerEditPage } from "./pages/PartnerPractitionerEditPage";
import { PartnerPractitionerListPage } from "./pages/PartnerPractitionerListPage";
import { InpatientListPage } from "./pages/InpatientListPage";
import { LocationCreatePage } from "./pages/LocationCreatePage";
import { LocationEditPage } from "./pages/LocationEditPage";
import { LocationListPage } from "./pages/LocationListPage";
import { WardCreatePage } from "./pages/WardCreatePage";
import { WardEditPage } from "./pages/WardEditPage";
import { WardListPage } from "./pages/WardListPage";
import { WardMapEditPage } from "./pages/WardMapEditPage";
import { WardMapPage } from "./pages/WardMapPage";
import { PatientFolderPage } from "./pages/PatientFolderPage";
import { WardRoomCreatePage } from "./pages/WardRoomCreatePage";
import { WardRoomEditPage } from "./pages/WardRoomEditPage";
import { WardRoomListPage } from "./pages/WardRoomListPage";
import { ScheduleCreatePage } from "./pages/ScheduleCreatePage";
import { ScheduleEditPage } from "./pages/ScheduleEditPage";
import { ScheduleListPage } from "./pages/ScheduleListPage";
import { ScheduleSlotCalendarPage } from "./pages/ScheduleSlotCalendarPage";
import { QuestionnaireCreatePage } from "./pages/QuestionnaireCreatePage";
import { QuestionnaireEditPage } from "./pages/QuestionnaireEditPage";
import { QuestionnaireListPage } from "./pages/QuestionnaireListPage";
import { QuestionnairePreviewPage } from "./pages/QuestionnairePreviewPage";
import { OutpatientListPage } from "./pages/OutpatientListPage";
import { EmergencyListPage } from "./pages/EmergencyListPage";
import { LabArrivalPage } from "./pages/LabArrivalPage";
import { LabResultImportPage } from "./pages/LabResultImportPage";
import { LabResultImportDetailPage } from "./pages/LabResultImportDetailPage";
import { LabWorklistPage } from "./pages/LabWorklistPage";
import { RadWorklistPage } from "./pages/RadWorklistPage";
import { RxWorklistPage } from "./pages/RxWorklistPage";
import { RxVerificationPage } from "./pages/RxVerificationPage";
import { BroughtMedicationWorklistPage } from "./pages/BroughtMedicationWorklistPage";
import { InjectionWorklistPage } from "./pages/InjectionWorklistPage";
import { LotManagementPage } from "./pages/LotManagementPage";
import { DataExtractPage } from "./pages/DataExtractPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ReportLayoutsPage } from "./pages/ReportLayoutsPage";
import { HomePage } from "./pages/HomePage";
import { BulletinPage } from "./pages/BulletinPage";
import { DpcForm1ExportPage } from "./pages/DpcForm1ExportPage";
import { DpcPatientListPage } from "./pages/DpcPatientListPage";
import { CancerRegistryPage } from "./pages/CancerRegistryPage";
import { InfectiousDiseaseReportPage } from "./pages/InfectiousDiseaseReportPage";
import { DpcTablesPage } from "./pages/DpcTablesPage";

// 患者配下の未定義パスをその患者のカルテへ寄せる。
function KarteRedirect() {
  const { patientId } = useParams<{ patientId: string }>();
  return <Navigate to={patientId ? `/patients/${patientId}/karte` : "/patients"} replace />;
}

function menuLink(item: AppMenuItem) {
  return (
    <Link key={item.to} to={item.to} className="row-menu__item">
      {item.label}
    </Link>
  );
}

function App() {
  // カルテの左ペインを出す別タブ。サブモニターに置いて参照するだけの画面なので、
  // アプリのヘッダー(ナビ)を出さず縦幅をカルテに回す。
  const { pathname } = useLocation();
  const detachedPane = pathname.startsWith(KARTE_PANE_PATH);
  // カルテ印刷も別タブで、印刷する紙面だけを出す。
  const printPage = pathname.startsWith(KARTE_PRINT_PATH);
  // Web 問診の患者画面。ログインの外(AuthGate の外)で、トークンだけで開く。
  const intakeToken = pathname.startsWith(INTAKE_PATH) ? pathname.slice(INTAKE_PATH.length).split("/")[0] : "";
  // メインタブは、別タブから見た「生きているか」「いま誰のカルテか」の応答口になる。
  useKartePaneHost(!detachedPane && !printPage && !intakeToken);

  if (intakeToken) return <IntakePage token={decodeURIComponent(intakeToken)} />;

  return (
    // アプリ全体をログインゲートで包む(ADMIN_TOKEN 未設定なら素通し)。
    // ログイン中の医療従事者(Practitioner)は useCurrentPractitioner で参照できる。
    <AuthGate>
      <div className={`app${detachedPane ? " app--pane" : ""}${printPage ? " app--print" : ""}`}>
      {!detachedPane && !printPage && (
      <header className="app__header">
        <Link to="/" className="app__title">
          FHIR Client
        </Link>
        <nav className="app__nav">
          {/* メニューの並びと項目は appMenu.ts(ホームのショートカットの候補と同じ表)。 */}
          {APP_MENU.map((entry) =>
            entry.kind === "link" ? (
              <NavLink key={entry.to} to={entry.to}>
                {entry.label}
              </NavLink>
            ) : (
              <HoverMenu key={entry.label} label={entry.label}>
                {"sections" in entry
                  ? entry.sections.map((section) => (
                      <SubMenu key={section.label} label={section.label}>
                        {section.items.map(menuLink)}
                      </SubMenu>
                    ))
                  : entry.items.map(menuLink)}
              </HoverMenu>
            ),
          )}
          <HoverMenu label="管理">
            {/* マスタメンテは項目が多くメニューに収まらないので、一覧のページ(/masters)へ送る。
                そこから入ったマスタの画面にいる間も、戻り先としてこの項目を強調する。 */}
            <Link
              to="/masters"
              className={`row-menu__item${isMasterPath(pathname) ? " active" : ""}`}
            >
              マスタメンテ
            </Link>
            <Link to="/oauth-clients" className="row-menu__item">
              OAuth クライアント
            </Link>
            {/* カルテの「SMARTアプリ」タブから起動する SMART on FHIR アプリの台帳。 */}
            <Link to="/smart-apps" className="row-menu__item">
              SMART アプリ
            </Link>
            {/* カルテを開いたときに呼ぶ外部の判断支援(CDS Hooks)の提供元。 */}
            <Link to="/cds-services" className="row-menu__item">
              CDS サービス
            </Link>
            {/* 警告(判断支援)の発火数・無視率と、種別ごとの重さの調整。 */}
            <Link to="/advisory-review" className="row-menu__item">
              警告の集計と設定
            </Link>
            <Link to="/settings" className="row-menu__item">
              接続設定
            </Link>
            {/* どの Organization が自院かの指定。診療科・診察室・スタッフの所属や
                帳票の自院欄がこの設定を見る。 */}
            <Link to="/facility-settings" className="row-menu__item">
              施設設定
            </Link>
            {/* 外部システム連携。一覧でシステムを選ぶと、そのシステムの設定ページへ入る
                (レセコン連携は docs/receipt-computer-integration.md)。 */}
            <Link to="/external-systems" className="row-menu__item">
              外部システム連携
            </Link>
            <ThemeToggleItem />
          </HoverMenu>
        </nav>
        {/* オーダーはカルテ以外(手術カレンダーなど)からも登録するので、
            依頼科・依頼医師の選択はどの画面でも切り替えられるようにする。 */}
        <OrderContextPicker />
        <NotificationBell />
        <CurrentUserBadge />
        <WakeButton />
      </header>
      )}
      <main className="app__main">
        <Routes>
          {/* ホーム。ログインした人の「今日の仕事」(通知・外来・入院・部門の件数)を職種ごとに出す。 */}
          <Route path="/" element={<HomePage />} />
          <Route path="/patients" element={<PatientListPage />} />
          <Route path="/patients/new" element={<PatientCreatePage />} />
          <Route path="/patients/:id/edit" element={<PatientEditPage />} />
          {/* 診療記録・処方・病名・アレルギー・検査結果・テンプレート回答は
              患者ごとの一覧ページを持たず、カルテ画面(タブと右ペイン)で扱う。 */}
          <Route path="/patients/:patientId/karte" element={<KartePage />} />
          {/* カルテの左ペインだけを出す別タブ。患者はメインタブから受け取るので、
              患者を持たない形でも開ける(メインでカルテを閉じている間)。 */}
          <Route path="/karte-pane" element={<KartePanePage />} />
          <Route path="/karte-pane/:patientId" element={<KartePanePage />} />
          <Route path={`${KARTE_PRINT_PATH}/:patientId`} element={<KartePrintPage />} />
          {/* 患者配下のその他の URL(/patients/:id/prescriptions など)は空白画面にせず、
              その患者のカルテへ寄せる。 */}
          <Route path="/patients/:patientId/*" element={<KarteRedirect />} />
          {/* 医療機関・医療従事者は上流 FHIR サーバーの Organization / Practitioner を
              直接操作するため、backend 管理API(AdminGate)の対象外。 */}
          <Route path="/organizations" element={<OrganizationListPage />} />
          <Route path="/organizations/new" element={<OrganizationCreatePage />} />
          <Route path="/organizations/:id/edit" element={<OrganizationEditPage />} />
          {/* 連携先(他院)。リソースは自院と同じ Organization / Practitioner で、
              画面と検索条件だけ分ける。 */}
          <Route path="/partner-organizations" element={<PartnerOrganizationListPage />} />
          <Route
            path="/partner-organizations/new"
            element={
              <OrganizationCreatePage backTo="/partner-organizations" title="連携先医療機関登録" />
            }
          />
          <Route
            path="/partner-organizations/:id/edit"
            element={
              <OrganizationEditPage backTo="/partner-organizations" title="連携先医療機関編集" />
            }
          />
          <Route path="/partner-practitioners" element={<PartnerPractitionerListPage />} />
          <Route path="/partner-practitioners/new" element={<PartnerPractitionerCreatePage />} />
          <Route
            path="/partner-practitioners/:id/edit"
            element={<PartnerPractitionerEditPage />}
          />
          {/* 診療科も Organization だが、所属医療機関(partOf)を持つ点で施設と切り分ける。 */}
          <Route path="/departments" element={<DepartmentListPage />} />
          <Route path="/departments/new" element={<DepartmentCreatePage />} />
          <Route path="/departments/:id/edit" element={<DepartmentEditPage />} />
          <Route path="/practitioners" element={<PractitionerListPage />} />
          <Route path="/practitioners/new" element={<PractitionerCreatePage />} />
          <Route path="/practitioners/:id/edit" element={<PractitionerEditPage />} />
          <Route path="/locations" element={<LocationListPage />} />
          <Route path="/locations/new" element={<LocationCreatePage />} />
          <Route path="/locations/:id/edit" element={<LocationEditPage />} />

          {/* 入院の場所。病棟(Location)の下に病室、その下にベッドをぶら下げる。
              診察室・撮影室と同じ Location だが、階層も使う場面も別なので画面を分ける。 */}
          <Route path="/wards" element={<WardListPage />} />
          <Route path="/wards/new" element={<WardCreatePage />} />
          <Route path="/wards/:id/edit" element={<WardEditPage />} />
          <Route path="/wards/:wardId/rooms" element={<WardRoomListPage />} />
          <Route path="/wards/:wardId/rooms/new" element={<WardRoomCreatePage />} />
          <Route path="/wards/:wardId/rooms/:id/edit" element={<WardRoomEditPage />} />
          <Route path="/wards/:wardId/map/edit" element={<WardMapEditPage />} />
          <Route path="/ward-map" element={<WardMapPage />} />
          <Route path="/patient-folders" element={<PatientFolderPage />} />

          {/* 予約枠。枠表(Schedule)の下に時間枠(Slot)を週カレンダーでぶら下げる。 */}
          <Route path="/schedules" element={<ScheduleListPage />} />
          <Route path="/schedules/new" element={<ScheduleCreatePage />} />
          <Route path="/schedules/:id/edit" element={<ScheduleEditPage />} />
          <Route path="/schedules/:id/slots" element={<ScheduleSlotCalendarPage />} />
          {/* 外来の受付。その日の予約患者と当日受付の患者を捌くための一覧。 */}
          <Route path="/outpatients" element={<OutpatientListPage />} />
          {/* 救急の受付。来院で救急の受診(Encounter)を建て、トリアージから転帰まで追う。 */}
          <Route path="/emergency" element={<EmergencyListPage />} />
          {/* 入院患者一覧。病棟のベッド(Location)に入院(Encounter)を突き合わせて出す。 */}
          <Route path="/inpatients" element={<InpatientListPage />} />
          {/* DPC 様式1 の提出ファイル(FF1)の出力。 */}
          <Route path="/dpc-form1-export" element={<DpcForm1ExportPage />} />
          <Route path="/dpc-patients" element={<DpcPatientListPage />} />
          {/* 院内がん登録の登録対象と登録・届出の状況。 */}
          <Route path="/cancer-registry" element={<CancerRegistryPage />} />
          {/* 感染症の発生届の届出対象と届出の状況。 */}
          <Route path="/infectious-disease-reports" element={<InfectiousDiseaseReportPage />} />
          {/* 部門業務の画面。オーダーを受けた側が、その日の検査を捌くための一覧。 */}
          <Route path="/lab-worklist" element={<LabWorklistPage />} />
          <Route path="/lab-arrivals" element={<LabArrivalPage />} />
          <Route path="/lab-result-imports" element={<LabResultImportPage />} />
          <Route path="/lab-result-imports/:id" element={<LabResultImportDetailPage />} />
          <Route path="/patho-worklist" element={<PathoWorklistPage />} />
          <Route path="/transfusion-worklist" element={<TransfusionWorklistPage />} />
          <Route path="/rehab-worklist" element={<RehabWorklistPage />} />
          <Route path="/meal-worklist" element={<MealWorklistPage />} />
          <Route path="/radiotherapy-worklist" element={<RadiotherapyWorklistPage />} />
          <Route path="/radiotherapy-protocols" element={<RadiotherapyProtocolPage />} />
          <Route path="/radiotherapy-modalities" element={<RadiotherapyModalityPage />} />
          <Route path="/radiotherapy-techniques" element={<RadiotherapyTechniquePage />} />
          <Route path="/radiotherapy-devices" element={<RadiotherapyDevicePage />} />
          <Route path="/radiotherapy-stop-reasons" element={<RadiotherapyStopReasonPage />} />
          <Route path="/advisory-override-reasons" element={<AdvisoryOverrideReasonPage />} />
          <Route path="/pharmacist-intervention-types" element={<PharmacistInterventionTypePage />} />
          <Route
            path="/nutrition-guidance-worklist"
            element={<NutritionGuidanceWorklistPage />}
          />
          <Route path="/medication-guidance-worklist" element={<MedicationGuidanceWorklistPage />} />
          <Route path="/consult-worklist" element={<ConsultWorklistPage />} />
          <Route path="/team-worklist" element={<TeamWorklistPage />} />
          <Route path="/notifications" element={<NotificationPage />} />
          <Route path="/countersigns" element={<CountersignListPage />} />
          <Route path="/supervisor-groups" element={<SupervisorGroupPage />} />
          <Route path="/care-teams" element={<CareTeamPage />} />
          {/* 掲示板(院内のお知らせ)。ホームのカードは今日掲載中だけ、ここは全件。 */}
          <Route path="/bulletin" element={<BulletinPage />} />
          <Route path="/order-sets" element={<OrderSetPage />} />
          <Route path="/nursing-worklist" element={<NursingWorklistPage />} />
          <Route path="/insulin-worklist" element={<InsulinWorklistPage />} />
          <Route path="/ast-worklist" element={<AstWorklistPage />} />
          <Route path="/nursing-worksheet" element={<NursingWorksheetPage />} />
          <Route path="/nursing-assignments" element={<NursingAssignmentPage />} />
          <Route path="/bed-schedule" element={<BedSchedulePage />} />
          <Route path="/bed-status" element={<BedStatusPage />} />
          <Route path="/admission-documents" element={<AdmissionDocumentsPage />} />
          <Route path="/result-followup" element={<ResultFollowupPage />} />
          <Route path="/nursing-acuity" element={<NursingAcuityPage />} />
          <Route path="/pressure-ulcer" element={<PressureUlcerPage />} />
          <Route path="/inpatients/bulk-vitals" element={<BulkVitalEntryPage />} />
          <Route path="/nursing-summary-approvals" element={<NursingSummaryApprovalPage />} />
          <Route path="/rad-worklist" element={<RadWorklistPage />} />
          <Route path="/rx-worklist" element={<RxWorklistPage />} />
          <Route path="/rx-verification" element={<RxVerificationPage />} />
          <Route path="/brought-med-worklist" element={<BroughtMedicationWorklistPage />} />
          <Route path="/injection-worklist" element={<InjectionWorklistPage />} />
          <Route path="/lot-management" element={<LotManagementPage />} />
          <Route path="/data-extract" element={<DataExtractPage />} />
          <Route path="/dashboards" element={<DashboardPage />} />
          <Route path="/chemo-room-worklist" element={<ChemoRoomWorklistPage />} />
          <Route path="/physio-worklist" element={<PhysioWorklistPage />} />
          <Route path="/endoscopy-worklist" element={<EndoscopyWorklistPage />} />
          <Route path="/treatment-worklist" element={<TreatmentWorklistPage />} />
          <Route path="/surgery-worklist" element={<SurgeryWorklistPage />} />
          <Route path="/surgery-calendar" element={<SurgeryCalendarPage />} />
          <Route path="/surgeries/:orderId/anesthesia-chart" element={<AnesthesiaChartPage />} />
          <Route path="/masters" element={<MasterMenuPage />} />
          <Route path="/master-import" element={<MasterImportPage />} />
          <Route path="/dpc-tables" element={<DpcTablesPage />} />
          <Route path="/medicine-dose-conversions" element={<MedicineDoseConversionPage />} />
          <Route path="/medicine-attributes" element={<MedicineAttributePage />} />
          <Route path="/formularies" element={<FormularyPage />} />
          <Route path="/drug-checks" element={<DrugCheckPage />} />
          <Route path="/insulin-scale-sets" element={<InsulinScaleSetPage />} />
          <Route path="/lab-order-items" element={<LabOrderItemPage />} />
          <Route path="/lab-result-items" element={<LabResultItemPage />} />
          <Route path="/lab-order-item-layouts" element={<LabOrderItemLayoutPage />} />
          <Route path="/lab-specimens" element={<LabSpecimenPage />} />
          <Route path="/lab-containers" element={<LabContainerPage />} />
          <Route path="/schemas" element={<SchemaMasterPage />} />
          <Route path="/rad-items" element={<RadItemPage />} />
          <Route path="/rad-item-layouts" element={<RadItemLayoutPage />} />
          <Route path="/rad-jj1017-codes" element={<RadJj1017CodePage />} />
          <Route path="/rad-materials" element={<RadMaterialPage />} />
          <Route path="/rad-datasets" element={<RadDatasetPage />} />
          <Route path="/regimens" element={<RegimenListPage />} />
          <Route path="/regimens/new" element={<RegimenEditorPage />} />
          <Route path="/regimens/:regimenId" element={<RegimenEditorPage />} />
          <Route path="/pathways" element={<PathwayListPage />} />
          <Route path="/pathways/new" element={<PathwayEditorPage />} />
          <Route path="/pathways/:pathwayId" element={<PathwayEditorPage />} />
          <Route path="/physio-items" element={<PhysioItemPage />} />
          <Route path="/physio-item-layouts" element={<PhysioItemLayoutPage />} />
          <Route path="/physio-exam-types" element={<PhysioExamTypePage />} />
          <Route path="/physio-datasets" element={<PhysioDatasetPage />} />
          <Route path="/endoscopy-items" element={<EndoscopyItemPage />} />
          <Route path="/endoscopy-item-layouts" element={<EndoscopyItemLayoutPage />} />
          <Route path="/endoscopy-exam-types" element={<EndoscopyExamTypePage />} />
          <Route path="/endoscopy-datasets" element={<EndoscopyDatasetPage />} />
          <Route path="/treatment-items" element={<TreatmentItemPage />} />
          <Route path="/treatment-item-layouts" element={<TreatmentItemLayoutPage />} />
          <Route path="/treatment-datasets" element={<TreatmentDatasetPage />} />
          <Route path="/meal-diets" element={<MealDietPage />} />
          <Route path="/meal-items" element={<MealItemPage />} />
          <Route path="/meal-categories" element={<MealCategoryPage />} />
          <Route path="/meal-patterns" element={<MealPatternPage />} />
          <Route path="/transfusion-products" element={<TransfusionProductPage />} />
          <Route path="/nursing-acts" element={<NursingActPage />} />
          <Route path="/nursing-observations" element={<NursingObservationPage />} />
          <Route path="/nursing-diagnoses" element={<NursingTermMasterPage key="diagnosis" taxonomy="diagnosis" />} />
          <Route path="/nursing-outcomes" element={<NursingTermMasterPage key="outcome" taxonomy="outcome" />} />
          <Route
            path="/nursing-interventions"
            element={<NursingTermMasterPage key="intervention" taxonomy="intervention" />}
          />
          <Route path="/nursing-standard-plans" element={<NursingStandardPlanPage />} />
          <Route path="/surgery-items" element={<SurgeryItemPage />} />
          <Route path="/surgery-categories" element={<SurgeryCategoryPage />} />
          <Route path="/surgery-room-blocks" element={<SurgeryRoomBlockPage />} />
          <Route path="/micro-order-items" element={<MicroOrderItemPage />} />
          <Route path="/micro-specimen-types" element={<MicroSpecimenTypePage />} />
          <Route path="/micro-organisms" element={<MicroOrganismPage />} />
          <Route path="/micro-antimicrobials" element={<MicroAntimicrobialPage />} />
          <Route path="/micro-susceptibility-methods" element={<MicroSusceptibilityMethodPage />} />
          <Route path="/patho-organs" element={<PathoOrganPage />} />
          <Route path="/patho-collection-methods" element={<PathoCollectionMethodPage />} />
          <Route path="/patient-cautions" element={<PatientCautionPage />} />
          <Route path="/clinical-note-titles" element={<ClinicalNoteTitlePage />} />
          <Route path="/questionnaires" element={<QuestionnaireListPage />} />
          <Route path="/questionnaires/new" element={<QuestionnaireCreatePage />} />
          <Route path="/questionnaires/:questionnaireId/edit" element={<QuestionnaireEditPage />} />
          <Route path="/questionnaires/:questionnaireId/preview" element={<QuestionnairePreviewPage />} />
          <Route path="/facility-settings" element={<FacilitySettingsPage />} />
          {/* 管理画面は AdminGate で包む。/settings も対象にするのは、
              これまで ADMIN_TOKEN ヘッダーを送っておらず、本番で
              ADMIN_TOKEN を設定すると 401 で開けなくなっていたため。 */}
          <Route
            path="/settings"
            element={
              <AdminGate>
                <ConnectionSettingsPage />
              </AdminGate>
            }
          />
          <Route
            path="/oauth-clients"
            element={
              <AdminGate>
                <OauthClientsPage />
              </AdminGate>
            }
          />
          {/* 起動 URL の差し替えは医療者を偽のアプリへ誘導する経路になるので管理者だけ。 */}
          <Route
            path="/smart-apps"
            element={
              <AdminGate>
                <SmartAppsPage />
              </AdminGate>
            }
          />
          {/* 患者情報(prefetch)の送り先なので管理者だけ。 */}
          <Route
            path="/cds-services"
            element={
              <AdminGate>
                <CdsServicesPage />
              </AdminGate>
            }
          />
          {/* 警告の統計は管理 API。重さの調整は施設設定に書く。 */}
          <Route
            path="/advisory-review"
            element={
              <AdminGate>
                <AdvisoryReviewPage />
              </AdminGate>
            }
          />
          {/* 外部システムの接続先と資格情報、受信トークンを持つので、接続設定と同じく管理者だけ。 */}
          <Route
            path="/external-systems"
            element={
              <AdminGate>
                <ExternalSystemListPage />
              </AdminGate>
            }
          />
          <Route
            path="/external-systems/:systemKey"
            element={
              <AdminGate>
                <ExternalSystemSettingsPage />
              </AdminGate>
            }
          />
          <Route
            path="/external-systems/:systemKey/code-mappings"
            element={
              <AdminGate>
                <ExternalCodeMappingPage />
              </AdminGate>
            }
          />
          {/* 帳票レイアウトは日常運用で使うため管理者ログインを要求しない
              (backend 側も認証対象外)。 */}
          <Route path="/report-layouts" element={<ReportLayoutsPage />} />
          <Route path="/document-templates" element={<DocumentTemplatesPage />} />
        </Routes>
      </main>
      </div>
    </AuthGate>
  );
}

export default App;
