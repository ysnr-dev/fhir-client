import { useMemo } from "react";
import { useLabItemsByCodes } from "../api/masterQueries";
import { useLabResultDetail } from "../api/queries";
import {
  hydrateLabResultForm,
  parseLabResultForm,
  splitLabResultDetailBundle,
} from "../fhir/labResultHelpers";
import { isPatientMismatch } from "../fhir/patientHelpers";

// 保存済みの検査結果を検査結果フォームの初期値に復元する。編集(そのまま復元)と
// 新規作成(DO)の双方から使う。呼び出し側は ready を待ってからフォームを描画すること
// (LabResultForm は初期値を useState の初期値としてのみ読むため)。
//
// patientId は URL 上の患者。検査結果の subject と食い違う場合は他患者の検査結果なので
// 初期値を返さず patientMismatch を立てる(呼び出し側でフォームを出さないこと)。
export function useLabResultInitialValues(reportId: string | undefined, patientId?: string) {
  const detail = useLabResultDetail(reportId);

  const split = useMemo(
    () =>
      detail.data
        ? splitLabResultDetailBundle(detail.data.data)
        : { report: undefined, observations: [], specimens: [] },
    [detail.data],
  );

  const parsed = useMemo(
    () =>
      split.report
        ? parseLabResultForm(split.report, split.observations, split.specimens)
        : undefined,
    [split],
  );

  // 保存済みリソースにはコード型の選択肢などマスタ情報が含まれないため、
  // JLAC11 コードでマスタを引き直してフォーム初期値を補完する。
  const codes = useMemo(
    () =>
      parsed?.lines
        .map((line) => line.item?.jlac11_code)
        .filter((code): code is string => Boolean(code)) ?? [],
    [parsed],
  );
  const masterItems = useLabItemsByCodes(codes);

  const initialValues = useMemo(
    () => (parsed ? hydrateLabResultForm(parsed, masterItems.data?.items ?? []) : undefined),
    [parsed, masterItems.data],
  );

  const patientMismatch = isPatientMismatch(patientId, split.report?.subject);

  return {
    ...split,
    initialValues: patientMismatch ? undefined : initialValues,
    // マスタ照会の完了(またはエラー)を待ってからフォームを初期化する。
    ready: !detail.isLoading && !masterItems.isLoading,
    patientMismatch,
    error:
      detail.error ??
      (patientMismatch ? new Error("指定された検査結果は別の患者のものです。") : undefined),
  };
}
