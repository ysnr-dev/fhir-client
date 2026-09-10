import { useMemo } from "react";
import type { LabOrderItemResult } from "../api/masterClient";
import { useLabOrderItemResults } from "../api/masterQueries";
import { useLabOrderDetail } from "../api/queries";
import {
  labOrderItemRequests,
  labOrderItems,
  serviceRequestsOf,
  type LabOrderItemLine,
} from "../fhir/labOrderHelpers";
import { emptyLabResultLine, lineKeyOf, type LabResultLineValues } from "../fhir/labResultHelpers";

// 検体検査オーダーの検査項目を、検査結果フォームの行(結果項目)に展開する。
// オーダー項目 → 結果項目の対応表(結果項目マスタ)で引く。1 つのオーダー項目が
// 複数の結果を返す(血液ガス分析 → pH・PCO2…)ときは、その数だけ行になる。

export interface ExpandedResultLine extends LabResultLineValues {
  item: NonNullable<LabResultLineValues["item"]>;
}

/**
 * @returns lines: 展開した結果行(オーダーの項目順、同じオーダー項目内は対応表の並び順)。
 *          unmatchedNames: 対応する結果項目が無いオーダー項目の名前(手入力を促すため)。
 */
export function useLabOrderResultLines(orderId: string | undefined) {
  const detail = useLabOrderDetail(orderId);

  // 結果値を入力する単位になる項目(= 構成項目を持たない項目)だけを対象にする。
  // パネル検査そのものは結果を持たず、その構成項目が結果の行になる。
  const items = useMemo(() => {
    const bundle = detail.data?.data;
    if (!bundle || !orderId) return [];
    const serviceRequests = serviceRequestsOf(bundle);
    const header = serviceRequests.find((sr) => sr.id === orderId);
    if (!header) return [];

    const all = labOrderItems(header, labOrderItemRequests(serviceRequests, orderId));
    const panelCodes = new Set(all.map((item) => item.parentCode).filter(Boolean));
    return all.filter((item) => !panelCodes.has(item.code));
  }, [detail.data, orderId]);

  const codes = useMemo(() => items.map((item) => item.code).filter(Boolean), [items]);
  const mappings = useLabOrderItemResults(codes);

  const expansion = useMemo(
    () => expand(items, mappings.data?.items ?? []),
    [items, mappings.data],
  );

  return {
    ...expansion,
    // 対応表の照会の完了(またはエラー)を待ってから展開結果を使う。
    ready: Boolean(orderId) && !detail.isLoading && !mappings.isLoading,
    error: detail.error ?? mappings.error ?? undefined,
  };
}

function expand(
  items: LabOrderItemLine[],
  mappings: LabOrderItemResult[],
): { lines: ExpandedResultLine[]; unmatchedNames: string[] } {
  const byOrderCode = new Map<string, LabOrderItemResult[]>();
  for (const mapping of mappings) {
    const list = byOrderCode.get(mapping.order_item_code);
    if (list) list.push(mapping);
    else byOrderCode.set(mapping.order_item_code, [mapping]);
  }
  const byDisplayOrder = (a: LabOrderItemResult, b: LabOrderItemResult) =>
    (a.display_order ?? Infinity) - (b.display_order ?? Infinity) || a.id - b.id;

  const lines: ExpandedResultLine[] = [];
  const unmatchedNames: string[] = [];
  const added = new Set<string>();

  for (const item of items) {
    // 対応表の行はあるが結果項目がマスタから消えている場合も「対応なし」に数える。
    const resultItems = (byOrderCode.get(item.code) ?? [])
      .sort(byDisplayOrder)
      .flatMap((mapping) => (mapping.result_item ? [mapping.result_item] : []));
    if (resultItems.length === 0) {
      unmatchedNames.push(item.name);
      continue;
    }
    for (const resultItem of resultItems) {
      // 同じ結果項目が複数のオーダー項目から返っても結果は 1 行。
      const key = lineKeyOf(resultItem);
      if (added.has(key)) continue;
      added.add(key);
      lines.push({ ...emptyLabResultLine, item: resultItem });
    }
  }

  return { lines, unmatchedNames };
}
