import { useCallback, useEffect, useMemo, useState } from "react";
import { FhirError } from "../api/fhirClient";
import { useCurrentPractitioner } from "../api/authQueries";
import {
  useDpcForm1,
  useDpcForm1For,
  useDpcForm1Sources,
  useEncounter,
  usePatientAdmissions,
  useSaveDpcForm1,
} from "../api/queries";
import { dpc1Definitions } from "../fhir/dpcForm1";
import type { Dpc1Values } from "../fhir/dpcForm1/types";
import { dpc1AgeAtAdmission, draftDpcForm1, type DpcForm1Sources } from "../fhir/dpcForm1Draft";
import {
  buildDpc1Context,
  buildDpcForm1Response,
  dpcForm1EncounterId,
  nextDpcForm1Status,
  normalizeDpc1Values,
  parseDpcForm1Form,
  validateDpcForm1,
} from "../fhir/dpcForm1Helpers";
import { ADMISSION_STATUS, admissionLabel } from "../fhir/encounterHelpers";
import { isPatientMismatch } from "../fhir/patientHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { useSelfInstitutionNumber } from "../hooks/useSelfInstitutionNumber";
import { today } from "../lib/dates";
import { DpcCodingView } from "./DpcCodingView";
import { DpcForm1Form } from "./DpcForm1Form";
import { ErrorBanner } from "./ErrorBanner";
import type { KartePaneState } from "./KarteRightPane";
import { useEditSnapshot } from "../hooks/useEditSnapshot";

// DPC の登録・編集(カルテ右ペイン)。様式1 と診断群分類(14 桁)をタブで切り替える。
//
// 登録は対象の入院を選ぶところから始める。入院中でも書き始められる(退院までに入力を
// 進めておき、退院後に確定する)。選んだ入院に既に様式1 があれば、その場で編集に
// 切り替える(1 入院 1 件)。無ければ、カルテにある情報から初期値を作る。
// 診断群分類は入力中の様式1 の値(保存前も)で判定するので、両方のタブを出したままにする。

export type DpcPaneTab = "form1" | "coding";

const DPC_TABS: { key: DpcPaneTab; label: string }[] = [
  { key: "form1", label: "様式1" },
  { key: "coding", label: "診断群分類" },
];

interface DpcForm1CreatePanelProps {
  patientId: string;
  /** 提出ファイルの一覧・DPC 患者一覧から開いたときの対象の入院。 */
  defaultEncounterId?: string;
  tab?: DpcPaneTab;
  onSaved: () => void;
  onStateChange: (state: KartePaneState) => void;
}

export function DpcForm1CreatePanel({
  patientId,
  defaultEncounterId,
  tab,
  onSaved,
  onStateChange,
}: DpcForm1CreatePanelProps) {
  const admissions = usePatientAdmissions(patientId);
  const [encounterId, setEncounterId] = useState(defaultEncounterId ?? "");

  // 既定は「今の入院」、無ければ最新の退院。
  useEffect(() => {
    if (encounterId || !admissions.data?.length) return;
    const current = admissions.data.find((e) => e.status === ADMISSION_STATUS);
    setEncounterId((current ?? admissions.data[0]).id ?? "");
  }, [admissions.data, encounterId]);

  const encounter = admissions.data?.find((e) => e.id === encounterId);
  const existing = useDpcForm1For(encounterId || undefined);

  // 既にあれば編集へ(ペインの見出しも「編集」に変わる)。
  useEffect(() => {
    if (existing.data?.id) onStateChange({ kind: "dpc-form1-edit", responseId: existing.data.id, tab });
  }, [existing.data?.id, onStateChange, tab]);

  return (
    <>
      <ErrorBanner error={admissions.error} />
      <ErrorBanner error={existing.error} />
      <div className="patient-form dpc-form1__target">
        <label>
          対象の入院
          <select value={encounterId} onChange={(e) => setEncounterId(e.target.value)}>
            {(admissions.data ?? []).map((e) => (
              <option key={e.id} value={e.id}>
                {admissionLabel(e)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {admissions.isLoading ? (
        <p>読み込み中...</p>
      ) : !admissions.data?.length ? (
        <p className="patient-table__empty">この患者に入院の記録がありません。</p>
      ) : (
        encounter &&
        existing.isSuccess &&
        !existing.data && (
          <CreateForm
            key={encounter.id}
            patientId={patientId}
            encounter={encounter}
            tab={tab}
            onSaved={onSaved}
          />
        )
      )}
    </>
  );
}

function CreateForm({
  patientId,
  encounter,
  tab,
  onSaved,
}: {
  patientId: string;
  encounter: fhir4.Encounter;
  tab?: DpcPaneTab;
  onSaved: () => void;
}) {
  const institutionNumber = useSelfInstitutionNumber();
  const sources = useDpcForm1Sources(patientId, encounter, institutionNumber);

  // 初期値は情報が揃ってから作る(揃う前にフォームを出すと、空のまま書き始めてしまう)。
  const initialValues = useMemo(
    () => (sources.data ? draftDpcForm1(sources.data, today()) : null),
    [sources.data],
  );

  return (
    <>
      <ErrorBanner error={sources.error} />
      {!initialValues || !sources.data ? (
        <p>入院の情報を集めています...</p>
      ) : (
        <SaveForm
          patientId={patientId}
          encounter={encounter}
          sources={sources.data}
          initialValues={initialValues}
          initialTab={tab}
          onSaved={onSaved}
        />
      )}
    </>
  );
}

interface DpcForm1EditPanelProps {
  patientId: string;
  responseId: string;
  tab?: DpcPaneTab;
  onSaved: () => void;
}

export function DpcForm1EditPanel({ patientId, responseId, tab, onSaved }: DpcForm1EditPanelProps) {
  const { data: result, isLoading, error } = useEditSnapshot(useDpcForm1(responseId), responseId);
  const response = result?.data;
  const patientMismatch = isPatientMismatch(patientId, response?.subject);
  const encounter = useEncounter(dpcForm1EncounterId(response) || undefined);
  const institutionNumber = useSelfInstitutionNumber();
  const sources = useDpcForm1Sources(patientId, encounter.data, institutionNumber);

  return (
    <>
      <ErrorBanner error={error} />
      <ErrorBanner error={encounter.error ?? sources.error} />
      {isLoading || encounter.isLoading || sources.isLoading ? (
        <p>読み込み中...</p>
      ) : patientMismatch ? (
        <p className="patient-table__empty">指定された様式1 は別の患者のものです。</p>
      ) : !encounter.data ? (
        <p className="patient-table__empty">対象の入院が見つかりません。</p>
      ) : (
        response &&
        sources.data && (
          <SaveForm
            patientId={patientId}
            encounter={encounter.data}
            sources={sources.data}
            initialValues={parseDpcForm1Form(response)}
            existing={response}
            etag={result?.etag ?? ""}
            initialTab={tab}
            onSaved={onSaved}
          />
        )
      )}
    </>
  );
}

function SaveForm({
  patientId,
  encounter,
  sources,
  initialValues,
  existing,
  etag,
  initialTab,
  onSaved,
}: {
  patientId: string;
  encounter: fhir4.Encounter;
  sources: DpcForm1Sources;
  initialValues: Dpc1Values;
  existing?: fhir4.QuestionnaireResponse;
  etag?: string;
  initialTab?: DpcPaneTab;
  onSaved: () => void;
}) {
  const [initial] = useState(initialValues);
  const [tab, setTab] = useState<DpcPaneTab>(initialTab ?? "form1");
  const [currentValues, setCurrentValues] = useState(initialValues);
  const handleValuesChange = useCallback((values: Dpc1Values) => setCurrentValues(values), []);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [conflict, setConflict] = useState(false);
  const save = useSaveDpcForm1();
  const { practitioner } = useCurrentPractitioner();
  const institutionNumber = useSelfInstitutionNumber();

  const defs = useMemo(() => dpc1Definitions(initial.header.fiscalYear), [initial.header.fiscalYear]);
  const age = dpc1AgeAtAdmission(sources.patient, encounter);
  // 確定済み(completed / amended)の編集は、保存で修正済みになる。下書きには戻さない。
  const finalized = Boolean(existing) && existing?.status !== "in-progress";

  function handleSubmit(
    values: Dpc1Values,
    finalize: boolean,
    mdc6ByIcd: Record<string, string[]>,
  ) {
    const normalized = normalizeDpc1Values(
      values,
      defs,
      buildDpc1Context({ values, age, mdc6ByIcd }),
    );
    if (finalize || finalized) {
      const errors = validateDpcForm1(
        normalized,
        defs,
        buildDpc1Context({ values: normalized, age, mdc6ByIcd }),
      );
      if (errors.length) {
        setValidationErrors(errors);
        return;
      }
    }
    setValidationErrors([]);
    setConflict(false);
    save.mutate(
      {
        response: buildDpcForm1Response({
          values: normalized,
          defs,
          status: nextDpcForm1Status(existing, finalize),
          patient: sources.patient,
          encounterId: encounter.id ?? "",
          authorName: practitioner ? practitionerDisplayName(practitioner) : "",
          institutionNumber,
          existing,
        }),
        encounterId: encounter.id ?? "",
        etag,
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
      <div className="order-select__tabs" role="tablist">
        {DPC_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={tab === t.key ? "order-select__tab is-active" : "order-select__tab"}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div hidden={tab !== "coding"}>
        <DpcCodingView
          patient={sources.patient}
          encounter={encounter}
          values={currentValues}
          age={age}
          active={tab === "coding"}
        />
      </div>
      <div hidden={tab !== "form1"}>
      {conflict && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">
            この様式1 は他の操作によって更新されています。画面を再読込してから再度編集してください。
          </p>
        </div>
      )}
      <DpcForm1Form
        patientId={patientId}
        encounter={encounter}
        defs={defs}
        initialValues={initial}
        age={age}
        sources={sources}
        finalized={finalized}
        onSubmit={handleSubmit}
        submitting={save.isPending}
        submitError={conflict ? undefined : save.error}
        validationErrors={validationErrors}
        onValuesChange={handleValuesChange}
      />
      </div>
    </>
  );
}
