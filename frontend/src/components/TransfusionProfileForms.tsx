import { useState, type FormEvent } from "react";
import { useSaveProfileObservation, useTransfusionProfile } from "../api/queries";
import {
  ANTIGEN_OPTIONS,
  antibodyLabel,
  buildIrregularAntibodyObservation,
  buildTransplantBloodTypeObservation,
  emptyTransplantBloodTypeForm,
  parseIrregularAntibodyForm,
  type IrregularAntibodyFormValues,
  type TransplantBloodTypeFormValues,
} from "../fhir/transfusionProfileHelpers";
import {
  ABO_OPTIONS,
  RHD_OPTIONS,
  type AboBloodType,
  type RhdBloodType,
} from "../fhir/transfusionOrderHelpers";
import { makeFieldUpdater } from "../lib/form";
import { ErrorBanner } from "./ErrorBanner";

// プロファイルタブの「身体」区画から登録する、輸血に関わる手入力の属性
// (fhir/transfusionProfileHelpers.ts)。血液型の申告と同じく、既に登録があれば id を引き継いで更新する。

/** 不規則抗体の特異性(同定した抗体)。 */
export function IrregularAntibodyForm({ patientId, onSaved }: { patientId: string; onSaved: () => void }) {
  const profile = useTransfusionProfile(patientId);
  const save = useSaveProfileObservation();
  const [values, setValues] = useState<IrregularAntibodyFormValues>(() =>
    parseIrregularAntibodyForm(profile.antibody),
  );
  const [validationError, setValidationError] = useState<string | null>(null);

  function toggle(code: string) {
    setValues((prev) => ({
      ...prev,
      antibodies: prev.antibodies.includes(code)
        ? prev.antibodies.filter((c) => c !== code)
        : [...prev.antibodies, code],
    }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!values.effectiveDate) {
      setValidationError("確認日を入れてください。");
      return;
    }
    setValidationError(null);
    save.mutate(buildIrregularAntibodyObservation(values, patientId, profile.antibody?.id || undefined), {
      onSuccess: onSaved,
    });
  }

  if (profile.isLoading) return <p>読み込み中...</p>;

  return (
    <form className="patient-fields" onSubmit={handleSubmit}>
      <div className="transfusion-perform__symptoms" role="group" aria-label="不規則抗体の特異性">
        {ANTIGEN_OPTIONS.map((option) => {
          const selected = values.antibodies.includes(option.code);
          return (
            <button
              key={option.code}
              type="button"
              aria-pressed={selected}
              className={`transfusion-chip transfusion-chip--symptom${
                selected ? " transfusion-chip--selected transfusion-chip--rhd-negative" : ""
              }`}
              onClick={() => toggle(option.code)}
            >
              {antibodyLabel(option.code)}
            </button>
          );
        })}
      </div>
      <div className="patient-fields__row">
        <label>
          確認日
          <input
            type="date"
            value={values.effectiveDate}
            onChange={(e) => setValues((prev) => ({ ...prev, effectiveDate: e.target.value }))}
          />
        </label>
        <label className="patient-fields__field--wide">
          備考
          <input
            type="text"
            value={values.note}
            onChange={(e) => setValues((prev) => ({ ...prev, note: e.target.value }))}
          />
        </label>
      </div>
      {validationError && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}
      <ErrorBanner error={profile.error ?? save.error} />
      <div className="patient-fields__actions">
        <button type="submit" disabled={save.isPending}>
          保存
        </button>
      </div>
    </form>
  );
}

function TypeSelects({
  label,
  abo,
  rhd,
  onChange,
}: {
  label: string;
  abo: AboBloodType | "";
  rhd: RhdBloodType | "";
  onChange: (patch: { abo?: AboBloodType | ""; rhd?: RhdBloodType | "" }) => void;
}) {
  return (
    <>
      <label className="patient-fields__field--gender">
        {label} ABO
        <select value={abo} onChange={(e) => onChange({ abo: e.target.value as AboBloodType | "" })}>
          <option value=""></option>
          {ABO_OPTIONS.map((o) => (
            <option key={o.code} value={o.code}>
              {o.display}
            </option>
          ))}
        </select>
      </label>
      <label className="patient-fields__field--gender">
        {label} RhD
        <select value={rhd} onChange={(e) => onChange({ rhd: e.target.value as RhdBloodType | "" })}>
          <option value=""></option>
          {RHD_OPTIONS.map((o) => (
            <option key={o.code} value={o.code}>
              {o.display}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

/** 造血幹細胞移植後の血液型(ドナーの型と、移植後に輸血に使う型)。 */
export function TransplantBloodTypeForm({ patientId, onSaved }: { patientId: string; onSaved: () => void }) {
  const profile = useTransfusionProfile(patientId);
  const save = useSaveProfileObservation();
  const [values, setValues] = useState<TransplantBloodTypeFormValues>(() =>
    profile.transplant
      ? {
          transplantDate: profile.transplant.transplantDate,
          donorAbo: profile.transplant.donorAbo,
          donorRhd: profile.transplant.donorRhd,
          rbcAbo: profile.transplant.rbcAbo,
          rbcRhd: profile.transplant.rbcRhd,
          plasmaAbo: profile.transplant.plasmaAbo,
          plasmaRhd: profile.transplant.plasmaRhd,
          note: profile.transplant.note,
        }
      : emptyTransplantBloodTypeForm(),
  );
  const [validationError, setValidationError] = useState<string | null>(null);
  const update = makeFieldUpdater(setValues);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!values.rbcAbo || !values.plasmaAbo) {
      setValidationError("輸血に使う型(赤血球・血漿/血小板)を選んでください。");
      return;
    }
    setValidationError(null);
    save.mutate(buildTransplantBloodTypeObservation(values, patientId, profile.transplant?.id || undefined), {
      onSuccess: onSaved,
    });
  }

  if (profile.isLoading) return <p>読み込み中...</p>;

  return (
    <form className="patient-fields" onSubmit={handleSubmit}>
      <div className="patient-fields__row">
        <label>
          移植日
          <input
            type="date"
            value={values.transplantDate}
            onChange={(e) => update("transplantDate", e.target.value)}
          />
        </label>
        <TypeSelects
          label="ドナー"
          abo={values.donorAbo}
          rhd={values.donorRhd}
          onChange={(patch) => setValues((prev) => ({ ...prev, donorAbo: patch.abo ?? prev.donorAbo, donorRhd: patch.rhd ?? prev.donorRhd }))}
        />
      </div>
      <div className="patient-fields__row">
        <TypeSelects
          label="赤血球製剤"
          abo={values.rbcAbo}
          rhd={values.rbcRhd}
          onChange={(patch) => setValues((prev) => ({ ...prev, rbcAbo: patch.abo ?? prev.rbcAbo, rbcRhd: patch.rhd ?? prev.rbcRhd }))}
        />
        <TypeSelects
          label="血漿・血小板製剤"
          abo={values.plasmaAbo}
          rhd={values.plasmaRhd}
          onChange={(patch) => setValues((prev) => ({ ...prev, plasmaAbo: patch.abo ?? prev.plasmaAbo, plasmaRhd: patch.rhd ?? prev.plasmaRhd }))}
        />
      </div>
      <div className="patient-fields__row">
        <label className="patient-fields__field--wide">
          備考
          <input type="text" value={values.note} onChange={(e) => update("note", e.target.value)} />
        </label>
      </div>
      {validationError && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}
      <ErrorBanner error={profile.error ?? save.error} />
      <div className="patient-fields__actions">
        <button type="submit" disabled={save.isPending}>
          保存
        </button>
      </div>
    </form>
  );
}
