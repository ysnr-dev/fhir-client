import { Link, Navigate, NavLink, Route, Routes, useParams } from "react-router-dom";
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
import { FacilitySettingsPage } from "./pages/FacilitySettingsPage";
import { OauthClientsPage } from "./pages/OauthClientsPage";
import { MasterImportPage } from "./pages/MasterImportPage";
import { LabContainerPage } from "./pages/LabContainerPage";
import { SchemaMasterPage } from "./pages/SchemaMasterPage";
import { LabOrderItemLayoutPage } from "./pages/LabOrderItemLayoutPage";
import { LabOrderItemPage } from "./pages/LabOrderItemPage";
import { LabSpecimenPage } from "./pages/LabSpecimenPage";
import { RadItemLayoutPage } from "./pages/RadItemLayoutPage";
import { RadItemPage } from "./pages/RadItemPage";
import { RadJj1017CodePage } from "./pages/RadJj1017CodePage";
import { RadMaterialPage } from "./pages/RadMaterialPage";
import { RadDatasetPage } from "./pages/RadDatasetPage";
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
import { MealItemPage } from "./pages/MealItemPage";
import { TransfusionProductPage } from "./pages/TransfusionProductPage";
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
import { PathoOrganPage } from "./pages/PathoOrganPage";
import { PathoCollectionMethodPage } from "./pages/PathoCollectionMethodPage";
import { MedicineDoseConversionPage } from "./pages/MedicineDoseConversionPage";
import { PractitionerCreatePage } from "./pages/PractitionerCreatePage";
import { PractitionerEditPage } from "./pages/PractitionerEditPage";
import { PractitionerListPage } from "./pages/PractitionerListPage";
import { PatientCreatePage } from "./pages/PatientCreatePage";
import { PatientEditPage } from "./pages/PatientEditPage";
import { PatientListPage } from "./pages/PatientListPage";
import { KartePage } from "./pages/KartePage";
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
import { LabWorklistPage } from "./pages/LabWorklistPage";
import { RadWorklistPage } from "./pages/RadWorklistPage";
import { RxWorklistPage } from "./pages/RxWorklistPage";
import { ReportLayoutsPage } from "./pages/ReportLayoutsPage";

// 患者配下の未定義パスをその患者のカルテへ寄せる。
function KarteRedirect() {
  const { patientId } = useParams<{ patientId: string }>();
  return <Navigate to={patientId ? `/patients/${patientId}/karte` : "/patients"} replace />;
}

function App() {
  return (
    // アプリ全体をログインゲートで包む(ADMIN_TOKEN 未設定なら素通し)。
    // ログイン中の医療従事者(Practitioner)は useCurrentPractitioner で参照できる。
    <AuthGate>
      <div className="app">
      <header className="app__header">
        <Link to="/patients" className="app__title">
          FHIR Client
        </Link>
        <nav className="app__nav">
          {/* 患者を探す入口。全患者から探すか、その日の外来予約から探すかで分ける。 */}
          <HoverMenu label="患者一覧">
            <Link to="/patients" className="row-menu__item">
              全患者
            </Link>
            {/* 外来患者一覧はその日の予約患者を受付する画面。 */}
            <Link to="/outpatients" className="row-menu__item">
              外来患者一覧
            </Link>
            {/* 入院患者一覧は病棟のベッドの埋まり具合と在院患者を見る画面。 */}
            <Link to="/inpatients" className="row-menu__item">
              入院患者一覧
            </Link>
          </HoverMenu>
          {/* 部門業務は「依頼を受けた側」の画面。診療科がオーダーを出す患者一覧・カルテと、
              マスタメンテの間に置く。放射線以外の部門が増えたらここに並べる。 */}
          <HoverMenu label="部門業務">
            <Link to="/lab-worklist" className="row-menu__item">
              検体検査一覧
            </Link>
            <Link to="/lab-arrivals" className="row-menu__item">
              検体到着確認
            </Link>
            <Link to="/patho-worklist" className="row-menu__item">
              病理検査一覧
            </Link>
            <Link to="/rad-worklist" className="row-menu__item">
              放射線検査一覧
            </Link>
            <Link to="/physio-worklist" className="row-menu__item">
              生理検査一覧
            </Link>
            <Link to="/endoscopy-worklist" className="row-menu__item">
              内視鏡一覧
            </Link>
            <Link to="/treatment-worklist" className="row-menu__item">
              処置一覧
            </Link>
            <Link to="/surgery-worklist" className="row-menu__item">
              手術一覧
            </Link>
            {/* 手術一覧が「その日の手術を 1 件ずつ処理する」画面なのに対し、
                カレンダーは「空いているところを探して日程を組む」画面。 */}
            <Link to="/surgery-calendar" className="row-menu__item">
              手術カレンダー
            </Link>
            {/* 輸血は依頼を受けてから製剤を払い出すまでが部門の仕事で、投与は病棟。
                作りは他の部門一覧と同じなのでここに並べる。 */}
            <Link to="/transfusion-worklist" className="row-menu__item">
              輸血一覧
            </Link>
            <Link to="/rx-worklist" className="row-menu__item">
              処方一覧
            </Link>
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
            <SubMenu label="検体検査">
              <Link to="/lab-order-items" className="row-menu__item">
                検査オーダー項目
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
              <Link to="/surgery-room-blocks" className="row-menu__item">
                手術室 ブロックスケジュール
              </Link>
            </SubMenu>
            {/* 食事。オーダーが食種 1 つを指すだけなので、マスタも項目 1 本だけ
                (食種と主食を kind で分けた 1 テーブル)。 */}
            <SubMenu label="食事">
              <Link to="/meal-items" className="row-menu__item">
                食事オーダー項目
              </Link>
            </SubMenu>
            {/* 輸血。食事と同じく製剤マスタ 1 本だけ(セット・レイアウト・
                データセットは持たない)。 */}
            <SubMenu label="輸血">
              <Link to="/transfusion-products" className="row-menu__item">
                輸血製剤マスタ
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
              自院設定
            </Link>
            <ThemeToggleItem />
          </HoverMenu>
        </nav>
        {/* オーダーはカルテ以外(手術カレンダーなど)からも登録するので、
            依頼科・依頼医師の選択はどの画面でも切り替えられるようにする。 */}
        <OrderContextPicker />
        <CurrentUserBadge />
        <WakeButton />
      </header>
      <main className="app__main">
        <Routes>
          <Route path="/" element={<Navigate to="/patients" replace />} />
          <Route path="/patients" element={<PatientListPage />} />
          <Route path="/patients/new" element={<PatientCreatePage />} />
          <Route path="/patients/:id/edit" element={<PatientEditPage />} />
          {/* 診療記録・処方・病名・アレルギー・検査結果・テンプレート回答は
              患者ごとの一覧ページを持たず、カルテ画面(タブと右ペイン)で扱う。 */}
          <Route path="/patients/:patientId/karte" element={<KartePage />} />
          {/* 廃止した一覧・詳細ページ(/patients/:id/prescriptions など)のブックマークを
              空白画面にせず、その患者のカルテへ寄せる。 */}
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
          <Route path="/patho-worklist" element={<PathoWorklistPage />} />
          <Route path="/transfusion-worklist" element={<TransfusionWorklistPage />} />
          <Route path="/rad-worklist" element={<RadWorklistPage />} />
          <Route path="/rx-worklist" element={<RxWorklistPage />} />
          <Route path="/physio-worklist" element={<PhysioWorklistPage />} />
          <Route path="/endoscopy-worklist" element={<EndoscopyWorklistPage />} />
          <Route path="/treatment-worklist" element={<TreatmentWorklistPage />} />
          <Route path="/surgery-worklist" element={<SurgeryWorklistPage />} />
          <Route path="/surgery-calendar" element={<SurgeryCalendarPage />} />
          <Route path="/surgeries/:orderId/anesthesia-chart" element={<AnesthesiaChartPage />} />
          <Route path="/master-import" element={<MasterImportPage />} />
          <Route path="/medicine-dose-conversions" element={<MedicineDoseConversionPage />} />
          <Route path="/lab-order-items" element={<LabOrderItemPage />} />
          <Route path="/lab-order-item-layouts" element={<LabOrderItemLayoutPage />} />
          <Route path="/lab-specimens" element={<LabSpecimenPage />} />
          <Route path="/lab-containers" element={<LabContainerPage />} />
          <Route path="/schemas" element={<SchemaMasterPage />} />
          <Route path="/rad-items" element={<RadItemPage />} />
          <Route path="/rad-item-layouts" element={<RadItemLayoutPage />} />
          <Route path="/rad-jj1017-codes" element={<RadJj1017CodePage />} />
          <Route path="/rad-materials" element={<RadMaterialPage />} />
          <Route path="/rad-datasets" element={<RadDatasetPage />} />
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
          <Route path="/meal-items" element={<MealItemPage />} />
          <Route path="/transfusion-products" element={<TransfusionProductPage />} />
          <Route path="/surgery-items" element={<SurgeryItemPage />} />
          <Route path="/surgery-room-blocks" element={<SurgeryRoomBlockPage />} />
          <Route path="/micro-order-items" element={<MicroOrderItemPage />} />
          <Route path="/micro-specimen-types" element={<MicroSpecimenTypePage />} />
          <Route path="/micro-organisms" element={<MicroOrganismPage />} />
          <Route path="/micro-antimicrobials" element={<MicroAntimicrobialPage />} />
          <Route path="/micro-susceptibility-methods" element={<MicroSusceptibilityMethodPage />} />
          <Route path="/patho-organs" element={<PathoOrganPage />} />
          <Route path="/patho-collection-methods" element={<PathoCollectionMethodPage />} />
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
