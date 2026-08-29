import { useEffect, useMemo, useState } from "react";
import {
  useCreatePathoResult,
  useDeletePathoResult,
  usePathoOrderCandidates,
  usePathoResultEntries,
  useUpdatePathoResult,
} from "../api/queries";
import {
  buildPathoResultBundle,
  buildPathoResultUpdateBundle,
  emptyPathoResultForm,
  type PathoResultFormValues,
} from "../fhir/pathoResultHelpers";
import { useDefaultOrderSetting } from "../hooks/useDefaultOrderSetting";
import { usePathoResultInitialValues } from "../hooks/usePathoResultInitialValues";
import { useOrderContext } from "../hooks/useOrderContext";
import { ErrorBanner } from "./ErrorBanner";
import { PathoResultDetailPanel } from "./PathoResultDetailPanel";
import { PathoResultForm } from "./PathoResultForm";
import { SpecimenDateList } from "./SpecimenDateList";

// カルテ画面の「病理検査」タブ(検査結果配下)。「細菌検査」タブと同じ構成で、左端の
// ペインに報告日を新しい順で並べ、その右に選択した病理レポートの内容を表示する。
// 登録・編集・削除も内容表示から行う(部門一覧からも同じフォームで書ける)。
//
// 表示対象は URL(view パラメータ)で表す。登録・編集は入力途中の内容を URL では
// 復元できないので、このコンポーネント内の状態に留める。

type FormMode = { kind: "create" } | { kind: "edit"; reportId: string };

interface KartePathoResultTabProps {
  patientId: string;
  /** URL から渡される表示対象の病理レポート ID。空なら最新のレポート。 */
  view: string;
  onViewChange: (view: string | null) => void;
}

export function KartePathoResultTab({ patientId, view, onViewChange }: KartePathoResultTabProps) {
  const [form, setForm] = useState<FormMode | null>(null);

  // 戻る・進むで表示対象が変わったら、開いていたフォームは畳む。
  useEffect(() => setForm(null), [view]);

  const { entries, isLoading, error } = usePathoResultEntries(patientId);
  const deletePathoResult = useDeletePathoResult();

  // view が指すレポートが見つからないとき(削除済み・古いリンク)は最新に落とす。
  const selected = entries.find((entry) => entry.id === view) ?? entries[0];

  function closeForm() {
    setForm(null);
  }

  function handleCreated() {
    // 登録したレポート(たいてい報告日が最新)が選ばれるよう、最新表示に戻す。
    setForm(null);
    onViewChange(null);
  }

  function handleDelete() {
    if (!selected) return;
    if (!window.confirm("この病理レポートを削除します。よろしいですか?")) return;
    deletePathoResult.mutate(selected.id, { onSuccess: () => onViewChange(null) });
  }

  if (form) {
    return (
      <div className="karte-tabpanel">
        <div className="karte-tabpanel__header">
          <h3>{form.kind === "edit" ? "病理レポート編集" : "病理レポート登録"}</h3>
          <div className="karte-tabpanel__actions">
            <button type="button" onClick={closeForm}>
              ← 内容表示に戻る
            </button>
          </div>
        </div>
        {form.kind === "create" ? (
          <PathoResultCreateForm patientId={patientId} onSaved={handleCreated} />
        ) : (
          <PathoResultEditForm
            patientId={patientId}
            reportId={form.reportId}
            onSaved={closeForm}
          />
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
          <h3>病理診断レポート</h3>
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
              disabled={!selected || deletePathoResult.isPending}
              onClick={handleDelete}
            >
              削除
            </button>
          </div>
        </div>

        <ErrorBanner error={error} />
        <ErrorBanner error={deletePathoResult.error} />

        {isLoading ? (
          <p>読み込み中...</p>
        ) : selected ? (
          <PathoResultDetailPanel reportId={selected.id} />
        ) : (
          <p className="patient-table__empty">登録されている病理レポートがありません。</p>
        )}
      </div>
    </div>
  );
}

/** 病理レポートの新規登録フォーム。カルテタブと部門一覧の双方から使う。 */
export function PathoResultCreateForm({
  patientId,
  onSaved,
  fixedOrderId,
}: {
  patientId: string;
  onSaved: () => void;
  /** 部門一覧の行から開いたときの紐付け先オーダー。 */
  fixedOrderId?: string;
}) {
  const createPathoResult = useCreatePathoResult();
  const orders = usePathoOrderCandidates(patientId);
  const requester = useOrderContext();
  // 入院中なら入外区分を「入院」で開く(細菌検査結果と同じ)。
  const defaultSetting = useDefaultOrderSetting(patientId);

  // 診療科の既定はヘッダーで選んでいる依頼科(細菌検査結果と同じ)。
  const initialValues = useMemo(
    () => ({
      ...emptyPathoResultForm(defaultSetting.setting),
      departmentId: requester.departmentId,
      departmentName: requester.departmentName,
      orderId: fixedOrderId ?? "",
    }),
    [requester.departmentId, requester.departmentName, defaultSetting.setting, fixedOrderId],
  );

  function handleSubmit(values: PathoResultFormValues) {
    createPathoResult.mutate(buildPathoResultBundle(values, patientId), { onSuccess: onSaved });
  }

  return (
    <>
      <ErrorBanner error={orders.error} />

      {/* 入院かどうかの読み込み完了を待ってからフォームを描画する
          (初期値は初回描画時のみ反映される)。 */}
      {!defaultSetting.ready ? (
        <p>読み込み中...</p>
      ) : (
        <PathoResultForm
          initialValues={initialValues}
          onSubmit={handleSubmit}
          submitting={createPathoResult.isPending}
          submitError={createPathoResult.error}
          orderCandidates={orders.candidates}
          orderCandidatesLoading={orders.isLoading}
          fixedOrderId={fixedOrderId}
        />
      )}
    </>
  );
}

/** 病理レポートの編集フォーム。カルテタブと部門一覧の双方から使う。 */
export function PathoResultEditForm({
  patientId,
  reportId,
  onSaved,
}: {
  patientId: string;
  reportId: string;
  onSaved: () => void;
}) {
  const updatePathoResult = useUpdatePathoResult();
  const { report, observations, specimens, initialValues, ready, patientMismatch, error } =
    usePathoResultInitialValues(reportId, patientId);
  // 編集中のレポートが紐付けているオーダーは、候補から落とさない。
  const orders = usePathoOrderCandidates(patientId, reportId);

  function handleSubmit(values: PathoResultFormValues) {
    // 別患者のレポートを更新すると subject が書き換わり、レポートが付け替わってしまう。
    if (!report || patientMismatch) return;
    const originalObservationIds = observations
      .map((o) => o.id)
      .filter((id): id is string => Boolean(id));
    const originalSpecimenIds = specimens
      .map((s) => s.id)
      .filter((id): id is string => Boolean(id));
    updatePathoResult.mutate(
      buildPathoResultUpdateBundle(
        values,
        patientId,
        reportId,
        originalObservationIds,
        originalSpecimenIds,
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
          <PathoResultForm
            initialValues={initialValues}
            onSubmit={handleSubmit}
            submitting={updatePathoResult.isPending}
            submitError={updatePathoResult.error}
            submitLabel="更新"
            orderCandidates={orders.candidates}
            orderCandidatesLoading={orders.isLoading}
          />
        )
      )}
    </>
  );
}
