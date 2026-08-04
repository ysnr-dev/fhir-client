import { useEffect, useState } from "react";
import { FhirError } from "../api/fhirClient";
import { useAllergy, useAllergySearch, useCreateAllergy, useUpdateAllergy } from "../api/queries";
import { buildAllergy, parseAllergyForm, type AllergyFormValues } from "../fhir/allergyHelpers";
import { isPatientMismatch } from "../fhir/patientHelpers";
import { AllergyDetailPanel } from "./AllergyDetailPanel";
import { AllergyForm } from "./AllergyForm";
import { AllergyTable } from "./AllergyTable";
import { ErrorBanner } from "./ErrorBanner";
import { Pagination } from "./Pagination";

// カルテ画面の「アレルギー」タブ。一覧・表示・登録・編集・削除を左ペイン内で完結させる。
//
// 一覧と詳細は URL(view パラメータ)で表す。登録・編集は入力途中の内容を URL では
// 復元できないので、このコンポーネント内の状態に留める。

type Mode =
  | { kind: "list" }
  | { kind: "detail"; allergyId: string }
  | { kind: "create" }
  | { kind: "edit"; allergyId: string };

type FormMode = Extract<Mode, { kind: "create" } | { kind: "edit" }> | null;

const MODE_TITLES: Record<Mode["kind"], string> = {
  list: "アレルギー",
  detail: "アレルギー詳細",
  create: "アレルギー登録",
  edit: "アレルギー編集",
};

interface KarteAllergyTabProps {
  patientId: string;
  /** URL から渡される表示対象のアレルギー ID。空なら一覧。 */
  view: string;
  onViewChange: (view: string | null) => void;
}

export function KarteAllergyTab({ patientId, view, onViewChange }: KarteAllergyTabProps) {
  const [form, setForm] = useState<FormMode>(null);
  const [offset, setOffset] = useState(0);

  // 戻る・進むで表示対象が変わったら、開いていたフォームは畳む。
  useEffect(() => setForm(null), [view]);

  const mode: Mode = form ?? (view ? { kind: "detail", allergyId: view } : { kind: "list" });

  const { bundle, total, count, hasPrevious, hasNext, isLoading, error } = useAllergySearch(
    patientId,
    offset,
  );
  const allergies =
    bundle?.entry?.map((e) => e.resource).filter((r): r is fhir4.AllergyIntolerance => Boolean(r)) ??
    [];

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
                onClick={() => setForm({ kind: "edit", allergyId: mode.allergyId })}
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
          <AllergyDetailPanel patientId={patientId} allergyId={mode.allergyId} />
        ) : mode.kind === "create" ? (
          <CreateForm patientId={patientId} onSaved={backToList} />
        ) : (
          <EditForm patientId={patientId} allergyId={mode.allergyId} onSaved={backToList} />
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
          <AllergyTable
            allergies={allergies}
            patientId={patientId}
            onView={(allergyId) => onViewChange(allergyId)}
            onEdit={(allergyId) => setForm({ kind: "edit", allergyId })}
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
  const createAllergy = useCreateAllergy();

  function handleSubmit(values: AllergyFormValues) {
    createAllergy.mutate(buildAllergy(values, patientId), { onSuccess: onSaved });
  }

  return (
    <AllergyForm
      onSubmit={handleSubmit}
      submitting={createAllergy.isPending}
      submitError={createAllergy.error}
    />
  );
}

function EditForm({
  patientId,
  allergyId,
  onSaved,
}: {
  patientId: string;
  allergyId: string;
  onSaved: () => void;
}) {
  const { data: result, isLoading, error: loadError } = useAllergy(allergyId);
  const updateAllergy = useUpdateAllergy();
  const [conflict, setConflict] = useState(false);

  const allergy = result?.data;
  // 別患者のアレルギーを更新すると patient が書き換わり、付け替わってしまう。
  const patientMismatch = isPatientMismatch(patientId, allergy?.patient);
  const error =
    loadError ??
    (patientMismatch ? new Error("指定されたアレルギーは別の患者のものです。") : undefined);

  function handleSubmit(values: AllergyFormValues) {
    if (!result?.etag || patientMismatch) return;
    setConflict(false);
    updateAllergy.mutate(
      { allergy: buildAllergy(values, patientId, allergyId), etag: result.etag },
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
            このアレルギーは他の操作によって更新されています。画面を再読込してから再度編集してください。
          </p>
        </div>
      )}

      {isLoading ? (
        <p>読み込み中...</p>
      ) : (
        allergy &&
        !patientMismatch && (
          <AllergyForm
            initialValues={parseAllergyForm(allergy)}
            onSubmit={handleSubmit}
            submitting={updateAllergy.isPending}
            submitError={conflict ? undefined : updateAllergy.error}
            submitLabel="更新"
          />
        )
      )}
    </>
  );
}
