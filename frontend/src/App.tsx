import { Link, Navigate, Route, Routes } from "react-router-dom";
import "./App.css";
import { AdminGate } from "./components/AdminGate";
import { ConnectionSettingsPage } from "./pages/ConnectionSettingsPage";
import { OauthClientsPage } from "./pages/OauthClientsPage";
import { MasterImportPage } from "./pages/MasterImportPage";
import { PatientCreatePage } from "./pages/PatientCreatePage";
import { PatientEditPage } from "./pages/PatientEditPage";
import { PatientListPage } from "./pages/PatientListPage";
import { LabResultCreatePage } from "./pages/LabResultCreatePage";
import { LabResultDetailPage } from "./pages/LabResultDetailPage";
import { LabResultEditPage } from "./pages/LabResultEditPage";
import { LabResultListPage } from "./pages/LabResultListPage";
import { PrescriptionCreatePage } from "./pages/PrescriptionCreatePage";
import { PrescriptionDetailPage } from "./pages/PrescriptionDetailPage";
import { PrescriptionEditPage } from "./pages/PrescriptionEditPage";
import { PrescriptionListPage } from "./pages/PrescriptionListPage";

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
          <Link to="/oauth-clients">OAuth クライアント</Link>
          <Link to="/settings">接続設定</Link>
        </nav>
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
          <Route path="/patients/:patientId/lab-results/:reportId" element={<LabResultDetailPage />} />
          <Route path="/patients/:patientId/lab-results/:reportId/edit" element={<LabResultEditPage />} />
          <Route path="/master-import" element={<MasterImportPage />} />
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
