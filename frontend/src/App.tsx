import { Link, Navigate, NavLink, Route, Routes, useLocation, useParams } from "react-router-dom";
import "./App.css";
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
import { MedicationGuidanceWorklistPage } from "./pages/MedicationGuidanceWorklistPage";
import { ConsultWorklistPage } from "./pages/ConsultWorklistPage";
import { NotificationPage } from "./pages/NotificationPage";
import { CountersignListPage } from "./pages/CountersignListPage";
import { SupervisorGroupPage } from "./pages/SupervisorGroupPage";
import { OrderSetPage } from "./pages/OrderSetPage";
import { NotificationBell } from "./components/NotificationBell";
import { NursingWorklistPage } from "./pages/NursingWorklistPage";
import { PathoOrganPage } from "./pages/PathoOrganPage";
import { PathoCollectionMethodPage } from "./pages/PathoCollectionMethodPage";
import { PatientCautionPage } from "./pages/PatientCautionPage";
import { ClinicalNoteTitlePage } from "./pages/ClinicalNoteTitlePage";
import { InsulinScaleSetPage } from "./pages/InsulinScaleSetPage";
import { InsulinWorklistPage } from "./pages/InsulinWorklistPage";
import { BulkVitalEntryPage } from "./pages/BulkVitalEntryPage";
import { NursingSummaryApprovalPage } from "./pages/NursingSummaryApprovalPage";
import { MedicineDoseConversionPage } from "./pages/MedicineDoseConversionPage";
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
import { BroughtMedicationWorklistPage } from "./pages/BroughtMedicationWorklistPage";
import { InjectionWorklistPage } from "./pages/InjectionWorklistPage";
import { ReportLayoutsPage } from "./pages/ReportLayoutsPage";
import { HomePage } from "./pages/HomePage";
import { BulletinPage } from "./pages/BulletinPage";
import { DpcForm1ExportPage } from "./pages/DpcForm1ExportPage";

// 患者配下の未定義パスをその患者のカルテへ寄せる。
function KarteRedirect() {
  const { patientId } = useParams<{ patientId: string }>();
  return <Navigate to={patientId ? `/patients/${patientId}/karte` : "/patients"} replace />;
}

function App() {
  // カルテの左ペインを出す別タブ。サブモニターに置いて参照するだけの画面なので、
  // アプリのヘッダー(ナビ)を出さず縦幅をカルテに回す。
  const { pathname } = useLocation();
  const detachedPane = pathname.startsWith(KARTE_PANE_PATH);
  // メインタブは、別タブから見た「生きているか」「いま誰のカルテか」の応答口になる。
  useKartePaneHost(!detachedPane);

  return (
    // アプリ全体をログインゲートで包む(ADMIN_TOKEN 未設定なら素通し)。
    // ログイン中の医療従事者(Practitioner)は useCurrentPractitioner で参照できる。
    <AuthGate>
      <div className={`app${detachedPane ? " app--pane" : ""}`}>
      {!detachedPane && (
      <header className="app__header">
        <Link to="/" className="app__title">
          FHIR Client
        </Link>
        <nav className="app__nav">
          {/* 患者を探す入口。患者検索で探すか、その日の外来予約から探すかで分ける。 */}
          <HoverMenu label="患者一覧">
            <Link to="/patients" className="row-menu__item">
              患者検索
            </Link>
            {/* 外来患者一覧はその日の予約患者を受付する画面。 */}
            <Link to="/outpatients" className="row-menu__item">
              外来患者一覧
            </Link>
            {/* 救急患者一覧は救急外来に来院した患者を来院から転帰まで追う画面。 */}
            <Link to="/emergency" className="row-menu__item">
              救急患者一覧
            </Link>
            {/* 入院患者一覧は病棟のベッドの埋まり具合と在院患者を見る画面。 */}
            <Link to="/inpatients" className="row-menu__item">
              入院患者一覧
            </Link>
            {/* 病棟マップは入院患者一覧の別の見え方(間取りの上に患者を出す)。 */}
            <Link to="/ward-map" className="row-menu__item">
              病棟マップ
            </Link>
          </HoverMenu>
          {/* 診療業務は「診療科の医師が捌く仕事」の画面。部門業務(検査室・薬剤部など、
              依頼を受ける部門の仕事)とは受け手が違うのでメニューを分ける
              — 他科依頼を受けるのは技師ではなく他科の医師で、返すのは結果ではなく
              診療記録(docs/consult-order-design.md §1)。 */}
          <HoverMenu label="診療業務">
            <Link to="/consult-worklist" className="row-menu__item">
              他科依頼一覧
            </Link>
            {/* 宛先の決まった通知(緊急異常値・オーダー承認…)の一覧。受け取るのは部門ではなく
                医師なので診療業務に置く(readme「通知」)。件数はヘッダーのベルに出る。 */}
            <Link to="/notifications" className="row-menu__item">
              通知
            </Link>
            {/* 研修医・学生の記録とオーダーのカウンターサイン(指導医向け。docs/countersign-design.md)。 */}
            <Link to="/countersigns" className="row-menu__item">
              カルテ承認
            </Link>
            {/* よく出すオーダーのひとまとめ(オーダーセット)の登録。出すのは診療科の
                医師なので部門業務ではなくここに置く(docs/order-set-design.md §1)。 */}
            <Link to="/order-sets" className="row-menu__item">
              セット登録
            </Link>
          </HoverMenu>
          {/* 部門業務は「依頼を受けた側」の画面。診療科がオーダーを出す患者一覧・カルテの
              次に置く。項目が多いので部門ごとに入れ子にする
              (1 項目だけの部門も並びを揃えるためサブメニューにする)。 */}
          <HoverMenu label="部門業務">
            <SubMenu label="臨床検査部門">
              <Link to="/lab-worklist" className="row-menu__item">
                検体検査一覧
              </Link>
              <Link to="/lab-arrivals" className="row-menu__item">
                検体到着確認
              </Link>
              {/* 検査室・分析装置・外注ラボから受け取った結果ファイルを読み込む
                  (docs/lab-result-import-design.md)。 */}
              <Link to="/lab-result-imports" className="row-menu__item">
                検査結果取込
              </Link>
            </SubMenu>
            <SubMenu label="病理部門">
              <Link to="/patho-worklist" className="row-menu__item">
                病理検査一覧
              </Link>
            </SubMenu>
            <SubMenu label="放射線部門">
              <Link to="/rad-worklist" className="row-menu__item">
                放射線検査一覧
              </Link>
              {/* 放射線治療は装置 × 時刻のカレンダーで照射の予定と実績を見る(右に治療コースの一覧)。 */}
              <Link to="/radiotherapy-worklist" className="row-menu__item">
                放射線治療カレンダー
              </Link>
            </SubMenu>
            <SubMenu label="生理検査部門">
              <Link to="/physio-worklist" className="row-menu__item">
                生理検査一覧
              </Link>
            </SubMenu>
            <SubMenu label="内視鏡部門">
              <Link to="/endoscopy-worklist" className="row-menu__item">
                内視鏡一覧
              </Link>
            </SubMenu>
            <SubMenu label="手術部門">
              <Link to="/surgery-worklist" className="row-menu__item">
                手術一覧
              </Link>
              {/* 手術一覧が「その日の手術を 1 件ずつ処理する」画面なのに対し、
                  カレンダーは「空いているところを探して日程を組む」画面。 */}
              <Link to="/surgery-calendar" className="row-menu__item">
                手術カレンダー
              </Link>
            </SubMenu>
            {/* 輸血は依頼を受けてから製剤を払い出すまでが部門の仕事で、投与は病棟。 */}
            <SubMenu label="輸血部門">
              <Link to="/transfusion-worklist" className="row-menu__item">
                輸血一覧
              </Link>
            </SubMenu>
            {/* リハビリは他の部門一覧と違い「その日に効いている期間オーダー」を並べる
                (1 オーダーが数か月続き、実施が日々積み上がる)。 */}
            <SubMenu label="リハビリ部門">
              <Link to="/rehab-worklist" className="row-menu__item">
                リハビリ一覧
              </Link>
            </SubMenu>
            {/* 栄養指導もリハビリと同じ期間継続型(1 オーダーに初回・継続の指導が積み上がる)。 */}
            <SubMenu label="栄養部門">
              <Link to="/nutrition-guidance-worklist" className="row-menu__item">
                栄養指導一覧
              </Link>
            </SubMenu>
            <SubMenu label="薬剤部門">
              <Link to="/rx-worklist" className="row-menu__item">
                処方一覧
              </Link>
              <Link to="/brought-med-worklist" className="row-menu__item">
                持参薬鑑別一覧
              </Link>
              {/* 服薬指導は栄養指導と同じ期間継続型(1 オーダーに入院中の指導が積み上がる)。 */}
              <Link to="/medication-guidance-worklist" className="row-menu__item">
                服薬指導一覧
              </Link>
              <Link to="/injection-worklist" className="row-menu__item">
                注射一覧
              </Link>
            </SubMenu>
            <SubMenu label="処置">
              <Link to="/treatment-worklist" className="row-menu__item">
                処置一覧
              </Link>
            </SubMenu>
            {/* 化学療法室は注射一覧(オーダー軸)と違い、その日の予約(時間割)で回る部門なので
                別の面にする(docs/chemo-regimen-design.md §7.6 E-7)。 */}
            <SubMenu label="外来化学療法室">
              <Link to="/chemo-room-worklist" className="row-menu__item">
                外来化学療法室
              </Link>
            </SubMenu>
          </HoverMenu>
          {/* 予約枠は診療科がオーダーを出す前段(いつ診るかを決める)なので、
              部門業務の次に独立して置く。 */}
          <NavLink to="/schedules">予約枠</NavLink>
          {/* 掲示板は院内のお知らせ。職種を問わず全員が読むので独立して置く(ホームにも出る)。 */}
          <NavLink to="/bulletin">掲示板</NavLink>
          {/* 院外へ提出するデータの作成状況の確認と出力をまとめる(DPC 調査など)。 */}
          <HoverMenu label="データ提出">
            <Link to="/dpc-form1-export" className="row-menu__item">
              DPC様式1
            </Link>
          </HoverMenu>
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
          {/* 部門業務の画面。オーダーを受けた側が、その日の検査を捌くための一覧。 */}
          <Route path="/lab-worklist" element={<LabWorklistPage />} />
          <Route path="/lab-arrivals" element={<LabArrivalPage />} />
          <Route path="/lab-result-imports" element={<LabResultImportPage />} />
          <Route path="/lab-result-imports/:id" element={<LabResultImportDetailPage />} />
          <Route path="/patho-worklist" element={<PathoWorklistPage />} />
          <Route path="/transfusion-worklist" element={<TransfusionWorklistPage />} />
          <Route path="/rehab-worklist" element={<RehabWorklistPage />} />
          <Route path="/radiotherapy-worklist" element={<RadiotherapyWorklistPage />} />
          <Route path="/radiotherapy-protocols" element={<RadiotherapyProtocolPage />} />
          <Route path="/radiotherapy-modalities" element={<RadiotherapyModalityPage />} />
          <Route path="/radiotherapy-techniques" element={<RadiotherapyTechniquePage />} />
          <Route path="/radiotherapy-devices" element={<RadiotherapyDevicePage />} />
          <Route path="/radiotherapy-stop-reasons" element={<RadiotherapyStopReasonPage />} />
          <Route
            path="/nutrition-guidance-worklist"
            element={<NutritionGuidanceWorklistPage />}
          />
          <Route path="/medication-guidance-worklist" element={<MedicationGuidanceWorklistPage />} />
          <Route path="/consult-worklist" element={<ConsultWorklistPage />} />
          <Route path="/notifications" element={<NotificationPage />} />
          <Route path="/countersigns" element={<CountersignListPage />} />
          <Route path="/supervisor-groups" element={<SupervisorGroupPage />} />
          {/* 掲示板(院内のお知らせ)。ホームのカードは今日掲載中だけ、ここは全件。 */}
          <Route path="/bulletin" element={<BulletinPage />} />
          <Route path="/order-sets" element={<OrderSetPage />} />
          <Route path="/nursing-worklist" element={<NursingWorklistPage />} />
          <Route path="/insulin-worklist" element={<InsulinWorklistPage />} />
          <Route path="/inpatients/bulk-vitals" element={<BulkVitalEntryPage />} />
          <Route path="/nursing-summary-approvals" element={<NursingSummaryApprovalPage />} />
          <Route path="/rad-worklist" element={<RadWorklistPage />} />
          <Route path="/rx-worklist" element={<RxWorklistPage />} />
          <Route path="/brought-med-worklist" element={<BroughtMedicationWorklistPage />} />
          <Route path="/injection-worklist" element={<InjectionWorklistPage />} />
          <Route path="/chemo-room-worklist" element={<ChemoRoomWorklistPage />} />
          <Route path="/physio-worklist" element={<PhysioWorklistPage />} />
          <Route path="/endoscopy-worklist" element={<EndoscopyWorklistPage />} />
          <Route path="/treatment-worklist" element={<TreatmentWorklistPage />} />
          <Route path="/surgery-worklist" element={<SurgeryWorklistPage />} />
          <Route path="/surgery-calendar" element={<SurgeryCalendarPage />} />
          <Route path="/surgeries/:orderId/anesthesia-chart" element={<AnesthesiaChartPage />} />
          <Route path="/masters" element={<MasterMenuPage />} />
          <Route path="/master-import" element={<MasterImportPage />} />
          <Route path="/medicine-dose-conversions" element={<MedicineDoseConversionPage />} />
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
            path="/facility-settings"
            element={
              <AdminGate>
                <FacilitySettingsPage />
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
