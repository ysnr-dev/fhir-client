import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Link, useParams } from "react-router-dom";
import {
  useKarteClinicalNotesInfinite,
  useKartePrescriptionsInfinite,
  useKarteQuestionnaireResponsesInfinite,
} from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { KarteAllergyTab } from "../components/KarteAllergyTab";
import { KarteConditionTab } from "../components/KarteConditionTab";
import { KarteDayList } from "../components/KarteDayList";
import { KarteLabResultTab } from "../components/KarteLabResultTab";
import { KarteRightPane, type KartePaneState } from "../components/KarteRightPane";
import { KarteSplitter } from "../components/KarteSplitter";
import { KARTE_TARGET_ATTR, KarteTimeline } from "../components/KarteTimeline";
import { PatientHeader } from "../components/PatientHeader";
import { buildKarteTimeline, type KarteTimelineItem } from "../fhir/karteTimeline";
import {
  clampLeftWidthRatio,
  clampTopRatio,
  readDayListVisible,
  readLeftPaneMode,
  readLeftWidthRatio,
  readTopRatio,
  storeDayListVisible,
  storeLeftPaneMode,
  storeLeftWidthRatio,
  storeTopRatio,
  type KarteLeftPaneMode,
} from "../karteLayout";

// 患者 1 人のカルテ画面。左ペインで登録済みの情報を参照し、右ペインで登録・編集する。

const TABS = [
  { key: "karte", label: "カルテ" },
  { key: "condition", label: "病名" },
  { key: "allergy", label: "アレルギー" },
  { key: "lab", label: "検査結果" },
] as const;

type TabKey = (typeof TABS)[number]["key"];
// 上下分割モードで下ペインに出すタブ(カルテは常に上ペインなので除く)。
type OtherTabKey = Exclude<TabKey, "karte">;

const OTHER_TABS = TABS.filter((item) => item.key !== "karte") as ReadonlyArray<{
  key: OtherTabKey;
  label: string;
}>;

export function KartePage() {
  const { patientId } = useParams<{ patientId: string }>();
  const [tab, setTab] = useState<TabKey>("karte");
  // 分割モードの下ペインは別の選択状態を持たせ、モードを往復しても選択が入れ替わらないようにする。
  const [otherTab, setOtherTab] = useState<OtherTabKey>("condition");
  const [pane, setPane] = useState<KartePaneState>({ kind: "empty" });
  const [mode, setMode] = useState<KarteLeftPaneMode>(readLeftPaneMode);
  const [topRatio, setTopRatio] = useState(readTopRatio);
  const [leftWidthRatio, setLeftWidthRatio] = useState(readLeftWidthRatio);
  const [dayListVisible, setDayListVisible] = useState(readDayListVisible);
  const splitRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef<HTMLDivElement>(null);

  // カルテは 2 ペインで横幅を使うため、この画面だけ #root の幅制限を外す。
  useEffect(() => {
    document.body.classList.add("karte-wide");
    return () => document.body.classList.remove("karte-wide");
  }, []);

  const notes = useKarteClinicalNotesInfinite(patientId);
  const prescriptions = useKartePrescriptionsInfinite(patientId);
  const responses = useKarteQuestionnaireResponsesInfinite(patientId);

  const timeline = useMemo(
    () =>
      buildKarteTimeline({
        noteBundles: notes.data?.pages.map((page) => page.data) ?? [],
        prescriptionBundles: prescriptions.data?.pages.map((page) => page.data) ?? [],
        responseBundles: responses.data?.pages.map((page) => page.data) ?? [],
        noteHasNext: Boolean(notes.hasNextPage),
        prescriptionHasNext: Boolean(prescriptions.hasNextPage),
        responseHasNext: Boolean(responses.hasNextPage),
      }),
    [
      notes.data,
      prescriptions.data,
      responses.data,
      notes.hasNextPage,
      prescriptions.hasNextPage,
      responses.hasNextPage,
    ],
  );

  // 表示範囲を押し下げているソースだけ次ページを読む。
  function loadMore() {
    if (timeline.pending.note && !notes.isFetchingNextPage) notes.fetchNextPage();
    if (timeline.pending.prescription && !prescriptions.isFetchingNextPage) {
      prescriptions.fetchNextPage();
    }
    if (timeline.pending.qr && !responses.isFetchingNextPage) responses.fetchNextPage();
  }

  // 取得が一段落するたびに追加読み込みを再判定させるためのトークン。
  const loadToken = [
    notes.data?.pages.length ?? 0,
    prescriptions.data?.pages.length ?? 0,
    responses.data?.pages.length ?? 0,
    timeline.pending.note,
    timeline.pending.prescription,
    timeline.pending.qr,
  ].join("/");

  // 診療日パネルからタイムラインの該当位置へ飛ぶ。scrollIntoView はページ側も
  // スクロールさせてしまうため、タイムラインのスクロール位置だけを動かす。
  // behavior: "smooth" はアニメーションが抑制された環境で無視され、移動そのものが
  // 起きないことがあるため使わない。
  const timelineRef = useRef<HTMLDivElement>(null);
  const scrollToTarget = useCallback((key: string) => {
    const container = timelineRef.current;
    const target = container?.querySelector(`[${KARTE_TARGET_ATTR}="${key}"]`);
    if (!container || !target) return;
    container.scrollTop +=
      target.getBoundingClientRect().top - container.getBoundingClientRect().top;
  }, []);

  function handleEdit(item: KarteTimelineItem) {
    if (item.kind === "note") setPane({ kind: "note-edit", noteId: item.id });
    else if (item.kind === "prescription") setPane({ kind: "prescription-edit", srId: item.id });
    else setPane({ kind: "qr-edit", qrId: item.id });
  }

  // 右ペインで開いている情報が消えたら編集 UI も閉じる。
  function handleDeleted(item: KarteTimelineItem) {
    const openId =
      pane.kind === "note-edit"
        ? pane.noteId
        : pane.kind === "prescription-edit"
          ? pane.srId
          : pane.kind === "qr-edit"
            ? pane.qrId
            : undefined;
    if (openId === item.id) setPane({ kind: "empty" });
  }

  function toggleDayList() {
    const next = !dayListVisible;
    setDayListVisible(next);
    storeDayListVisible(next);
  }

  function toggleMode() {
    const next = mode === "split" ? "tabs" : "split";
    setMode(next);
    storeLeftPaneMode(next);
  }

  if (!patientId) return null;

  const isLoading = notes.isPending || prescriptions.isPending || responses.isPending;
  const isFetchingMore =
    notes.isFetchingNextPage || prescriptions.isFetchingNextPage || responses.isFetchingNextPage;

  const karteBody = (
    <div
      className={`karte-left__body${dayListVisible ? "" : " karte-left__body--daylist-hidden"}`}
    >
      <KarteDayList
        groups={timeline.groups}
        onSelect={scrollToTarget}
        visible={dayListVisible}
        onToggleVisible={toggleDayList}
      />
      <div className="karte-left__timeline">
        <ErrorBanner error={notes.error} />
        <ErrorBanner error={prescriptions.error} />
        <ErrorBanner error={responses.error} />
        <KarteTimeline
          groups={timeline.groups}
          // 3 ソースのうち一部だけ届いた段階でも、出せるものは出す。
          isLoading={isLoading && timeline.groups.length === 0}
          hasMore={timeline.hasMore}
          isFetchingMore={isFetchingMore}
          loadToken={loadToken}
          onLoadMore={loadMore}
          onEdit={handleEdit}
          onDo={(srId) => setPane({ kind: "prescription-create", sourceSrId: srId })}
          onDeleted={handleDeleted}
          containerRef={timelineRef}
        />
      </div>
    </div>
  );

  function renderTabPanel(key: OtherTabKey) {
    if (!patientId) return null;
    if (key === "condition") return <KarteConditionTab patientId={patientId} />;
    if (key === "allergy") return <KarteAllergyTab patientId={patientId} />;
    return <KarteLabResultTab patientId={patientId} />;
  }

  const modeToggle = <KarteModeToggleButton mode={mode} onToggle={toggleMode} />;

  return (
    <div className="page karte-page">
      {/* 見出しは置かず、患者情報と戻るボタンを 1 行にまとめて縦幅を左右のペインに回す。 */}
      <div className="karte-page__header">
        <PatientHeader patientId={patientId} />
        <Link to="/patients" className="button">
          ← 患者一覧に戻る
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
              <KarteTabs tabs={TABS} active={tab} onSelect={setTab} trailing={modeToggle} />
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
                  tabs={OTHER_TABS}
                  active={otherTab}
                  onSelect={setOtherTab}
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

        <KarteRightPane patientId={patientId} state={pane} onStateChange={setPane} />
      </div>
    </div>
  );
}

// タブ行。右端に左ペインの表示モード切替ボタンを置く。
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
  return (
    <div className="karte-tabs">
      <div className="karte-tabs__list" role="tablist">
        {tabs.map((item) => (
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
        ))}
      </div>
      {trailing}
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
