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
import { ExternalCodeMappingPage } from "./pages/ExternalCodeMappingPage";
import { ExternalSystemListPage } from "./pages/ExternalSystemListPage";
import { ExternalSystemSettingsPage } from "./pages/ExternalSystemSettingsPage";
import { FacilitySettingsPage } from "./pages/FacilitySettingsPage";
import { OauthClientsPage } from "./pages/OauthClientsPage";
import { MasterImportPage } from "./pages/MasterImportPage";
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
import { ConsultWorklistPage } from "./pages/ConsultWorklistPage";
import { NotificationPage } from "./pages/NotificationPage";
import { OrderSetPage } from "./pages/OrderSetPage";
import { NotificationBell } from "./components/NotificationBell";
import { NursingWorklistPage } from "./pages/NursingWorklistPage";
import { PathoOrganPage } from "./pages/PathoOrganPage";
import { PathoCollectionMethodPage } from "./pages/PathoCollectionMethodPage";
import { PatientCautionPage } from "./pages/PatientCautionPage";
import { ClinicalNoteTitlePage } from "./pages/ClinicalNoteTitlePage";
import { MedicineDoseConversionPage } from "./pages/MedicineDoseConversionPage";
import { PractitionerCreatePage } from "./pages/PractitionerCreatePage";
import { PractitionerEditPage } from "./pages/PractitionerEditPage";
import { PractitionerListPage } from "./pages/PractitionerListPage";
import { PatientCreatePage } from "./pages/PatientCreatePage";
import { PatientEditPage } from "./pages/PatientEditPage";
import { PatientListPage } from "./pages/PatientListPage";
import { KartePage } from "./pages/KartePage";
import { KartePanePage } from "./pages/KartePanePage";
import { KARTE_PANE_PATH, useKartePaneHost } from "./kartePaneChannel";
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
import { LabArrivalPage } from "./pages/LabArrivalPage";
import { LabResultImportPage } from "./pages/LabResultImportPage";
import { LabResultImportDetailPage } from "./pages/LabResultImportDetailPage";
import { LabWorklistPage } from "./pages/LabWorklistPage";
import { RadWorklistPage } from "./pages/RadWorklistPage";
import { RxWorklistPage } from "./pages/RxWorklistPage";
import { BroughtMedicationWorklistPage } from "./pages/BroughtMedicationWorklistPage";
import { InjectionWorklistPage } from "./pages/InjectionWorklistPage";
import { ReportLayoutsPage } from "./pages/ReportLayoutsPage";

// 患者配下の未定義パスをその患者のカルテへ寄せる。
function KarteRedirect() {
  const { patientId } = useParams<{ patientId: string }>();
  return <Navigate to={patientId ? `/patients/${patientId}/karte` : "/patients"} replace />;
}

function App() {
  // カルテの左ペインを出す別タブ。サブモニターに置いて参照するだけの画面なので、
  // アプリのヘッダー(ナビ)を出さず縦幅をカルテに回す。
  const detachedPane = useLocation().pathname.startsWith(KARTE_PANE_PATH);
  // メインタブは、別タブから見た「生きているか」「いま誰のカルテか」の応答口になる。
  useKartePaneHost(!detachedPane);

  return (
    // アプリ全体をログインゲートで包む(ADMIN_TOKEN 未設定なら素通し)。
    // ログイン中の医療従事者(Practitioner)は useCurrentPractitioner で参照できる。
    <AuthGate>
      <div className={`app${detachedPane ? " app--pane" : ""}`}>
      {!detachedPane && (
      <header className="app__header">
        <Link to="/patients" className="app__title">
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
            {/* よく出すオーダーのひとまとめ(オーダーセット)の登録。出すのは診療科の
                医師なので部門業務ではなくここに置く(docs/order-set-design.md §1)。 */}
            <Link to="/order-sets" className="row-menu__item">
              セット登録
            </Link>
          </HoverMenu>
          {/* 部門業務は「依頼を受けた側」の画面。診療科がオーダーを出す患者一覧・カルテと、
              マスタメンテの間に置く。項目が増えたのでマスタメンテと同じく部門ごとに
              入れ子にする(1 項目だけの部門も並びを揃えるためサブメニューにする)。 */}
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
              部門業務とマスタメンテの間に独立して置く。 */}
          <NavLink to="/schedules">予約枠</NavLink>
          {/* マスタメンテは項目が増えるため、診療領域ごとに入れ子にする。
              どの領域にも属さないものは「共通」にまとめる。
              マスタ取込は領域をまたぐので直下に置く。 */}
          <HoverMenu label="マスタメンテ">
            <Link to="/master-import" className="row-menu__item">
              マスタ取込
            </Link>
            {/* 自院のマスタ。診療科・診察室・スタッフは自院のものしか登録しない
                (他院は下の「連携先」)。 */}
            <SubMenu label="共通">
              <Link to="/organizations" className="row-menu__item">
                医療機関
              </Link>
              <Link to="/departments" className="row-menu__item">
                診療科
              </Link>
              <Link to="/practitioners" className="row-menu__item">
                医療従事者
              </Link>
              <Link to="/locations" className="row-menu__item">
                診察室・撮影室
              </Link>
              <Link to="/wards" className="row-menu__item">
                病棟・病室
              </Link>
              <Link to="/patient-cautions" className="row-menu__item">
                注意区分
              </Link>
              <Link to="/clinical-note-titles" className="row-menu__item">
                診療記録タイトル
              </Link>
            </SubMenu>
            {/* 他院。診療情報提供書の送付先候補として登録する。 */}
            <SubMenu label="連携先">
              <Link to="/partner-organizations" className="row-menu__item">
                連携先医療機関
              </Link>
              <Link to="/partner-practitioners" className="row-menu__item">
                連携先医師
              </Link>
            </SubMenu>
            <SubMenu label="テンプレート">
              <Link to="/questionnaires" className="row-menu__item">
                テンプレート
              </Link>
              <Link to="/report-layouts" className="row-menu__item">
                帳票レイアウト
              </Link>
              <Link to="/schemas" className="row-menu__item">
                シェーマ
              </Link>
            </SubMenu>
            <SubMenu label="医薬品">
              <Link to="/medicine-dose-conversions" className="row-menu__item">
                投与量換算
              </Link>
            </SubMenu>
            {/* 化学療法のマスタ。レジメンは審査委員会で承認する施設共通の参照表なので
                マスタメンテに置く(docs/chemo-regimen-design.md)。 */}
            <SubMenu label="化学療法">
              <Link to="/regimens" className="row-menu__item">
                レジメン
              </Link>
            </SubMenu>
            {/* クリニカルパス(施設パス)の定義。承認制の施設共通マスタ(docs/clinical-pathway-design.md)。 */}
            <SubMenu label="クリニカルパス">
              <Link to="/pathways" className="row-menu__item">
                パス定義
              </Link>
            </SubMenu>
            <SubMenu label="検体検査">
              <Link to="/lab-order-items" className="row-menu__item">
                検査オーダー項目
              </Link>
              <Link to="/lab-result-items" className="row-menu__item">
                検査結果項目
              </Link>
              <Link to="/lab-order-item-layouts" className="row-menu__item">
                検査オーダーレイアウト
              </Link>
              <Link to="/lab-specimens" className="row-menu__item">
                検体
              </Link>
              <Link to="/lab-containers" className="row-menu__item">
                採取管
              </Link>
            </SubMenu>
            {/* 細菌検査は検体を扱う点で検体検査に近いので、その下に並べる。 */}
            <SubMenu label="細菌検査">
              <Link to="/micro-order-items" className="row-menu__item">
                検査項目・採取部位
              </Link>
              <Link to="/micro-specimen-types" className="row-menu__item">
                JANIS材料コード
              </Link>
              <Link to="/micro-organisms" className="row-menu__item">
                JANIS病原体コード
              </Link>
              <Link to="/micro-antimicrobials" className="row-menu__item">
                JANIS抗菌薬コード
              </Link>
              <Link to="/micro-susceptibility-methods" className="row-menu__item">
                JANIS感受性測定法コード
              </Link>
            </SubMenu>
            <SubMenu label="病理検査">
              <Link to="/patho-organs" className="row-menu__item">
                臓器・検査材料
              </Link>
              <Link to="/patho-collection-methods" className="row-menu__item">
                採取法
              </Link>
            </SubMenu>
            <SubMenu label="放射線検査">
              <Link to="/rad-items" className="row-menu__item">
                放射線オーダー項目
              </Link>
              <Link to="/rad-item-layouts" className="row-menu__item">
                放射線オーダーレイアウト
              </Link>
              <Link to="/rad-jj1017-codes" className="row-menu__item">
                JJ1017コード
              </Link>
              {/* 実施入力で使う器材。実際の製品を登録し、算定用の特定器材コードを紐付ける。 */}
              <Link to="/rad-materials" className="row-menu__item">
                放射線器材
              </Link>
              {/* 実施入力の初期明細。撮影項目に紐付けて使う。 */}
              <Link to="/rad-datasets" className="row-menu__item">
                実施入力データセット
              </Link>
            </SubMenu>
            {/* 生理検査。JJ1017 に収載されていないので部品コード・頻用コードは無く、
                モダリティの代わりに施設が定義する「検査種別」を持つ。 */}
            <SubMenu label="生理検査">
              <Link to="/physio-items" className="row-menu__item">
                生理検査オーダー項目
              </Link>
              <Link to="/physio-item-layouts" className="row-menu__item">
                生理検査オーダーレイアウト
              </Link>
              {/* 心電図・超音波検査などの検査分野。放射線のモダリティに当たる。 */}
              <Link to="/physio-exam-types" className="row-menu__item">
                検査種別
              </Link>
              {/* 実施入力の初期明細。検査項目に紐付けて使う。 */}
              <Link to="/physio-datasets" className="row-menu__item">
                実施入力データセット
              </Link>
            </SubMenu>
            {/* 内視鏡。生理検査と同じ構成。 */}
            <SubMenu label="内視鏡">
              <Link to="/endoscopy-items" className="row-menu__item">
                内視鏡オーダー項目
              </Link>
              <Link to="/endoscopy-item-layouts" className="row-menu__item">
                内視鏡オーダーレイアウト
              </Link>
              {/* 上部・下部などの検査分野。JED の4区分との対応を持てる。 */}
              <Link to="/endoscopy-exam-types" className="row-menu__item">
                検査種別
              </Link>
              {/* 実施入力の初期明細。検査項目に紐付けて使う。 */}
              <Link to="/endoscopy-datasets" className="row-menu__item">
                実施入力データセット
              </Link>
            </SubMenu>
            {/* 処置。生理検査と同じ構成だが、検査種別に当たる分類軸は持たない。 */}
            <SubMenu label="処置">
              <Link to="/treatment-items" className="row-menu__item">
                処置オーダー項目
              </Link>
              <Link to="/treatment-item-layouts" className="row-menu__item">
                処置オーダーレイアウト
              </Link>
              {/* 実施入力の初期明細。処置項目に紐付けて使う。 */}
              <Link to="/treatment-datasets" className="row-menu__item">
                実施入力データセット
              </Link>
            </SubMenu>
            {/* 手術。術式は検索で選ぶだけなのでレイアウト・データセットのマスタは無い。 */}
            <SubMenu label="手術">
              <Link to="/surgery-items" className="row-menu__item">
                術式マスタ
              </Link>
              {/* 術式の分類。点数表 第10部の「款 → 区分」に合わせて入れ子にできる。 */}
              <Link to="/surgery-categories" className="row-menu__item">
                術式種別
              </Link>
              <Link to="/surgery-room-blocks" className="row-menu__item">
                手術室 ブロックスケジュール
              </Link>
            </SubMenu>
            {/* 食事。食種(種別・食止め・主成分量を持つ)と、主食・副食形態のリスト。
                セット・レイアウト・データセットは持たない。 */}
            <SubMenu label="食事">
              <Link to="/meal-diets" className="row-menu__item">
                食種
              </Link>
              <Link to="/meal-items" className="row-menu__item">
                主食・副食形態
              </Link>
              {/* 食種の分類(一般食・特別食 など)。主食には付けない。 */}
              <Link to="/meal-categories" className="row-menu__item">
                食種種別
              </Link>
            </SubMenu>
            {/* 輸血。食事と同じく製剤マスタ 1 本だけ(セット・レイアウト・
                データセットは持たない)。 */}
            <SubMenu label="輸血">
              <Link to="/transfusion-products" className="row-menu__item">
                輸血製剤マスタ
              </Link>
            </SubMenu>
            {/* 放射線治療。装置・技法・定型の線量分割は施設ごとに違うので、選択肢をマスタで持つ。 */}
            <SubMenu label="放射線治療">
              <Link to="/radiotherapy-protocols" className="row-menu__item">
                治療プロトコルマスタ
              </Link>
              <Link to="/radiotherapy-modalities" className="row-menu__item">
                照射モダリティマスタ
              </Link>
              <Link to="/radiotherapy-techniques" className="row-menu__item">
                照射技法マスタ
              </Link>
              <Link to="/radiotherapy-devices" className="row-menu__item">
                治療装置マスタ
              </Link>
              <Link to="/radiotherapy-stop-reasons" className="row-menu__item">
                休止・中止理由マスタ
              </Link>
            </SubMenu>
            {/* 看護。MEDIS 看護実践用語標準マスターの閲覧(取込で洗い替える読み取り専用)。 */}
            <SubMenu label="看護">
              <Link to="/nursing-acts" className="row-menu__item">
                看護行為マスタ
              </Link>
              <Link to="/nursing-observations" className="row-menu__item">
                看護観察マスタ
              </Link>
            </SubMenu>
          </HoverMenu>
          <HoverMenu label="管理">
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
          <Route path="/" element={<Navigate to="/patients" replace />} />
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
          {/* 入院患者一覧。病棟のベッド(Location)に入院(Encounter)を突き合わせて出す。 */}
          <Route path="/inpatients" element={<InpatientListPage />} />
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
          <Route path="/consult-worklist" element={<ConsultWorklistPage />} />
          <Route path="/notifications" element={<NotificationPage />} />
          <Route path="/order-sets" element={<OrderSetPage />} />
          <Route path="/nursing-worklist" element={<NursingWorklistPage />} />
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
          <Route path="/master-import" element={<MasterImportPage />} />
          <Route path="/medicine-dose-conversions" element={<MedicineDoseConversionPage />} />
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
        </Routes>
      </main>
      </div>
    </AuthGate>
  );
}

export default App;
