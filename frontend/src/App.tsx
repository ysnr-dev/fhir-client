import { Link, Navigate, NavLink, Route, Routes, useMatch, useParams } from "react-router-dom";
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
import { MicroOrderItemPage } from "./pages/MicroOrderItemPage";
import { MicroOrganismPage } from "./pages/MicroOrganismPage";
import { MicroAntimicrobialPage } from "./pages/MicroAntimicrobialPage";
import { MicroSusceptibilityMethodPage } from "./pages/MicroSusceptibilityMethodPage";
import { MicroSpecimenTypePage } from "./pages/MicroSpecimenTypePage";
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
import { QuestionnaireCreatePage } from "./pages/QuestionnaireCreatePage";
import { QuestionnaireEditPage } from "./pages/QuestionnaireEditPage";
import { QuestionnaireListPage } from "./pages/QuestionnaireListPage";
import { QuestionnairePreviewPage } from "./pages/QuestionnairePreviewPage";
import { RadWorklistPage } from "./pages/RadWorklistPage";
import { ReportLayoutsPage } from "./pages/ReportLayoutsPage";

// 患者配下の未定義パスをその患者のカルテへ寄せる。
function KarteRedirect() {
  const { patientId } = useParams<{ patientId: string }>();
  return <Navigate to={patientId ? `/patients/${patientId}/karte` : "/patients"} replace />;
}

function App() {
  // 依頼科・依頼医師はオーダーを登録するカルテ画面でだけ切り替えられればよいので、
  // ヘッダーには同画面を開いている間だけ出す。
  const onKarte = useMatch("/patients/:patientId/karte");

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
          <NavLink to="/patients">患者一覧</NavLink>
          {/* 部門業務は「依頼を受けた側」の画面。診療科がオーダーを出す患者一覧・カルテと、
              マスタメンテの間に置く。放射線以外の部門が増えたらここに並べる。 */}
          <HoverMenu label="部門業務">
            <Link to="/rad-worklist" className="row-menu__item">
              放射線検査一覧
            </Link>
          </HoverMenu>
          {/* マスタメンテは項目が増えるため、診療領域ごとに入れ子にする。
              どの領域にも属さないものは「共通」にまとめる。
              マスタ取込は領域をまたぐので直下に置く。 */}
          <HoverMenu label="マスタメンテ">
            <Link to="/master-import" className="row-menu__item">
              マスタ取込
            </Link>
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
            </SubMenu>
          </HoverMenu>
          <HoverMenu label="管理">
            <Link to="/oauth-clients" className="row-menu__item">
              OAuth クライアント
            </Link>
            <Link to="/settings" className="row-menu__item">
              接続設定
            </Link>
            <ThemeToggleItem />
          </HoverMenu>
        </nav>
        {onKarte && <OrderContextPicker />}
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
          {/* 診療科も Organization だが、所属医療機関(partOf)を持つ点で施設と切り分ける。 */}
          <Route path="/departments" element={<DepartmentListPage />} />
          <Route path="/departments/new" element={<DepartmentCreatePage />} />
          <Route path="/departments/:id/edit" element={<DepartmentEditPage />} />
          <Route path="/practitioners" element={<PractitionerListPage />} />
          <Route path="/practitioners/new" element={<PractitionerCreatePage />} />
          <Route path="/practitioners/:id/edit" element={<PractitionerEditPage />} />
          {/* 部門業務の画面。オーダーを受けた側が、その日の検査を捌くための一覧。 */}
          <Route path="/rad-worklist" element={<RadWorklistPage />} />
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
          <Route path="/micro-order-items" element={<MicroOrderItemPage />} />
          <Route path="/micro-specimen-types" element={<MicroSpecimenTypePage />} />
          <Route path="/micro-organisms" element={<MicroOrganismPage />} />
          <Route path="/micro-antimicrobials" element={<MicroAntimicrobialPage />} />
          <Route path="/micro-susceptibility-methods" element={<MicroSusceptibilityMethodPage />} />
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
