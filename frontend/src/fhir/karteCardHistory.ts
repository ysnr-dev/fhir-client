import { localDay } from "../lib/dates";
import { orderCardDay, type KarteTimelineItem } from "./karteTimeline";
import { labOrderItemRequests } from "./labOrderHelpers";
import { withEvaluationObservation } from "./pathwayKarteHelpers";
import { VITAL_ENTRY_SYSTEM, groupVitalEntries } from "./vitalHelpers";

// カルテカードの変更履歴。カードは 1 リソースとは限らず(オーダーはヘッダ + 明細、
// バイタルは項目ごとの Observation)、編集のたびに明細が足されたり消されたりする。
// そこでカードを作るリソースすべての版を上流の _history から集め、時刻順に積み直して
// 「その編集を終えた時点のカード」を組み直す。消した明細は検索に出ないので、上流の
// 型レベル履歴を検索条件で絞る形(削除済みも返る)で引く。
//
// 版はオーダー内容の版で、実施記録・照射記録は含めない(別のリソースで、オーダーの
// 編集とは別に積み上がるため)。進捗やレポートの有無は現在の値のまま出す。
// 診療日(day)は版の値で付け直す(日付の変更も版の違いとして見えるように)。
//
// 診療記録は ClinicalNoteHistoryModal が別に扱う(承認・署名など版ごとの見どころが違う)。

export type HistoryCardItem = Exclude<KarteTimelineItem, { kind: "note" }>;

/** カードを作るリソースの集め方。 */
export interface KarteCardHistoryPlan {
  /** 本体の 1 リソース(オーダーのヘッダ・テンプレート回答・パス評価)。 */
  main?: { resourceType: string; id: string };
  /** ヘッダの based-on を辿る明細の型。検体検査などの明細は 2 段(ヘッダ → 明細 → 構成項目)。 */
  children?: "ServiceRequest" | "MedicationRequest";
  /** バイタル 1 回ぶんの Observation が共有する identifier(system|value)。 */
  identifier?: string;
}

export function karteCardHistoryPlan(item: HistoryCardItem): KarteCardHistoryPlan {
  if (item.kind === "vital") return { identifier: `${VITAL_ENTRY_SYSTEM}|${item.entry.entryId}` };
  if (item.kind === "qr") return { main: { resourceType: "QuestionnaireResponse", id: item.id } };
  if (item.kind === "pathway-evaluation") {
    return { main: { resourceType: "Observation", id: item.evaluation.observation.id ?? "" } };
  }
  const main = { resourceType: "ServiceRequest", id: item.id };
  if ("medicationRequests" in item) return { main, children: "MedicationRequest" };
  if ("itemRequests" in item) return { main, children: "ServiceRequest" };
  return { main };
}

/** 1 リソースの 1 版。削除の版は resource が null。 */
export interface ResourceVersion {
  /** "ServiceRequest/xxx" */
  reference: string;
  lastModified: string;
  resource: fhir4.Resource | null;
}

/** history Bundle の entry を版に読み替える。 */
export function resourceVersionsOf(bundle: fhir4.Bundle | undefined): ResourceVersion[] {
  return (bundle?.entry ?? []).flatMap((entry) => {
    const reference = entry.request?.url ?? "";
    const lastModified = entry.response?.lastModified ?? entry.resource?.meta?.lastUpdated ?? "";
    if (!reference || !lastModified) return [];
    const deleted = entry.request?.method === "DELETE" || !entry.resource;
    return [{ reference, lastModified, resource: deleted ? null : (entry.resource ?? null) }];
  });
}

export interface KarteCardVersion {
  /** 古い方から 1, 2, … */
  versionNo: number;
  /** その編集の最後の書き込みの時刻。 */
  lastModified: string;
  item: HistoryCardItem;
}

// 1 回の登録・編集は 1 つの transaction で書かれ、リソースごとの時刻はミリ秒単位でずれる。
// 書き込みの間がこれより短いものは同じ編集とみなす(人の操作でこの間隔に 2 回は保存できない)。
const SAME_EDIT_GAP_MS = 2000;

/**
 * 集めた版から、編集ごとのカードを組み直す(新しい順)。内容が前の版と変わらない書き込み
 * (同じ内容での保存)は版に数えない。本体が無い時点(登録前)は出さない。
 */
export function buildKarteCardVersions(
  item: HistoryCardItem,
  versions: ResourceVersion[],
): KarteCardVersion[] {
  const sorted = [...versions].sort((a, b) => a.lastModified.localeCompare(b.lastModified));
  const state = new Map<string, fhir4.Resource | null>();
  const result: KarteCardVersion[] = [];
  let previousSignature = "";

  for (let index = 0; index < sorted.length; index += 1) {
    const version = sorted[index];
    state.set(version.reference, version.resource);
    const next = sorted[index + 1];
    if (next && Date.parse(next.lastModified) - Date.parse(version.lastModified) <= SAME_EDIT_GAP_MS) continue;

    const rebuilt = rebuildItem(item, state);
    if (!rebuilt) continue;
    const signature = stateSignature(state);
    if (signature === previousSignature) continue;
    previousSignature = signature;
    result.push({ versionNo: result.length + 1, lastModified: version.lastModified, item: rebuilt });
  }
  return result.reverse();
}

function liveResources<T extends fhir4.Resource>(
  state: Map<string, fhir4.Resource | null>,
  resourceType: T["resourceType"],
): T[] {
  return [...state.values()].filter((r): r is T => r?.resourceType === resourceType);
}

// 版の比較に使う中身。meta(版番号・更新時刻)は保存のたびに変わるので外す。
function stateSignature(state: Map<string, fhir4.Resource | null>): string {
  return JSON.stringify(
    [...state.entries()]
      .filter(([, resource]) => resource)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([reference, resource]) => [reference, { ...resource, meta: undefined }]),
  );
}

function rebuildItem(
  item: HistoryCardItem,
  state: Map<string, fhir4.Resource | null>,
): HistoryCardItem | null {
  if (item.kind === "vital") {
    const entry = groupVitalEntries(liveResources<fhir4.Observation>(state, "Observation"))[0];
    return entry
      ? { ...item, entry, day: localDay(entry.effectiveDateTime), dateTime: entry.effectiveDateTime }
      : null;
  }

  const main = karteCardHistoryPlan(item).main;
  const resource = main ? state.get(`${main.resourceType}/${main.id}`) : null;
  if (!resource) return null;

  if (item.kind === "qr") {
    const response = resource as fhir4.QuestionnaireResponse;
    return { ...item, response, day: localDay(response.authored), dateTime: response.authored ?? "" };
  }
  if (item.kind === "pathway-evaluation") {
    return { ...item, evaluation: withEvaluationObservation(item.evaluation, resource as fhir4.Observation) };
  }

  const serviceRequest = resource as fhir4.ServiceRequest;
  let rebuilt: HistoryCardItem = {
    ...item,
    serviceRequest,
    day: orderCardDay(serviceRequest),
    dateTime: serviceRequest.authoredOn ?? "",
  };
  if ("medicationRequests" in rebuilt) {
    rebuilt = { ...rebuilt, medicationRequests: liveResources<fhir4.MedicationRequest>(state, "MedicationRequest") };
  }
  if ("itemRequests" in rebuilt) {
    rebuilt = {
      ...rebuilt,
      itemRequests: labOrderItemRequests(liveResources<fhir4.ServiceRequest>(state, "ServiceRequest"), item.id),
    };
  }
  if ("performs" in rebuilt) rebuilt = { ...rebuilt, performs: [] };
  if ("fractions" in rebuilt) rebuilt = { ...rebuilt, fractions: [] };
  return rebuilt;
}
