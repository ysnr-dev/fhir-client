import { useMemo } from "react";
import type { LabItem } from "../api/masterClient";
import { useLabItemsByJlacCodes } from "../api/masterQueries";
import { useLabOrderDetail } from "../api/queries";
import {
  labOrderItemRequests,
  labOrderItems,
  serviceRequestsOf,
  type LabOrderItemLine,
} from "../fhir/labOrderHelpers";
import { emptyLabResultLine, type LabResultLineValues } from "../fhir/labResultHelpers";

/** オーダーから展開した行。検査項目マスタを引き当てられた行だけを作るので item は必ず入る。 */
export interface ExpandedResultLine extends LabResultLineValues {
  item: LabItem;
}

/**
 * 検体検査オーダーの検査項目を、検査結果フォームの行に展開する。
 *
 * オーダー項目マスタの JLAC コードで検査項目マスタ(検査結果側)を引き当てるので、
 * オーダー項目に JLAC コードが入っていない項目は展開できない。展開できなかった
 * 項目は unmatchedNames で返し、呼び出し側で「手で足してほしい」旨を伝える。
 */
export function useLabOrderResultLines(orderId: string | undefined) {
  const detail = useLabOrderDetail(orderId);

  // 結果値を入力する単位になる項目(= 構成項目を持たない項目)だけを対象にする。
  // パネル検査そのものは結果を持たず、その構成項目が結果の 1 行になる。
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

  const jlac11Codes = useMemo(() => codesOf(items, "jlac11"), [items]);
  const jlac10Codes = useMemo(() => codesOf(items, "jlac10"), [items]);
  const masterItems = useLabItemsByJlacCodes(jlac11Codes, jlac10Codes);

  const expansion = useMemo(
    () => expand(items, masterItems.data ?? []),
    [items, masterItems.data],
  );

  return {
    ...expansion,
    // マスタ照会の完了(またはエラー)を待ってから展開結果を使う。
    ready: Boolean(orderId) && !detail.isLoading && !masterItems.isLoading,
    error: detail.error ?? masterItems.error ?? undefined,
  };
}

/** 指定のコード体系でオーダーされた項目の JLAC コード(重複なし)。 */
function codesOf(items: LabOrderItemLine[], system: "jlac11" | "jlac10"): string[] {
  const codes = items
    .filter((item) => item.jlacCode && systemOf(item) === system)
    .map((item) => item.jlacCode);
  return [...new Set(codes)];
}

// コード体系が空のオーダー項目(JLAC コード自体も空)はここへ来ない。
function systemOf(item: LabOrderItemLine): string {
  return item.jlacCodeSystem === "jlac10" ? "jlac10" : "jlac11";
}

function expand(
  items: LabOrderItemLine[],
  masterItems: LabItem[],
): { lines: ExpandedResultLine[]; unmatchedNames: string[] } {
  const byJlac11 = new Map<string, LabItem>();
  const byJlac10 = new Map<string, LabItem>();
  for (const item of masterItems) {
    // JLAC10 コードはマスタ上で一意ではないので、収載順で先に来たものを採る。
    if (!byJlac11.has(item.jlac11_code)) byJlac11.set(item.jlac11_code, item);
    if (item.jlac10_code && !byJlac10.has(item.jlac10_code)) byJlac10.set(item.jlac10_code, item);
  }

  const lines: ExpandedResultLine[] = [];
  const unmatchedNames: string[] = [];
  const added = new Set<string>();

  for (const item of items) {
    const master = item.jlacCode
      ? (systemOf(item) === "jlac10" ? byJlac10 : byJlac11).get(item.jlacCode)
      : undefined;
    if (!master) {
      unmatchedNames.push(item.name);
      continue;
    }
    // 同じ検査項目が複数のパネルに入っていても結果は 1 行。
    if (added.has(master.jlac11_code)) continue;
    added.add(master.jlac11_code);
    lines.push({ ...emptyLabResultLine, item: master });
  }

  return { lines, unmatchedNames };
}
