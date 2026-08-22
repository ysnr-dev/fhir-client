import { useEffect, useMemo, useState } from "react";
import {
  useCreateMicroResult,
  useDeleteMicroResult,
  useMicroOrderCandidates,
  useMicroResultEntries,
  useUpdateMicroResult,
} from "../api/queries";
import {
  buildMicroResultBundle,
  buildMicroResultUpdateBundle,
  emptyMicroResultForm,
  type MicroResultFormValues,
} from "../fhir/microResultHelpers";
import { useDefaultOrderSetting } from "../hooks/useDefaultOrderSetting";
import { useMicroResultInitialValues } from "../hooks/useMicroResultInitialValues";
import { useOrderContext } from "../hooks/useOrderContext";
import { ErrorBanner } from "./ErrorBanner";
import { MicroResultDetailPanel } from "./MicroResultDetailPanel";
import { MicroResultForm } from "./MicroResultForm";
import { SpecimenDateList } from "./SpecimenDateList";

// カルテ画面の「細菌検査」タブ(検査結果配下)。「検体検査」タブと同じ構成で、左端の
// ペインに検体採取日を新しい順で並べ、その右に選択した細菌検査結果の内容を表示する。
// 登録・編集・削除も内容表示から行う。細菌検査はレポート単位の内容表示が本体で
// 「項目×日付」の表にならないため、時系列表示は持たない。
//
// 表示対象は URL(view パラメータ)で表す。登録・編集は入力途中の内容を URL では
// 復元できないので、このコンポーネント内の状態に留める。

type FormMode = { kind: "create" } | { kind: "edit"; reportId: string };

interface KarteMicroResultTabProps {
  patientId: string;
  /** URL から渡される表示対象の細菌検査結果 ID。空なら最新の細菌検査結果。 */
  view: string;
  onViewChange: (view: string | null) => void;
}

export function KarteMicroResultTab({ patientId, view, onViewChange }: KarteMicroResultTabProps) {
  const [form, setForm] = useState<FormMode | null>(null);

  // 戻る・進むで表示対象が変わったら、開いていたフォームは畳む。
  useEffect(() => setForm(null), [view]);

  const { entries, isLoading, error } = useMicroResultEntries(patientId);
  const deleteMicroResult = useDeleteMicroResult();

  // view が指す結果が見つからないとき(削除済み・古いリンク)は最新に落とす。
  const selected = entries.find((entry) => entry.id === view) ?? entries[0];

  function closeForm() {
    setForm(null);
  }

  function handleCreated() {
    // 登録した結果(たいてい採取日が最新)が選ばれるよう、最新表示に戻す。
    setForm(null);
    onViewChange(null);
  }

  function handleDelete() {
    if (!selected) return;
    if (!window.confirm("この細菌検査結果を削除します。よろしいですか?")) return;
    deleteMicroResult.mutate(selected.id, { onSuccess: () => onViewChange(null) });
  }

  if (form) {
    return (
      <div className="karte-tabpanel">
        <div className="karte-tabpanel__header">
          <h3>{form.kind === "edit" ? "細菌検査結果編集" : "細菌検査結果登録"}</h3>
          <div className="karte-tabpanel__actions">
            <button type="button" onClick={closeForm}>
              ← 内容表示に戻る
            </button>
          </div>
        </div>
        {form.kind === "create" ? (
          <CreateForm patientId={patientId} onSaved={handleCreated} />
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
          <h3>細菌検査結果内容</h3>
          <div className="karte-tabpanel__actions">
            <button type="button" onClick={() => setForm({ kind: "create" })}>
              新規登録
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
              disabled={!selected || deleteMicroResult.isPending}
              onClick={handleDelete}
            >
              削除
            </button>
          </div>
        </div>

        <ErrorBanner error={error} />
        <ErrorBanner error={deleteMicroResult.error} />

        {isLoading ? (
          <p>読み込み中...</p>
        ) : selected ? (
          <MicroResultDetailPanel reportId={selected.id} />
        ) : (
          <p className="patient-table__empty">登録されている細菌検査結果がありません。</p>
        )}
      </div>
    </div>
  );
}

function CreateForm({ patientId, onSaved }: { patientId: string; onSaved: () => void }) {
  const createMicroResult = useCreateMicroResult();
  const orders = useMicroOrderCandidates(patientId);
  const requester = useOrderContext();
  // 入院中なら入外区分を「入院」で開く(検体検査結果と同じ)。
  const defaultSetting = useDefaultOrderSetting(patientId);

  // 診療科の既定はヘッダーで選んでいる依頼科(検体検査結果と同じ)。
  const initialValues = useMemo(
    () => ({
      ...emptyMicroResultForm(defaultSetting.setting),
      departmentId: requester.departmentId,
      departmentName: requester.departmentName,
    }),
    [requester.departmentId, requester.departmentName, defaultSetting.setting],
  );

  function handleSubmit(values: MicroResultFormValues) {
    createMicroResult.mutate(buildMicroResultBundle(values, patientId), { onSuccess: onSaved });
  }

  return (
    <>
      <ErrorBanner error={orders.error} />

      {/* 入院かどうかの読み込み完了を待ってからフォームを描画する
          (初期値は初回描画時のみ反映される)。 */}
      {!defaultSetting.ready ? (
        <p>読み込み中...</p>
      ) : (
        <MicroResultForm
          initialValues={initialValues}
          onSubmit={handleSubmit}
          submitting={createMicroResult.isPending}
          submitError={createMicroResult.error}
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
  const updateMicroResult = useUpdateMicroResult();
  const { report, observations, specimens, initialValues, ready, patientMismatch, error } =
    useMicroResultInitialValues(reportId, patientId);
  // 編集中の結果が紐付けているオーダーは、候補から落とさない。
  const orders = useMicroOrderCandidates(patientId, reportId);

  function handleSubmit(values: MicroResultFormValues) {
    // 別患者の結果を更新すると subject が書き換わり、結果が付け替わってしまう。
    if (!report || patientMismatch) return;
    const originalIds = observations.map((o) => o.id).filter((id): id is string => Boolean(id));
    updateMicroResult.mutate(
      buildMicroResultUpdateBundle(values, patientId, reportId, originalIds, specimens[0]?.id),
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
          <MicroResultForm
            initialValues={initialValues}
            onSubmit={handleSubmit}
            submitting={updateMicroResult.isPending}
            submitError={updateMicroResult.error}
            submitLabel="更新"
            orderCandidates={orders.candidates}
            orderCandidatesLoading={orders.isLoading}
          />
        )
      )}
    </>
  );
}
