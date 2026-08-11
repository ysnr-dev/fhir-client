import { useMemo } from "react";
import { useMicroResultDetail } from "../api/queries";
import {
  parseMicroResultForm,
  splitMicroResultDetailBundle,
} from "../fhir/microResultHelpers";
import { isPatientMismatch } from "../fhir/patientHelpers";

// 保存済みの細菌検査結果を結果フォームの初期値に復元する。名称(菌名・薬剤名など)は
// すべて coding.display にマスタの写しとして保存されているため、検体検査結果の
// hydrate に相当するマスタ引き直しは不要で、FHIR リソースの parse だけで完結する。
// 呼び出し側は ready を待ってからフォームを描画すること(MicroResultForm は
// 初期値を useState の初期値としてのみ読むため)。
//
// patientId は URL 上の患者。結果の subject と食い違う場合は他患者の結果なので
// 初期値を返さず patientMismatch を立てる(呼び出し側でフォームを出さないこと)。
export function useMicroResultInitialValues(reportId: string | undefined, patientId?: string) {
  const detail = useMicroResultDetail(reportId);

  const split = useMemo(
    () =>
      detail.data
        ? splitMicroResultDetailBundle(detail.data.data)
        : { report: undefined, observations: [], specimens: [] },
    [detail.data],
  );

  const initialValues = useMemo(
    () =>
      split.report
        ? parseMicroResultForm(split.report, split.observations, split.specimens)
        : undefined,
    [split],
  );

  const patientMismatch = isPatientMismatch(patientId, split.report?.subject);

  return {
    ...split,
    initialValues: patientMismatch ? undefined : initialValues,
    ready: !detail.isLoading,
    patientMismatch,
    error:
      detail.error ??
      (patientMismatch ? new Error("指定された検査結果は別の患者のものです。") : undefined),
  };
}
