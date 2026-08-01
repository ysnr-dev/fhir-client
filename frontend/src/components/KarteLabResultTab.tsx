import { useState } from "react";
import { useCreateLabResult, useLabResultSearch, useUpdateLabResult } from "../api/queries";
import {
  buildLabResultBundle,
  buildLabResultUpdateBundle,
  specimenRefsFrom,
  type LabResultFormValues,
} from "../fhir/labResultHelpers";
import { useLabResultInitialValues } from "../hooks/useLabResultInitialValues";
import { ErrorBanner } from "./ErrorBanner";
import { LabResultForm } from "./LabResultForm";
import { LabResultTable } from "./LabResultTable";
import { Pagination } from "./Pagination";

// カルテ画面の「検査結果」タブ。一覧・登録・編集・削除を左ペイン内で完結させる。

type Mode = { kind: "list" } | { kind: "create" } | { kind: "edit"; reportId: string };

export function KarteLabResultTab({ patientId }: { patientId: string }) {
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [offset, setOffset] = useState(0);

  const { bundle, total, count, hasPrevious, hasNext, isLoading, error } = useLabResultSearch(
    patientId,
    offset,
  );
  const reports =
    bundle?.entry?.map((e) => e.resource).filter((r): r is fhir4.DiagnosticReport => Boolean(r)) ??
    [];

  const backToList = () => setMode({ kind: "list" });

  if (mode.kind !== "list") {
    return (
      <div className="karte-tabpanel">
        <div className="karte-tabpanel__header">
          <h3>{mode.kind === "create" ? "検査結果登録" : "検査結果編集"}</h3>
          <button type="button" onClick={backToList}>
            ← 一覧に戻る
          </button>
        </div>
        {mode.kind === "create" ? (
          <CreateForm patientId={patientId} onSaved={backToList} />
        ) : (
          <EditForm patientId={patientId} reportId={mode.reportId} onSaved={backToList} />
        )}
      </div>
    );
  }

  return (
    <div className="karte-tabpanel">
      <div className="karte-tabpanel__header">
        <h3>検査結果</h3>
        <button type="button" onClick={() => setMode({ kind: "create" })}>
          新規登録
        </button>
      </div>

      <ErrorBanner error={error} />

      {isLoading ? (
        <p>読み込み中...</p>
      ) : (
        <>
          <LabResultTable
            reports={reports}
            patientId={patientId}
            onEdit={(reportId) => setMode({ kind: "edit", reportId })}
          />
          <Pagination
            offset={offset}
            count={count}
            total={total}
            hasPrevious={hasPrevious}
            hasNext={hasNext}
            onPrevious={() => setOffset((o) => Math.max(0, o - count))}
            onNext={() => setOffset((o) => o + count)}
          />
        </>
      )}
    </div>
  );
}

function CreateForm({ patientId, onSaved }: { patientId: string; onSaved: () => void }) {
  const createLabResult = useCreateLabResult();

  function handleSubmit(values: LabResultFormValues) {
    createLabResult.mutate(buildLabResultBundle(values, patientId), { onSuccess: onSaved });
  }

  return (
    <LabResultForm
      onSubmit={handleSubmit}
      submitting={createLabResult.isPending}
      submitError={createLabResult.error}
    />
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
          />
        )
      )}
    </>
  );
}
