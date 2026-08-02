import { Link, Navigate, NavLink, Route, Routes } from "react-router-dom";
import "./App.css";
import { AdminGate } from "./components/AdminGate";
import { AuthGate } from "./components/AuthGate";
import { CurrentUserBadge } from "./components/CurrentUserBadge";
import { HoverMenu } from "./components/HoverMenu";
import { WakeButton } from "./components/WakeButton";
import { ConnectionSettingsPage } from "./pages/ConnectionSettingsPage";
import { OauthClientsPage } from "./pages/OauthClientsPage";
import { MasterImportPage } from "./pages/MasterImportPage";
import { AllergyCreatePage } from "./pages/AllergyCreatePage";
import { AllergyDetailPage } from "./pages/AllergyDetailPage";
import { AllergyEditPage } from "./pages/AllergyEditPage";
import { AllergyListPage } from "./pages/AllergyListPage";
import { ClinicalNoteCreatePage } from "./pages/ClinicalNoteCreatePage";
import { ClinicalNoteDetailPage } from "./pages/ClinicalNoteDetailPage";
import { ClinicalNoteEditPage } from "./pages/ClinicalNoteEditPage";
import { ClinicalNoteListPage } from "./pages/ClinicalNoteListPage";
import { ConditionCreatePage } from "./pages/ConditionCreatePage";
import { ConditionDetailPage } from "./pages/ConditionDetailPage";
import { ConditionEditPage } from "./pages/ConditionEditPage";
import { ConditionListPage } from "./pages/ConditionListPage";
import { PractitionerCreatePage } from "./pages/PractitionerCreatePage";
import { PractitionerEditPage } from "./pages/PractitionerEditPage";
import { PractitionerListPage } from "./pages/PractitionerListPage";
import { PatientCreatePage } from "./pages/PatientCreatePage";
import { PatientEditPage } from "./pages/PatientEditPage";
import { PatientListPage } from "./pages/PatientListPage";
import { KartePage } from "./pages/KartePage";
import { LabResultCreatePage } from "./pages/LabResultCreatePage";
import { LabResultDetailPage } from "./pages/LabResultDetailPage";
import { LabResultEditPage } from "./pages/LabResultEditPage";
import { LabResultListPage } from "./pages/LabResultListPage";
import { LabResultTimelinePage } from "./pages/LabResultTimelinePage";
import { OrganizationCreatePage } from "./pages/OrganizationCreatePage";
import { OrganizationEditPage } from "./pages/OrganizationEditPage";
import { OrganizationListPage } from "./pages/OrganizationListPage";
import { PrescriptionCreatePage } from "./pages/PrescriptionCreatePage";
import { PrescriptionDetailPage } from "./pages/PrescriptionDetailPage";
import { PrescriptionEditPage } from "./pages/PrescriptionEditPage";
import { PrescriptionListPage } from "./pages/PrescriptionListPage";
import { QuestionnaireCreatePage } from "./pages/QuestionnaireCreatePage";
import { QuestionnaireEditPage } from "./pages/QuestionnaireEditPage";
import { QuestionnaireListPage } from "./pages/QuestionnaireListPage";
import { QuestionnairePreviewPage } from "./pages/QuestionnairePreviewPage";
import { QuestionnaireResponseCreatePage } from "./pages/QuestionnaireResponseCreatePage";
import { QuestionnaireResponseDetailPage } from "./pages/QuestionnaireResponseDetailPage";
import { QuestionnaireResponseEditPage } from "./pages/QuestionnaireResponseEditPage";
import { QuestionnaireResponseListPage } from "./pages/QuestionnaireResponseListPage";
import { ReportLayoutsPage } from "./pages/ReportLayoutsPage";

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
          <NavLink to="/patients">患者一覧</NavLink>
          <NavLink to="/questionnaires">テンプレート</NavLink>
          <NavLink to="/report-layouts">帳票レイアウト</NavLink>
          <HoverMenu label="管理">
            <Link to="/organizations" className="row-menu__item">
              医療機関
            </Link>
            <Link to="/practitioners" className="row-menu__item">
              医療従事者
            </Link>
            <Link to="/master-import" className="row-menu__item">
              マスタ取込
            </Link>
            <Link to="/oauth-clients" className="row-menu__item">
              OAuth クライアント
            </Link>
            <Link to="/settings" className="row-menu__item">
              接続設定
            </Link>
          </HoverMenu>
        </nav>
        <CurrentUserBadge />
        <WakeButton />
      </header>
      <main className="app__main">
        <Routes>
          <Route path="/" element={<Navigate to="/patients" replace />} />
          <Route path="/patients" element={<PatientListPage />} />
          <Route path="/patients/new" element={<PatientCreatePage />} />
          <Route path="/patients/:id/edit" element={<PatientEditPage />} />
          <Route path="/patients/:patientId/karte" element={<KartePage />} />
          <Route path="/patients/:patientId/prescriptions" element={<PrescriptionListPage />} />
          <Route path="/patients/:patientId/prescriptions/new" element={<PrescriptionCreatePage />} />
          <Route path="/patients/:patientId/prescriptions/:srId" element={<PrescriptionDetailPage />} />
          <Route path="/patients/:patientId/prescriptions/:srId/edit" element={<PrescriptionEditPage />} />
          <Route path="/patients/:patientId/lab-results" element={<LabResultListPage />} />
          <Route path="/patients/:patientId/lab-results/new" element={<LabResultCreatePage />} />
          {/* 固定パスは :reportId より先にマッチさせる。 */}
          <Route path="/patients/:patientId/lab-results/timeline" element={<LabResultTimelinePage />} />
          <Route path="/patients/:patientId/lab-results/:reportId" element={<LabResultDetailPage />} />
          <Route path="/patients/:patientId/lab-results/:reportId/edit" element={<LabResultEditPage />} />
          <Route
            path="/patients/:patientId/questionnaire-responses"
            element={<QuestionnaireResponseListPage />}
          />
          <Route
            path="/patients/:patientId/questionnaire-responses/new"
            element={<QuestionnaireResponseCreatePage />}
          />
          <Route
            path="/patients/:patientId/questionnaire-responses/:qrId"
            element={<QuestionnaireResponseDetailPage />}
          />
          <Route
            path="/patients/:patientId/questionnaire-responses/:qrId/edit"
            element={<QuestionnaireResponseEditPage />}
          />
          <Route path="/patients/:patientId/conditions" element={<ConditionListPage />} />
          <Route path="/patients/:patientId/conditions/new" element={<ConditionCreatePage />} />
          <Route path="/patients/:patientId/conditions/:conditionId" element={<ConditionDetailPage />} />
          <Route path="/patients/:patientId/conditions/:conditionId/edit" element={<ConditionEditPage />} />
          <Route path="/patients/:patientId/clinical-notes" element={<ClinicalNoteListPage />} />
          <Route path="/patients/:patientId/clinical-notes/new" element={<ClinicalNoteCreatePage />} />
          <Route path="/patients/:patientId/clinical-notes/:noteId" element={<ClinicalNoteDetailPage />} />
          <Route path="/patients/:patientId/clinical-notes/:noteId/edit" element={<ClinicalNoteEditPage />} />
          <Route path="/patients/:patientId/allergies" element={<AllergyListPage />} />
          <Route path="/patients/:patientId/allergies/new" element={<AllergyCreatePage />} />
          <Route path="/patients/:patientId/allergies/:allergyId" element={<AllergyDetailPage />} />
          <Route path="/patients/:patientId/allergies/:allergyId/edit" element={<AllergyEditPage />} />
          {/* 医療機関・医療従事者は上流 FHIR サーバーの Organization / Practitioner を
              直接操作するため、backend 管理API(AdminGate)の対象外。 */}
          <Route path="/organizations" element={<OrganizationListPage />} />
          <Route path="/organizations/new" element={<OrganizationCreatePage />} />
          <Route path="/organizations/:id/edit" element={<OrganizationEditPage />} />
          <Route path="/practitioners" element={<PractitionerListPage />} />
          <Route path="/practitioners/new" element={<PractitionerCreatePage />} />
          <Route path="/practitioners/:id/edit" element={<PractitionerEditPage />} />
          <Route path="/master-import" element={<MasterImportPage />} />
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
