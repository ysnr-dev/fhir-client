import {
  admissionRouteHasDetails,
  type AdmissionRouteValues,
} from "../fhir/admissionRouteHelpers";
import {
  ADMISSION_ROUTE_OPTIONS,
  ADMISSION_TYPE_OPTIONS,
  HOME_CARE_OPTIONS,
} from "../fhir/dpcForm1/records/common";

// 入院の経緯(入院経路・予定/救急の区分・紹介の有無など)の入力欄。入院登録と入院実施の
// モーダルで共通に使う。選択肢は DPC 様式1 の定義表のもの(様式1 の初期値になるため)。
//
// 入院登録で選べる入院経路から「院内の他病棟からの転棟」は外す(転棟ごとに作る様式の値で、
// 入院の時点では起こらない)。

const ROUTE_OPTIONS = ADMISSION_ROUTE_OPTIONS.filter((option) => option.code !== "0");

export function AdmissionRouteFields({
  values,
  onChange,
}: {
  values: AdmissionRouteValues;
  onChange: (values: AdmissionRouteValues) => void;
}) {
  const set = <K extends keyof AdmissionRouteValues>(key: K, value: AdmissionRouteValues[K]) =>
    onChange({ ...values, [key]: value });
  const details = admissionRouteHasDetails(values.route);

  return (
    <>
      <label>
        入院経路
        <select value={values.route} onChange={(e) => set("route", e.target.value)}>
          <option value="">未指定</option>
          {ROUTE_OPTIONS.map((option) => (
            <option key={option.code} value={option.code}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        予定・救急医療入院
        <select value={values.admissionType} onChange={(e) => set("admissionType", e.target.value)}>
          <option value="">未指定</option>
          {ADMISSION_TYPE_OPTIONS.map((option) => (
            <option key={option.code} value={option.code}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {details && (
        <>
          <label>
            入院前の在宅医療
            <select
              value={values.priorHomeCare}
              onChange={(e) => set("priorHomeCare", e.target.value)}
            >
              <option value="">未指定</option>
              {HOME_CARE_OPTIONS.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div className="admission__route-flags">
            <label>
              <input
                type="checkbox"
                checked={values.referral}
                onChange={(e) => set("referral", e.target.checked)}
              />
              他院よりの紹介
            </label>
            <label>
              <input
                type="checkbox"
                checked={values.fromOutpatient}
                onChange={(e) => set("fromOutpatient", e.target.checked)}
              />
              自院の外来からの入院
            </label>
            <label>
              <input
                type="checkbox"
                checked={values.ambulance}
                onChange={(e) => set("ambulance", e.target.checked)}
              />
              救急車による搬送
            </label>
          </div>
        </>
      )}
    </>
  );
}
