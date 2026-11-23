import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useCurrentPractitioner } from "../api/authQueries";
import {
  useDeficiencyCellTasks,
  useDeficiencyDraftNotes,
  useDeficiencyDraftResponses,
  useDeficiencyOwners,
  useRecordDeficiencyItems,
  useSelfDepartments,
  type DeficiencyOwner,
} from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { Modal } from "../components/Modal";
import { StatCell } from "../components/StatSummary";
import { notificationKindOf } from "../components/notifications/notificationRegistry";
import { documentDraftOfResponse } from "../fhir/documentFormQuestionnaire";
import { displayName, patientNumberOf } from "../fhir/patientHelpers";
import { questionnaireCanonical } from "../fhir/questionnaireResponseHelpers";
import {
  aggregateRecordDeficiencies,
  deficiencyTasksOfKind,
  NO_OWNER,
  RECORD_DEFICIENCY_KINDS,
  type DeficiencyCell,
  type DeficiencyOwnerRow,
  type RecordDeficiencyKind,
  sumDeficiencyRows,
  taskDueDateOf,
} from "../fhir/recordDeficiencyHelpers";
import { referenceId } from "../fhir/shared";
import { formatKarteDetail, formatKarteOpen, KARTE_DETAIL_PARAM, KARTE_OPEN_PARAM } from "../karteUrl";
import { localDay, today } from "../lib/dates";
import { useReturnLinkState } from "../returnTo";

// 未完了記録一覧(docs/features/notifications.md「未完了記録一覧」)。下書きの診療記録・テンプレートの回答と、承認待ち・差戻し・作成待ちの文書・
// 未確認の結果などの未対応の Task を担当者 × 種別で数える。件数を押すとその担当者・種別の一覧をモーダルで開き、行からカルテへ移る。

const ALL_DEPARTMENTS = "";

export function RecordDeficiencyPage() {
  const { practitionerId } = useCurrentPractitioner();
  const [mineOnly, setMineOnly] = useState(false);
  const [departmentId, setDepartmentId] = useState(ALL_DEPARTMENTS);
  const [opening, setOpening] = useState<{ ownerId: string; kind: RecordDeficiencyKind } | null>(null);
  const deficiencies = useRecordDeficiencyItems(mineOnly ? practitionerId : null, !mineOnly || Boolean(practitionerId));
  const departments = useSelfDepartments();
  const todayValue = today();

  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  const allRows = useMemo(
    () => aggregateRecordDeficiencies(deficiencies.items ?? [], todayValue),
    [deficiencies.items, todayValue],
  );
  const owners = useDeficiencyOwners(allRows.map((row) => row.ownerId));
  const ownerMap = owners.data;
  // 所属科は Task に無いので、担当者の所属ロールで振り分ける(宛先なしは科を持たない)。
  const rows = useMemo(
    () =>
      departmentId === ALL_DEPARTMENTS
        ? allRows
        : allRows.filter((row) =>
            ownerMap?.get(row.ownerId)?.departments.some((d) => d.organizationId === departmentId),
          ),
    [allRows, departmentId, ownerMap],
  );
  const total = sumDeficiencyRows(rows);
  // 表示中の行に 1 件も無い種別の列は出さない(種別すべてを並べると横に長くなりすぎる)。
  const kinds = RECORD_DEFICIENCY_KINDS.filter((kind) => total.cells.has(kind.code));

  return (
    <div className="page">
      <div className="page__header">
        <h1>未完了記録一覧</h1>
        <div className="page__header-actions">
          <Link className="button" to="/notifications">
            通知
          </Link>
        </div>
      </div>

      <form className="patient-search-form" onSubmit={(e) => e.preventDefault()}>
        <label>
          診療科
          <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            <option value={ALL_DEPARTMENTS}>すべて</option>
            {departments.departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </label>
        <label className="patient-search-form__check">
          <input
            type="checkbox"
            checked={mineOnly}
            disabled={!practitionerId}
            onChange={(e) => setMineOnly(e.target.checked)}
          />
          自分あてのみ
        </label>
      </form>

      <ErrorBanner error={deficiencies.error ?? owners.error ?? departments.error} />

      {deficiencies.isPending ? (
        <p>読み込み中...</p>
      ) : rows.length === 0 ? (
        <p className="patient-table__empty">未完了の記録はありません。</p>
      ) : (
        <div className="lab-worklist-wrap sticky-table-wrap">
          <table className="lab-worklist sticky-table stat-table record-deficiency">
            <thead>
              <tr>
                <th className="sticky-table__fix-1">担当者</th>
                <th className="stat-table__num stat-table__group-start">合計</th>
                <th className="stat-table__num">最長</th>
                {kinds.map((kind, i) => (
                  <th
                    key={kind.code}
                    className={`stat-table__num record-deficiency__kind${isGroupStart(kinds, i) ? " stat-table__group-start" : ""}`}
                    title={kind.group}
                  >
                    {kind.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <DeficiencyLine
                  key={row.ownerId || "none"}
                  row={row}
                  kinds={kinds}
                  name={ownerName(row.ownerId, ownerMap?.get(row.ownerId))}
                  departments={ownerMap?.get(row.ownerId)?.departments.map((d) => d.name).join("、") ?? ""}
                  mine={Boolean(practitionerId) && row.ownerId === practitionerId}
                  onOpen={(kind) => setOpening({ ownerId: row.ownerId, kind })}
                />
              ))}
            </tbody>
            {rows.length > 1 && (
              <tfoot>
                <DeficiencyLine row={total} kinds={kinds} name="合計" departments="" />
              </tfoot>
            )}
          </table>
        </div>
      )}

      {opening && (
        <DeficiencyCellModal
          ownerId={opening.ownerId}
          ownerLabel={ownerName(opening.ownerId, ownerMap?.get(opening.ownerId))}
          kind={opening.kind}
          onClose={() => setOpening(null)}
        />
      )}
    </div>
  );
}

function ownerName(ownerId: string, owner: DeficiencyOwner | undefined): string {
  if (ownerId === NO_OWNER) return "宛先なし";
  return owner?.name || ownerId;
}

/** 種別の列。分類(記録・結果・照会・届出)の変わり目に区切りの罫線を引く。 */
function isGroupStart(kinds: readonly RecordDeficiencyKind[], index: number): boolean {
  return index === 0 || kinds[index - 1].group !== kinds[index].group;
}

function DeficiencyLine({
  row,
  kinds,
  name,
  departments,
  mine = false,
  onOpen,
}: {
  row: DeficiencyOwnerRow;
  kinds: readonly RecordDeficiencyKind[];
  name: string;
  departments: string;
  mine?: boolean;
  onOpen?: (kind: RecordDeficiencyKind) => void;
}) {
  // 担当者の行の見出しは td にして、行に乗せたときの色を敷く(合計の行は th)。
  const LabelCell = onOpen ? "td" : "th";
  return (
    <tr className={mine ? "record-deficiency__mine" : undefined}>
      <LabelCell className="sticky-table__fix-1 stat-table__label" title={departments ? `${name}(${departments})` : name}>
        {name}
        {departments && <span className="record-deficiency__department">{departments}</span>}
      </LabelCell>
      <StatCell
        groupStart
        strong
        value={
          row.total > 0 ? (
            <>
              {row.total}
              {row.overdue > 0 && <span className="record-deficiency__overdue">超過 {row.overdue}</span>}
            </>
          ) : null
        }
      />
      <StatCell value={row.total > 0 ? `${row.oldestDays} 日` : null} />
      {kinds.map((kind, i) => {
        const cell = row.cells.get(kind.code);
        return (
          <StatCell
            key={kind.code}
            className="record-deficiency__kind-cell"
            groupStart={isGroupStart(kinds, i)}
            value={cell ? <CellButton cell={cell} onClick={onOpen ? () => onOpen(kind) : undefined} /> : null}
          />
        );
      })}
    </tr>
  );
}

/** 担当者の行は件数をボタンにして一覧を開く。合計の行は押せないので数字だけ。 */
function CellButton({ cell, onClick }: { cell: DeficiencyCell; onClick?: () => void }) {
  const title = `最も古いもの ${cell.oldestDays} 日前${cell.overdue > 0 ? `・期限超過 ${cell.overdue} 件` : ""}`;
  return (
    <>
      {onClick ? (
        <button type="button" className="record-deficiency__cell" title={title} onClick={onClick}>
          {cell.count}
        </button>
      ) : (
        <span title={title}>{cell.count}</span>
      )}
      {cell.overdue > 0 && <span className="record-deficiency__overdue">超過 {cell.overdue}</span>}
    </>
  );
}

/** モーダルの 1 行。Task と下書きの診療記録をこの形にそろえて並べる。 */
interface CellLine {
  id: string;
  patientId: string;
  patient: fhir4.Patient | undefined;
  since: string;
  due: string;
  content: string;
  karteLink: string | null;
}

function taskLines(
  tasks: readonly fhir4.Task[],
  patients: Map<string, fhir4.Patient>,
): CellLine[] {
  return tasks.map((task) => {
    const patientId = referenceId(task.for?.reference) ?? "";
    const patient = patients.get(patientId);
    const registered = notificationKindOf(task);
    return {
      id: task.id ?? "",
      patientId,
      patient,
      since: task.authoredOn ? localDay(task.authoredOn) : "",
      due: taskDueDateOf(task),
      content: task.description ?? "",
      karteLink: registered
        ? registered.karteLink(registered.toRow(task, patient))
        : patientId
          ? `/patients/${patientId}/karte`
          : null,
    };
  });
}

/** 下書きの診療記録は、カルテの詳細でその記録を開いた状態へ移る(確定はそこから)。 */
function draftNoteLines(
  notes: readonly fhir4.Composition[],
  patients: Map<string, fhir4.Patient>,
): CellLine[] {
  return notes.map((note) => {
    const patientId = referenceId(note.subject?.reference) ?? "";
    const params = new URLSearchParams();
    params.set(KARTE_DETAIL_PARAM, formatKarteDetail({ kind: "note", id: note.id ?? "" }));
    return {
      id: note.id ?? "",
      patientId,
      patient: patients.get(patientId),
      since: note.date ? localDay(note.date) : "",
      due: "",
      content: note.title ?? "",
      karteLink: patientId ? `/patients/${patientId}/karte?${params.toString()}` : null,
    };
  });
}

/**
 * 下書きのテンプレートの回答は、カルテの右ペインでその下書きを開き直した状態へ移る(様式文書は文書作成、
 * ほかはテンプレートの編集)。
 */
function draftResponseLines(
  responses: readonly fhir4.QuestionnaireResponse[],
  questionnaires: readonly fhir4.Questionnaire[],
  patients: Map<string, fhir4.Patient>,
): CellLine[] {
  return responses.map((response) => {
    const patientId = referenceId(response.subject?.reference) ?? "";
    const documentDraft = documentDraftOfResponse(response);
    const questionnaire = questionnaires.find(
      (q) => questionnaireCanonical(q) === response.questionnaire || q.url === response.questionnaire,
    );
    const params = new URLSearchParams();
    params.set(
      KARTE_OPEN_PARAM,
      formatKarteOpen(
        documentDraft
          ? { kind: "document-draft", responseId: response.id ?? "" }
          : { kind: "questionnaire-response", responseId: response.id ?? "" },
      ),
    );
    return {
      id: response.id ?? "",
      patientId,
      patient: patients.get(patientId),
      since: response.authored ? localDay(response.authored) : "",
      due: "",
      content: documentDraft?.title || questionnaire?.title || questionnaire?.name || "",
      karteLink: patientId ? `/patients/${patientId}/karte?${params.toString()}` : null,
    };
  });
}

/** 担当者 × 種別の一覧。古い順で、行からカルテへ移る。 */
function DeficiencyCellModal({
  ownerId,
  ownerLabel,
  kind,
  onClose,
}: {
  ownerId: string;
  ownerLabel: string;
  kind: RecordDeficiencyKind;
  onClose: () => void;
}) {
  const isDraft = kind.source !== "task";
  const taskList = useDeficiencyCellTasks(isDraft ? null : kind.code, ownerId);
  const draftList = useDeficiencyDraftNotes(ownerId, kind.source === "draft-note");
  const draftResponseList = useDeficiencyDraftResponses(ownerId, kind.source === "draft-response");
  const list = kind.source === "draft-note" ? draftList : kind.source === "draft-response" ? draftResponseList : taskList;
  const linkState = useReturnLinkState();
  const todayValue = today();
  const lines =
    kind.source === "draft-note"
      ? draftList.data
        ? draftNoteLines(draftList.data.notes, draftList.data.patients)
        : []
      : kind.source === "draft-response"
        ? draftResponseList.data
          ? draftResponseLines(
              draftResponseList.data.responses,
              draftResponseList.data.questionnaires,
              draftResponseList.data.patients,
            )
          : []
        : taskList.data
          ? taskLines(deficiencyTasksOfKind(taskList.data.tasks, kind, todayValue), taskList.data.patients)
          : [];

  return (
    <Modal
      title={`${ownerLabel} の${kind.label}`}
      onClose={onClose}
      className="modal--record-deficiency"
      titleAction={
        kind.link ? (
          <Link className="rp-card__compact-button" to={kind.link} state={linkState}>
            一覧
          </Link>
        ) : undefined
      }
    >
      <ErrorBanner error={list.error} />
      {list.isPending ? (
        <p>読み込み中...</p>
      ) : lines.length === 0 ? (
        <p className="patient-table__empty">未完了のものはありません。</p>
      ) : (
        <div className="home__table-wrap">
          <table className="home__table">
            <thead>
              <tr>
                <th>患者番号</th>
                <th>患者氏名</th>
                <th>{isDraft ? "記録日" : "発生日"}</th>
                {!isDraft && <th>期限</th>}
                <th>{isDraft ? "タイトル" : "内容"}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id}>
                  <td className="home__cell-compact">{line.patient ? patientNumberOf(line.patient) : ""}</td>
                  <td className="home__cell-compact">{line.patient ? displayName(line.patient) : line.patientId}</td>
                  <td className="home__cell-compact">{line.since}</td>
                  {!isDraft && (
                    <td
                      className={`home__cell-compact${line.due && line.due < todayValue ? " admission-documents__overdue" : ""}`}
                    >
                      {line.due}
                    </td>
                  )}
                  <td className="record-deficiency__description">{line.content}</td>
                  <td className="home__cell-compact">
                    {line.karteLink && (
                      <Link to={line.karteLink} state={linkState}>
                        カルテ
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {list.data?.hasMore && (
        <p className="home__more">古い順に 200 件まで出しています。{kind.link ? "続きは一覧で見てください。" : ""}</p>
      )}
    </Modal>
  );
}
