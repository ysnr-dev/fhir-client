import { useMemo } from "react";
import { useLabResultItemsByCodes, useLabResultItemsByJlac11Codes } from "../api/masterQueries";
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

  // 保存済みリソースにはコード型の選択肢などマスタ情報が含まれないため、結果項目コードで
  // マスタを引き直してフォーム初期値を補完する。結果項目マスタ導入前の保存済み結果
  // (施設コードが無く JLAC11 だけ)は JLAC11 で引く。
  const { codes, jlac11Codes } = useMemo(() => {
    const codes: string[] = [];
    const jlac11Codes: string[] = [];
    for (const line of parsed?.lines ?? []) {
      if (!line.item) continue;
      if (line.item.result_item_code) codes.push(line.item.result_item_code);
      else if (line.item.jlac11_code) jlac11Codes.push(line.item.jlac11_code);
    }
    return { codes, jlac11Codes };
  }, [parsed]);
  const masterItems = useLabResultItemsByCodes(codes);
  const legacyItems = useLabResultItemsByJlac11Codes(jlac11Codes);

  const initialValues = useMemo(
    () =>
      parsed
        ? hydrateLabResultForm(parsed, [
            ...(masterItems.data?.items ?? []),
            ...(legacyItems.data?.items ?? []),
          ])
        : undefined,
    [parsed, masterItems.data, legacyItems.data],
  );

  const patientMismatch = isPatientMismatch(patientId, split.report?.subject);

  return {
    ...split,
    initialValues: patientMismatch ? undefined : initialValues,
    // マスタ照会の完了(またはエラー)を待ってからフォームを初期化する。
    ready: !detail.isLoading && !masterItems.isLoading && !legacyItems.isLoading,
    patientMismatch,
    error:
      detail.error ??
      (patientMismatch ? new Error("指定された検査結果は別の患者のものです。") : undefined),
  };
}
