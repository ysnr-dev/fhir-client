import { Link } from "react-router-dom";
import { useDeleteClinicalNote } from "../api/queries";
import { summarizeClinicalNote } from "../fhir/clinicalNoteHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { RowMenu } from "./RowMenu";

interface ClinicalNoteTableProps {
  notes: fhir4.Composition[];
  patientId: string;
}

export function ClinicalNoteTable({ notes, patientId }: ClinicalNoteTableProps) {
  const deleteNote = useDeleteClinicalNote();

  function handleDelete(noteId: string, title: string) {
    if (!window.confirm(`診療記録「${title}」を削除します。よろしいですか?`)) return;
    deleteNote.mutate(noteId);
  }

  if (notes.length === 0) {
    return <p className="patient-table__empty">登録されている診療記録がありません。</p>;
  }

  return (
    <>
      <ErrorBanner error={deleteNote.error} />
      <table className="patient-table">
        <thead>
          <tr>
            <th>記録日時</th>
            <th>タイトル</th>
            <th>ステータス</th>
            <th>セクション</th>
            <th>作成者</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {notes.map((note) => {
            const summary = summarizeClinicalNote(note);
            return (
              <tr key={summary.id}>
                <td>{summary.dateTime || "-"}</td>
                <td>{summary.title || "-"}</td>
                <td>{summary.statusLabel || "-"}</td>
                <td>{summary.sectionSummary}</td>
                <td>{summary.authorName}</td>
                <td className="patient-table__actions">
                  <Link className="button" to={`/patients/${patientId}/clinical-notes/${summary.id}`}>
                    表示
                  </Link>
                  <RowMenu label={`${summary.title} の操作`}>
                    <Link
                      className="row-menu__item"
                      to={`/patients/${patientId}/clinical-notes/${summary.id}/edit`}
                    >
                      編集
                    </Link>
                    <button
                      type="button"
                      className="row-menu__item row-menu__item--danger"
                      onClick={() => handleDelete(summary.id, summary.title)}
                      disabled={deleteNote.isPending}
                    >
                      削除
                    </button>
                  </RowMenu>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
