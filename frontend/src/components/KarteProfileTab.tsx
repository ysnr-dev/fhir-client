import { useEffect, useState } from "react";
import { FhirError } from "../api/fhirClient";
import { useCurrentPractitioner } from "../api/authQueries";
import { usePatientCautions } from "../api/masterQueries";
import {
  useBloodType,
  useCreateFlag,
  useDeleteInfection,
  useFlag,
  useFlagSearch,
  useManualInfections,
  usePatient,
  usePregnancy,
  useSaveBloodType,
  useSaveInfection,
  useSavePregnancy,
  useUpdateFlag,
  useUpdatePatient,
} from "../api/queries";
import {
  buildInfectionObservation,
  parseInfectionForm,
  type InfectionFormValues,
} from "../fhir/infectionHelpers";
import { InfectionForm } from "./InfectionForm";
import { PatientInfectionSection } from "./PatientInfectionSection";
import {
  buildPregnancyObservations,
  parsePregnancyForm,
  summarizePregnancy,
  type PregnancyFormValues,
} from "../fhir/pregnancyHelpers";
import { PregnancyForm } from "./PregnancyForm";
import {
  buildBloodTypeObservations,
  parseBloodTypeForm,
  summarizeBloodType,
  type BloodTypeFormValues,
} from "../fhir/bloodTypeHelpers";
import { BloodTypeForm } from "./BloodTypeForm";
import { PatientBodySection } from "./PatientBodySection";
import type { PatientCaution } from "../api/masterClient";
import { buildFlag, parseFlagForm, type FlagFormValues } from "../fhir/flagHelpers";
import {
  buildPatient,
  isPatientMismatch,
  parsePatient,
  type PatientFormValues,
} from "../fhir/patientHelpers";
import { PatientForm } from "./PatientForm";
import { ErrorBanner } from "./ErrorBanner";
import { FlagDetailPanel } from "./FlagDetailPanel";
import { FlagForm } from "./FlagForm";
import { FlagTable } from "./FlagTable";
import { Pagination } from "./Pagination";
import { PatientBasicSection } from "./PatientBasicSection";

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
  | { kind: "edit"; flagId: string }
  | { kind: "edit-patient" }
  | { kind: "edit-blood-type" }
  | { kind: "edit-pregnancy" }
  | { kind: "create-infection" }
  | { kind: "edit-infection"; observationId: string };

// 入力途中のフォームは URL に載せない(復元しても入力内容は戻らないため)ので、
// 登録・編集はこのコンポーネントの状態で持つ(karteUrl.ts 冒頭の方針)。
type FormMode =
  | Extract<
      Mode,
      | { kind: "create" }
      | { kind: "edit" }
      | { kind: "edit-patient" }
      | { kind: "edit-blood-type" }
      | { kind: "edit-pregnancy" }
      | { kind: "create-infection" }
      | { kind: "edit-infection" }
    >
  | null;

const MODE_TITLES: Record<Mode["kind"], string> = {
  list: "プロファイル",
  detail: "注意の詳細",
  create: "注意の登録",
  edit: "注意の編集",
  "edit-patient": "患者情報の編集",
  "edit-blood-type": "血液型",
  "edit-pregnancy": "妊娠・授乳",
  "create-infection": "感染症の登録",
  "edit-infection": "感染症の編集",
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
        ) : mode.kind === "edit-patient" ? (
          <PatientEditForm patientId={patientId} onSaved={backToList} />
        ) : mode.kind === "edit-blood-type" ? (
          <BloodTypeEditForm patientId={patientId} onSaved={backToList} />
        ) : mode.kind === "edit-pregnancy" ? (
          <PregnancyEditForm patientId={patientId} onSaved={backToList} />
        ) : mode.kind === "create-infection" ? (
          <InfectionEditForm patientId={patientId} onSaved={backToList} />
        ) : mode.kind === "edit-infection" ? (
          <InfectionEditForm
            patientId={patientId}
            observationId={mode.observationId}
            onSaved={backToList}
          />
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
      <PatientBasicSection
        patientId={patientId}
        onEdit={() => setForm({ kind: "edit-patient" })}
      />
      <PatientBodySection
        patientId={patientId}
        onEditBloodType={() => setForm({ kind: "edit-blood-type" })}
        onEditPregnancy={() => setForm({ kind: "edit-pregnancy" })}
      />
      <PatientInfectionSection
        patientId={patientId}
        onAdd={() => setForm({ kind: "create-infection" })}
        onEdit={(observationId) => setForm({ kind: "edit-infection", observationId })}
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

/**
 * 患者情報の編集。患者編集画面へ遷移せずタブの中で開く(カルテを見ている
 * ところから離れずに連絡先やかかりつけ医を直せるようにするため)。
 * 楽観ロックと競合時の扱いは患者編集画面と同じ。
 */
function PatientEditForm({ patientId, onSaved }: { patientId: string; onSaved: () => void }) {
  const { data: result, isLoading, error: loadError } = usePatient(patientId);
  const updatePatient = useUpdatePatient();
  const [conflict, setConflict] = useState(false);

  function handleSubmit(values: PatientFormValues) {
    if (!result?.etag) return;
    setConflict(false);
    updatePatient.mutate(
      { patient: buildPatient(values, patientId), etag: result.etag },
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
      <ErrorBanner error={loadError} />

      {conflict && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">
            この患者情報は他の操作によって更新されています。画面を再読込してから再度編集してください。
          </p>
        </div>
      )}

      {isLoading ? (
        <p>読み込み中...</p>
      ) : (
        result && (
          <PatientForm
            initialValues={parsePatient(result.data)}
            onSubmit={handleSubmit}
            submitting={updatePatient.isPending}
            submitError={conflict ? undefined : updatePatient.error}
            submitLabel="更新"
          />
        )
      )}
    </>
  );
}

/**
 * 血液型の登録・編集。ABO と RhD は別リソースなので、保存は transaction で
 * まとめて送る(useSaveBloodType)。既に登録があればその id を引き継いで
 * 更新し、履歴を増やさない(「いつ確認したか」は確認日で持つ)。
 */
function BloodTypeEditForm({ patientId, onSaved }: { patientId: string; onSaved: () => void }) {
  const { observations, isLoading, error } = useBloodType(patientId);
  const saveBloodType = useSaveBloodType();

  const summary = summarizeBloodType(observations);

  function handleSubmit(values: BloodTypeFormValues) {
    saveBloodType.mutate(
      buildBloodTypeObservations(values, patientId, {
        aboId: summary?.aboId || undefined,
        rhdId: summary?.rhdId || undefined,
      }),
      { onSuccess: onSaved },
    );
  }

  return (
    <>
      <ErrorBanner error={error} />

      {isLoading ? (
        <p>読み込み中...</p>
      ) : (
        <BloodTypeForm
          initialValues={parseBloodTypeForm(observations)}
          onSubmit={handleSubmit}
          submitting={saveBloodType.isPending}
          submitError={saveBloodType.error}
        />
      )}
    </>
  );
}

/**
 * 妊娠・授乳の登録・編集。血液型と同じく、既に登録があればその id を
 * 引き継いで更新する(「いつ時点の状態か」は確認日で持つ)。
 */
function PregnancyEditForm({ patientId, onSaved }: { patientId: string; onSaved: () => void }) {
  const { observations, isLoading, error } = usePregnancy(patientId);
  const savePregnancy = useSavePregnancy();

  const summary = summarizePregnancy(observations);

  function handleSubmit(values: PregnancyFormValues) {
    savePregnancy.mutate(
      buildPregnancyObservations(values, patientId, {
        pregnancyId: summary?.pregnancyId || undefined,
        lactationId: summary?.lactationId || undefined,
      }),
      { onSuccess: onSaved },
    );
  }

  return (
    <>
      <ErrorBanner error={error} />

      {isLoading ? (
        <p>読み込み中...</p>
      ) : (
        <PregnancyForm
          initialValues={parsePregnancyForm(observations)}
          onSubmit={handleSubmit}
          submitting={savePregnancy.isPending}
          submitError={savePregnancy.error}
        />
      )}
    </>
  );
}

/**
 * 手入力の感染症。`observationId` があれば編集、無ければ新規。
 * 検査結果由来の行はここに来ない(正本は検査結果側なので編集させない)。
 */
function InfectionEditForm({
  patientId,
  observationId,
  onSaved,
}: {
  patientId: string;
  observationId?: string;
  onSaved: () => void;
}) {
  const { observations, isLoading, error } = useManualInfections(patientId);
  const saveInfection = useSaveInfection();
  const deleteInfection = useDeleteInfection();

  const target = observationId ? observations.find((o) => o.id === observationId) : undefined;

  function handleSubmit(values: InfectionFormValues) {
    saveInfection.mutate(
      { observation: buildInfectionObservation(values, patientId, observationId) },
      { onSuccess: onSaved },
    );
  }

  function handleDelete() {
    if (!observationId || !target) return;
    if (!window.confirm("この感染症の記録を削除します。よろしいですか?")) return;

    deleteInfection.mutate(observationId, { onSuccess: onSaved });
  }

  return (
    <>
      <ErrorBanner error={error} />

      {isLoading ? (
        <p>読み込み中...</p>
      ) : (
        <InfectionForm
          initialValues={target ? parseInfectionForm(target) : undefined}
          onSubmit={handleSubmit}
          submitting={saveInfection.isPending}
          submitError={saveInfection.error ?? deleteInfection.error}
          onDelete={observationId ? handleDelete : undefined}
          deleting={deleteInfection.isPending}
        />
      )}
    </>
  );
}
