import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  buildKarteCardVersions,
  groupCardVersions,
  karteCardHistoryPlan,
  type HistoryCardItem,
  type KarteCardVersion,
  type ResourceVersion,
} from "../../fhir/karteCardHistory";
import {
  buildKarteTimeline,
  karteItemKey,
  type KarteDayGroup,
  type KarteTimelineItem,
} from "../../fhir/karteTimeline";
import { DEFAULT_KARTE_CARD_ORDER, sortKarteDayItems } from "../../fhir/karteCardOrderHelpers";
import { searchAllPages } from "./core";
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
// 履歴を印刷するときは、カードを作るリソースの版を型レベルの _history でまとめて引く
// (1 件ずつ引くとレート制限に掛かる)。

const PRINT_PAGE = 100;
const PRINT_MAX_PAGES = 10;
// バイタルは 1 回の測定が項目ごとの Observation に分かれるので、1 ページを大きく取る。
const PRINT_VITAL_PAGE = 500;
// 型レベルの _history に渡す id の 1 回ぶん(URL の長さを抑える)。
const HISTORY_ID_CHUNK = 50;

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

async function readKartePrintSource(patientId: string, from: string, to: string): Promise<KartePrintSource> {
  const notes = karteNoteParams(patientId);
  setRange(notes, "date", from, to);
  notes.set("_sort", "date");

  const orders = karteOrderParams(patientId);
  setRange(orders, "occurrence", from, to);
  orders.set("_sort", "occurrence");
  appendKarteOrderIncludes(orders);

  // 開始日を持たないオーダーは登録日の日に出るもの(タイムラインの orderCardDay)。
  // 日付未定に出る種別も混ざるが、日付未定の日は印刷しないので並べる側で落ちる。
  const undatedOrders = karteOrderParams(patientId);
  undatedOrders.set("occurrence:missing", "true");
  setRange(undatedOrders, "authoredon", from, to);
  undatedOrders.set("_sort", "authoredon");
  appendKarteOrderIncludes(undatedOrders);

  const responses = karteResponseParams(patientId);
  setRange(responses, "authored", from, to);
  responses.set("_sort", "authored");
  responses.set("_include", "QuestionnaireResponse:questionnaire");

  const vitals = karteVitalParams(patientId);
  setRange(vitals, "date", from, to);
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

/** 期間内のカルテ(古い日から)。日付未定・日付なしの日は含めない。 */
export function useKartePrintTimeline(patientId: string | undefined, from: string, to: string) {
  const source = useQuery({
    queryKey: ["karte-print", patientId, from, to],
    queryFn: () => readKartePrintSource(patientId as string, from, to),
    enabled: Boolean(patientId && from && to),
  });
  const pathwayEvaluations = useKartePathwayEvaluations(patientId, null);
  const adverseEvents = usePatientAdverseEvents(patientId);
  const cardOrder = useFacilitySettings().data?.karte_card_order ?? DEFAULT_KARTE_CARD_ORDER;

  const groups = useMemo<KarteDayGroup[]>(() => {
    if (!source.data || !pathwayEvaluations.data || !adverseEvents.data) return [];
    const timeline = buildKarteTimeline({
      noteBundles: source.data.noteBundles,
      prescriptionBundles: source.data.orderBundles,
      pendingBundles: [],
      responseBundles: source.data.responseBundles,
      vitalBundles: source.data.vitalBundles,
      pathwayEvaluations: pathwayEvaluations.data,
      adverseEvents: adverseEvents.data,
      noteHasNext: false,
      prescriptionHasNext: false,
      responseHasNext: false,
      vitalHasNext: false,
    });
    return timeline.groups
      .filter((group) => /^\d{4}-\d{2}-\d{2}$/.test(group.day) && group.day >= from && group.day <= to)
      .map((group) => ({
        ...group,
        items: sortKarteDayItems(group.items, cardOrder, "asc"),
      }))
      .sort((a, b) => a.day.localeCompare(b.day));
  }, [source.data, pathwayEvaluations.data, adverseEvents.data, from, to, cardOrder]);

  return {
    groups,
    truncated: Boolean(source.data?.truncated),
    isPending: source.isPending || pathwayEvaluations.isPending || adverseEvents.isPending,
    error: source.error ?? pathwayEvaluations.error ?? adverseEvents.error ?? null,
  };
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
