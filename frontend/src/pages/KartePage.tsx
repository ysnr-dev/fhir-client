import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  useKarteClinicalNotesInfinite,
  useKarteConditions,
  useKarteDayIndex,
  useKartePrescriptionsInfinite,
  useKarteQuestionnaireResponsesInfinite,
  useKarteVitalsInfinite,
  type KarteProblemFilter,
} from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { KarteAllergyTab } from "../components/KarteAllergyTab";
import { KarteAppointmentTab } from "../components/KarteAppointmentTab";
import { KarteConditionTab } from "../components/KarteConditionTab";
import { KarteSidePane } from "../components/KarteSidePane";
import { VitalFlowsheetPanel } from "../components/VitalFlowsheetPanel";
import { KarteLabResultTab } from "../components/KarteLabResultTab";
import { LabResultTimelinePanel } from "../components/LabResultTimelinePanel";
import { KarteMicroResultTab } from "../components/KarteMicroResultTab";
import { KarteProblemList } from "../components/KarteProblemList";
import { KarteProblemSummary } from "../components/KarteProblemSummary";
import { KarteDetailModal } from "../components/KarteCardModals";
import { KarteRightPane, type KartePaneState } from "../components/KarteRightPane";
import { KarteSplitter } from "../components/KarteSplitter";
import { KARTE_TARGET_ATTR, KarteTimeline } from "../components/KarteTimeline";
import { PatientHeader } from "../components/PatientHeader";
import {
  problemLabel,
  problemWithDescendantIds,
  splitConditions,
} from "../fhir/conditionHelpers";
import {
  buildKarteTimeline,
  filterKarteGroupsByCard,
  mergeDayIndex,
  type KarteCardFilter,
  type KarteTimelineItem,
} from "../fhir/karteTimeline";
import {
  KARTE_CARD_PARAM,
  KARTE_DETAIL_PARAM,
  KARTE_LAB_GROUP,
  KARTE_OTHER_TABS,
  KARTE_PROBLEM_PARAM,
  KARTE_TAB_PARAM,
  KARTE_TABS,
  KARTE_VIEW_PARAM,
  formatKarteCard,
  formatKarteDetail,
  parseKarteCard,
  parseKarteDetail,
  parseKarteTab,
  type KarteDetailTarget,
  type KarteOtherTabKey,
  type KarteTabKey,
} from "../karteUrl";
import { useKarteReturnTo } from "../karteReturn";
import {
  clampLeftWidthRatio,
  clampTopRatio,
  readDayListVisible,
  readLeftPaneMode,
  readLeftWidthRatio,
  readProblemListVisible,
  readProblemMode,
  readResolvedProblemsVisible,
  readSidePaneMode,
  readTopRatio,
  storeDayListVisible,
  storeLeftPaneMode,
  storeLeftWidthRatio,
  storeProblemListVisible,
  storeProblemMode,
  storeResolvedProblemsVisible,
  storeSidePaneMode,
  storeTopRatio,
  type KarteLeftPaneMode,
  type KarteProblemMode,
  type KarteSidePaneMode,
} from "../karteLayout";

// 患者 1 人のカルテ画面。左ペインで登録済みの情報を参照し、右ペインで登録・編集する。
// 「どのタブで何を開いているか」は URL に持たせる(karteUrl.ts 参照)。

// 診療日パネルから飛んだ先の枠を強調しておく時間。
const HIGHLIGHT_DURATION_MS = 2000;


export function KartePage() {
  const { patientId } = useParams<{ patientId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  // 「戻る」はカルテを開いた元の一覧へ。遷移元が分からなければ全患者へ戻す。
  const returnTo = useKarteReturnTo();

  const tab = parseKarteTab(searchParams.get(KARTE_TAB_PARAM));
  const view = searchParams.get(KARTE_VIEW_PARAM) ?? "";
  const detailTarget = parseKarteDetail(searchParams.get(KARTE_DETAIL_PARAM));

  // 分割モードでカルテタブが選ばれているときの下ペインの既定。URL のタブが
  // カルテ以外ならそれをそのまま使うので、モードを往復しても選択は保たれる。
  const [lastOtherTab, setLastOtherTab] = useState<KarteOtherTabKey>("condition");
  const otherTab: KarteOtherTabKey = tab === "karte" ? lastOtherTab : tab;

  // 何かを開く操作だけ履歴に積む(戻るで一覧に戻れる)。タブ切替や閉じる操作で
  // 積むと、戻るを何度も押さないと画面を離れられなくなる。
  const updateParams = useCallback(
    (mutate: (params: URLSearchParams) => void, push = false) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          mutate(next);
          return next;
        },
        { replace: !push },
      );
    },
    [setSearchParams],
  );

  const selectTab = useCallback(
    (next: KarteTabKey) => {
      // タブが変われば「開いているもの」も意味を失うので一緒に落とす。
      updateParams((params) => {
        params.set(KARTE_TAB_PARAM, next);
        params.delete(KARTE_VIEW_PARAM);
      });
    },
    [updateParams],
  );

  const selectOtherTab = useCallback(
    (next: KarteOtherTabKey) => {
      setLastOtherTab(next);
      selectTab(next);
    },
    [selectTab],
  );

  const selectView = useCallback(
    (next: string | null) => {
      updateParams((params) => {
        if (next) params.set(KARTE_VIEW_PARAM, next);
        else params.delete(KARTE_VIEW_PARAM);
      }, Boolean(next));
    },
    [updateParams],
  );

  const openDetail = useCallback(
    (target: KarteDetailTarget) => {
      updateParams((params) => {
        params.set(KARTE_DETAIL_PARAM, formatKarteDetail(target));
      }, true);
    },
    [updateParams],
  );

  const closeDetail = useCallback(() => {
    updateParams((params) => params.delete(KARTE_DETAIL_PARAM));
  }, [updateParams]);

  const [pane, setPane] = useState<KartePaneState>({ kind: "empty" });
  const [mode, setMode] = useState<KarteLeftPaneMode>(readLeftPaneMode);
  const [topRatio, setTopRatio] = useState(readTopRatio);
  const [leftWidthRatio, setLeftWidthRatio] = useState(readLeftWidthRatio);
  const [dayListVisible, setDayListVisible] = useState(readDayListVisible);
  const [problemListVisible, setProblemListVisible] = useState(readProblemListVisible);
  const [resolvedProblemsVisible, setResolvedProblemsVisible] = useState(
    readResolvedProblemsVisible,
  );
  // 選択中のプロブレム。減光(強調表示)だけの選択は一時的な状態なので URL に載せず、
  // ここに持つ。絞り込み表示は共有できたほうがよいので URL 側(filterProblemId)。
  const [selectedProblemId, setSelectedProblemId] = useState<string | null>(null);
  const [problemMode, setProblemMode] = useState<KarteProblemMode>(readProblemMode);
  const [sidePaneMode, setSidePaneMode] = useState<KarteSidePaneMode>(readSidePaneMode);
  // 情報の種別での絞り込み。共有できるよう URL に載せる(プロブレムと同じ扱い)。
  const cardFilter = parseKarteCard(searchParams.get(KARTE_CARD_PARAM));
  // 絞り込み中のプロブレム。これがあれば「関連する記録のみ表示」の状態。
  const filterProblemId = searchParams.get(KARTE_PROBLEM_PARAM);
  // 減光と絞り込みのどちらであれ、いま選ばれているプロブレム。
  const activeProblemId = filterProblemId ?? selectedProblemId;
  const splitRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef<HTMLDivElement>(null);

  // カルテは 2 ペインで横幅を使うため、この画面だけ #root の幅制限を外す。
  useEffect(() => {
    document.body.classList.add("karte-wide");
    return () => document.body.classList.remove("karte-wide");
  }, []);

  const {
    conditions,
    error: conditionsError,
    isPending: conditionsPending,
  } = useKarteConditions(patientId);

  // プロブレムは一覧表示と、タイムラインのバッジを最新の名称に解決するのに使う。
  const problems = useMemo(() => splitConditions(conditions).problems, [conditions]);
  const problemsById = useMemo(
    () => new Map(problems.map((problem) => [problem.id ?? "", problem])),
    [problems],
  );

  // 選択中のプロブレムと、その下位プロブレム。親を選んだら子に紐付く情報も
  // 同じ扱いにする(合併症を含めた経過を 1 つの軸で追えるようにするため)。
  const activeProblemIds = useMemo(
    () => (activeProblemId ? problemWithDescendantIds(problems, activeProblemId) : null),
    [problems, activeProblemId],
  );

  // タイムラインに渡す絞り込み。下位プロブレムまで含めるので、プロブレムの取得が
  // 終わるまでは undefined(取得を始めない)にして、絞り込み前の並びが一瞬見えたり
  // 直後に読み直しになったりしないようにする。
  const timelineProblemIds = useMemo<KarteProblemFilter>(() => {
    if (!filterProblemId) return null;
    if (conditionsPending) return undefined;
    return [...(activeProblemIds ?? [filterProblemId])].sort();
  }, [filterProblemId, conditionsPending, activeProblemIds]);

  const notes = useKarteClinicalNotesInfinite(patientId, timelineProblemIds);
  const prescriptions = useKartePrescriptionsInfinite(patientId, timelineProblemIds);
  const responses = useKarteQuestionnaireResponsesInfinite(patientId, timelineProblemIds);
  const vitals = useKarteVitalsInfinite(patientId, timelineProblemIds);
  // 診療日ペイン用の全診療日。タイムラインのページングとは別に日付だけを読み切る
  // ので、スクロール(読み込み状況)に関係なく過去の日付まで最初から並ぶ。
  const dayIndex = useKarteDayIndex(patientId, timelineProblemIds);

  // 選択中のプロブレムは、診療記録を新規登録するときの対象の初期値にする。
  const selectedProblem = useMemo(() => {
    const condition = activeProblemId ? problemsById.get(activeProblemId) : undefined;
    return condition
      ? { conditionId: condition.id ?? "", display: problemLabel(condition) }
      : undefined;
  }, [activeProblemId, problemsById]);

  // 種別の絞り込み。開くときだけ履歴に積む(切替・解除で積むと戻るのたびに絞り込みが
  // 戻ってしまう)。
  const selectCardFilter = useCallback(
    (next: KarteCardFilter | null) => {
      updateParams((params) => {
        if (next) params.set(KARTE_CARD_PARAM, formatKarteCard(next));
        else params.delete(KARTE_CARD_PARAM);
      }, Boolean(next) && !cardFilter);
    },
    [updateParams, cardFilter],
  );

  const selectSidePaneMode = useCallback(
    (mode: KarteSidePaneMode) => {
      setSidePaneMode(mode);
      storeSidePaneMode(mode);
      // 診療日に切り替えたら絞り込みは解除する(絞り込みの操作は種別ペインでしか
      // できないので、見えないところで効いたままにしない)。
      if (mode === "days") selectCardFilter(null);
    },
    [selectCardFilter],
  );

  // 絞り込み中は必ず種別を表示する。URL(?card=...)で開いたときも、なぜ絞り込まれて
  // いるのかがペインを見れば分かる。
  const effectiveSidePaneMode: KarteSidePaneMode = cardFilter ? "categories" : sidePaneMode;

  // 絞り込みの解除。選択そのものも落とす(帯のチップだけ選ばれたまま残ると、
  // 何も起きていないのに選択中に見える)。
  const clearProblemFilter = useCallback(() => {
    updateParams((params) => params.delete(KARTE_PROBLEM_PARAM));
    setSelectedProblemId(null);
  }, [updateParams]);

  // プロブレムのチップ。絞り込み中は表示対象の切り替え、そうでなければモードに従う。
  const handleSelectProblem = useCallback(
    (conditionId: string | null) => {
      if (!conditionId) {
        if (filterProblemId) clearProblemFilter();
        else setSelectedProblemId(null);
        return;
      }
      if (problemMode === "filter" || filterProblemId) {
        // 絞り込みを開くのは「何かを開く」操作なので履歴に積む(戻ると減光に戻る)。
        // 対象の差し替えでは積まない(チップを次々押すたびに履歴が伸びるため)。
        updateParams(
          (params) => params.set(KARTE_PROBLEM_PARAM, conditionId),
          !filterProblemId,
        );
      } else {
        setSelectedProblemId(conditionId);
      }
    },
    [filterProblemId, problemMode, updateParams, clearProblemFilter],
  );

  // ケバブメニューでの見せ方の切り替え。選択中のプロブレムがあれば、その場で
  // 減光 ⇔ 絞り込みを移し替える。
  const handleChangeProblemMode = useCallback(
    (next: KarteProblemMode) => {
      setProblemMode(next);
      storeProblemMode(next);
      if (next === "filter" && !filterProblemId && selectedProblemId) {
        updateParams((params) => params.set(KARTE_PROBLEM_PARAM, selectedProblemId), true);
      } else if (next === "dim" && filterProblemId) {
        updateParams((params) => params.delete(KARTE_PROBLEM_PARAM));
        setSelectedProblemId(filterProblemId);
      }
    },
    [filterProblemId, selectedProblemId, updateParams],
  );

  const timeline = useMemo(
    () =>
      buildKarteTimeline({
        noteBundles: notes.data?.pages.map((page) => page.data) ?? [],
        prescriptionBundles: prescriptions.data?.pages.map((page) => page.data) ?? [],
        responseBundles: responses.data?.pages.map((page) => page.data) ?? [],
        vitalBundles: vitals.data?.pages.map((page) => page.data) ?? [],
        noteHasNext: Boolean(notes.hasNextPage),
        prescriptionHasNext: Boolean(prescriptions.hasNextPage),
        responseHasNext: Boolean(responses.hasNextPage),
        vitalHasNext: Boolean(vitals.hasNextPage),
      }),
    [
      notes.data,
      prescriptions.data,
      responses.data,
      vitals.data,
      notes.hasNextPage,
      prescriptions.hasNextPage,
      responses.hasNextPage,
      vitals.hasNextPage,
    ],
  );

  // プロブレムの絞り込みはサーバー検索で済んでいるので、ここで残るのは種別だけ。
  // 種別はページングの判定(カットオフ・pending)より後に行う。判定は読み込み済みの
  // 全データで決まるので、ここで件数が減っても読み進みには影響しない。
  const filteredGroups = useMemo(
    () => (cardFilter ? filterKarteGroupsByCard(timeline.groups, cardFilter) : timeline.groups),
    [timeline.groups, cardFilter],
  );

  // 診療日ペインに出す全日付。読み込み済みの日はタイムラインの項目付き。
  const dayEntries = useMemo(
    () => mergeDayIndex(filteredGroups, dayIndex.days, timeline.cutoff),
    [filteredGroups, dayIndex.days, timeline.cutoff],
  );

  // 表示範囲を押し下げているソースだけ次ページを読む。
  function loadMore() {
    if (timeline.pending.note && !notes.isFetchingNextPage) notes.fetchNextPage();
    if (timeline.pending.prescription && !prescriptions.isFetchingNextPage) {
      prescriptions.fetchNextPage();
    }
    if (timeline.pending.qr && !responses.isFetchingNextPage) responses.fetchNextPage();
    if (timeline.pending.vital && !vitals.isFetchingNextPage) vitals.fetchNextPage();
  }

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

  // 診療日パネルからタイムラインの該当位置へ飛ぶ。scrollIntoView はページ側も
  // スクロールさせてしまうため、タイムラインのスクロール位置だけを動かす。
  // behavior: "smooth" はアニメーションが抑制された環境で無視され、移動そのものが
  // 起きないことがあるため使わない。
  // 飛んだ先がどれか分かるよう、移動先の枠を一定時間だけ強調する。
  const timelineRef = useRef<HTMLDivElement>(null);
  const [highlightKey, setHighlightKey] = useState<string | null>(null);
  const highlightTimer = useRef<number | undefined>(undefined);
  const scrollToTarget = useCallback((key: string) => {
    const container = timelineRef.current;
    const target = container?.querySelector(`[${KARTE_TARGET_ATTR}="${key}"]`);
    if (!container || !target) return;
    container.scrollTop +=
      target.getBoundingClientRect().top - container.getBoundingClientRect().top;
    setHighlightKey(key);
    window.clearTimeout(highlightTimer.current);
    highlightTimer.current = window.setTimeout(() => setHighlightKey(null), HIGHLIGHT_DURATION_MS);
  }, []);
  useEffect(() => () => window.clearTimeout(highlightTimer.current), []);

  // 診療日ペインは全日付を出すので、まだ読み込んでいない日も選べる。その場合は
  // 該当の日が表示範囲に入るまで自動で読み進めてから飛ぶ。scroll はクリック
  // (飛ぶ)か展開だけ(項目を出す)かの区別。
  const [pendingDay, setPendingDay] = useState<{ key: string; scroll: boolean } | null>(null);

  // 読み込みの進行(loadToken の変化)のたびに最新の loadMore を呼ぶための ref
  // (KarteTimeline と同じ理由。effect の依存を安定させる)。
  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;

  useEffect(() => {
    if (!pendingDay) return;
    const day = pendingDay.key === "no-date" ? "" : pendingDay.key;
    // カットオフより新しければ、その日は既に表示範囲(項目が無ければ無いことも確定)。
    const loaded = timeline.cutoff === undefined || day > timeline.cutoff;
    if (loaded) {
      // インデックスと実データが食い違って項目の無い日は、スクロール先が無いので
      // 何もせず終わる(scrollToTarget が対象なしを無視する)。
      if (pendingDay.scroll) scrollToTarget(pendingDay.key);
      setPendingDay(null);
    } else if (timeline.hasMore) {
      loadMoreRef.current();
    } else {
      setPendingDay(null);
    }
  }, [pendingDay, loadToken, timeline.cutoff, timeline.hasMore, scrollToTarget]);

  // 診療日ペインからの移動。項目キー(kind:id)は読み込み済みの日にしか並ばないので
  // そのまま飛ぶ。日付は未読のことがあるので、読み込みを待ち合わせる上の effect に
  // 委ねる(読み込み済みでも即座に同じ結果になる)。
  const handleSideSelect = useCallback(
    (key: string) => {
      if (key.includes(":")) scrollToTarget(key);
      else setPendingDay({ key, scroll: true });
    },
    [scrollToTarget],
  );

  // 未読の日が展開されたときの読み込み。スクロールはしない。
  const handleLoadDay = useCallback((key: string) => {
    // クリック(飛ぶ)の待ち合わせ中に同じ日を展開しても、飛ぶ方を取り消さない。
    setPendingDay((prev) => (prev?.key === key ? prev : { key, scroll: false }));
  }, []);

  function handleEdit(item: KarteTimelineItem) {
    if (item.kind === "note") setPane({ kind: "note-edit", noteId: item.id });
    else if (item.kind === "prescription") setPane({ kind: "prescription-edit", srId: item.id });
    else if (item.kind === "injection") setPane({ kind: "injection-edit", srId: item.id });
    else if (item.kind === "lab-order") setPane({ kind: "lab-order-edit", srId: item.id });
    else if (item.kind === "micro-order") setPane({ kind: "micro-order-edit", srId: item.id });
    else if (item.kind === "rad-order") setPane({ kind: "rad-order-edit", srId: item.id });
    // バイタルの id は 1 回の測定を束ねる identifier。
    else if (item.kind === "vital") setPane({ kind: "vital-edit", entryId: item.id });
    else setPane({ kind: "qr-edit", qrId: item.id });
  }

  // DO(複写して新規登録)。処方・注射・検体検査で開くフォームが違う。
  function handleDo(item: KarteTimelineItem) {
    if (item.kind === "prescription") setPane({ kind: "prescription-create", sourceSrId: item.id });
    else if (item.kind === "injection") setPane({ kind: "injection-create", sourceSrId: item.id });
    else if (item.kind === "lab-order") setPane({ kind: "lab-order-create", sourceSrId: item.id });
    else if (item.kind === "micro-order") {
      setPane({ kind: "micro-order-create", sourceSrId: item.id });
    } else if (item.kind === "rad-order") {
      setPane({ kind: "rad-order-create", sourceSrId: item.id });
    }
  }

  // 開いている情報が消えたら、それを見ている UI も閉じる。
  function handleDeleted(item: KarteTimelineItem) {
    const openId =
      pane.kind === "note-edit"
        ? pane.noteId
        : pane.kind === "prescription-edit" ||
            pane.kind === "injection-edit" ||
            pane.kind === "lab-order-edit" ||
            pane.kind === "micro-order-edit" ||
            pane.kind === "rad-order-edit"
          ? pane.srId
          : pane.kind === "qr-edit"
            ? pane.qrId
            : undefined;
    if (openId === item.id) setPane({ kind: "empty" });
    if (detailTarget?.kind === item.kind && detailTarget.id === item.id) closeDetail();
  }

  function toggleDayList() {
    const next = !dayListVisible;
    setDayListVisible(next);
    storeDayListVisible(next);
  }

  function toggleProblemList() {
    const next = !problemListVisible;
    setProblemListVisible(next);
    storeProblemListVisible(next);
  }

  function toggleResolvedProblems() {
    const next = !resolvedProblemsVisible;
    setResolvedProblemsVisible(next);
    storeResolvedProblemsVisible(next);
  }

  function toggleMode() {
    const next = mode === "split" ? "tabs" : "split";
    setMode(next);
    storeLeftPaneMode(next);
  }

  if (!patientId) return null;

  const isLoading =
    notes.isPending || prescriptions.isPending || responses.isPending || vitals.isPending;
  const isFetchingMore =
    notes.isFetchingNextPage ||
    prescriptions.isFetchingNextPage ||
    responses.isFetchingNextPage ||
    vitals.isFetchingNextPage;

  const karteBody = (
    <div className="karte-left__karte">
      {/* プロブレムリストはタブを切り替えても隠れないよう、カルテ本体の上に常時置く。 */}
      <KarteProblemList
        problems={problems}
        selectedId={activeProblemId}
        onSelect={handleSelectProblem}
        visible={problemListVisible}
        onToggleVisible={toggleProblemList}
        resolvedVisible={resolvedProblemsVisible}
        onToggleResolved={toggleResolvedProblems}
        mode={problemMode}
        onChangeMode={handleChangeProblemMode}
        filterActive={Boolean(filterProblemId)}
      />
      <div
        className={`karte-left__body${dayListVisible ? "" : " karte-left__body--daylist-hidden"}`}
      >
      <KarteSidePane
        entries={dayEntries}
        onSelect={handleSideSelect}
        onLoadDay={handleLoadDay}
        loadingKey={pendingDay?.key ?? null}
        mode={effectiveSidePaneMode}
        onModeChange={selectSidePaneMode}
        filter={cardFilter}
        onFilterChange={selectCardFilter}
        visible={dayListVisible}
        onToggleVisible={toggleDayList}
      />
      <div className="karte-left__timeline">
        {/* 絞り込みの見出しはスクロール領域の外に置き、遡っても見えるようにする。
            種別の絞り込みは左端のペインで状態が見えて解除もできるので、ここには出さない。 */}
        {filterProblemId && (
          <KarteProblemSummary
            condition={problemsById.get(filterProblemId)}
            problems={problems}
            loading={conditionsPending}
            groups={filteredGroups}
            hasMore={timeline.hasMore}
            onClear={clearProblemFilter}
          />
        )}
        <ErrorBanner error={notes.error} />
        <ErrorBanner error={prescriptions.error} />
        <ErrorBanner error={responses.error} />
        <ErrorBanner error={conditionsError} />
        <KarteTimeline
          groups={filteredGroups}
          // 3 ソースのうち一部だけ届いた段階でも、出せるものは出す。
          isLoading={isLoading && timeline.groups.length === 0}
          hasMore={timeline.hasMore}
          isFetchingMore={isFetchingMore}
          loadToken={loadToken}
          onLoadMore={loadMore}
          onEdit={handleEdit}
          onDo={handleDo}
          onOpenDetail={openDetail}
          onDeleted={handleDeleted}
          containerRef={timelineRef}
          problemsById={problemsById}
          selectedProblemIds={activeProblemIds}
          highlightKey={highlightKey}
          emptyMessage={
            filterProblemId
              ? "このプロブレムに紐付く診療情報がありません。"
              : cardFilter
                ? "この種別の診療情報がありません。"
                : undefined
          }
        />
      </div>
      </div>
    </div>
  );

  // view は選択中のタブに属する値なので、そのタブを描くときだけ渡す。
  function renderTabPanel(key: KarteOtherTabKey) {
    if (!patientId) return null;
    const props = { patientId, view: tab === key ? view : "", onViewChange: selectView };
    if (key === "condition") return <KarteConditionTab {...props} />;
    if (key === "allergy") return <KarteAllergyTab {...props} />;
    // 経過表・検査結果時系列は読み取り専用で、詳細を開く導線が無いので view は使わない。
    if (key === "flowsheet") return <VitalFlowsheetPanel patientId={patientId} />;
    if (key === "lab-timeline") {
      return (
        <div className="karte-tabpanel">
          <LabResultTimelinePanel patientId={patientId} />
        </div>
      );
    }
    if (key === "micro") return <KarteMicroResultTab {...props} />;
    // 予約の日時変更は枠を選ぶ操作なので、登録と同じ右ペインで開く。
    if (key === "appointment") {
      return (
        <KarteAppointmentTab
          patientId={patientId}
          onReschedule={(appointmentId) => setPane({ kind: "appointment-reschedule", appointmentId })}
        />
      );
    }
    return <KarteLabResultTab {...props} />;
  }

  const modeToggle = <KarteModeToggleButton mode={mode} onToggle={toggleMode} />;

  return (
    <div className="page karte-page">
      {/* 見出しは置かず、患者情報と戻るボタンを 1 行にまとめて縦幅を左右のペインに回す。 */}
      <div className="karte-page__header">
        <PatientHeader patientId={patientId} />
        <Link to={returnTo} className="button">
          ← 戻る
        </Link>
      </div>

      {/* 左右の幅はカスタムプロパティで渡す。狭い画面では CSS 側で縦積みに切り替える
          ため、grid-template-columns 自体はインラインで上書きしない。 */}
      <div
        className="karte-layout"
        ref={layoutRef}
        style={{ "--karte-left-ratio": leftWidthRatio } as CSSProperties}
      >
        <section className={`karte-left${mode === "split" ? " karte-left--split" : ""}`}>
          {mode === "tabs" ? (
            <>
              <KarteTabs tabs={KARTE_TABS} active={tab} onSelect={selectTab} trailing={modeToggle} />
              {tab === "karte" ? karteBody : renderTabPanel(tab)}
            </>
          ) : (
            // 上: カルテ / 下: それ以外のタブ。タブ行は操作対象の下ペイン側に置く。
            <div className="karte-left__split" ref={splitRef}>
              <div className="karte-left__split-top" style={{ flexBasis: `${topRatio * 100}%` }}>
                {karteBody}
              </div>
              <KarteSplitter
                containerRef={splitRef}
                orientation="horizontal"
                ratio={topRatio}
                label="カルテと他タブの高さ"
                onChange={(ratio) => setTopRatio(clampTopRatio(ratio))}
                onChangeEnd={storeTopRatio}
              />
              <div className="karte-left__split-bottom">
                <KarteTabs
                  tabs={KARTE_OTHER_TABS}
                  active={otherTab}
                  onSelect={selectOtherTab}
                  trailing={modeToggle}
                />
                {renderTabPanel(otherTab)}
              </div>
            </div>
          )}
        </section>

        <KarteSplitter
          containerRef={layoutRef}
          orientation="vertical"
          ratio={leftWidthRatio}
          label="左ペインと右ペインの幅"
          onChange={(ratio) => setLeftWidthRatio(clampLeftWidthRatio(ratio))}
          onChangeEnd={storeLeftWidthRatio}
        />

        <KarteRightPane
          patientId={patientId}
          state={pane}
          selectedProblem={selectedProblem}
          onStateChange={setPane}
        />
      </div>

      {/* 詳細モーダルはタイムラインの読み込み位置に依存しないよう、対象を ID で
          受け取って自分で取得する(古い記録の URL を直接開いても表示できる)。 */}
      {detailTarget && (
        <KarteDetailModal
          patientId={patientId}
          target={detailTarget}
          problemsById={problemsById}
          onClose={closeDetail}
        />
      )}
    </div>
  );
}

// タブ行。右端に左ペインの表示モード切替ボタンを置く。
// 検査結果系のタブ(検体検査・検体検査時系列・細菌検査)はタブ行に並べず、
// 「検査結果」1 つのドロップダウンにまとめる(タブ行の幅と行数を増やさない)。
function KarteTabs<K extends string>({
  tabs,
  active,
  onSelect,
  trailing,
}: {
  tabs: ReadonlyArray<{ key: K; label: string }>;
  active: K;
  onSelect: (key: K) => void;
  trailing: ReactNode;
}) {
  const groupKeys = KARTE_LAB_GROUP.keys as readonly string[];
  const groupTabs = tabs.filter((item) => groupKeys.includes(item.key));
  return (
    <div className="karte-tabs">
      <div className="karte-tabs__list" role="tablist">
        {tabs.map((item) => {
          if (groupKeys.includes(item.key)) {
            // グループはまとめて 1 つ。先頭のタブの位置にだけ描く。
            if (item.key !== groupTabs[0]?.key) return null;
            return (
              <KarteTabGroup
                key={item.key}
                tabs={groupTabs}
                active={active}
                onSelect={onSelect}
              />
            );
          }
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={active === item.key}
              className={`karte-tabs__tab${active === item.key ? " karte-tabs__tab--active" : ""}`}
              onClick={() => onSelect(item.key)}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {trailing}
    </div>
  );
}

// 「検査結果」ドロップダウンタブ。ヘッダーメニュー(HoverMenu)と同様にマウスオーバーで
// 開き、メニューで配下(検体検査・検体検査時系列・細菌検査)を選ぶ。タブ名は
// 「検査結果」固定で、キーボード操作向けにクリックでも開閉する。
function KarteTabGroup<K extends string>({
  tabs,
  active,
  onSelect,
}: {
  tabs: ReadonlyArray<{ key: K; label: string }>;
  active: K;
  onSelect: (key: K) => void;
}) {
  const [open, setOpen] = useState(false);
  // タブ行(.karte-tabs__list)は overflow-x: auto なので、中に absolute で開くと
  // クリップされる。トリガーの位置から fixed で開いてはみ出せるようにする。
  // 位置計算前の初期値も fixed + 不可視にする: 一瞬でも absolute で描くと
  // タブ行に横スクロールバーが出て行の高さが押し上がったままになる。
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({
    position: "fixed",
    visibility: "hidden",
  });
  const ref = useRef<HTMLDivElement>(null);
  const activeTab = tabs.find((item) => item.key === active);

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = ref.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    // トリガーとの間に隙間があるとマウス移動中に mouseleave で閉じてしまうため接して開く。
    setMenuStyle({ position: "fixed", top: rect.bottom, left: rect.left, right: "auto" });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    // fixed で置くのでスクロールに追従できない。開いたまま動かす使い方はしないので閉じる。
    function close() {
      setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  return (
    <div
      className="karte-tabs__group"
      ref={ref}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        role="tab"
        aria-selected={activeTab != null}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`karte-tabs__tab${activeTab ? " karte-tabs__tab--active" : ""}`}
        onClick={() => setOpen((value) => !value)}
      >
        {KARTE_LAB_GROUP.label}
        <span className="karte-tabs__caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div
          className="row-menu__items karte-tabs__menu"
          role="menu"
          style={menuStyle}
          onClick={() => setOpen(false)}
        >
          {tabs.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitemradio"
              aria-checked={item.key === active}
              className="row-menu__item"
              onClick={() => onSelect(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function KarteModeToggleButton({
  mode,
  onToggle,
}: {
  mode: KarteLeftPaneMode;
  onToggle: () => void;
}) {
  const isSplit = mode === "split";
  return (
    <button
      type="button"
      className={`karte-tabs__mode${isSplit ? " karte-tabs__mode--active" : ""}`}
      aria-pressed={isSplit}
      title={isSplit ? "カルテと他タブを切り替え表示にする" : "カルテと他タブを上下に並べる"}
      aria-label={isSplit ? "カルテと他タブを切り替え表示にする" : "カルテと他タブを上下に並べる"}
      onClick={onToggle}
    >
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
        <rect
          x="1.5"
          y="2.5"
          width="13"
          height="11"
          rx="1.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
        />
        {/* 分割中は 1 枚に戻すアイコン、通常時は上下に割るアイコンを出す。 */}
        {!isSplit && <path d="M1.5 8h13" stroke="currentColor" strokeWidth="1.2" />}
      </svg>
    </button>
  );
}
