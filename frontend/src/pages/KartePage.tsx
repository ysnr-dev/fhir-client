import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { KARTE_TARGET_ATTR, KarteTimeline } from "../components/KarteTimeline";
import { PatientHeader } from "../components/PatientHeader";
import { buildKarteTimeline, type KarteTimelineItem } from "../fhir/karteTimeline";

// 患者 1 人のカルテ画面。左ペインで登録済みの情報を参照し、右ペインで登録・編集する。

const TABS = [
  { key: "karte", label: "カルテ" },
  { key: "condition", label: "病名" },
  { key: "allergy", label: "アレルギー" },
  { key: "lab", label: "検査結果" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export function KartePage() {
  const { patientId } = useParams<{ patientId: string }>();
  const [tab, setTab] = useState<TabKey>("karte");
  const [pane, setPane] = useState<KartePaneState>({ kind: "empty" });

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

  if (!patientId) return null;

  const isLoading = notes.isPending || prescriptions.isPending || responses.isPending;
  const isFetchingMore =
    notes.isFetchingNextPage || prescriptions.isFetchingNextPage || responses.isFetchingNextPage;

  return (
    <div className="page karte-page">
      {/* 見出しは置かず、患者情報と戻るボタンを 1 行にまとめて縦幅を左右のペインに回す。 */}
      <div className="karte-page__header">
        <PatientHeader patientId={patientId} />
        <Link to="/patients" className="button">
          ← 患者一覧に戻る
        </Link>
      </div>

      <div className="karte-layout">
        <section className="karte-left">
          <div className="karte-tabs" role="tablist">
            {TABS.map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={tab === item.key}
                className={`karte-tabs__tab${tab === item.key ? " karte-tabs__tab--active" : ""}`}
                onClick={() => setTab(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>

          {tab === "karte" && (
            <div className="karte-left__body">
              <KarteDayList groups={timeline.groups} onSelect={scrollToTarget} />
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
          )}
          {tab === "condition" && <KarteConditionTab patientId={patientId} />}
          {tab === "allergy" && <KarteAllergyTab patientId={patientId} />}
          {tab === "lab" && <KarteLabResultTab patientId={patientId} />}
        </section>

        <KarteRightPane patientId={patientId} state={pane} onStateChange={setPane} />
      </div>
    </div>
  );
}
