import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useCurrentPractitioner } from "../api/authQueries";
import { useClinicalNote, useMyCountersignTasks } from "../api/queries";
import { ClinicalNoteDetailPanel } from "../components/ClinicalNoteDetailPanel";
import { ErrorBanner } from "../components/ErrorBanner";
import { Modal } from "../components/Modal";
import { useCompleteNotificationRows } from "../components/notifications/notificationQueries";
import { notificationRows, type NotificationRow } from "../components/notifications/notificationRegistry";
import { PatientKana } from "../components/PatientRowCells";
import { NOTE_COUNTERSIGN_TASK_CODE, type NoteCountersignRow } from "../fhir/countersignHelpers";
import { kindLabel, type OrderApprovalRow } from "../fhir/orderApprovalTaskHelpers";
import { displayName, patientNumberOf } from "../fhir/patientHelpers";
import { orderActivityLabel } from "../fhir/provenanceHelpers";
import { dateTimeSecondsLabel } from "../lib/dates";
import { useReturnLinkState } from "../returnTo";

// カルテ承認(診療業務)。受け持つ研修医・学生の診療記録とオーダーのうち、自分あての
// カウンターサインを未承認・承認済みで並べる(docs/countersign-design.md)。記録は
// この画面のモーダルで内容を確かめて承認・差戻し・コメントし、オーダーはカルテの詳細で承認する。
// 承認待ちの件数は通知(ベル)にも乗る。

type Status = "requested" | "completed";
type Kind = "" | "note" | "order";

export function CountersignListPage() {
  const { practitionerId } = useCurrentPractitioner();
  const [status, setStatus] = useState<Status>("requested");
  const [kind, setKind] = useState<Kind>("");
  const [trainee, setTrainee] = useState("");
  const [opening, setOpening] = useState<NoteCountersignRow | null>(null);
  const list = useMyCountersignTasks(practitionerId, status);
  const complete = useCompleteNotificationRows();
  const linkState = useReturnLinkState();

  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  // 研修医の活動だけを出す(代行入力の承認は通知で扱う)。
  const rows = useMemo(() => {
    const data = list.data;
    if (!data) return [];
    return notificationRows(data.tasks, data.patients).filter((entry) => traineeNameOf(entry) !== "");
  }, [list.data]);
  const traineeNames = useMemo(() => Array.from(new Set(rows.map(traineeNameOf))).sort(), [rows]);
  const visible = rows.filter(
    (entry) =>
      (!kind || kindOf(entry) === kind) && (!trainee || traineeNameOf(entry) === trainee),
  );

  return (
    <div className="page">
      <div className="page__header">
        <h1>カルテ承認</h1>
        <div className="page__header-actions">
          <Link className="button" to="/notifications">
            通知
          </Link>
        </div>
      </div>

      <form className="patient-search-form" onSubmit={(e) => e.preventDefault()}>
        <label>
          状態
          <select value={status} onChange={(e) => setStatus(e.target.value as Status)}>
            <option value="requested">未承認</option>
            <option value="completed">対応済</option>
          </select>
        </label>
        <label>
          種別
          <select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            <option value="">すべて</option>
            <option value="note">記録</option>
            <option value="order">オーダー</option>
          </select>
        </label>
        <label>
          研修医
          <select value={trainee} onChange={(e) => setTrainee(e.target.value)}>
            <option value="">すべて</option>
            {traineeNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </form>

      <ErrorBanner error={list.error ?? complete.error} />

      {!practitionerId ? (
        <p className="patient-table__empty">医療従事者に紐付いたアカウントでログインしてください。</p>
      ) : list.isPending ? (
        <p>読み込み中...</p>
      ) : (
        <div className="lab-worklist-wrap sticky-table-wrap">
          <table className="lab-worklist sticky-table">
            <thead>
              <tr>
                <th className="lab-worklist__compact">日時</th>
                <th className="lab-worklist__compact">種別</th>
                <th className="lab-worklist__compact">患者番号</th>
                <th>患者</th>
                <th>内容</th>
                <th className="lab-worklist__compact">研修医</th>
                {status === "completed" && <th className="lab-worklist__compact">対応</th>}
                <th className="lab-worklist__actions sticky-table__fix-actions"></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((entry) => (
                <CountersignRow
                  key={entry.row.task.id}
                  entry={entry}
                  pending={complete.isPending}
                  status={status}
                  linkState={linkState}
                  onOpen={() => setOpening(entry.row as NoteCountersignRow)}
                  onApprove={() => complete.mutate([entry])}
                />
              ))}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={status === "completed" ? 8 : 7} className="master-search__empty">
                    {status === "requested" ? "承認待ちはありません。" : "対応済みはありません。"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {opening && (
        <Modal title={opening.noteLabel || "診療記録"} onClose={() => setOpening(null)} className="modal--wide">
          <NoteDetail compositionId={opening.compositionId} />
        </Modal>
      )}
    </div>
  );
}

function kindOf(entry: NotificationRow): Kind {
  return entry.kind.code === NOTE_COUNTERSIGN_TASK_CODE.code ? "note" : "order";
}

function traineeNameOf(entry: NotificationRow): string {
  return kindOf(entry) === "note"
    ? (entry.row as NoteCountersignRow).traineeName
    : (entry.row as OrderApprovalRow).traineeName;
}

function contentOf(entry: NotificationRow): string {
  if (kindOf(entry) === "note") return (entry.row as NoteCountersignRow).noteLabel;
  const row = entry.row as OrderApprovalRow;
  return `${row.kinds.map(kindLabel).join(" / ")}の${orderActivityLabel(row.activity)}${row.dayLabel ? `（${row.dayLabel}）` : ""}`;
}

/** 対応済みにしたときの記録(コメントではない最後の note)。「記録を承認しました。」など。 */
function completionOf(task: fhir4.Task): string {
  const notes = (task.note ?? []).filter((note) => !note.extension?.length);
  const last = notes[notes.length - 1];
  if (!last) return "";
  return `${last.text}${last.authorReference?.display ? `（${last.authorReference.display}）` : ""}`;
}

function CountersignRow({
  entry,
  pending,
  status,
  linkState,
  onOpen,
  onApprove,
}: {
  entry: NotificationRow;
  pending: boolean;
  status: Status;
  linkState: ReturnType<typeof useReturnLinkState>;
  onOpen: () => void;
  onApprove: () => void;
}) {
  const { kind, row } = entry;
  const karteLink = kind.karteLink(row);
  const isNote = kindOf(entry) === "note";
  return (
    <tr>
      <td className="lab-worklist__compact">{dateTimeSecondsLabel(row.authoredOn)}</td>
      <td className="lab-worklist__compact">{isNote ? "記録" : "オーダー"}</td>
      <td className="lab-worklist__compact">{row.patient ? patientNumberOf(row.patient) : ""}</td>
      <td>
        {row.patient ? (
          <>
            {displayName(row.patient)}
            <PatientKana patient={row.patient} />
          </>
        ) : (
          row.patientId
        )}
      </td>
      <td>{contentOf(entry)}</td>
      <td className="lab-worklist__compact">{traineeNameOf(entry)}</td>
      {/* 対応済みは承認と差戻しの両方を含むので、どちらだったかを対応の記録(note)から出す。 */}
      {status === "completed" && (
        <td className="lab-worklist__compact">{completionOf(row.task)}</td>
      )}
      <td className="lab-worklist__actions sticky-table__fix-actions">
        {isNote && (
          <button type="button" onClick={onOpen}>
            開く
          </button>
        )}
        {karteLink && (
          <Link className="button" to={karteLink} state={linkState}>
            カルテ
          </Link>
        )}
        {status === "requested" && !isNote && (
          <button type="button" disabled={pending} onClick={onApprove}>
            承認
          </button>
        )}
      </td>
    </tr>
  );
}

/** 記録の内容(承認・差戻し・コメントは詳細の中のカウンターサイン欄)。 */
function NoteDetail({ compositionId }: { compositionId: string }) {
  const { data: result, isLoading, error } = useClinicalNote(compositionId);
  return (
    <>
      <ErrorBanner error={error} />
      {isLoading ? (
        <p>読み込み中...</p>
      ) : result?.data ? (
        <ClinicalNoteDetailPanel note={result.data} />
      ) : (
        !error && <p className="patient-table__empty">この診療記録は見つかりません。</p>
      )}
    </>
  );
}
