import { useMemo } from "react";
import { usePathoResultDetail } from "../api/queries";
import { parsePathoResultForm, splitPathoResultDetailBundle } from "../fhir/pathoResultHelpers";
import { isPatientMismatch } from "../fhir/patientHelpers";

// 保存済みの病理レポートをフォームの初期値に復元する。臓器名・検体タイプ名は
// coding.display にマスタの写しとして保存されているため、マスタ引き直しは不要で
// FHIR リソースの parse だけで完結する(細菌検査結果と同じ)。
// 呼び出し側は ready を待ってからフォームを描画すること(PathoResultForm は
// 初期値を useState の初期値としてのみ読むため)。
//
// patientId は URL 上の患者。レポートの subject と食い違う場合は他患者のもの
// なので初期値を返さず patientMismatch を立てる(呼び出し側でフォームを出さない)。
export function usePathoResultInitialValues(reportId: string | undefined, patientId?: string) {
  const detail = usePathoResultDetail(reportId);

  const split = useMemo(
    () =>
      detail.data
        ? splitPathoResultDetailBundle(detail.data.data)
        : { report: undefined, observations: [], specimens: [] },
    [detail.data],
  );

  const initialValues = useMemo(
    () =>
      split.report
        ? parsePathoResultForm(split.report, split.observations, split.specimens)
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
      (patientMismatch ? new Error("指定された病理レポートは別の患者のものです。") : undefined),
  };
}
