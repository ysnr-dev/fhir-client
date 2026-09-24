import { useCallback, useState } from "react";
import {
  searchLabResultItems,
  type LabResultImportRowPayload,
  type LabResultItem,
} from "../api/masterClient";
import { useLabResultImportMutations } from "../api/masterQueries";
import { fetchLabResultDetail, useCreateLabResult, useUpdateLabResult } from "../api/queries";
import {
  buildImportFormValues,
  importLinesOf,
  mergeImportLines,
  reportIdFromTransactionResponse,
  type LabImportGroup,
} from "../fhir/labImportHelpers";
import {
  hydrateLabResultForm,
  labResultSubjectOf,
  parseLabResultForm,
  specimenRefsFrom,
  splitLabResultDetailBundle,
} from "../fhir/labResultHelpers";
import type { LabImportGroupContext } from "./useLabImportGroupContext";
import { useLabResultPerformerDefaults } from "./useLabResultPerformerDefaults";

// 取込の候補 1 件を上流に登録する。手入力と同じ道(useCreateLabResult /
// useUpdateLabResult)を通すので、基準値の適用・パニック値の通知・報告区分の遷移は
// そちらの実装がそのまま効く。

/** 登録できる状態か。できないときは理由を返す(ボタンの活殺と説明に使う)。 */
export function registrationBlocker(
  group: LabImportGroup,
  context: LabImportGroupContext | undefined,
): string | null {
  if (group.registeredReportId) return "登録済みです。";
  if (!context) return "患者とオーダーを確認中です。";
  if (!context.patient?.id) return "患者が決まっていません。";
  if (context.resolvedBy === "patient-multiple" && !context.orderContext.orderId) {
    return "オーダーを選んでください。";
  }
  const pending = group.rows.filter((row) => row.status === "pending");
  if (pending.length > 0) return `保留の行が ${pending.length} 件あります。`;
  if (!group.rows.some((row) => row.status === "ready")) return "登録する行がありません。";
  return null;
}

export function useLabImportRegistration() {
  const createLabResult = useCreateLabResult();
  const updateLabResult = useUpdateLabResult();
  const { bulkUpdateRows } = useLabResultImportMutations();
  const { fill: fillPerformer, practitionerId } = useLabResultPerformerDefaults();
  const [registering, setRegistering] = useState(false);

  const registerGroup = useCallback(
    async (group: LabImportGroup, context: LabImportGroupContext) => {
      const patientId = context.patient?.id;
      if (!patientId) throw new Error("患者が決まっていません。");

      const subject = labResultSubjectOf(context.patient);
      const items = await fetchImportItems(group);
      const lines = importLinesOf(group, items, subject);
      if (lines.length === 0) throw new Error("登録できる行がありません。");

      const reportId = context.existingReportId
        ? await updateExisting(group, lines, context, patientId, subject)
        : await createNew(group, lines, context, patientId, subject, fillPerformer);

      await bulkUpdateRows.mutateAsync({
        ids: group.rows.filter((row) => row.status === "ready").map((row) => row.id),
        payload: {
          report_fhir_id: reportId,
          patient_fhir_id: patientId,
          order_fhir_id: context.orderContext.orderId,
          registered_by_practitioner_id: practitionerId,
        } satisfies LabResultImportRowPayload,
      });
      return reportId;
    },
    [bulkUpdateRows, fillPerformer, practitionerId],
  );

  /**
   * 候補をまとめて登録する。1 候補で上流に 3〜4 回書き込むので逐次に処理し、
   * 失敗した候補は理由を残して残りを続ける(患者ファイル取込と同じ部分成功)。
   */
  const registerAll = useCallback(
    async (entries: { group: LabImportGroup; context: LabImportGroupContext }[]) => {
      setRegistering(true);
      const failures: { groupNo: number; message: string }[] = [];
      try {
        for (const entry of entries) {
          try {
            await registerGroup(entry.group, entry.context);
          } catch (error) {
            failures.push({
              groupNo: entry.group.groupNo,
              message: error instanceof Error ? error.message : String(error),
            });
          }
        }
      } finally {
        setRegistering(false);
      }
      return failures;
    },
    [registerGroup],
  );

  async function createNew(
    group: LabImportGroup,
    lines: ReturnType<typeof importLinesOf>,
    context: LabImportGroupContext,
    patientId: string,
    subject: ReturnType<typeof labResultSubjectOf>,
    fill: typeof fillPerformer,
  ) {
    const values = buildImportFormValues(group, lines, context.orderContext);
    const { data } = await createLabResult.mutateAsync({
      values: { ...values, performer: fill(values.performer) },
      patientId,
      subject,
      owner: context.requester,
    });
    const reportId = reportIdFromTransactionResponse(data);
    if (!reportId) throw new Error("登録した検査結果の id を取得できませんでした。");
    return reportId;
  }

  // 既にそのオーダーに結果があるときは、既存のレポートに項目を差し替え・追加する。
  // 確定済みのレポートなら保存時に訂正報告になり、結果確認の通知も未確認に戻る。
  async function updateExisting(
    group: LabImportGroup,
    lines: ReturnType<typeof importLinesOf>,
    context: LabImportGroupContext,
    patientId: string,
    subject: ReturnType<typeof labResultSubjectOf>,
  ) {
    const reportId = context.existingReportId;
    const { data: bundle } = await fetchLabResultDetail(reportId);
    const split = splitLabResultDetailBundle(bundle);
    if (!split.report) throw new Error("既存の検査結果を読み込めませんでした。");

    const parsed = parseLabResultForm(split.report, split.observations, split.specimens);
    const existing = hydrateLabResultForm(parsed, await fetchExistingItems(parsed));

    await updateLabResult.mutateAsync({
      values: mergeImportLines(existing, group, lines),
      patientId,
      reportId,
      originalObservationIds: split.observations.map((observation) => observation.id ?? ""),
      originalSpecimens: specimenRefsFrom(split.specimens),
      subject,
      owner: context.requester,
    });
    return reportId;
  }

  return { registerGroup, registerAll, registering };
}

/** 取込行が指す結果項目を引く(基準値つき)。 */
async function fetchImportItems(group: LabImportGroup): Promise<Map<string, LabResultItem>> {
  const codes = Array.from(
    new Set(group.rows.map((row) => row.result_item_code).filter((code): code is string => Boolean(code))),
  );
  if (codes.length === 0) return new Map();
  const { items } = await searchLabResultItems({ result_item_code: codes.join(","), per: 500 });
  return new Map(items.map((item) => [item.result_item_code, item]));
}

// 保存済みの結果にはコード型の選択肢などマスタ情報が無いので、
// 結果項目コードで引き直して初期値を補完する(useLabResultInitialValues と同じ)。
async function fetchExistingItems(
  parsed: ReturnType<typeof parseLabResultForm>,
): Promise<LabResultItem[]> {
  const codes = parsed.lines
    .map((line) => line.item?.result_item_code)
    .filter((code): code is string => Boolean(code));
  if (codes.length === 0) return [];
  const { items } = await searchLabResultItems({ result_item_code: codes.join(","), per: 500 });
  return items;
}
