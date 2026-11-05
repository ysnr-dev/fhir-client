import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ADVERSE_EVENT_CATEGORY, parseAdverseEvent, type AdverseEventRecord } from "../../fhir/adverseEventHelpers";
import {
  buildKarteCardVersions,
  groupCardVersions,
  karteCardHistoryPlan,
  resourceVersionsOf,
  type HistoryCardItem,
  type KarteCardVersion,
  type ResourceVersion,
} from "../../fhir/karteCardHistory";
import {
  childrenDeletedWith,
  deletedStates,
  deletedVitalObservations,
  finalStates,
  responseIdsReferencedBy,
  searchsetOf,
} from "../../fhir/karteDeletedItems";
import {
  buildKarteTimeline,
  karteItemKey,
  karteItemMainReferences,
  type KarteDayGroup,
  type KarteTimelineItem,
} from "../../fhir/karteTimeline";
import { DEFAULT_KARTE_CARD_ORDER, sortKarteDayItems } from "../../fhir/karteCardOrderHelpers";
import { deleteRecordsByTarget, type DeleteRecord } from "../../fhir/provenanceHelpers";
import { readTypeHistory } from "../fhirClient";
import { hasNextPage, searchAllPages } from "./core";
import {
  appendKarteOrderIncludes,
  karteNoteParams,
  karteOrderParams,
  karteResponseParams,
  karteVitalParams,
  useKartePathwayEvaluations,
} from "./karte";
import { usePatientAdverseEvents } from "./adverseEvent";
import { readAllTypeHistory } from "./karteCardHistory";
import { useFacilitySettings } from "./organization";

// ---- カルテ印刷 ----
//
// 期間を指定してカルテ 2 号用紙を印刷する。タイムラインと同じ検索条件を期間で切って
// 全件読み、同じ buildKarteTimeline でカードにする(画面のカードと同じものが印字される)。
// 履歴を印刷するときは、カードを作るリソースの版を型レベルの _history でまとめて引き、
// 削除した記録も並べる(1 件ずつ引くとレート制限に掛かる)。

const PRINT_PAGE = 100;
const PRINT_MAX_PAGES = 10;
// バイタルは 1 回の測定が項目ごとの Observation に分かれるので、1 ページを大きく取る。
const PRINT_VITAL_PAGE = 500;
// 型レベルの _history に渡す id の 1 回ぶん(URL の長さを抑える)。
const HISTORY_ID_CHUNK = 50;
// 削除した記録を探す型レベルの _history。残っているリソースの版も返るので 1 ページを大きく取る。
const PRINT_HISTORY_PAGE = 500;
const PRINT_HISTORY_MAX_PAGES = 10;

interface KartePrintSource {
  noteBundles: fhir4.Bundle[];
  orderBundles: fhir4.Bundle[];
  responseBundles: fhir4.Bundle[];
  vitalBundles: fhir4.Bundle[];
  truncated: boolean;
}

function setRange(params: URLSearchParams, name: string, from: string, to: string) {
  params.append(name, `ge${from}`);
  params.append(name, `le${to}`);
}

// タイムラインと同じ検索条件を期間で切ったもの。_sort / _include は読む側で足す
// (削除した記録を型レベルの _history で引くときは条件だけを使う)。
function kartePrintCriteria(patientId: string, from: string, to: string) {
  const notes = karteNoteParams(patientId);
  setRange(notes, "date", from, to);

  const orders = karteOrderParams(patientId);
  setRange(orders, "occurrence", from, to);

  // 開始日を持たないオーダーは登録日の日に出るもの(タイムラインの orderCardDay)。
  // 日付未定に出る種別も混ざるが、日付未定の日は印刷しないので並べる側で落ちる。
  const undatedOrders = karteOrderParams(patientId);
  undatedOrders.set("occurrence:missing", "true");
  setRange(undatedOrders, "authoredon", from, to);

  const responses = karteResponseParams(patientId);
  setRange(responses, "authored", from, to);

  const vitals = karteVitalParams(patientId);
  setRange(vitals, "date", from, to);

  // 有害事象は患者ぶんを全部読んで発現日で並べる(タイムラインと同じ)。
  const adverseEvents = new URLSearchParams();
  adverseEvents.set("patient", `Patient/${patientId}`);
  adverseEvents.set("category", ADVERSE_EVENT_CATEGORY.code);

  return { notes, orders, undatedOrders, responses, vitals, adverseEvents };
}

async function readKartePrintSource(patientId: string, from: string, to: string): Promise<KartePrintSource> {
  const { notes, orders, undatedOrders, responses, vitals } = kartePrintCriteria(patientId, from, to);
  notes.set("_sort", "date");
  orders.set("_sort", "occurrence");
  appendKarteOrderIncludes(orders);
  undatedOrders.set("_sort", "authoredon");
  appendKarteOrderIncludes(undatedOrders);
  responses.set("_sort", "authored");
  responses.set("_include", "QuestionnaireResponse:questionnaire");
  vitals.set("_sort", "date");

  const options = { page: PRINT_PAGE, maxPages: PRINT_MAX_PAGES };
  const [noteResult, orderResult, undatedResult, responseResult, vitalResult] = await Promise.all([
    searchAllPages<fhir4.Composition>("Composition", notes, options),
    searchAllPages<fhir4.ServiceRequest>("ServiceRequest", orders, options),
    searchAllPages<fhir4.ServiceRequest>("ServiceRequest", undatedOrders, options),
    searchAllPages<fhir4.QuestionnaireResponse>("QuestionnaireResponse", responses, options),
    searchAllPages<fhir4.Observation>("Observation", vitals, { page: PRINT_VITAL_PAGE, maxPages: PRINT_MAX_PAGES }),
  ]);
  return {
    noteBundles: noteResult.bundles,
    orderBundles: [...orderResult.bundles, ...undatedResult.bundles],
    responseBundles: responseResult.bundles,
    vitalBundles: vitalResult.bundles,
    truncated: [noteResult, orderResult, undatedResult, responseResult, vitalResult].some((r) => r.truncated),
  };
}

// ---- 削除した記録 ----
//
// 「履歴を印刷」では、期間内に削除した記録も最後に残っていた内容で並べる。上流は論理削除で、
// 検索条件付きの型レベル _history が削除済みのリソースの版も返すので、タイムラインと同じ条件で
// 版を引き、最後の版が削除のものを拾う(残っているリソースの版も返るので数は多い)。
// 誰が・なぜ消したかは中継が添えた削除の来歴(Provenance)から引く。

interface KartePrintDeleted {
  noteBundles: fhir4.Bundle[];
  orderBundles: fhir4.Bundle[];
  responseBundles: fhir4.Bundle[];
  vitalBundles: fhir4.Bundle[];
  adverseEvents: AdverseEventRecord[];
  /** 削除されたリソースの参照 → 削除の記録(来歴が無い削除は時刻だけ)。 */
  deletions: Map<string, DeleteRecord>;
  truncated: boolean;
}

async function readTypeHistoryPages(
  resourceType: string,
  params: URLSearchParams,
): Promise<{ versions: ResourceVersion[]; truncated: boolean }> {
  const versions: ResourceVersion[] = [];
  for (let page = 0; page < PRINT_HISTORY_MAX_PAGES; page += 1) {
    const pageParams = new URLSearchParams(params);
    pageParams.set("_count", String(PRINT_HISTORY_PAGE));
    pageParams.set("_offset", String(page * PRINT_HISTORY_PAGE));
    const { data: bundle } = await readTypeHistory(resourceType, pageParams);
    versions.push(...resourceVersionsOf(bundle));
    if (!hasNextPage(bundle)) return { versions, truncated: false };
  }
  return { versions, truncated: true };
}

async function readQuestionnaires(responses: fhir4.QuestionnaireResponse[]): Promise<fhir4.Questionnaire[]> {
  const urls = [...new Set(responses.map((response) => response.questionnaire?.split("|")[0] ?? ""))].filter(Boolean);
  const questionnaires: fhir4.Questionnaire[] = [];
  for (const chunk of chunks(urls, HISTORY_ID_CHUNK)) {
    const result = await searchAllPages<fhir4.Questionnaire>(
      "Questionnaire",
      new URLSearchParams({ url: chunk.join(",") }),
      { page: PRINT_PAGE, maxPages: PRINT_MAX_PAGES },
    );
    questionnaires.push(...result.matches);
  }
  return questionnaires;
}

async function readDeleteRecords(references: string[]): Promise<Map<string, DeleteRecord>> {
  const provenances: fhir4.Provenance[] = [];
  for (const chunk of chunks(references, HISTORY_ID_CHUNK)) {
    const result = await searchAllPages<fhir4.Provenance>(
      "Provenance",
      new URLSearchParams({ target: chunk.join(",") }),
      { page: PRINT_PAGE, maxPages: PRINT_MAX_PAGES },
    );
    provenances.push(...result.matches);
  }
  return deleteRecordsByTarget(provenances);
}

async function readKartePrintDeleted(patientId: string, from: string, to: string): Promise<KartePrintDeleted> {
  const criteria = kartePrintCriteria(patientId, from, to);
  const [notes, orders, undatedOrders, responses, vitals, adverseEvents] = await Promise.all([
    readTypeHistoryPages("Composition", criteria.notes),
    readTypeHistoryPages("ServiceRequest", criteria.orders),
    readTypeHistoryPages("ServiceRequest", criteria.undatedOrders),
    readTypeHistoryPages("QuestionnaireResponse", criteria.responses),
    readTypeHistoryPages("Observation", criteria.vitals),
    readTypeHistoryPages("Observation", criteria.adverseEvents),
  ]);

  // 確定前の下書きは記録になる前のものなので出さない。
  const deletedNotes = deletedStates(finalStates(notes.versions)).filter(
    (state) => (state.resource as fhir4.Composition).status !== "preliminary",
  );
  const deletedHeaders = deletedStates(finalStates([...orders.versions, ...undatedOrders.versions]));
  const headerRefs = deletedHeaders.map((state) => state.reference);
  const medicationVersions = await readHistoryOf("MedicationRequest", "based-on", headerRefs);
  const itemVersions = await readHistoryOf("ServiceRequest", "based-on", headerRefs);
  const componentVersions = await readHistoryOf(
    "ServiceRequest",
    "based-on",
    [...new Set(itemVersions.map((version) => version.reference))],
  );
  const children = childrenDeletedWith(
    deletedHeaders,
    finalStates([...medicationVersions, ...itemVersions, ...componentVersions]),
  );

  // 記録の本文として出る回答(記録と一緒に消えたもの・記録の編集で外したもの)は単独のカードにしない。
  const linkedResponseIds = responseIdsReferencedBy([...notes.versions, ...orders.versions, ...undatedOrders.versions]);
  const deletedResponses = deletedStates(finalStates(responses.versions)).filter(
    (state) => !linkedResponseIds.has(state.resource.id ?? ""),
  );
  const questionnaires = await readQuestionnaires(
    deletedResponses.map((state) => state.resource as fhir4.QuestionnaireResponse),
  );
  const deletedVitals = deletedVitalObservations(finalStates(vitals.versions));
  const deletedAdverseEvents = deletedStates(finalStates(adverseEvents.versions));

  const deleted = [...deletedNotes, ...deletedHeaders, ...deletedResponses, ...deletedVitals, ...deletedAdverseEvents];
  const records = deleted.length > 0 ? await readDeleteRecords(deleted.map((state) => state.reference)) : new Map();
  const deletions = new Map<string, DeleteRecord>();
  for (const state of deleted) {
    deletions.set(state.reference, records.get(state.reference) ?? { at: state.deletedAt ?? "", name: "", reason: "" });
  }

  return {
    noteBundles: [searchsetOf(deletedNotes.map((state) => state.resource))],
    orderBundles: [searchsetOf([...deletedHeaders.map((state) => state.resource), ...children])],
    responseBundles: [searchsetOf([...deletedResponses.map((state) => state.resource), ...questionnaires])],
    vitalBundles: [searchsetOf(deletedVitals.map((state) => state.resource))],
    adverseEvents: deletedAdverseEvents.flatMap((state) => parseAdverseEvent(state.resource as fhir4.Observation) ?? []),
    deletions,
    truncated: [notes, orders, undatedOrders, responses, vitals, adverseEvents].some((r) => r.truncated),
  };
}

/**
 * 期間内のカルテ(古い日から)。日付未定・日付なしの日は含めない。
 * withDeleted のときは削除した記録も並べ、`deletions` にカードのキー → 削除の記録を返す。
 */
export function useKartePrintTimeline(
  patientId: string | undefined,
  from: string,
  to: string,
  withDeleted: boolean,
) {
  const source = useQuery({
    queryKey: ["karte-print", patientId, from, to],
    queryFn: () => readKartePrintSource(patientId as string, from, to),
    enabled: Boolean(patientId && from && to),
  });
  const deleted = useQuery({
    queryKey: ["karte-print-deleted", patientId, from, to],
    queryFn: () => readKartePrintDeleted(patientId as string, from, to),
    enabled: Boolean(patientId && from && to && withDeleted),
  });
  const pathwayEvaluations = useKartePathwayEvaluations(patientId, null);
  const adverseEvents = usePatientAdverseEvents(patientId);
  const cardOrder = useFacilitySettings().data?.karte_card_order ?? DEFAULT_KARTE_CARD_ORDER;

  const { groups, deletions } = useMemo(() => {
    const empty = { groups: [] as KarteDayGroup[], deletions: new Map<string, DeleteRecord>() };
    if (!source.data || !pathwayEvaluations.data || !adverseEvents.data) return empty;
    if (withDeleted && !deleted.data) return empty;
    const extra = withDeleted ? deleted.data : undefined;
    const timeline = buildKarteTimeline({
      noteBundles: [...source.data.noteBundles, ...(extra?.noteBundles ?? [])],
      prescriptionBundles: [...source.data.orderBundles, ...(extra?.orderBundles ?? [])],
      pendingBundles: [],
      responseBundles: [...source.data.responseBundles, ...(extra?.responseBundles ?? [])],
      vitalBundles: [...source.data.vitalBundles, ...(extra?.vitalBundles ?? [])],
      pathwayEvaluations: pathwayEvaluations.data,
      adverseEvents: [...adverseEvents.data, ...(extra?.adverseEvents ?? [])],
      noteHasNext: false,
      prescriptionHasNext: false,
      responseHasNext: false,
      vitalHasNext: false,
    });
    const groups = timeline.groups
      .filter((group) => /^\d{4}-\d{2}-\d{2}$/.test(group.day) && group.day >= from && group.day <= to)
      .map((group) => ({
        ...group,
        items: sortKarteDayItems(group.items, cardOrder, "asc"),
      }))
      .sort((a, b) => a.day.localeCompare(b.day));
    return { groups, deletions: extra ? itemDeletions(groups, extra.deletions) : empty.deletions };
  }, [source.data, deleted.data, withDeleted, pathwayEvaluations.data, adverseEvents.data, from, to, cardOrder]);

  const queries = [source, ...(withDeleted ? [deleted] : []), pathwayEvaluations, adverseEvents];
  return {
    groups,
    deletions,
    truncated: Boolean(source.data?.truncated || (withDeleted && deleted.data?.truncated)),
    isPending: queries.some((query) => query.isPending),
    error: queries.find((query) => query.error)?.error ?? null,
  };
}

// カードの本体がすべて削除されたものだけを削除したカードにする(バイタルは 1 回ぶんの Observation 全部)。
function itemDeletions(groups: KarteDayGroup[], byReference: Map<string, DeleteRecord>): Map<string, DeleteRecord> {
  const result = new Map<string, DeleteRecord>();
  for (const item of groups.flatMap((group) => group.items)) {
    const references = karteItemMainReferences(item);
    if (references.length === 0 || !references.every((reference) => byReference.has(reference))) continue;
    const records = references.map((reference) => byReference.get(reference) as DeleteRecord);
    result.set(karteItemKey(item), records.find((record) => record.name) ?? records[0]);
  }
  return result;
}

/** カードごとの版(新しい順)。診療記録は Composition の版、それ以外は編集ごとに組み直したカード。 */
export interface KartePrintHistory {
  notes: Map<string, fhir4.Composition[]>;
  cards: Map<string, KarteCardVersion[]>;
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function readHistoryOf(
  resourceType: string,
  name: string,
  values: string[],
): Promise<ResourceVersion[]> {
  const versions: ResourceVersion[] = [];
  for (const chunk of chunks([...new Set(values)], HISTORY_ID_CHUNK)) {
    versions.push(...(await readAllTypeHistory(resourceType, new URLSearchParams({ [name]: chunk.join(",") }))));
  }
  return versions;
}

function idOf(reference: string): string {
  return reference.split("/").pop() ?? "";
}

async function readKartePrintHistory(items: KarteTimelineItem[]): Promise<KartePrintHistory> {
  const noteIds = items.flatMap((item) => (item.kind === "note" ? [item.id] : []));
  const cardItems = items.filter((item): item is HistoryCardItem => item.kind !== "note");
  const plans = cardItems.map(karteCardHistoryPlan);
  const mainIds = (resourceType: string) =>
    plans.flatMap((plan) => (plan.main?.resourceType === resourceType ? [plan.main.id] : []));
  const headerRefs = (children: "ServiceRequest" | "MedicationRequest") =>
    plans.flatMap((plan) => (plan.main && plan.children === children ? [`ServiceRequest/${plan.main.id}`] : []));

  const noteVersions = await readHistoryOf("Composition", "_id", noteIds);
  const versions: ResourceVersion[] = [
    ...(await readHistoryOf("ServiceRequest", "_id", mainIds("ServiceRequest"))),
    ...(await readHistoryOf("QuestionnaireResponse", "_id", mainIds("QuestionnaireResponse"))),
    ...(await readHistoryOf("Observation", "_id", mainIds("Observation"))),
    ...(await readHistoryOf("Observation", "identifier", plans.flatMap((plan) => plan.identifier ?? []))),
    ...(await readHistoryOf("MedicationRequest", "based-on", headerRefs("MedicationRequest"))),
  ];
  // ヘッダ → 明細 → 構成項目の 2 段。構成項目は明細(消したものも含む)を親に引く。
  const orderItems = await readHistoryOf("ServiceRequest", "based-on", headerRefs("ServiceRequest"));
  const components = await readHistoryOf(
    "ServiceRequest",
    "based-on",
    [...new Set(orderItems.map((version) => version.reference))],
  );
  versions.push(...orderItems, ...components);

  const notes = new Map<string, fhir4.Composition[]>();
  for (const version of noteVersions) {
    if (version.resource?.resourceType !== "Composition") continue;
    const id = idOf(version.reference);
    notes.set(id, [...(notes.get(id) ?? []), version.resource as fhir4.Composition]);
  }
  for (const list of notes.values()) {
    list.sort((a, b) => Number(b.meta?.versionId ?? 0) - Number(a.meta?.versionId ?? 0));
  }

  const grouped = groupCardVersions(cardItems, versions);
  const cards = new Map<string, KarteCardVersion[]>();
  for (const item of cardItems) {
    const key = karteItemKey(item);
    cards.set(key, buildKarteCardVersions(item, grouped.get(key) ?? []));
  }
  return { notes, cards };
}

/** 印刷するカードの変更履歴。enabled のときだけ引く。 */
export function useKartePrintHistory(items: KarteTimelineItem[], enabled: boolean) {
  const keys = useMemo(() => items.map(karteItemKey).join(","), [items]);
  return useQuery({
    queryKey: ["karte-print-history", keys],
    queryFn: () => readKartePrintHistory(items),
    enabled: enabled && items.length > 0,
  });
}
