import type { ResourceVersion } from "./karteCardHistory";
import { vitalEntryId } from "./vitalHelpers";

// カルテ印刷の「削除した記録」。上流は論理削除で、検索条件付きの型レベル _history が
// 削除済みのリソースの版も返す。そこから「最後に残っていた内容」を取り出してカードに組み直す
// (docs/features/karte.md「カルテ印刷」)。
//
// オーダーはヘッダと明細が同じ transaction で消える。ヘッダより前の編集で外した明細は
// 削除の時点で既に無かったものなので、ヘッダと一緒に消えた明細だけを残す。

// 1 回の書き込みのリソースごとの時刻のずれ(karteCardHistory の SAME_EDIT_GAP_MS と同じ幅)。
const SAME_EDIT_GAP_MS = 2000;

export interface ResourceFinalState {
  /** "Composition/abc" */
  reference: string;
  /** 最後に残っていた内容。 */
  resource: fhir4.Resource;
  /** 削除された時刻。残っていれば null。 */
  deletedAt: string | null;
}

/** 版をリソースごとにまとめ、最後の内容と削除の有無にする。中身の版が 1 つも無いものは除く。 */
export function finalStates(versions: ResourceVersion[]): Map<string, ResourceFinalState> {
  const byReference = new Map<string, ResourceVersion[]>();
  for (const version of versions) {
    byReference.set(version.reference, [...(byReference.get(version.reference) ?? []), version]);
  }
  const result = new Map<string, ResourceFinalState>();
  for (const [reference, list] of byReference) {
    const sorted = [...list].sort((a, b) => a.lastModified.localeCompare(b.lastModified));
    const newest = sorted[sorted.length - 1];
    const resource = [...sorted].reverse().find((version) => version.resource)?.resource;
    if (!resource) continue;
    result.set(reference, { reference, resource, deletedAt: newest.resource ? null : newest.lastModified });
  }
  return result;
}

export function deletedStates(states: Map<string, ResourceFinalState>): ResourceFinalState[] {
  return [...states.values()].filter((state) => state.deletedAt);
}

function deletedBy(childDeletedAt: string | null, ownerDeletedAt: string): boolean {
  if (!childDeletedAt) return true;
  return Date.parse(childDeletedAt) >= Date.parse(ownerDeletedAt) - SAME_EDIT_GAP_MS;
}

/**
 * 消えたヘッダと一緒に消えた明細(basedOn でヘッダ → 明細 → 構成項目の 2 段まで辿る)。
 * ヘッダより前に消した明細は入れない。
 */
export function childrenDeletedWith(
  headers: ResourceFinalState[],
  children: Map<string, ResourceFinalState>,
): fhir4.Resource[] {
  const ownerDeletedAt = new Map(headers.map((header) => [header.reference, header.deletedAt ?? ""]));
  const result: fhir4.Resource[] = [];
  for (let depth = 0; depth < 2; depth += 1) {
    for (const child of children.values()) {
      if (ownerDeletedAt.has(child.reference)) continue;
      const basedOn = (child.resource as fhir4.ServiceRequest | fhir4.MedicationRequest).basedOn ?? [];
      const owner = basedOn.map((ref) => ownerDeletedAt.get(ref.reference ?? "")).find(Boolean);
      if (!owner || !deletedBy(child.deletedAt, owner)) continue;
      ownerDeletedAt.set(child.reference, owner);
      result.push(child.resource);
    }
  }
  return result;
}

/**
 * 測定 1 回ぶんがまるごと消えたバイタル。測定の編集は Observation を消して作り直すので、
 * 同じ測定(identifier)に残っているものがあれば削除ではない。最後の削除で消えたものだけを返す。
 */
export function deletedVitalObservations(states: Map<string, ResourceFinalState>): ResourceFinalState[] {
  const byEntry = new Map<string, ResourceFinalState[]>();
  for (const state of states.values()) {
    const entryId = vitalEntryId(state.resource as fhir4.Observation);
    if (entryId) byEntry.set(entryId, [...(byEntry.get(entryId) ?? []), state]);
  }
  return [...byEntry.values()].flatMap((list) => {
    if (list.some((state) => !state.deletedAt)) return [];
    const last = list.map((state) => state.deletedAt ?? "").sort().pop() ?? "";
    return list.filter((state) => deletedBy(state.deletedAt, last));
  });
}

const RESPONSE_REFERENCE = /QuestionnaireResponse\/([A-Za-z0-9\-.]+)/g;

/**
 * 診療記録・オーダーのどれかの版が参照したテンプレート回答の id。記録の本文として出る回答は
 * 記録の編集で外されても単独のカードにはしない(タイムラインの linkedResponseIds と同じ考え方)。
 */
export function responseIdsReferencedBy(versions: ResourceVersion[]): Set<string> {
  const ids = new Set<string>();
  for (const version of versions) {
    if (!version.resource) continue;
    for (const match of JSON.stringify(version.resource).matchAll(RESPONSE_REFERENCE)) ids.add(match[1]);
  }
  return ids;
}

/** buildKarteTimeline に渡す検索結果の形。 */
export function searchsetOf(resources: fhir4.Resource[]): fhir4.Bundle {
  return {
    resourceType: "Bundle",
    type: "searchset",
    entry: resources.map((resource) => ({ resource, search: { mode: "match" } })),
  };
}
