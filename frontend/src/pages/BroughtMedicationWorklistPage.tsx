import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useCurrentPractitioner } from "../api/authQueries";
import { readResource } from "../api/fhirClient";
import {
  useBroughtMedicationTransaction,
  useBroughtMedWorklist,
  type BroughtMedWorklistItem,
} from "../api/queries";
import { BroughtMedicationIdentifyModal } from "../components/BroughtMedicationIdentifyModal";
import { ErrorBanner } from "../components/ErrorBanner";
import {
  PatientKana,
  PatientProfileCells,
  PatientProfileHeadCells,
} from "../components/PatientRowCells";
import { RowMenu } from "../components/RowMenu";
import {
  broughtStateOf,
  countBroughtStates,
  summarizeBroughtMedication,
} from "../fhir/broughtMedicationHelpers";
import {
  broughtMedIdentifiedEntry,
  broughtMedReviewEntry,
  broughtMedReviewRowOf,
  broughtMedReviewStatusDisplay,
  buildBroughtMedReviewUpdate,
  type BroughtMedReviewStatus,
} from "../fhir/broughtMedTaskHelpers";
import { displayName } from "../fhir/patientHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { addDays, dateTimeLabel, today } from "../lib/dates";
import { useReturnLinkState } from "../returnTo";

// 薬剤部の持参薬鑑別一覧(docs/brought-medication-design.md §5.2)。
// 閉じていない鑑別依頼を 1 入院 1 行で並べ、鑑別開始 → 鑑別 → 鑑別完了と進める。
// 鑑別完了で主治医に「持参薬鑑別済」の通知を出す。

/** 「鑑別済も表示」で遡る日数。 */
const COMPLETED_LOOKBACK_DAYS = 7;

export function BroughtMedicationWorklistPage() {
  const [includeCompleted, setIncludeCompleted] = useState(false);
  const [identifying, setIdentifying] = useState<BroughtMedWorklistItem | null>(null);
  const worklist = useBroughtMedWorklist({
    includeCompletedSince: includeCompleted ? addDays(today(), -COMPLETED_LOOKBACK_DAYS) : undefined,
  });
  const transaction = useBroughtMedicationTransaction();
  const [completeError, setCompleteError] = useState<unknown>(null);
  const { practitionerId, practitioner } = useCurrentPractitioner();
  const actor =
    practitionerId && practitioner
      ? { practitionerId, display: practitionerDisplayName(practitioner) }
      : null;

  const items = worklist.data ?? [];

  // 患者の列と持参薬の列で横に長くなるので、処方一覧と同じくこの画面だけ幅を広げる。
  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  function changeStatus(item: BroughtMedWorklistItem, status: BroughtMedReviewStatus) {
    transaction.mutate([
      broughtMedReviewEntry(buildBroughtMedReviewUpdate(item.task, status, actor ?? undefined)),
    ]);
  }

  // 鑑別完了。主治医は入院から引き直す(依頼のときから替わっていることがある)。
  async function complete(item: BroughtMedWorklistItem) {
    setCompleteError(null);
    try {
      const encounterId = item.task.encounter?.reference?.split("/").pop();
      if (!encounterId) throw new Error("鑑別依頼に入院がありません。");
      const encounter = (await readResource<fhir4.Encounter>("Encounter", encounterId)).data;
      const patientId = item.task.for?.reference?.split("/").pop() ?? "";
      const counts = countBroughtStates(item.statements);
      const entries = [
        broughtMedReviewEntry(buildBroughtMedReviewUpdate(item.task, "completed", actor ?? undefined)),
      ];
      const notification = broughtMedIdentifiedEntry(encounter, patientId, counts, actor ?? undefined);
      if (notification) entries.push(notification);
      transaction.mutate(entries);
    } catch (error) {
      setCompleteError(error);
    }
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>持参薬鑑別一覧</h1>
      </div>

      <div className="brought-med__toolbar">
        <label className="brought-med__check">
          <input
            type="checkbox"
            checked={includeCompleted}
            onChange={(e) => setIncludeCompleted(e.target.checked)}
          />
          鑑別済も表示(直近 {COMPLETED_LOOKBACK_DAYS} 日)
        </label>
      </div>

      <ErrorBanner error={worklist.error} />
      <ErrorBanner error={transaction.error ?? completeError} />

      {worklist.isLoading ? (
        <p>読み込み中...</p>
      ) : (
        <div className="lab-worklist-wrap sticky-table-wrap">
          <table className="lab-worklist sticky-table">
            <thead>
              <tr>
                <th className="sticky-table__fix-1">患者番号</th>
                <th className="sticky-table__fix-2">患者氏名</th>
                <PatientProfileHeadCells />
                <th className="lab-worklist__compact">病棟</th>
                <th className="lab-worklist__compact">入院日</th>
                <th className="lab-worklist__compact">依頼日時</th>
                <th>持参薬</th>
                <th className="lab-worklist__compact">ステータス</th>
                <th className="lab-worklist__actions sticky-table__fix-actions"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <WorklistRow
                  key={item.task.id}
                  item={item}
                  pending={transaction.isPending}
                  onChangeStatus={(status) => changeStatus(item, status)}
                  onIdentify={() => setIdentifying(item)}
                  onComplete={() => complete(item)}
                />
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={11} className="master-search__empty">
                    鑑別を待っている持参薬はありません
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {identifying && (
        <BroughtMedicationIdentifyModal
          statements={identifying.statements.filter((s) => {
            const state = broughtStateOf(s);
            return state === "unidentified" || state === "undecided" || state === "not-taken";
          })}
          onClose={() => setIdentifying(null)}
        />
      )}
    </div>
  );
}

function WorklistRow({
  item,
  pending,
  onChangeStatus,
  onIdentify,
  onComplete,
}: {
  item: BroughtMedWorklistItem;
  pending: boolean;
  onChangeStatus: (status: BroughtMedReviewStatus) => void;
  onIdentify: () => void;
  onComplete: () => void;
}) {
  const returnLinkState = useReturnLinkState();
  const row = broughtMedReviewRowOf(item.task);
  const { patient } = item;
  const counts = useMemo(() => countBroughtStates(item.statements), [item.statements]);
  const names = item.statements
    .map((s) => summarizeBroughtMedication(s).name)
    .filter(Boolean)
    .join("・");
  const open = row.status === "requested" || row.status === "in-progress";

  return (
    <tr>
      <td className="sticky-table__fix-1">{patient?.identifier?.[0]?.value ?? "-"}</td>
      <td className="sticky-table__fix-2">
        {patient ? (
          <>
            <Link
              to={`/patients/${patient.id}/karte?tab=brought-medication`}
              state={returnLinkState}
            >
              {displayName(patient)}
            </Link>
            <PatientKana patient={patient} />
          </>
        ) : (
          "-"
        )}
      </td>
      <PatientProfileCells patient={patient} />
      <td className="lab-worklist__compact">{row.wardName || "-"}</td>
      <td className="lab-worklist__compact">{row.admissionDate || "-"}</td>
      <td className="lab-worklist__compact">{dateTimeLabel(row.authoredOn) || "-"}</td>
      <td>
        <span className="rx-worklist__medicines" title={names}>
          {counts.total} 剤{names && `(${names})`}
        </span>
        {counts.unidentified > 0 && (
          <span className="brought-med__pending">未鑑別 {counts.unidentified}</span>
        )}
      </td>
      <td className="lab-worklist__compact">
        <span className={`lab-worklist__status lab-worklist__status--${row.status}`}>
          {broughtMedReviewStatusDisplay(row.status)}
        </span>
      </td>
      <td className="lab-worklist__actions sticky-table__fix-actions">
        {row.status === "requested" && (
          <button type="button" disabled={pending} onClick={() => onChangeStatus("in-progress")}>
            鑑別開始
          </button>
        )}
        {open && (
          <button type="button" onClick={onIdentify} disabled={item.statements.length === 0}>
            鑑別
          </button>
        )}
        {row.status === "in-progress" && (
          <button
            type="button"
            disabled={pending || counts.unidentified > 0 || counts.total === 0}
            title={counts.unidentified > 0 ? "鑑別していない持参薬があります" : undefined}
            onClick={onComplete}
          >
            鑑別完了
          </button>
        )}
        {open && (
          <RowMenu label="この鑑別依頼の操作" escapesClipping>
            {row.status === "in-progress" && (
              <button
                type="button"
                className="row-menu__item"
                disabled={pending}
                onClick={() => onChangeStatus("requested")}
              >
                取消
              </button>
            )}
            <button
              type="button"
              className="row-menu__item row-menu__item--danger"
              disabled={pending}
              onClick={() => onChangeStatus("cancelled")}
            >
              依頼を取り下げ
            </button>
          </RowMenu>
        )}
      </td>
    </tr>
  );
}
