import { useDeleteImagingStudy } from "../api/queries";
import { karteDayLabel } from "../fhir/karteTimeline";
import { groupImagingStudiesByDate, type ImagingStudySummary } from "../fhir/imagingHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { RowMenu } from "./RowMenu";

// 取り込んだ DICOM のスタディ一覧。検査日ごとに見出しを挟むので、行には日付の列を持たない。

const COLUMN_COUNT = 7;

export function ImagingStudyTable({
  patientId,
  studies,
  onView,
}: {
  patientId: string;
  studies: ImagingStudySummary[];
  onView: (studyId: string) => void;
}) {
  const deleteStudy = useDeleteImagingStudy(patientId);

  function handleDelete(study: ImagingStudySummary) {
    const label = [study.date, study.modalities.join("/"), study.description].filter(Boolean).join(" ");
    if (!window.confirm(`検査「${label}」の画像 ${study.numberOfInstances} 枚を削除します。よろしいですか?`)) {
      return;
    }
    deleteStudy.mutate(study.studyUid);
  }

  if (studies.length === 0) {
    return <p className="patient-table__empty">取り込んだ画像がありません。</p>;
  }

  return (
    <>
      <ErrorBanner error={deleteStudy.error} />
      <table className="patient-table karte-file-table">
        <thead>
          <tr>
            <th>時刻</th>
            <th>モダリティ</th>
            <th>検査内容</th>
            <th>シリーズ</th>
            <th>枚数</th>
            <th>取込元</th>
            <th></th>
          </tr>
        </thead>
        {groupImagingStudiesByDate(studies).map((group) => (
          <tbody key={group.date || "undated"}>
            <tr className="karte-file-table__day">
              <th colSpan={COLUMN_COUNT} scope="colgroup">
                {karteDayLabel(group.date)}
              </th>
            </tr>
            {group.studies.map((study) => (
              <tr key={study.id}>
                <td>{study.time || "-"}</td>
                <td>{study.modalities.join(" / ") || "-"}</td>
                <td>{study.description || "-"}</td>
                <td>{study.numberOfSeries}</td>
                <td>{study.numberOfInstances}</td>
                <td>{study.institutionName || "-"}</td>
                <td className="patient-table__actions">
                  <button type="button" onClick={() => onView(study.id)}>
                    表示
                  </button>
                  <RowMenu label={`${study.description || study.date} の操作`}>
                    <button
                      type="button"
                      className="row-menu__item row-menu__item--danger"
                      onClick={() => handleDelete(study)}
                      disabled={deleteStudy.isPending}
                    >
                      削除
                    </button>
                  </RowMenu>
                </td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </>
  );
}
