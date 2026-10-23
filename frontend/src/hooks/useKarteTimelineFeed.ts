import { useCallback, useMemo, useRef } from "react";
import {
  useFacilitySettings,
  useKarteClinicalNotesInfinite,
  useKartePathwayEvaluations,
  useKartePendingOrders,
  useKartePrescriptionsInfinite,
  useKarteQuestionnaireResponsesInfinite,
  useKarteVitalsInfinite,
  type KarteProblemFilter,
  type KarteScope,
} from "../api/queries";
import { DEFAULT_KARTE_CARD_ORDER, sortKarteDayGroups } from "../fhir/karteCardOrderHelpers";
import { buildKarteTimeline, type KarteTimelineResult } from "../fhir/karteTimeline";

// カルテのタイムラインの読み込み。診療記録・処方(オーダー)・テンプレート回答・バイタルを
// それぞれオフセットページングで読み(docs/features/karte.md「無限スクロール」)、日付未定・先の予定の
// オーダーとパス評価は先読みして、buildKarteTimeline で診療日ごとにまとめる。
// カルテ画面(左ペインのカルテタブ)と診療ダッシュボードの「カルテ」カードが同じ hook を使う。

export function useKarteTimelineFeed(patientId: string | undefined, problemIds: KarteProblemFilter, scope: KarteScope) {
  const notes = useKarteClinicalNotesInfinite(patientId, problemIds, scope);
  const prescriptions = useKartePrescriptionsInfinite(patientId, problemIds, scope);
  const responses = useKarteQuestionnaireResponsesInfinite(patientId, problemIds, scope);
  // 日付未定・開始日が今日より後のオーダーは本流(開始日が今日以前)に乗らないので別に先読みする。
  const pendingOrders = useKartePendingOrders(patientId, problemIds, scope);
  const vitals = useKarteVitalsInfinite(patientId, problemIds, scope);
  // 記載のあるパスの評価。患者ぶんを全部読むので、ページングの判定には加わらない。
  const pathwayEvaluations = useKartePathwayEvaluations(patientId, problemIds);

  const facilitySettings = useFacilitySettings();
  const cardOrder = facilitySettings.data?.karte_card_order ?? DEFAULT_KARTE_CARD_ORDER;
  const timeline = useMemo<KarteTimelineResult>(() => {
    const built = buildKarteTimeline({
      noteBundles: notes.data?.pages.map((page) => page.data) ?? [],
      prescriptionBundles: prescriptions.data?.pages.map((page) => page.data) ?? [],
      pendingBundles: pendingOrders.bundles,
      responseBundles: responses.data?.pages.map((page) => page.data) ?? [],
      vitalBundles: vitals.data?.pages.map((page) => page.data) ?? [],
      pathwayEvaluations: pathwayEvaluations.data ?? [],
      noteHasNext: Boolean(notes.hasNextPage),
      prescriptionHasNext: Boolean(prescriptions.hasNextPage),
      responseHasNext: Boolean(responses.hasNextPage),
      vitalHasNext: Boolean(vitals.hasNextPage),
    });
    return { ...built, groups: sortKarteDayGroups(built.groups, cardOrder, "desc") };
  }, [
    cardOrder,
    notes.data,
    prescriptions.data,
    pendingOrders.bundles,
    responses.data,
    vitals.data,
    pathwayEvaluations.data,
    notes.hasNextPage,
    prescriptions.hasNextPage,
    responses.hasNextPage,
    vitals.hasNextPage,
  ]);

  // 表示範囲を押し下げているソースだけ次ページを読む。呼び出し側は effect から呼ぶので、
  // 最新の状態を ref 経由で読む安定した関数にする。
  const sources = useRef({ notes, prescriptions, responses, vitals, timeline });
  sources.current = { notes, prescriptions, responses, vitals, timeline };
  const loadMore = useCallback(() => {
    const { notes, prescriptions, responses, vitals, timeline } = sources.current;
    if (timeline.pending.note && !notes.isFetchingNextPage) notes.fetchNextPage();
    if (timeline.pending.prescription && !prescriptions.isFetchingNextPage) prescriptions.fetchNextPage();
    if (timeline.pending.qr && !responses.isFetchingNextPage) responses.fetchNextPage();
    if (timeline.pending.vital && !vitals.isFetchingNextPage) vitals.fetchNextPage();
  }, []);

  // 取得が一段落するたびに追加読み込みを再判定させるためのトークン。
  const loadToken = [
    notes.data?.pages.length ?? 0,
    prescriptions.data?.pages.length ?? 0,
    responses.data?.pages.length ?? 0,
    vitals.data?.pages.length ?? 0,
    timeline.pending.note,
    timeline.pending.prescription,
    timeline.pending.qr,
    timeline.pending.vital,
  ].join("/");

  return {
    timeline,
    pathwayEvaluations: pathwayEvaluations.data ?? [],
    loadMore,
    loadToken,
    isLoading: notes.isPending || prescriptions.isPending || responses.isPending || vitals.isPending,
    isFetchingMore:
      notes.isFetchingNextPage || prescriptions.isFetchingNextPage || responses.isFetchingNextPage || vitals.isFetchingNextPage,
    /** 本流 4 つと先読みのオーダーがすべて届いた(開いた位置を合わせてよい)。 */
    ready:
      !notes.isPending && !prescriptions.isPending && !responses.isPending && !vitals.isPending && !pendingOrders.isPending,
    errors: {
      notes: notes.error,
      prescriptions: prescriptions.error,
      pendingOrders: pendingOrders.error,
      responses: responses.error,
      pathwayEvaluations: pathwayEvaluations.error,
    },
    pendingOrdersTruncated: pendingOrders.truncated,
  };
}
