import { useEffect, useMemo, useState } from "react";
import { FhirError } from "../api/fhirClient";
import { useCurrentPractitioner } from "../api/authQueries";
import {
  useBroughtMedication,
  useBroughtMedicationTransaction,
  useBroughtMedTasks,
  usePatientAdmission,
  usePatientAdmissions,
  usePatientBroughtMedications,
  useRegisterBroughtMedications,
} from "../api/queries";
import {
  BROUGHT_STATE_LABELS,
  broughtDoseLabel,
  broughtMedicationEntry,
  broughtStockLabel,
  buildBroughtMedication,
  buildEnteredInErrorMedication,
  buildUndecidedMedication,
  countBroughtStates,
  isAwaitingDecision,
  parseBroughtMedicationForm,
  summarizeBroughtMedication,
  type BroughtMedicationFormValues,
  type BroughtState,
} from "../fhir/broughtMedicationHelpers";
import {
  broughtMedReviewStatusDisplay,
  isBroughtMedReviewTask,
} from "../fhir/broughtMedTaskHelpers";
import { encounterAdmissionDate } from "../fhir/encounterHelpers";
import { isPatientMismatch } from "../fhir/patientHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { BroughtMedicationDecisionModal } from "./BroughtMedicationDecisionModal";
import { BroughtMedicationDetailPanel } from "./BroughtMedicationDetailPanel";
import { BroughtMedicationForm } from "./BroughtMedicationForm";
import { BroughtMedicationIdentifyModal } from "./BroughtMedicationIdentifyModal";
import { ErrorBanner } from "./ErrorBanner";
import { RowMenu } from "./RowMenu";

// カルテ画面の「持参薬」タブ。今の入院(入院していなければ直近の入院)の持参薬を並べ、
// 登録・鑑別・継続/休止/中止の判断をタブの中で行う(docs/brought-medication-design.md §5.1)。
//
// 一覧と詳細は URL(view パラメータ)で表す。登録・編集は入力途中の内容を URL では
// 復元できないので、このコンポーネント内の状態に留める(アレルギータブと同じ)。

type Mode =
  | { kind: "list" }
  | { kind: "detail"; id: string }
  | { kind: "create" }
  | { kind: "edit"; id: string };

type FormMode = Extract<Mode, { kind: "create" } | { kind: "edit" }> | null;

type ModalState =
  | { kind: "identify"; statements: fhir4.MedicationStatement[] }
  | { kind: "decide"; decision: "hold" | "stop"; statements: fhir4.MedicationStatement[] }
  | null;

const MODE_TITLES: Record<Mode["kind"], string> = {
  list: "持参薬",
  detail: "持参薬詳細",
  create: "持参薬登録",
  edit: "持参薬編集",
};

/** 鑑別を入れ直せる状態(判断がまだのもの)。 */
const IDENTIFIABLE: BroughtState[] = ["unidentified", "undecided", "not-taken"];

interface KarteBroughtMedicationTabProps {
  patientId: string;
  /** URL から渡される表示対象の持参薬 ID。空なら一覧。 */
  view: string;
  onViewChange: (view: string | null) => void;
  /** 継続。右ペインの処方登録を、選んだ持参薬から作った初期値で開く。 */
  onContinue: (broughtIds: string[]) => void;
  /** 継続で起こした処方の詳細を開く。 */
  onOpenPrescription: (srId: string) => void;
}

export function KarteBroughtMedicationTab({
  patientId,
  view,
  onViewChange,
  onContinue,
  onOpenPrescription,
}: KarteBroughtMedicationTabProps) {
  const [form, setForm] = useState<FormMode>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [showAll, setShowAll] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectionError, setSelectionError] = useState<string | null>(null);

  // 戻る・進むで表示対象が変わったら、開いていたフォームは畳む。
  useEffect(() => setForm(null), [view]);

  const admission = usePatientAdmission(patientId);
  const admissions = usePatientAdmissions(patientId);
  // 今の入院。入院していなければ直近の入院(退院後に持参薬の記録を見返すため)。
  const currentEncounter = admission.data?.encounter ?? admissions.data?.[0];
  const encounterId = currentEncounter?.id;
  const admitted = Boolean(admission.data);

  const { statements, isLoading, error } = usePatientBroughtMedications(
    patientId,
    showAll ? undefined : encounterId,
  );
  // 判断が出揃ったかどうかは、表示の切り替えと関係なく今の入院の持参薬で見る。
  const encounterStatements = usePatientBroughtMedications(
    encounterId ? patientId : undefined,
    encounterId,
  ).statements;
  const { tasks } = useBroughtMedTasks(encounterId);
  const transaction = useBroughtMedicationTransaction();

  const counts = useMemo(() => countBroughtStates(encounterStatements), [encounterStatements]);
  const openReview = tasks.find(
    (task) => isBroughtMedReviewTask(task) && task.status !== "cancelled",
  );

  const mode: Mode = form ?? (view ? { kind: "detail", id: view } : { kind: "list" });

  function backToList() {
    setForm(null);
    onViewChange(null);
  }

  function selectedStatements() {
    return statements.filter((s) => s.id && selected.has(s.id));
  }

  function handleContinue() {
    const targets = selectedStatements();
    const unresolved = targets.filter((s) => {
      const summary = summarizeBroughtMedication(s);
      return !(summary.substitute ?? summary.medicine);
    });
    if (unresolved.length) {
      setSelectionError(
        `医薬品が特定されていない持参薬があります(${unresolved
          .map((s) => summarizeBroughtMedication(s).name)
          .join("・")})。鑑別で特定してから継続してください。`,
      );
      return;
    }
    setSelectionError(null);
    onContinue(targets.map((s) => s.id as string));
    setSelected(new Set());
  }

  function handleDecide(decision: "hold" | "stop") {
    setSelectionError(null);
    setModal({ kind: "decide", decision, statements: selectedStatements() });
    setSelected(new Set());
  }

  // 休止・中止だけを戻す。継続は処方を起こしているので、戻すのではなく中止する。
  function handleUndo(statement: fhir4.MedicationStatement) {
    transaction.mutate([broughtMedicationEntry(buildUndecidedMedication(statement))]);
  }

  function handleEnteredInError(statement: fhir4.MedicationStatement) {
    const name = summarizeBroughtMedication(statement).name;
    if (!window.confirm(`持参薬「${name}」を誤登録として取り消します。よろしいですか?`)) return;
    transaction.mutate([broughtMedicationEntry(buildEnteredInErrorMedication(statement))]);
  }

  const modalElement =
    modal?.kind === "identify" ? (
      <BroughtMedicationIdentifyModal statements={modal.statements} onClose={() => setModal(null)} />
    ) : modal?.kind === "decide" ? (
      <BroughtMedicationDecisionModal
        decision={modal.decision}
        statements={modal.statements}
        encounterStatements={encounterStatements}
        tasks={tasks}
        onClose={() => setModal(null)}
      />
    ) : null;

  if (mode.kind !== "list") {
    return (
      <div className="karte-tabpanel">
        <div className="karte-tabpanel__header">
          <h3>{MODE_TITLES[mode.kind]}</h3>
          <div className="karte-tabpanel__actions">
            {mode.kind === "detail" && (
              <button type="button" onClick={() => setForm({ kind: "edit", id: mode.id })}>
                編集
              </button>
            )}
            <button type="button" onClick={backToList}>
              ← 一覧に戻る
            </button>
          </div>
        </div>
        {mode.kind === "detail" ? (
          <DetailView
            patientId={patientId}
            id={mode.id}
            onOpenPrescription={onOpenPrescription}
          />
        ) : mode.kind === "create" ? (
          <CreateForm
            patientId={patientId}
            admission={
              admitted && currentEncounter?.id
                ? {
                    encounterId: currentEncounter.id,
                    wardName: admission.data?.wardName ?? "",
                    admissionDate: encounterAdmissionDate(currentEncounter),
                  }
                : undefined
            }
            onSaved={backToList}
          />
        ) : (
          <EditForm patientId={patientId} id={mode.id} onSaved={backToList} />
        )}
      </div>
    );
  }

  const identifiable = encounterStatements.filter((s) =>
    IDENTIFIABLE.includes(summarizeBroughtMedication(s).state),
  );

  return (
    <div className="karte-tabpanel">
      <div className="karte-tabpanel__header">
        <h3>{MODE_TITLES.list}</h3>
        <div className="karte-tabpanel__actions">
          {identifiable.length > 0 && (
            <button type="button" onClick={() => setModal({ kind: "identify", statements: identifiable })}>
              鑑別
            </button>
          )}
          {admitted && (
            <button type="button" onClick={() => setForm({ kind: "create" })}>
              新規登録
            </button>
          )}
        </div>
      </div>

      <ErrorBanner error={error ?? transaction.error} />

      {currentEncounter && (
        <p className="brought-med__summary">
          {admitted ? "入院中" : "直近の入院"}(
          {encounterAdmissionDate(currentEncounter)} 入院)・持参薬 {counts.total} 剤
          {openReview && `・鑑別 ${broughtMedReviewStatusDisplay(openReview.status)}`}
          {counts.unidentified > 0 && (
            <span className="brought-med__pending">未鑑別 {counts.unidentified}</span>
          )}
          {counts.undecided > 0 && (
            <span className="brought-med__pending">未判断 {counts.undecided}</span>
          )}
        </p>
      )}

      <div className="brought-med__toolbar">
        <label className="brought-med__check">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          過去の入院も表示
        </label>
        {selected.size > 0 && (
          <div className="brought-med__bulk">
            <span>{selected.size} 剤を選択中</span>
            <button type="button" onClick={handleContinue}>
              継続(院内処方にする)
            </button>
            <button type="button" onClick={() => handleDecide("hold")}>
              休止
            </button>
            <button type="button" onClick={() => handleDecide("stop")}>
              中止
            </button>
          </div>
        )}
      </div>
      {selectionError && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{selectionError}</p>
        </div>
      )}

      {isLoading ? (
        <p>読み込み中...</p>
      ) : statements.length === 0 ? (
        <p className="patient-table__empty">
          {currentEncounter ? "登録されている持参薬がありません。" : "入院歴がありません。"}
        </p>
      ) : (
        <table className="patient-table">
          <thead>
            <tr>
              <th></th>
              <th>薬剤</th>
              <th>用法・用量</th>
              <th>持参数・残日数</th>
              <th>状態</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {statements.map((statement) => {
              const summary = summarizeBroughtMedication(statement);
              const awaiting = isAwaitingDecision(statement);
              return (
                <tr key={summary.id}>
                  <td>
                    {awaiting && (
                      <input
                        type="checkbox"
                        aria-label={`${summary.name} を選択`}
                        checked={selected.has(summary.id)}
                        onChange={(e) =>
                          setSelected((current) => {
                            const next = new Set(current);
                            if (e.target.checked) next.add(summary.id);
                            else next.delete(summary.id);
                            return next;
                          })
                        }
                      />
                    )}
                  </td>
                  <td>
                    {summary.name || "-"}
                    {summary.substitute && (
                      <span className="brought-med__substitute">→ {summary.substitute.name}</span>
                    )}
                  </td>
                  <td>
                    {[summary.usageName, broughtDoseLabel(summary)].filter(Boolean).join(" ") || "-"}
                  </td>
                  <td>{broughtStockLabel(summary) || "-"}</td>
                  <td>
                    <span className={`brought-med__state brought-med__state--${summary.state}`}>
                      {BROUGHT_STATE_LABELS[summary.state]}
                    </span>
                  </td>
                  <td className="patient-table__actions">
                    <button type="button" onClick={() => onViewChange(summary.id)}>
                      表示
                    </button>
                    <RowMenu label={`${summary.name} の操作`}>
                      <button
                        type="button"
                        className="row-menu__item"
                        onClick={() => setForm({ kind: "edit", id: summary.id })}
                      >
                        編集
                      </button>
                      {IDENTIFIABLE.includes(summary.state) && (
                        <button
                          type="button"
                          className="row-menu__item"
                          onClick={() => setModal({ kind: "identify", statements: [statement] })}
                        >
                          鑑別
                        </button>
                      )}
                      {summary.state === "continued" && (
                        <>
                          {summary.convertedOrderId && (
                            <button
                              type="button"
                              className="row-menu__item"
                              onClick={() => onOpenPrescription(summary.convertedOrderId as string)}
                            >
                              処方を開く
                            </button>
                          )}
                          <button
                            type="button"
                            className="row-menu__item"
                            onClick={() =>
                              setModal({ kind: "decide", decision: "stop", statements: [statement] })
                            }
                          >
                            中止
                          </button>
                        </>
                      )}
                      {(summary.state === "held" || summary.state === "stopped") && (
                        <button
                          type="button"
                          className="row-menu__item"
                          onClick={() => handleUndo(statement)}
                          disabled={transaction.isPending}
                        >
                          判断を取消
                        </button>
                      )}
                      {summary.state !== "continued" && (
                        <button
                          type="button"
                          className="row-menu__item row-menu__item--danger"
                          onClick={() => handleEnteredInError(statement)}
                          disabled={transaction.isPending}
                        >
                          誤登録
                        </button>
                      )}
                    </RowMenu>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {modalElement}
    </div>
  );
}

function DetailView({
  patientId,
  id,
  onOpenPrescription,
}: {
  patientId: string;
  id: string;
  onOpenPrescription: (srId: string) => void;
}) {
  const { data: statement, isLoading, error: loadError } = useBroughtMedication(id);
  const patientMismatch = isPatientMismatch(patientId, statement?.subject);
  const error =
    loadError ?? (patientMismatch ? new Error("指定された持参薬は別の患者のものです。") : undefined);

  return (
    <>
      <ErrorBanner error={error} />
      {isLoading ? (
        <p>読み込み中...</p>
      ) : (
        statement &&
        !patientMismatch && (
          <BroughtMedicationDetailPanel
            statement={statement}
            onOpenPrescription={onOpenPrescription}
          />
        )
      )}
    </>
  );
}

function useRegistrant() {
  const { practitionerId, practitioner } = useCurrentPractitioner();
  return practitionerId && practitioner
    ? { practitionerId, practitionerName: practitionerDisplayName(practitioner) }
    : {};
}

function CreateForm({
  patientId,
  admission,
  onSaved,
}: {
  patientId: string;
  admission?: { encounterId: string; wardName: string; admissionDate: string };
  onSaved: () => void;
}) {
  const register = useRegisterBroughtMedications();
  const registrant = useRegistrant();

  function handleSubmit(values: BroughtMedicationFormValues) {
    const statements = values.lines.map((line) =>
      buildBroughtMedication(values, line, {
        patientId,
        encounterId: admission?.encounterId,
        ...registrant,
      }),
    );
    register.mutate({ statements, patientId, admission }, { onSuccess: onSaved });
  }

  return (
    <BroughtMedicationForm
      onSubmit={handleSubmit}
      submitting={register.isPending}
      submitError={register.error}
    />
  );
}

function EditForm({
  patientId,
  id,
  onSaved,
}: {
  patientId: string;
  id: string;
  onSaved: () => void;
}) {
  const { data: statement, isLoading, error: loadError } = useBroughtMedication(id);
  const transaction = useBroughtMedicationTransaction();
  const patientMismatch = isPatientMismatch(patientId, statement?.subject);
  const error =
    loadError ?? (patientMismatch ? new Error("指定された持参薬は別の患者のものです。") : undefined);
  const conflict =
    transaction.error instanceof FhirError &&
    (transaction.error.status === 409 || transaction.error.status === 412);

  function handleSubmit(values: BroughtMedicationFormValues) {
    if (!statement || patientMismatch) return;
    const next = buildBroughtMedication(values, values.lines[0], { patientId }, statement);
    transaction.mutate([broughtMedicationEntry(next)], { onSuccess: onSaved });
  }

  return (
    <>
      <ErrorBanner error={error} />
      {conflict && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">
            この持参薬は他の操作によって更新されています。画面を再読込してから再度編集してください。
          </p>
        </div>
      )}
      {isLoading ? (
        <p>読み込み中...</p>
      ) : (
        statement &&
        !patientMismatch && (
          <BroughtMedicationForm
            initialValues={parseBroughtMedicationForm(statement)}
            onSubmit={handleSubmit}
            submitting={transaction.isPending}
            submitError={conflict ? undefined : transaction.error}
            submitLabel="更新"
            single
          />
        )
      )}
    </>
  );
}
