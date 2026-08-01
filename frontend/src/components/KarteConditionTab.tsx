import { useState } from "react";
import { FhirError } from "../api/fhirClient";
import {
  useCondition,
  useConditionSearch,
  useCreateCondition,
  useUpdateCondition,
} from "../api/queries";
import {
  buildCondition,
  parseConditionForm,
  type ConditionFormValues,
} from "../fhir/conditionHelpers";
import { isPatientMismatch } from "../fhir/patientHelpers";
import { ConditionForm } from "./ConditionForm";
import { ConditionTable } from "./ConditionTable";
import { ErrorBanner } from "./ErrorBanner";
import { Pagination } from "./Pagination";

// カルテ画面の「病名」タブ。一覧・登録・編集・削除を左ペイン内で完結させる。

type Mode = { kind: "list" } | { kind: "create" } | { kind: "edit"; conditionId: string };

export function KarteConditionTab({ patientId }: { patientId: string }) {
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [offset, setOffset] = useState(0);

  const { bundle, total, count, hasPrevious, hasNext, isLoading, error } = useConditionSearch(
    patientId,
    offset,
  );
  const conditions =
    bundle?.entry?.map((e) => e.resource).filter((r): r is fhir4.Condition => Boolean(r)) ?? [];

  const backToList = () => setMode({ kind: "list" });

  if (mode.kind !== "list") {
    return (
      <div className="karte-tabpanel">
        <div className="karte-tabpanel__header">
          <h3>{mode.kind === "create" ? "病名登録" : "病名編集"}</h3>
          <button type="button" onClick={backToList}>
            ← 一覧に戻る
          </button>
        </div>
        {mode.kind === "create" ? (
          <CreateForm patientId={patientId} onSaved={backToList} />
        ) : (
          <EditForm
            patientId={patientId}
            conditionId={mode.conditionId}
            onSaved={backToList}
          />
        )}
      </div>
    );
  }

  return (
    <div className="karte-tabpanel">
      <div className="karte-tabpanel__header">
        <h3>病名</h3>
        <button type="button" onClick={() => setMode({ kind: "create" })}>
          新規登録
        </button>
      </div>

      <ErrorBanner error={error} />

      {isLoading ? (
        <p>読み込み中...</p>
      ) : (
        <>
          <ConditionTable
            conditions={conditions}
            patientId={patientId}
            onEdit={(conditionId) => setMode({ kind: "edit", conditionId })}
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
  const createCondition = useCreateCondition();

  function handleSubmit(values: ConditionFormValues) {
    createCondition.mutate(buildCondition(values, patientId), { onSuccess: onSaved });
  }

  return (
    <ConditionForm
      onSubmit={handleSubmit}
      submitting={createCondition.isPending}
      submitError={createCondition.error}
    />
  );
}

function EditForm({
  patientId,
  conditionId,
  onSaved,
}: {
  patientId: string;
  conditionId: string;
  onSaved: () => void;
}) {
  const { data: result, isLoading, error: loadError } = useCondition(conditionId);
  const updateCondition = useUpdateCondition();
  const [conflict, setConflict] = useState(false);

  const condition = result?.data;
  // 別患者の病名を更新すると subject が書き換わり、病名が付け替わってしまう。
  const patientMismatch = isPatientMismatch(patientId, condition?.subject);
  const error =
    loadError ?? (patientMismatch ? new Error("指定された病名は別の患者のものです。") : undefined);

  function handleSubmit(values: ConditionFormValues) {
    if (!result?.etag || patientMismatch) return;
    setConflict(false);
    updateCondition.mutate(
      { condition: buildCondition(values, patientId, conditionId), etag: result.etag },
      {
        onSuccess: onSaved,
        onError: (err) => {
          if (err instanceof FhirError && err.status === 412) {
            setConflict(true);
          }
        },
      },
    );
  }

  return (
    <>
      <ErrorBanner error={error} />

      {conflict && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">
            この病名は他の操作によって更新されています。画面を再読込してから再度編集してください。
          </p>
        </div>
      )}

      {isLoading ? (
        <p>読み込み中...</p>
      ) : (
        condition &&
        !patientMismatch && (
          <ConditionForm
            initialValues={parseConditionForm(condition)}
            onSubmit={handleSubmit}
            submitting={updateCondition.isPending}
            submitError={conflict ? undefined : updateCondition.error}
            submitLabel="更新"
          />
        )
      )}
    </>
  );
}
