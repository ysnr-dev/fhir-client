import { useState, type FormEvent } from "react";
import { useOrganizationOptions } from "../api/queries";
import { SSMIX2_DEPARTMENT_CODES, departmentCodeDisplay } from "../fhir/departmentCodes";
import {
  emptyDepartmentForm,
  validateDepartmentForm,
  type DepartmentFormValues,
} from "../fhir/departmentHelpers";
import { organizationDisplayName } from "../fhir/organizationHelpers";
import { ErrorBanner } from "./ErrorBanner";

interface DepartmentFormProps {
  initialValues?: DepartmentFormValues;
  /** 一覧で医療機関を絞り込んでいるときの初期選択。 */
  defaultPartOfId?: string;
  onSubmit: (values: DepartmentFormValues) => void;
  submitting: boolean;
  submitError?: unknown;
  submitLabel: string;
}

export function DepartmentForm({
  initialValues,
  defaultPartOfId,
  onSubmit,
  submitting,
  submitError,
  submitLabel,
}: DepartmentFormProps) {
  const [values, setValues] = useState<DepartmentFormValues>(
    initialValues ?? { ...emptyDepartmentForm, partOfId: defaultPartOfId ?? "" },
  );
  const [validationError, setValidationError] = useState<string | null>(null);
  const { organizations, isLoading: loadingOrganizations } = useOrganizationOptions();

  function update<K extends keyof DepartmentFormValues>(key: K, value: DepartmentFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  // コードを選んだら診療科名も入れる。名称を編集済みのときは上書きしない
  // (コード表の名称をそのまま使わず院内呼称にしている場合があるため)。
  function selectCode(code: string) {
    setValues((v) => {
      const keepName = v.name && v.name !== departmentCodeDisplay(v.code);
      return { ...v, code, name: keepName ? v.name : departmentCodeDisplay(code) };
    });
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const error = validateDepartmentForm(values);
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError(null);
    onSubmit(values);
  }

  return (
    <form className="patient-form" onSubmit={handleSubmit}>
      {validationError && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}
      <ErrorBanner error={submitError} />

      <label>
        所属医療機関(必須)
        <select
          value={values.partOfId}
          onChange={(e) => update("partOfId", e.target.value)}
          disabled={loadingOrganizations}
          required
        >
          <option value="">選択してください</option>
          {organizations.map((organization) => (
            <option key={organization.id} value={organization.id}>
              {organizationDisplayName(organization)}
            </option>
          ))}
        </select>
      </label>

      <label>
        診療科コード
        <select value={values.code} onChange={(e) => selectCode(e.target.value)}>
          <option value="">未指定</option>
          {SSMIX2_DEPARTMENT_CODES.map((department) => (
            <option key={department.code} value={department.code}>
              {department.code} {department.display}
            </option>
          ))}
        </select>
      </label>
      <p className="organization-form__hint">
        SS-MIX2 統一診療科コード表 V1.0(使用者定義表-#0069 診療部門)の 2 ケタ科。
      </p>

      <label>
        診療科名(必須)
        <input
          type="text"
          value={values.name}
          onChange={(e) => update("name", e.target.value)}
          required
        />
      </label>

      <label className="patient-form__checkbox">
        <input
          type="checkbox"
          checked={values.active}
          onChange={(e) => update("active", e.target.checked)}
        />
        有効(active)
      </label>

      <div className="patient-form__actions">
        <button type="submit" disabled={submitting}>
          {submitting ? "送信中..." : submitLabel}
        </button>
      </div>
    </form>
  );
}
