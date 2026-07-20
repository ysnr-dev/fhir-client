import { Link, Navigate, Route, Routes } from "react-router-dom";
import "./App.css";
import { MasterImportPage } from "./pages/MasterImportPage";
import { PatientCreatePage } from "./pages/PatientCreatePage";
import { PatientEditPage } from "./pages/PatientEditPage";
import { PatientListPage } from "./pages/PatientListPage";
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
          <Route path="/master-import" element={<MasterImportPage />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
