import { Link, useParams } from "react-router-dom";
import { LabResultTimelinePanel } from "../components/LabResultTimelinePanel";
import { PatientHeader } from "../components/PatientHeader";

export function LabResultTimelinePage() {
  const { patientId } = useParams<{ patientId: string }>();

  if (!patientId) return null;

  return (
    <div className="page">
      <div className="page__header">
        <h1>検査結果 時系列表示</h1>
        <div>
          <Link to={`/patients/${patientId}/lab-results`} className="button">
            ← 検査結果一覧に戻る
          </Link>
        </div>
      </div>

      <PatientHeader patientId={patientId} />

      <LabResultTimelinePanel patientId={patientId} />
    </div>
  );
}
