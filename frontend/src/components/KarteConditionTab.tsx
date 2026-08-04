import { useEffect, useState } from "react";
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
import { useProblemNumbering } from "../hooks/useProblemNumbering";
import { isPatientMismatch } from "../fhir/patientHelpers";
import { ConditionDetailPanel } from "./ConditionDetailPanel";
import { ConditionForm } from "./ConditionForm";
import { ConditionTable } from "./ConditionTable";
import { ErrorBanner } from "./ErrorBanner";
import { Pagination } from "./Pagination";

// カルテ画面の「病名」タブ。一覧・表示・登録・編集・削除を左ペイン内で完結させる。
//
// 一覧と詳細は URL(view パラメータ)で表す。登録・編集は入力途中の内容を URL では
// 復元できないので、このコンポーネント内の状態に留める。

type Mode =
  | { kind: "list" }
  | { kind: "detail"; conditionId: string }
  | { kind: "create" }
  | { kind: "edit"; conditionId: string };

type FormMode = Extract<Mode, { kind: "create" } | { kind: "edit" }> | null;

const MODE_TITLES: Record<Mode["kind"], string> = {
  list: "病名",
  detail: "病名詳細",
  create: "病名登録",
  edit: "病名編集",
};

interface KarteConditionTabProps {
  patientId: string;
  /** URL から渡される表示対象の病名 ID。空なら一覧。 */
  view: string;
  onViewChange: (view: string | null) => void;
}

export function KarteConditionTab({ patientId, view, onViewChange }: KarteConditionTabProps) {
  const [form, setForm] = useState<FormMode>(null);
  const [offset, setOffset] = useState(0);

  // 戻る・進むで表示対象が変わったら、開いていたフォームは畳む。
  useEffect(() => setForm(null), [view]);

  const mode: Mode = form ?? (view ? { kind: "detail", conditionId: view } : { kind: "list" });

  const { bundle, total, count, hasPrevious, hasNext, isLoading, error } = useConditionSearch(
    patientId,
    offset,
  );
  const conditions =
    bundle?.entry?.map((e) => e.resource).filter((r): r is fhir4.Condition => Boolean(r)) ?? [];

  function backToList() {
    setForm(null);
    onViewChange(null);
  }

  if (mode.kind !== "list") {
    return (
      <div className="karte-tabpanel">
        <div className="karte-tabpanel__header">
          <h3>{MODE_TITLES[mode.kind]}</h3>
          <div className="karte-tabpanel__actions">
            {mode.kind === "detail" && (
              <button
                type="button"
                onClick={() => setForm({ kind: "edit", conditionId: mode.conditionId })}
              >
                編集
              </button>
            )}
            <button type="button" onClick={backToList}>
              ← 一覧に戻る
            </button>
          </div>
        </div>
        {mode.kind === "detail" ? (
          <ConditionDetailPanel patientId={patientId} conditionId={mode.conditionId} />
        ) : mode.kind === "create" ? (
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
        <h3>{MODE_TITLES.list}</h3>
        <button type="button" onClick={() => setForm({ kind: "create" })}>
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
            onView={(conditionId) => onViewChange(conditionId)}
            onEdit={(conditionId) => setForm({ kind: "edit", conditionId })}
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
  const problemNumberFor = useProblemNumbering(patientId);

  function handleSubmit(values: ConditionFormValues) {
    createCondition.mutate(
      buildCondition(values, patientId, undefined, problemNumberFor(values)),
      { onSuccess: onSaved },
    );
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
  const problemNumberFor = useProblemNumbering(patientId);
  const [conflict, setConflict] = useState(false);

  const condition = result?.data;
  // 別患者の病名を更新すると subject が書き換わり、病名が付け替わってしまう。
  const patientMismatch = isPatientMismatch(patientId, condition?.subject);
  const error =
    loadError ?? (patientMismatch ? new Error("指定された病名は別の患者のものです。") : undefined);

  function handleSubmit(values: ConditionFormValues) {
    if (!result?.etag || patientMismatch || !condition) return;
    setConflict(false);
    updateCondition.mutate(
      {
        condition: buildCondition(
          values,
          patientId,
          conditionId,
          problemNumberFor(values, condition),
        ),
        etag: result.etag,
      },
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
