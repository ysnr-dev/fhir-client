import { useEffect, useMemo, useState } from "react";
import {
  useCreateLabResult,
  useDeleteLabResult,
  useLabOrderCandidates,
  useLabResultEntries,
  useUpdateLabResult,
} from "../api/queries";
import {
  buildDoLabResultForm,
  buildLabResultBundle,
  buildLabResultUpdateBundle,
  emptyLabResultForm,
  specimenRefsFrom,
  type LabResultFormValues,
} from "../fhir/labResultHelpers";
import { useLabResultInitialValues } from "../hooks/useLabResultInitialValues";
import { useOrderContext } from "../hooks/useOrderContext";
import { ErrorBanner } from "./ErrorBanner";
import { LabResultDetailPanel } from "./LabResultDetailPanel";
import { LabResultForm } from "./LabResultForm";
import { SpecimenDateList } from "./SpecimenDateList";

// カルテ画面の「検査結果」タブ。カルテタブの診療日パネルと同様に、左端のペインに
// 検体採取日を新しい順で並べ、その右に選択した検査結果の内容を表示する。
// 登録・編集・削除も内容表示から行う。時系列表示は「検査結果時系列」タブが担う。
//
// 表示対象は URL(view パラメータ)で表す。登録・編集は入力途中の内容を URL では
// 復元できないので、このコンポーネント内の状態に留める。

type FormMode = { kind: "create"; sourceReportId?: string } | { kind: "edit"; reportId: string };

function formTitle(form: FormMode) {
  if (form.kind === "edit") return "検査結果編集";
  return form.sourceReportId ? "検査結果登録(DO)" : "検査結果登録";
}

interface KarteLabResultTabProps {
  patientId: string;
  /** URL から渡される表示対象の検査結果 ID。空なら最新の検査結果。 */
  view: string;
  onViewChange: (view: string | null) => void;
}

export function KarteLabResultTab({ patientId, view, onViewChange }: KarteLabResultTabProps) {
  const [form, setForm] = useState<FormMode | null>(null);

  // 戻る・進むで表示対象が変わったら、開いていたフォームは畳む。
  useEffect(() => setForm(null), [view]);

  const { entries, isLoading, error } = useLabResultEntries(patientId);
  const deleteLabResult = useDeleteLabResult();

  // view が指す検査結果が見つからないとき(削除済み・古いリンク)は最新に落とす。
  const selected = entries.find((entry) => entry.id === view) ?? entries[0];

  function closeForm() {
    setForm(null);
  }

  function handleCreated() {
    // 登録した検査結果(たいてい採取日が最新)が選ばれるよう、最新表示に戻す。
    setForm(null);
    onViewChange(null);
  }

  function handleDelete() {
    if (!selected) return;
    if (!window.confirm("この検査結果を削除します。よろしいですか?")) return;
    deleteLabResult.mutate(selected.id, { onSuccess: () => onViewChange(null) });
  }

  if (form) {
    return (
      <div className="karte-tabpanel">
        <div className="karte-tabpanel__header">
          <h3>{formTitle(form)}</h3>
          <div className="karte-tabpanel__actions">
            <button type="button" onClick={closeForm}>
              ← 内容表示に戻る
            </button>
          </div>
        </div>
        {form.kind === "create" ? (
          <CreateForm
            patientId={patientId}
            sourceReportId={form.sourceReportId}
            onSaved={handleCreated}
          />
        ) : (
          <EditForm patientId={patientId} reportId={form.reportId} onSaved={closeForm} />
        )}
      </div>
    );
  }

  return (
    <div className="karte-tabpanel karte-lab">
      <SpecimenDateList
        entries={entries}
        selectedId={selected?.id}
        isLoading={isLoading}
        onSelect={(reportId) => onViewChange(reportId)}
      />

      <div className="karte-lab__content">
        <div className="karte-tabpanel__header">
          <h3>検査結果内容</h3>
          <div className="karte-tabpanel__actions">
            <button type="button" onClick={() => setForm({ kind: "create" })}>
              新規登録
            </button>
            <button
              type="button"
              disabled={!selected}
              onClick={() =>
                selected && setForm({ kind: "create", sourceReportId: selected.id })
              }
            >
              DO
            </button>
            <button
              type="button"
              disabled={!selected}
              onClick={() => selected && setForm({ kind: "edit", reportId: selected.id })}
            >
              編集
            </button>
            <button
              type="button"
              disabled={!selected || deleteLabResult.isPending}
              onClick={handleDelete}
            >
              削除
            </button>
          </div>
        </div>

        <ErrorBanner error={error} />
        <ErrorBanner error={deleteLabResult.error} />

        {isLoading ? (
          <p>読み込み中...</p>
        ) : selected ? (
          <LabResultDetailPanel reportId={selected.id} />
        ) : (
          <p className="patient-table__empty">登録されている検査結果がありません。</p>
        )}
      </div>
    </div>
  );
}

function CreateForm({
  patientId,
  sourceReportId,
  onSaved,
}: {
  patientId: string;
  /** DO(検査項目のみ流用して新規登録)する元の DiagnosticReport id。 */
  sourceReportId?: string;
  onSaved: () => void;
}) {
  const createLabResult = useCreateLabResult();
  const source = useLabResultInitialValues(sourceReportId, patientId);
  const orders = useLabOrderCandidates(patientId);
  const requester = useOrderContext();

  // 診療科の既定はヘッダーで選んでいる依頼科。DO でも元の検査結果の科ではなく、
  // いま入力している科を初期値にする。
  const initialValues = useMemo(
    () => ({
      ...(source.initialValues ? buildDoLabResultForm(source.initialValues) : emptyLabResultForm()),
      departmentId: requester.departmentId,
      departmentName: requester.departmentName,
    }),
    [source.initialValues, requester.departmentId, requester.departmentName],
  );

  function handleSubmit(values: LabResultFormValues) {
    createLabResult.mutate(buildLabResultBundle(values, patientId), { onSuccess: onSaved });
  }

  return (
    <>
      <ErrorBanner error={source.error} />
      <ErrorBanner error={orders.error} />

      {/* DO 元の読み込み完了を待ってからフォームを描画する(初期値は初回描画時のみ反映される)。 */}
      {sourceReportId && !source.ready ? (
        <p>読み込み中...</p>
      ) : (
        <LabResultForm
          initialValues={initialValues}
          onSubmit={handleSubmit}
          submitting={createLabResult.isPending}
          submitError={createLabResult.error}
          orderCandidates={orders.candidates}
          orderCandidatesLoading={orders.isLoading}
        />
      )}
    </>
  );
}

function EditForm({
  patientId,
  reportId,
  onSaved,
}: {
  patientId: string;
  reportId: string;
  onSaved: () => void;
}) {
  const updateLabResult = useUpdateLabResult();
  const { report, observations, specimens, initialValues, ready, patientMismatch, error } =
    useLabResultInitialValues(reportId, patientId);
  // 編集中の検査結果が紐付けているオーダーは、候補から落とさない。
  const orders = useLabOrderCandidates(patientId, reportId);

  function handleSubmit(values: LabResultFormValues) {
    // 別患者の検査結果を更新すると subject が書き換わり、検査結果が付け替わってしまう。
    if (!report || patientMismatch) return;
    const originalIds = observations.map((o) => o.id).filter((id): id is string => Boolean(id));
    updateLabResult.mutate(
      buildLabResultUpdateBundle(
        values,
        patientId,
        reportId,
        originalIds,
        specimenRefsFrom(specimens),
      ),
      { onSuccess: onSaved },
    );
  }

  return (
    <>
      <ErrorBanner error={error} />
      <ErrorBanner error={orders.error} />

      {!ready ? (
        <p>読み込み中...</p>
      ) : (
        report &&
        initialValues && (
          <LabResultForm
            initialValues={initialValues}
            onSubmit={handleSubmit}
            submitting={updateLabResult.isPending}
            submitError={updateLabResult.error}
            submitLabel="更新"
            orderCandidates={orders.candidates}
            orderCandidatesLoading={orders.isLoading}
          />
        )
      )}
    </>
  );
}
