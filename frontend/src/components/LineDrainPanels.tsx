import { useState } from "react";
import {
  useLineDrainDevice,
  useLineDrainProcedure,
  useOrderEnterer,
  usePatientAdmission,
  usePractitionerOptions,
  useSaveLineDrain,
} from "../api/queries";
import { useLineDrainTypes } from "../api/masterQueries";
import { FhirError } from "../api/fhirClient";
import {
  buildLineDrainCreateBundle,
  buildLineDrainUpdateBundle,
  emptyLineDrainForm,
  formValuesOf,
  validateLineDrain,
  type LineDrainFormValues,
  type LineDrainRecord,
} from "../fhir/lineDrainHelpers";
import { isPatientMismatch } from "../fhir/patientHelpers";
import { useEditSnapshot } from "../hooks/useEditSnapshot";
import { useOrderContext } from "../hooks/useOrderContext";
import { useValidationError } from "../hooks/useValidationError";
import { nowDateTimeInput, toDateTimeInputValue } from "../lib/dates";
import { ErrorBanner } from "./ErrorBanner";
import { LineDrainForm } from "./LineDrainForm";

// 留置物の登録・編集(カルテ右ペイン。docs/line-drain-design.md §4.1)。登録は Device と
// 挿入の Procedure を 1 つの transaction で書き、編集は読んだ版を ifMatch に添えて組み直す。

export function LineDrainCreatePanel({ patientId, onSaved }: { patientId: string; onSaved: () => void }) {
  const enterer = useOrderEnterer();
  const [values, setValues] = useState<LineDrainFormValues>(() => ({
    ...emptyLineDrainForm(nowDateTimeInput()),
    performerId: enterer?.practitionerId ?? "",
    performerName: enterer?.display ?? "",
  }));
  const [validationError, setValidationError, errorRef] = useValidationError();
  const types = useLineDrainTypes();
  const practitioners = usePractitionerOptions();
  // 記録した診療科と入院(入院中なら今の入院に結ぶ。バイタルと同じ)。
  const orderContext = useOrderContext();
  const admission = usePatientAdmission(patientId);
  const save = useSaveLineDrain();

  function handleSubmit() {
    const error = validateLineDrain(values);
    const type = types.find((t) => t.code === values.typeCode);
    setValidationError(error ?? (type ? null : "種別を選んでください"));
    if (error || !type) return;
    save.mutate(
      buildLineDrainCreateBundle(values, type, {
        patientId,
        department: orderContext,
        encounterId: admission.data?.encounter?.id,
      }),
      { onSuccess: onSaved },
    );
  }

  return (
    <>
      <ErrorBanner error={save.error} />
      <ErrorBanner error={practitioners.error} />
      {validationError && (
        <div className="error-banner" role="alert" ref={errorRef}>
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}
      <LineDrainForm
        values={values}
        onChange={setValues}
        types={types}
        practitioners={practitioners.practitioners}
        onSubmit={handleSubmit}
        submitLabel="登録"
        submitting={save.isPending || admission.isPending}
      />
    </>
  );
}

export function LineDrainEditPanel({
  patientId,
  procedureId,
  onSaved,
}: {
  patientId: string;
  procedureId: string;
  onSaved: () => void;
}) {
  // 開いた時点の版に固定する(読み直された版で保存させない)。
  const procedure = useEditSnapshot(useLineDrainProcedure(procedureId), procedureId);
  const record = procedure.data ?? undefined;
  const device = useEditSnapshot(useLineDrainDevice(record?.deviceId || undefined), record?.deviceId);
  const patientMismatch = record ? isPatientMismatch(patientId, record.procedure.subject) : false;

  return (
    <>
      <ErrorBanner error={procedure.error} />
      <ErrorBanner error={device.error} />
      {patientMismatch && <ErrorBanner error={new Error("指定された留置は別の患者のものです。")} />}
      {procedure.isLoading || (record?.deviceId && device.isLoading) ? (
        <p>読み込み中...</p>
      ) : record && !patientMismatch ? (
        <EditForm record={record} device={device.data ?? undefined} onSaved={onSaved} />
      ) : procedure.data === null ? (
        <p className="patient-table__empty">この留置は見つかりませんでした。</p>
      ) : null}
    </>
  );
}

function EditForm({
  record,
  device,
  onSaved,
}: {
  record: LineDrainRecord;
  device: fhir4.Device | undefined;
  onSaved: () => void;
}) {
  const [values, setValues] = useState<LineDrainFormValues>(() => {
    const initial = formValuesOf(record, device);
    return { ...initial, insertedAt: toDateTimeInputValue(initial.insertedAt) };
  });
  const [validationError, setValidationError, errorRef] = useValidationError();
  const [conflict, setConflict] = useState(false);
  const types = useLineDrainTypes();
  const practitioners = usePractitionerOptions();
  const save = useSaveLineDrain();

  function handleSubmit() {
    const error = validateLineDrain(values);
    const type = types.find((t) => t.code === values.typeCode);
    setValidationError(error ?? (type ? null : "種別を選んでください"));
    if (error || !type) return;
    setConflict(false);
    save.mutate(buildLineDrainUpdateBundle(values, type, record, device), {
      onSuccess: onSaved,
      onError: (err) => {
        if (err instanceof FhirError && err.status === 412) setConflict(true);
      },
    });
  }

  return (
    <>
      {conflict ? (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">
            この留置は他の操作によって更新されています。画面を再読込してから再度編集してください。
          </p>
        </div>
      ) : (
        <ErrorBanner error={save.error} />
      )}
      <ErrorBanner error={practitioners.error} />
      {validationError && (
        <div className="error-banner" role="alert" ref={errorRef}>
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}
      <LineDrainForm
        values={values}
        onChange={setValues}
        types={types}
        practitioners={practitioners.practitioners}
        onSubmit={handleSubmit}
        submitLabel="更新"
        submitting={save.isPending}
      />
    </>
  );
}
