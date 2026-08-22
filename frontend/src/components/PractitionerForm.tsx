import { makeFieldUpdater } from "../lib/form";
import { useState, type FormEvent } from "react";
import { useDepartmentsOf, useSelfOrganization } from "../api/queries";
import {
  departmentCode,
  departmentDisplayName,
  sortDepartmentsByCode,
} from "../fhir/departmentHelpers";
import { organizationDisplayName } from "../fhir/organizationHelpers";
import {
  emptyPractitionerForm,
  validatePractitionerForm,
  type PractitionerFormValues,
} from "../fhir/practitionerHelpers";
import { PRACTITIONER_ROLE_OPTIONS } from "../fhir/practitionerRoleHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { OrganizationSearchModal } from "./OrganizationSearchModal";

// ログイン設定(users テーブル)。Practitioner 本体とは別に backend の
// /auth/account へ保存するため、FHIR 用の PractitionerFormValues とは分ける。
export interface PractitionerLoginValues {
  loginId: string;
  /** 空なら「変更しない」(既存アカウントの更新時)。 */
  password: string;
}

interface PractitionerFormProps {
  initialValues?: PractitionerFormValues;
  /** 編集時: 登録済みログインアカウントの初期値。新規は省略。 */
  initialLogin?: { loginId: string; registered: boolean };
  /**
   * 連携先医師(他院の医師)のフォームとして使う。所属は自院ではなく他院から
   * 選び、自院スタッフ向けの項目(所属診療科・ログイン設定)は出さない。
   */
  partner?: boolean;
  onSubmit: (values: PractitionerFormValues, login: PractitionerLoginValues) => void;
  submitting: boolean;
  submitError?: unknown;
  submitLabel: string;
}

export function PractitionerForm({
  initialValues,
  initialLogin,
  partner = false,
  onSubmit,
  submitting,
  submitError,
  submitLabel,
}: PractitionerFormProps) {
  const [values, setValues] = useState<PractitionerFormValues>(
    initialValues ?? emptyPractitionerForm,
  );
  const [login, setLogin] = useState<PractitionerLoginValues>({
    loginId: initialLogin?.loginId ?? "",
    password: "",
  });
  const accountRegistered = initialLogin?.registered ?? false;
  const [validationError, setValidationError] = useState<string | null>(null);
  const [organizationModalOpen, setOrganizationModalOpen] = useState(false);
  const [departmentToAdd, setDepartmentToAdd] = useState("");

  // 自院スタッフの所属は自院で固定する(マルチテナントではないので選ばせない)。
  // 連携先医師は他院を選ぶので固定しない。自院未設定の環境では従来どおり選ぶ。
  const self = useSelfOrganization();
  const fixedToSelf = !partner && Boolean(self.selfOrganizationId);
  const organizationId = fixedToSelf ? (self.selfOrganizationId as string) : values.organizationId;
  const organizationName = fixedToSelf
    ? self.organization
      ? organizationDisplayName(self.organization)
      : ""
    : values.organizationName;

  // 診療科は所属医療機関にぶら下がる Organization なので、選べるのは選択中の
  // 医療機関の配下だけ。既に追加済みのものは候補から外す。
  const { data: facilityDepartments } = useDepartmentsOf(
    partner ? undefined : organizationId || undefined,
  );
  const departmentOptions = sortDepartmentsByCode(facilityDepartments ?? []).filter(
    (department) => !values.departments.some((d) => d.organizationId === department.id),
  );

  const update = makeFieldUpdater(setValues);

  function handleOrganizationSelect(organization: fhir4.Organization) {
    setValues((v) => ({
      ...v,
      organizationId: organization.id ?? "",
      organizationName: organizationDisplayName(organization),
      // 診療科は医療機関ごとに別リソースなので、施設を変えたら選び直してもらう。
      departments: organization.id === v.organizationId ? v.departments : [],
    }));
    setDepartmentToAdd("");
    setOrganizationModalOpen(false);
  }

  function addDepartment() {
    const department = (facilityDepartments ?? []).find((d) => d.id === departmentToAdd);
    if (!department?.id) return;
    setValues((v) => ({
      ...v,
      departments: [
        ...v.departments,
        {
          organizationId: department.id as string,
          name: departmentDisplayName(department),
          code: departmentCode(department),
          // 最初の 1 件は自動的に既定診療科にする。
          primary: v.departments.length === 0,
        },
      ],
    }));
    setDepartmentToAdd("");
  }

  function removeDepartment(organizationId: string) {
    setValues((v) => {
      const departments = v.departments.filter((d) => d.organizationId !== organizationId);
      // 既定を外したときは残りの先頭を既定に繰り上げる(既定不在で保存できないため)。
      if (departments.length > 0 && !departments.some((d) => d.primary)) {
        departments[0] = { ...departments[0], primary: true };
      }
      return { ...v, departments };
    });
  }

  function setPrimaryDepartment(organizationId: string) {
    setValues((v) => ({
      ...v,
      departments: v.departments.map((d) => ({
        ...d,
        primary: d.organizationId === organizationId,
      })),
    }));
  }

  function validateLogin(): string | null {
    if (!login.loginId) {
      if (login.password) return "パスワードを設定するにはログインIDも入力してください。";
      return null;
    }
    if (login.loginId === "administrator") {
      return "ログインID「administrator」は予約されています。";
    }
    // 新規アカウント(未登録)はパスワード必須。既存は空なら変更しない。
    if (!accountRegistered && !login.password) {
      return "ログインを設定するにはパスワードを入力してください。";
    }
    if (login.password && login.password.length < 8) {
      return "パスワードは8文字以上で入力してください。";
    }
    return null;
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const submitted: PractitionerFormValues = {
      ...values,
      organizationId,
      organizationName,
      // 連携先医師には自院の診療科もログインも持たせない。
      departments: partner ? [] : values.departments,
    };
    const error =
      validatePractitionerForm(submitted) ?? (partner ? null : validateLogin());
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError(null);
    onSubmit(submitted, partner ? { loginId: "", password: "" } : login);
  }

  return (
    <form className="patient-form" onSubmit={handleSubmit}>
      {validationError && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}
      <ErrorBanner error={submitError} />

      <fieldset>
        <legend>氏名(漢字・必須)</legend>
        <label>
          {"姓"}
          <input
            type="text"
            value={values.familyKanji}
            onChange={(e) => update("familyKanji", e.target.value)}
          />
        </label>
        <label>
          {"名"}
          <input
            type="text"
            value={values.givenKanji}
            onChange={(e) => update("givenKanji", e.target.value)}
          />
        </label>
      </fieldset>

      <fieldset>
        <legend>氏名(カナ)</legend>
        <label>
          セイ
          <input
            type="text"
            value={values.familyKana}
            onChange={(e) => update("familyKana", e.target.value)}
          />
        </label>
        <label>
          メイ
          <input
            type="text"
            value={values.givenKana}
            onChange={(e) => update("givenKana", e.target.value)}
          />
        </label>
      </fieldset>

      <label>
        医籍登録番号
        <input
          type="text"
          value={values.medicalRegistrationNumber}
          onChange={(e) => update("medicalRegistrationNumber", e.target.value)}
        />
      </label>

      <label>
        性別
        <select
          value={values.gender}
          onChange={(e) => update("gender", e.target.value as PractitionerFormValues["gender"])}
        >
          <option value="">未指定</option>
          <option value="male">男性</option>
          <option value="female">女性</option>
          <option value="other">その他</option>
          <option value="unknown">不明</option>
        </select>
      </label>

      <label>
        生年月日
        <input
          type="date"
          value={values.birthDate}
          onChange={(e) => update("birthDate", e.target.value)}
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

      <label>
        電話番号
        <input type="text" value={values.phone} onChange={(e) => update("phone", e.target.value)} />
      </label>

      <label>
        メールアドレス
        <input type="email" value={values.email} onChange={(e) => update("email", e.target.value)} />
      </label>

      <fieldset className="practitioner-form__role">
        <legend>職種・所属</legend>
        <label>
          職種
          <select value={values.roleCode} onChange={(e) => update("roleCode", e.target.value)}>
            <option value="">未指定</option>
            {PRACTITIONER_ROLE_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <div className="practitioner-form__organization">
          <span className="qp-field__label">所属医療機関</span>
          <span className="practitioner-form__organization-value">
            {organizationName || <span className="rp-card__usage-value--empty">未選択</span>}
          </span>
          {/* 自院スタッフの所属は自院で固定。選び直せるのは連携先医師のときだけ。 */}
          {!fixedToSelf && (
            <>
              <button type="button" onClick={() => setOrganizationModalOpen(true)}>
                {values.organizationId ? "変更" : "選択"}
              </button>
              {values.organizationId && (
                <button
                  type="button"
                  onClick={() =>
                    setValues((v) => ({
                      ...v,
                      organizationId: "",
                      organizationName: "",
                      departments: [],
                    }))
                  }
                >
                  クリア
                </button>
              )}
            </>
          )}
        </div>
      </fieldset>

      {/* 連携先医師には自院の診療科を持たせない。 */}
      {!partner && (
        <fieldset className="practitioner-form__role">
          <legend>所属診療科</legend>
          {organizationId ? (
            <>
              <div className="practitioner-form__department-add">
                <select
                  value={departmentToAdd}
                  onChange={(e) => setDepartmentToAdd(e.target.value)}
                  disabled={departmentOptions.length === 0}
                >
                  <option value="">
                    {departmentOptions.length === 0 ? "追加できる診療科がありません" : "診療科を選択"}
                  </option>
                  {departmentOptions.map((department) => (
                    <option key={department.id} value={department.id}>
                      {departmentCode(department)
                        ? `${departmentCode(department)} ${departmentDisplayName(department)}`
                        : departmentDisplayName(department)}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={addDepartment} disabled={!departmentToAdd}>
                  追加
                </button>
              </div>
              {values.departments.length === 0 ? (
                <p className="practitioner-form__login-hint">
                  診療科は未選択です。複数選べます(1つが既定診療科になります)。
                </p>
              ) : (
                <ul className="practitioner-form__department-list">
                  {values.departments.map((department) => (
                    <li key={department.organizationId}>
                      <label>
                        <input
                          type="radio"
                          name="primary-department"
                          checked={department.primary}
                          onChange={() => setPrimaryDepartment(department.organizationId)}
                        />
                        既定
                      </label>
                      <span className="practitioner-form__department-name">
                        {department.code ? `${department.code} ${department.name}` : department.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeDepartment(department.organizationId)}
                      >
                        削除
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p className="practitioner-form__login-hint">
              先に所属医療機関を選ぶと、その医療機関の診療科を追加できます。
            </p>
          )}
        </fieldset>
      )}

      {/* ログインするのは自院スタッフだけ。 */}
      {!partner && (
        <fieldset className="practitioner-form__login">
          <legend>ログイン設定</legend>
          <p className="practitioner-form__login-hint">
            {accountRegistered
              ? "パスワードは変更する場合のみ入力してください。ログインIDを空にして更新するとログインを無効化します。"
              : "設定すると、このID/パスワードでこのアプリにログインできます(任意)。"}
          </p>
          <label>
            ログインID
            <input
              type="text"
              value={login.loginId}
              autoComplete="off"
              onChange={(e) => setLogin((l) => ({ ...l, loginId: e.target.value }))}
            />
          </label>
          <label>
            パスワード
            <input
              type="password"
              value={login.password}
              autoComplete="new-password"
              placeholder={accountRegistered ? "(変更しない)" : ""}
              onChange={(e) => setLogin((l) => ({ ...l, password: e.target.value }))}
            />
          </label>
        </fieldset>
      )}

      <div className="patient-form__actions">
        <button type="submit" disabled={submitting}>
          {submitting ? "送信中..." : submitLabel}
        </button>
      </div>

      {organizationModalOpen && (
        <OrganizationSearchModal
          onSelect={handleOrganizationSelect}
          onClose={() => setOrganizationModalOpen(false)}
          excludeSelf={partner}
          title={partner ? "連携先医療機関を選択" : "医療機関を選択"}
        />
      )}
    </form>
  );
}
