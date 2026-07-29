import { Link, Navigate, Route, Routes } from "react-router-dom";
import "./App.css";
import { AdminGate } from "./components/AdminGate";
import { WakeButton } from "./components/WakeButton";
import { ConnectionSettingsPage } from "./pages/ConnectionSettingsPage";
import { OauthClientsPage } from "./pages/OauthClientsPage";
import { MasterImportPage } from "./pages/MasterImportPage";
import { ConditionCreatePage } from "./pages/ConditionCreatePage";
import { ConditionDetailPage } from "./pages/ConditionDetailPage";
import { ConditionEditPage } from "./pages/ConditionEditPage";
import { ConditionListPage } from "./pages/ConditionListPage";
import { PatientCreatePage } from "./pages/PatientCreatePage";
import { PatientEditPage } from "./pages/PatientEditPage";
import { PatientListPage } from "./pages/PatientListPage";
import { LabResultCreatePage } from "./pages/LabResultCreatePage";
import { LabResultDetailPage } from "./pages/LabResultDetailPage";
import { LabResultEditPage } from "./pages/LabResultEditPage";
import { LabResultListPage } from "./pages/LabResultListPage";
import { LabResultTimelinePage } from "./pages/LabResultTimelinePage";
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

function App() {
  return (
    <div className="app">
      <header className="app__header">
        <Link to="/patients" className="app__title">
          FHIR Client
        </Link>
        <nav className="app__nav">
          <Link to="/patients">患者一覧</Link>
          <Link to="/master-import">マスタ取込</Link>
          <Link to="/questionnaires">テンプレート</Link>
          <Link to="/oauth-clients">OAuth クライアント</Link>
          <Link to="/settings">接続設定</Link>
        </nav>
        <WakeButton />
      </header>
      <main className="app__main">
        <Routes>
          <Route path="/" element={<Navigate to="/patients" replace />} />
          <Route path="/patients" element={<PatientListPage />} />
          <Route path="/patients/new" element={<PatientCreatePage />} />
          <Route path="/patients/:id/edit" element={<PatientEditPage />} />
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
        </Routes>
      </main>
    </div>
  );
}

export default App;
