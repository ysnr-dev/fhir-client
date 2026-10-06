import { useState } from "react";
import { useCountersignContext, useNoteTasks, useReviewNote, useSaveNoteTask } from "../api/queries";
import {
  COUNTERSIGN_STATE_LABELS,
  NOTE_COUNTERSIGN_NOTE,
  NOTE_COUNTERSIGN_TASK_CODE,
  NOTE_RETURN_NOTE,
  NOTE_RETURNED_TASK_CODE,
  buildCommentedTask,
  buildCountersignedNote,
  buildEditedCommentTask,
  buildNoteReturnedEntry,
  buildReturnedNote,
  canCountersignNote,
  closeNoteCountersignEntries,
  countersignApprover,
  countersignStateOf,
  noteAuthorId,
  noteCommentsOf,
  noteReturnReason,
  type NoteComment,
} from "../fhir/countersignHelpers";
import { hasTaskCode } from "../fhir/notificationHelpers";
import { dateTimeLabel } from "../lib/dates";
import { ErrorBanner } from "./ErrorBanner";
import { TrashIcon } from "./icons/TrashIcon";
import { Modal } from "./Modal";

// 研修医の診療記録のカウンターサイン(docs/countersign-design.md)。記録の詳細に置き、
// 状態・承認者・差戻し理由・指導医のコメント歴を出す。受け持つ指導医には承認・差戻し・コメントの操作。

export function NoteCountersignPanel({ note }: { note: fhir4.Composition }) {
  const patientId = note.subject?.reference?.split("/").pop() ?? "";
  const tasks = useNoteTasks(note.id);
  const { enterer, practitionerId, trainees } = useCountersignContext();
  const review = useReviewNote();
  const saveTask = useSaveNoteTask();
  const [returning, setReturning] = useState(false);
  const [comment, setComment] = useState("");
  const [editing, setEditing] = useState<NoteComment | null>(null);

  const allTasks = tasks.data ?? [];
  const returned = allTasks.find((t) => t.status === "requested" && hasTaskCode(t, NOTE_RETURNED_TASK_CODE.code));
  const state = countersignStateOf(note, Boolean(returned));
  const approver = countersignApprover(note);
  const comments = noteCommentsOf(allTasks);
  const authorId = noteAuthorId(note);
  const supervising = Boolean(practitionerId) && practitionerId !== authorId && trainees.has(authorId);
  const canReview = canCountersignNote(note, practitionerId, trainees);
  // コメントは自分あての承認待ちの Task に積む。閉じていれば最後に自分あてだったものに積む。
  const mine = allTasks.filter(
    (t) => hasTaskCode(t, NOTE_COUNTERSIGN_TASK_CODE.code) && t.owner?.reference === `Practitioner/${practitionerId}`,
  );
  const commentTask = mine.find((t) => t.status === "requested") ?? mine[mine.length - 1];

  function approve() {
    if (!enterer) return;
    review.mutate({
      original: note,
      next: buildCountersignedNote(note, enterer),
      extraEntries: closeNoteCountersignEntries(allTasks, enterer, NOTE_COUNTERSIGN_NOTE),
    });
  }

  function sendBack(reason: string) {
    if (!enterer) return;
    review.mutate(
      {
        original: note,
        next: buildReturnedNote(note),
        extraEntries: [
          ...closeNoteCountersignEntries(allTasks, enterer, NOTE_RETURN_NOTE),
          buildNoteReturnedEntry({ composition: note, patientId, reason, approver: enterer }),
        ],
      },
      { onSuccess: () => setReturning(false) },
    );
  }

  function addComment() {
    if (!enterer || !commentTask || !comment.trim()) return;
    saveTask.mutate(buildCommentedTask(commentTask, enterer, comment.trim()), { onSuccess: () => setComment("") });
  }

  function saveEdit(text: string | null) {
    if (!editing) return;
    const task = allTasks.find((t) => t.id === editing.taskId);
    if (!task) return;
    saveTask.mutate(buildEditedCommentTask(task, editing.index, text), { onSuccess: () => setEditing(null) });
  }

  return (
    <fieldset>
      <legend>カウンターサイン</legend>
      <ErrorBanner error={tasks.error ?? review.error ?? saveTask.error} />
      <dl className="prescription-detail__common">
        <dt>状態</dt>
        <dd>
          <span className={`countersign__state countersign__state--${state}`}>{COUNTERSIGN_STATE_LABELS[state]}</span>
          {canReview && (
            <span className="countersign__actions">
              <button type="button" className="rp-card__compact-button" disabled={review.isPending} onClick={approve}>
                承認
              </button>
              <button
                type="button"
                className="rp-card__compact-button"
                disabled={review.isPending}
                onClick={() => setReturning(true)}
              >
                差戻し
              </button>
            </span>
          )}
        </dd>
        {approver && (
          <>
            <dt>承認者</dt>
            <dd>
              {approver.name || "-"}
              {approver.time && ` (${dateTimeLabel(approver.time)})`}
            </dd>
          </>
        )}
        {returned && (
          <>
            <dt>差戻し理由</dt>
            <dd className="countersign__reason">
              {noteReturnReason(returned)}
              {returned.requester?.display && ` (${returned.requester.display})`}
            </dd>
          </>
        )}
      </dl>

      {(comments.length > 0 || (supervising && commentTask)) && (
        <div className="countersign__comments">
          <h3 className="facility-settings__subheading">コメント</h3>
          {comments.length > 0 && (
            <ul className="countersign__comment-list">
              {comments.map((c) => (
                <li key={`${c.taskId}/${c.index}`}>
                  <span className="countersign__comment-meta">
                    {c.authorName}
                    {c.time && ` ${dateTimeLabel(c.time)}`}
                  </span>
                  <span className="countersign__comment-text">{c.text}</span>
                  {c.authorId === practitionerId && (
                    <span className="countersign__comment-actions">
                      <button type="button" className="rp-card__compact-button" onClick={() => setEditing(c)}>
                        編集
                      </button>
                      <button
                        type="button"
                        className="rp-card__icon-button"
                        title="コメントを削除"
                        aria-label="コメントを削除"
                        disabled={saveTask.isPending}
                        onClick={() => {
                          setEditing(c);
                          const task = allTasks.find((t) => t.id === c.taskId);
                          if (task) saveTask.mutate(buildEditedCommentTask(task, c.index, null), { onSuccess: () => setEditing(null) });
                        }}
                      >
                        <TrashIcon />
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {supervising && commentTask && (
            <div className="countersign__comment-form">
              <textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} aria-label="コメント" />
              <button
                type="button"
                className="rp-card__compact-button"
                disabled={!comment.trim() || saveTask.isPending}
                onClick={addComment}
              >
                コメント
              </button>
            </div>
          )}
        </div>
      )}

      {returning && (
        <ReasonModal title="差戻し" submitting={review.isPending} onSubmit={sendBack} onClose={() => setReturning(false)} />
      )}
      {editing && !saveTask.isPending && (
        <EditCommentModal
          initial={editing.text}
          submitting={saveTask.isPending}
          onSubmit={saveEdit}
          onClose={() => setEditing(null)}
        />
      )}
    </fieldset>
  );
}

// Modal はポータルではないので <form> は書かない。
function ReasonModal({
  title,
  submitting,
  onSubmit,
  onClose,
}: {
  title: string;
  submitting: boolean;
  onSubmit: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <Modal title={title} onClose={onClose}>
      <div className="prescription-form">
        <label>
          理由
          <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <div className="lab-order-item__actions">
          <button type="button" disabled={!reason.trim() || submitting} onClick={() => onSubmit(reason.trim())}>
            差戻し
          </button>
        </div>
      </div>
    </Modal>
  );
}

function EditCommentModal({
  initial,
  submitting,
  onSubmit,
  onClose,
}: {
  initial: string;
  submitting: boolean;
  onSubmit: (text: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(initial);
  return (
    <Modal title="コメント" onClose={onClose}>
      <div className="prescription-form">
        <label>
          コメント
          <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <div className="lab-order-item__actions">
          <button type="button" disabled={!text.trim() || submitting} onClick={() => onSubmit(text.trim())}>
            更新
          </button>
        </div>
      </div>
    </Modal>
  );
}
