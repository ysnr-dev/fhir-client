import { useEffect, useState } from "react";
import { FhirError } from "../api/fhirClient";
import { useCurrentPractitioner } from "../api/authQueries";
import { usePatientCautions } from "../api/masterQueries";
import { useCreateFlag, useFlag, useFlagSearch, useUpdateFlag } from "../api/queries";
import type { PatientCaution } from "../api/masterClient";
import { buildFlag, parseFlagForm, type FlagFormValues } from "../fhir/flagHelpers";
import { isPatientMismatch } from "../fhir/patientHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { FlagDetailPanel } from "./FlagDetailPanel";
import { FlagForm } from "./FlagForm";
import { FlagTable } from "./FlagTable";
import { Pagination } from "./Pagination";

/**
 * カルテ画面の「プロファイル」タブ。時系列ではなく、患者の「現在の状態」を
 * 区画ごとに並べて読む。今は注意の区画だけで、身体(血液型・妊娠)・感染症・
 * 生活などの区画を後から足す前提の構造にしてある。
 *
 * URL の view は区画ごとの接頭辞つき("caution:<flagId>")。後から足す区画が
 * 別の接頭辞を使えるようにして、ID の取り違えを防ぐ。
 */

const CAUTION_VIEW_PREFIX = "caution:";

type Mode =
  | { kind: "list" }
  | { kind: "detail"; flagId: string }
  | { kind: "create" }
  | { kind: "edit"; flagId: string };

type FormMode = Extract<Mode, { kind: "create" } | { kind: "edit" }> | null;

const MODE_TITLES: Record<Mode["kind"], string> = {
  list: "プロファイル",
  detail: "注意の詳細",
  create: "注意の登録",
  edit: "注意の編集",
};

interface KarteProfileTabProps {
  patientId: string;
  /** URL から渡される表示対象。空なら区画の一覧。 */
  view: string;
  onViewChange: (view: string | null) => void;
}

export function KarteProfileTab({ patientId, view, onViewChange }: KarteProfileTabProps) {
  const [form, setForm] = useState<FormMode>(null);

  // 戻る・進むで表示対象が変わったら、開いていたフォームは畳む。
  useEffect(() => setForm(null), [view]);

  const viewedFlagId = view.startsWith(CAUTION_VIEW_PREFIX)
    ? view.slice(CAUTION_VIEW_PREFIX.length)
    : "";
  const mode: Mode = form ?? (viewedFlagId ? { kind: "detail", flagId: viewedFlagId } : { kind: "list" });

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
              <button type="button" onClick={() => setForm({ kind: "edit", flagId: mode.flagId })}>
                編集
              </button>
            )}
            <button type="button" onClick={backToList}>
              ← 一覧に戻る
            </button>
          </div>
        </div>
        {mode.kind === "detail" ? (
          <FlagDetailPanel patientId={patientId} flagId={mode.flagId} onEnded={backToList} />
        ) : mode.kind === "create" ? (
          <CreateForm patientId={patientId} onSaved={backToList} />
        ) : (
          <EditForm patientId={patientId} flagId={mode.flagId} onSaved={backToList} />
        )}
      </div>
    );
  }

  return (
    <div className="karte-tabpanel karte-profile">
      <CautionSection
        patientId={patientId}
        onView={(flagId) => onViewChange(`${CAUTION_VIEW_PREFIX}${flagId}`)}
        onCreate={() => setForm({ kind: "create" })}
        onEdit={(flagId) => setForm({ kind: "edit", flagId })}
      />
    </div>
  );
}

interface CautionSectionProps {
  patientId: string;
  onView: (flagId: string) => void;
  onCreate: () => void;
  onEdit: (flagId: string) => void;
}

// 注意の区画。既定は有効なものだけを出し、終了したものは選んだときだけ足す。
function CautionSection({ patientId, onView, onCreate, onEdit }: CautionSectionProps) {
  const [offset, setOffset] = useState(0);
  const [activeOnly, setActiveOnly] = useState(true);
  const cautions = usePatientCautions();

  const { bundle, total, count, hasPrevious, hasNext, isLoading, error } = useFlagSearch(
    patientId,
    offset,
    activeOnly,
  );
  const flags =
    bundle?.entry?.map((e) => e.resource).filter((r): r is fhir4.Flag => Boolean(r)) ?? [];
  const cautionsByCode = new Map<string, PatientCaution>(
    (cautions.data?.items ?? []).map((c) => [c.code, c]),
  );

  function handleActiveOnlyChange(next: boolean) {
    setActiveOnly(next);
    setOffset(0);
  }

  return (
    <section className="karte-profile__section">
      <div className="karte-tabpanel__header">
        <h3>診療上の注意</h3>
        <div className="karte-tabpanel__actions">
          <label className="profile-tab__toggle">
            <input
              type="checkbox"
              checked={!activeOnly}
              onChange={(e) => handleActiveOnlyChange(!e.target.checked)}
            />
            終了したものも表示
          </label>
          <button type="button" onClick={onCreate}>
            新規登録
          </button>
        </div>
      </div>

      <ErrorBanner error={error ?? cautions.error} />

      {isLoading ? (
        <p>読み込み中...</p>
      ) : (
        <>
          <FlagTable
            flags={flags}
            cautionsByCode={cautionsByCode}
            onView={onView}
            onEdit={onEdit}
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
    </section>
  );
}

function CreateForm({ patientId, onSaved }: { patientId: string; onSaved: () => void }) {
  const createFlag = useCreateFlag();
  const cautions = usePatientCautions();
  const { practitionerId } = useCurrentPractitioner();

  function handleSubmit(values: FlagFormValues) {
    createFlag.mutate(
      buildFlag(values, patientId, cautions.data?.items ?? [], practitionerId),
      { onSuccess: onSaved },
    );
  }

  return (
    <FlagForm
      onSubmit={handleSubmit}
      submitting={createFlag.isPending}
      submitError={createFlag.error}
    />
  );
}

function EditForm({
  patientId,
  flagId,
  onSaved,
}: {
  patientId: string;
  flagId: string;
  onSaved: () => void;
}) {
  const { data: result, isLoading, error: loadError } = useFlag(flagId);
  const updateFlag = useUpdateFlag();
  const cautions = usePatientCautions();
  const { practitionerId } = useCurrentPractitioner();
  const [conflict, setConflict] = useState(false);

  const flag = result?.data;
  // 別患者の注意を更新すると subject が書き換わり、付け替わってしまう。
  const patientMismatch = isPatientMismatch(patientId, flag?.subject);
  const error =
    loadError ?? (patientMismatch ? new Error("指定された注意は別の患者のものです。") : undefined);

  function handleSubmit(values: FlagFormValues) {
    if (!result?.etag || patientMismatch) return;
    setConflict(false);
    updateFlag.mutate(
      {
        flag: buildFlag(values, patientId, cautions.data?.items ?? [], practitionerId, flagId),
        etag: result.etag,
      },
      {
        onSuccess: onSaved,
        onError: (err) => {
          if (err instanceof FhirError && err.status === 412) setConflict(true);
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
            この注意は他の操作によって更新されています。画面を再読込してから再度編集してください。
          </p>
        </div>
      )}

      {isLoading ? (
        <p>読み込み中...</p>
      ) : (
        flag &&
        !patientMismatch && (
          <FlagForm
            initialValues={parseFlagForm(flag)}
            onSubmit={handleSubmit}
            submitting={updateFlag.isPending}
            submitError={conflict ? undefined : updateFlag.error}
            submitLabel="更新"
            editing
          />
        )
      )}
    </>
  );
}
