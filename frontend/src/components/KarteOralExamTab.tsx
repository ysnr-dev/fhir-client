import { useEffect, useState } from "react";
import { FhirError } from "../api/fhirClient";
import { useCurrentPractitioner } from "../api/authQueries";
import { useOralExamCodes } from "../api/masterQueries";
import {
  useDeleteOralExam,
  useOralExamSnapshot,
  useOralExamSnapshots,
  usePatient,
  useSaveOralExam,
} from "../api/queries";
import {
  changedTeeth,
  codeDisplay,
  copySnapshotForNew,
  countTeeth,
  emptyOralExamSnapshot,
  isDeciduous,
  recordsOfTooth,
  type OralExamSnapshot,
} from "../fhir/oralExamHelpers";
import { calculateAge, isPatientMismatch } from "../fhir/patientHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { useEditSnapshot } from "../hooks/useEditSnapshot";
import { ErrorBanner } from "./ErrorBanner";
import { OralExamChart, OralExamChartSizeButton } from "./OralExamChart";
import { OralExamMouthDetail, OralExamToothDetail } from "./OralExamDetail";
import { OralExamForm } from "./OralExamForm";
import { OralExamLegendButton } from "./OralExamLegend";
import { TruncatedNotice } from "./TruncatedNotice";

// カルテ画面の「口腔診査情報」タブ。口腔診査情報標準コード仕様(JDAOES)の口腔状態スナップショットを
// 診査ごとに残し、最新(または選んだ回)を歯式図で読む。登録・編集はタブの中で行う。
//
// 選んでいる回は URL の view(見出しの Observation の id)で表す。登録・編集は入力途中の内容を
// URL では復元できないので、このコンポーネントの状態に留める。

type FormMode = { kind: "create" } | { kind: "edit"; snapshotId: string } | null;

/** 乳歯の行を既定で出す年齢(この年齢未満)。 */
const DECIDUOUS_AGE = 15;

interface KarteOralExamTabProps {
  patientId: string;
  view: string;
  onViewChange: (view: string | null) => void;
}

export function KarteOralExamTab({ patientId, view, onViewChange }: KarteOralExamTabProps) {
  const [form, setForm] = useState<FormMode>(null);
  const [selectedTooth, setSelectedTooth] = useState("");
  const [showDiff, setShowDiff] = useState(false);
  const codes = useOralExamCodes();
  const book = codes.data;
  const { snapshots, isLoading, error } = useOralExamSnapshots(patientId);
  const patient = usePatient(patientId);
  const age = calculateAge(patient.data?.data.birthDate ?? "");
  const youngPatient = age !== undefined && age < DECIDUOUS_AGE;
  const deleteOralExam = useDeleteOralExam();

  useEffect(() => setForm(null), [view]);

  const currentIndex = Math.max(0, snapshots.findIndex((s) => s.summary.headerId === view));
  const current = snapshots[currentIndex];
  const previous = snapshots[currentIndex + 1];
  const detail = useOralExamSnapshot(current?.summary.snapshotId);
  const loaded = detail.data;
  // 「前回との違い」は 1 つ前の診査と比べる。
  const previousDetail = useOralExamSnapshot(showDiff ? previous?.summary.snapshotId : undefined);

  function backToView() {
    setForm(null);
  }

  function handleDelete() {
    if (!current) return;
    if (!window.confirm(`${current.summary.examDate} の口腔診査情報を削除します。よろしいですか?`)) return;
    deleteOralExam.mutate(current.summary.snapshotId, { onSuccess: () => onViewChange(null) });
  }

  if (form) {
    return (
      <div className="karte-tabpanel oral-exam">
        <div className="karte-tabpanel__header">
          <h3>{form.kind === "create" ? "口腔診査情報の登録" : "口腔診査情報の編集"}</h3>
          <div className="karte-tabpanel__actions">
            <button type="button" onClick={backToView}>
              ← 一覧に戻る
            </button>
          </div>
        </div>
        {form.kind === "create" ? (
          <CreateForm
            patientId={patientId}
            previous={snapshots.length ? loaded?.snapshot : undefined}
            previousLoading={snapshots.length > 0 && detail.isLoading}
            defaultDeciduous={youngPatient}
            onSaved={(headerId) => {
              setForm(null);
              onViewChange(headerId ?? null);
            }}
            onCancel={backToView}
          />
        ) : (
          <EditForm
            patientId={patientId}
            snapshotId={form.snapshotId}
            defaultDeciduous={youngPatient}
            onSaved={backToView}
            onCancel={backToView}
          />
        )}
      </div>
    );
  }

  const snapshot = loaded?.snapshot;
  const counts = snapshot ? countTeeth(snapshot.teeth) : null;
  const changed =
    showDiff && snapshot && previousDetail.data ? changedTeeth(snapshot.teeth, previousDetail.data.snapshot.teeth) : undefined;
  const showDeciduous = youngPatient || Boolean(snapshot?.teeth.some((t) => isDeciduous(t.toothCode)));

  return (
    <div className="karte-tabpanel oral-exam">
      <div className="karte-tabpanel__header">
        <h3>口腔診査情報</h3>
        <div className="karte-tabpanel__actions">
          {snapshots.length > 0 && (
            <select
              aria-label="診査日"
              value={current?.summary.headerId ?? ""}
              onChange={(e) => onViewChange(e.target.value)}
            >
              {snapshots.map(({ summary }) => (
                <option key={summary.headerId} value={summary.headerId}>
                  {summary.examDate} {codeDisplay(book, "NS-2", summary.inputType)}
                </option>
              ))}
            </select>
          )}
          <button type="button" onClick={() => setForm({ kind: "create" })}>
            新規登録
          </button>
          {current && (
            <>
              <button type="button" onClick={() => setForm({ kind: "edit", snapshotId: current.summary.snapshotId })}>
                編集
              </button>
              <button type="button" onClick={handleDelete} disabled={deleteOralExam.isPending}>
                削除
              </button>
            </>
          )}
        </div>
      </div>

      <ErrorBanner error={error ?? codes.error ?? detail.error ?? deleteOralExam.error} />

      {isLoading || detail.isLoading ? (
        <p>読み込み中...</p>
      ) : !snapshot ? (
        <p className="oral-exam__empty">記録なし</p>
      ) : (
        <>
          <TruncatedNotice show={loaded?.truncated} />
          <p className="oral-exam__summary">
            <OralExamLegendButton />
            <OralExamChartSizeButton />
            {current?.summary.performer && <span>診査者 {current.summary.performer}</span>}
            {counts && (
              <>
                <span>現在歯 {counts.present}</span>
                <span>未処置歯 {counts.caries}</span>
                <span>処置歯 {counts.treated}</span>
                <span>喪失歯 {counts.missing}</span>
              </>
            )}
            {previous && (
              <label className="oral-exam__check">
                <input type="checkbox" checked={showDiff} onChange={(e) => setShowDiff(e.target.checked)} />
                前回との違い
              </label>
            )}
            {changed && <span>変更 {changed.size} 歯</span>}
          </p>
          <OralExamChart
            teeth={snapshot.teeth}
            selected={selectedTooth ? [selectedTooth] : []}
            onSelect={setSelectedTooth}
            showDeciduous={showDeciduous}
            changed={changed}
            resizable
          />
          {selectedTooth && (
            <OralExamToothDetail
              book={book}
              toothCode={selectedTooth}
              records={recordsOfTooth(snapshot.teeth, selectedTooth)}
            />
          )}
          <OralExamMouthDetail book={book} mouth={snapshot.mouth} />
          {snapshot.note && <p className="oral-exam__note">{snapshot.note}</p>}
        </>
      )}
    </div>
  );
}

function usePerformer(): fhir4.Reference | undefined {
  const { practitionerId, practitioner } = useCurrentPractitioner();
  if (!practitionerId) return undefined;
  return {
    reference: `Practitioner/${practitionerId}`,
    ...(practitioner ? { display: practitionerDisplayName(practitioner) } : {}),
  };
}

function conflictOf(error: unknown): boolean {
  return error instanceof FhirError && (error.status === 412 || error.status === 404);
}

function ConflictBanner() {
  return (
    <div className="error-banner" role="alert">
      <p className="error-banner__line error-banner__line--error">
        この口腔診査情報は他の操作によって更新されています。画面を再読込してから再度編集してください。
      </p>
    </div>
  );
}

function CreateForm({
  patientId,
  previous,
  previousLoading,
  defaultDeciduous,
  onSaved,
  onCancel,
}: {
  patientId: string;
  /** 複写する前回の診査(表示中の回)。 */
  previous: OralExamSnapshot | undefined;
  previousLoading: boolean;
  defaultDeciduous: boolean;
  onSaved: (headerId: string | undefined) => void;
  onCancel: () => void;
}) {
  const codes = useOralExamCodes();
  const save = useSaveOralExam();
  const performer = usePerformer();

  if (previousLoading || codes.isLoading) return <p>読み込み中...</p>;

  const initial = previous ? copySnapshotForNew(previous) : emptyOralExamSnapshot();

  function handleSubmit(snapshot: OralExamSnapshot) {
    save.mutate(
      { snapshot: { ...snapshot, performer }, patientId, book: codes.data },
      {
        onSuccess: (result) => {
          // 応答の先頭が見出し(entry の順は送った順)。
          const location = result.data.entry?.[0]?.response?.location ?? "";
          onSaved(location.match(/(?:^|\/)Observation\/([^/]+)/)?.[1]);
        },
      },
    );
  }

  return (
    <>
      <ErrorBanner error={codes.error} />
      <OralExamForm
        book={codes.data}
        initialValues={initial}
        defaultDeciduous={defaultDeciduous}
        baseline={previous?.teeth}
        onSubmit={handleSubmit}
        onCancel={onCancel}
        submitting={save.isPending}
        submitError={save.error}
      />
    </>
  );
}

function EditForm({
  patientId,
  snapshotId,
  defaultDeciduous,
  onSaved,
  onCancel,
}: {
  patientId: string;
  snapshotId: string;
  defaultDeciduous: boolean;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const codes = useOralExamCodes();
  const { data: loaded, isLoading, error: loadError } = useEditSnapshot(useOralExamSnapshot(snapshotId), snapshotId);
  const save = useSaveOralExam();
  const performer = usePerformer();

  // 別患者の診査を更新すると subject が書き換わり、付け替わってしまう。
  const patientMismatch = isPatientMismatch(patientId, loaded?.header.subject);
  const error =
    loadError ?? (patientMismatch ? new Error("指定された口腔診査情報は別の患者のものです。") : undefined);

  function handleSubmit(snapshot: OralExamSnapshot) {
    if (!loaded || patientMismatch) return;
    save.mutate(
      {
        snapshot: { ...snapshot, performer: snapshot.performer ?? performer },
        patientId,
        book: codes.data,
        loaded: { header: loaded.header, childIds: loaded.childIds },
      },
      { onSuccess: onSaved },
    );
  }

  return (
    <>
      <ErrorBanner error={error ?? codes.error} />
      {conflictOf(save.error) && <ConflictBanner />}
      {isLoading || codes.isLoading ? (
        <p>読み込み中...</p>
      ) : (
        loaded &&
        !patientMismatch && (
          <OralExamForm
            book={codes.data}
            initialValues={loaded.snapshot}
            defaultDeciduous={defaultDeciduous}
            baseline={loaded.snapshot.teeth}
            onSubmit={handleSubmit}
            onCancel={onCancel}
            submitting={save.isPending}
            submitError={conflictOf(save.error) ? undefined : save.error}
            submitLabel="更新"
          />
        )
      )}
    </>
  );
}
