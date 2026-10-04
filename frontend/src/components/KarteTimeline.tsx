import { memo, useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  useDeleteClinicalNote,
  useDeleteLabOrder,
  useDeleteMicroOrder,
  useDeletePathoOrder,
  useDeleteRadOrder,
  useDeletePhysioOrder,
  useDeleteTreatmentOrder,
  useDeleteMealOrder,
  useDeleteConsultOrder,
  useDeleteRadiotherapyOrder,
  useDeleteRehabOrder,
  useDeleteNutritionGuidanceOrder,
  useDeleteTransfusionOrder,
  useDeleteSurgeryOrder,
  useDeleteEndoscopyOrder,
  useCancelInjectionPerforms,
  useDeletePrescription,
  useDeleteQuestionnaireResponse,
  useDeleteVitalEntry,
} from "../api/queries";
import { questionnaireResponsePdfUrl, useReportLayoutStatus } from "../api/reportsClient";
import {
  noteBodySections,
  sectionResponseId,
  sectionTitle,
  statusLabel,
  stripSchemaImageNotes,
} from "../fhir/clinicalNoteHelpers";
import { problemLabel, type ProblemRef } from "../fhir/conditionHelpers";
import {
  KARTE_KIND_LABELS,
  karteItemKindLabel,
  karteDayHeadingLabel,
  karteDayLabel,
  karteItemKey,
  itemPathway,
  itemProblem,
  referencesProblem,
  type KarteDayGroup,
  type KarteTimelineItem,
} from "../fhir/karteTimeline";
import { karteLinkLabel, type KarteLink } from "../fhir/karteLinkHelpers";
import type { KarteDetailTarget } from "../karteUrl";
import { copyKarteLink } from "../lib/copyKarteLink";
import {
  groupInjectionByRp,
  injectionComment,
  injectionSeriesLabel,
  injectionTimesLabel,
  injectionUsageSummary,
  summarizeInjectionServiceRequest,
} from "../fhir/injectionHelpers";
import {
  summarizeLabOrder,
} from "../fhir/labOrderHelpers";
import { labTaskStatusDisplay } from "../fhir/labTaskHelpers";
import {
  summarizeMicroOrder,
} from "../fhir/microOrderHelpers";
import {
  summarizePathoOrder,
} from "../fhir/pathoOrderHelpers";
import { pathoTaskStatusDisplay } from "../fhir/pathoTaskHelpers";
import {
  radOrderTime,
  summarizeRadOrder,
} from "../fhir/radOrderHelpers";
import { radTaskStatusDisplay } from "../fhir/radTaskHelpers";
import {
  physioOrderTime,
  summarizePhysioOrder,
} from "../fhir/physioOrderHelpers";
import { physioTaskStatusDisplay } from "../fhir/physioTaskHelpers";
import {
  treatmentOrderTime,
  summarizeTreatmentOrder,
} from "../fhir/treatmentOrderHelpers";
import { summarizeMealOrder } from "../fhir/mealOrderHelpers";
import { consultReply, summarizeConsultOrder } from "../fhir/consultOrderHelpers";
import { consultTaskStatusDisplay } from "../fhir/consultTaskHelpers";
import { summarizeRadiotherapyOrder } from "../fhir/radiotherapyOrderHelpers";
import { radiotherapyTaskStatusDisplay } from "../fhir/radiotherapyTaskHelpers";
import {
  canCancelInjection,
  canRestoreInjection,
  injectionTaskStatusDisplay,
} from "../fhir/injectionTaskHelpers";
import { summarizeRehabOrder } from "../fhir/rehabOrderHelpers";
import { summarizeNutritionGuidanceOrder } from "../fhir/nutritionGuidanceOrderHelpers";
import { transfusionTaskStatusDisplay } from "../fhir/transfusionTaskHelpers";
import { rehabTaskStatusDisplay } from "../fhir/rehabTaskHelpers";
import { nutritionGuidanceTaskStatusDisplay } from "../fhir/nutritionGuidanceTaskHelpers";
import { TransfusionPerformModal } from "./TransfusionPerformModal";
import {
  summarizeTransfusionOrder,
} from "../fhir/transfusionOrderHelpers";
import { treatmentTaskStatusDisplay } from "../fhir/treatmentTaskHelpers";
import {
  summarizeSurgeryOrder,
} from "../fhir/surgeryOrderHelpers";
import { surgeryTaskStatusDisplay } from "../fhir/surgeryTaskHelpers";
import {
  endoscopyOrderTime,
  summarizeEndoscopyOrder,
} from "../fhir/endoscopyOrderHelpers";
import { endoscopyTaskStatusDisplay } from "../fhir/endoscopyTaskHelpers";
import { isAsNeededUsage } from "../fhir/medicationScheduleHelpers";
import { departmentOf, orderContextSummary, orderRequester } from "../fhir/orderHeader";
import {
  groupByRp,
  hasDoseDays,
  prescriptionComment,
  summarizeServiceRequest,
} from "../fhir/prescriptionHelpers";
import {
  questionnaireResponseDocumentText,
  questionnaireResponsePlainText,
  schemaAnnotatedLines,
  schemaImageRefs,
  summarizeQuestionnaireResponse,
} from "../fhir/questionnaireResponseHelpers";
import { vitalDisplayRows, vitalEntryDepartment } from "../fhir/vitalHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { AnesthesiaChartModal } from "./AnesthesiaChartModal";
import { ClinicalNoteHistoryModal } from "./ClinicalNoteHistoryModal";
import { cycleDayLabel, regimenOrderLabel, regimenOrderOf } from "../fhir/regimenOrderHelpers";
import { InjectionCancelModal } from "./InjectionCancelModal";
import { InjectionPerformModal } from "./InjectionPerformModal";
import { ExamReportEntryModal } from "./ExamReportEntryModal";
import { EXAM_REPORT_CONFIGS, EXAM_REPORT_KIND_OF_ORDER } from "../fhir/examReportHelpers";
import { InjectionDeleteModal } from "./InjectionDeleteModal";
import { KarteCardJsonModal } from "./KarteCardModals";
import { PlainTextModal } from "./PlainTextModal";
import { RichTextView } from "./RichTextView";
import { ResponseSchemaImages, SchemaImageGallery } from "./SchemaImageGallery";
import { RowMenu } from "./RowMenu";
import { useKarteLinkActions } from "./KarteLinkContext";
import { LabOrderCardBody } from "./karteCardBodies/LabOrderCardBody";
import { PathoOrderCardBody } from "./karteCardBodies/PathoOrderCardBody";
import { MicroOrderCardBody } from "./karteCardBodies/MicroOrderCardBody";
import { RadOrderCardBody } from "./karteCardBodies/RadOrderCardBody";
import { PhysioOrderCardBody } from "./karteCardBodies/PhysioOrderCardBody";
import { SurgeryOrderCardBody } from "./karteCardBodies/SurgeryOrderCardBody";
import { MealOrderCardBody } from "./karteCardBodies/MealOrderCardBody";
import { RehabOrderCardBody } from "./karteCardBodies/RehabOrderCardBody";
import { NutritionGuidanceOrderCardBody } from "./karteCardBodies/NutritionGuidanceOrderCardBody";
import { ConsultOrderCardBody } from "./karteCardBodies/ConsultOrderCardBody";
import { RadiotherapyOrderCardBody } from "./karteCardBodies/RadiotherapyOrderCardBody";
import { InjectionPerformSection } from "./karteCardBodies/InjectionPerformSection";
import { TransfusionOrderCardBody } from "./karteCardBodies/TransfusionOrderCardBody";
import { TreatmentOrderCardBody } from "./karteCardBodies/TreatmentOrderCardBody";
import { EndoscopyOrderCardBody } from "./karteCardBodies/EndoscopyOrderCardBody";
import { PathwayEvaluationCardBody } from "./karteCardBodies/PathwayEvaluationCardBody";

interface KarteTimelineProps {
  groups: KarteDayGroup[];
  isLoading: boolean;
  hasMore: boolean;
  isFetchingMore: boolean;
  /** 追加読み込みの再判定トリガー。ページ数や取得状態が変わるたびに変化させる。 */
  loadToken: string;
  onLoadMore: () => void;
  onEdit: (item: KarteTimelineItem) => void;
  /** DO(複写して新規登録)。処方と注射で開くフォームが違うので item ごと渡す。 */
  onDo: (item: KarteTimelineItem) => void;
  /** 詳細表示。対象は URL に載せるので、モーダルは親(カルテ画面)が描く。 */
  onOpenDetail: (target: KarteDetailTarget) => void;
  /** 放射線治療コースの記録を右ペインで開く(docs/radiotherapy-order-design.md §6.3)。 */
  onOpenRadiotherapyPane: (kind: "adverse" | "review", srId: string) => void;
  /** 削除された項目。右ペインで開いていたら閉じるために親へ通知する。 */
  onDeleted: (item: KarteTimelineItem) => void;
  /** スクロールコンテナ。診療日パネルからのスクロール指示に使う。 */
  containerRef: RefObject<HTMLDivElement | null>;
  /** プロブレム(Condition)を id で引く辞書。バッジを最新の名称で描くために使う。 */
  problemsById: Map<string, fhir4.Condition>;
  /** 選択中のプロブレム。これを参照しない診療記録は控えめに表示する。 */
  selectedProblemIds: ReadonlySet<string> | null;
  /** 診療日パネルから飛んだ先。該当する枠を一定時間だけ強調する。 */
  highlightKey: string | null;
  /** 表示するものが無いときの文言。プロブレムで絞り込んでいるときに差し替える。 */
  emptyMessage?: string;
}

// 診療日パネルからのスクロール先を引くための目印。キーは診療日 or karteItemKey。
export const KARTE_TARGET_ATTR = "data-karte-target";

export function KarteTimeline({
  groups,
  isLoading,
  hasMore,
  isFetchingMore,
  loadToken,
  onLoadMore,
  onEdit,
  onDo,
  onOpenDetail,
  onOpenRadiotherapyPane,
  onDeleted,
  containerRef,
  problemsById,
  selectedProblemIds,
  highlightKey,
  emptyMessage,
}: KarteTimelineProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [sentinelVisible, setSentinelVisible] = useState(false);
  const { remove, deletingKey, failure } = useKarteItemDelete(onDeleted);

  // 追加読み込みの実体は毎レンダリングで作り直されるため、ref 経由で最新を呼ぶ
  // (effect の依存を loadToken だけに保つ)。
  const loadMoreRef = useRef(onLoadMore);
  loadMoreRef.current = onLoadMore;

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => setSentinelVisible(entries.some((entry) => entry.isIntersecting)),
      // スクロールコンテナ内で、下端に近づいた時点で先読みする。
      { root: containerRef.current, rootMargin: "400px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [containerRef]);

  // 読み込み完了後もまだ末尾が見えていれば続けて読む。最古ページが同じ診療日で
  // 埋まっていて表示が増えない場合でも、これで前に進む。
  useEffect(() => {
    if (sentinelVisible) loadMoreRef.current();
  }, [sentinelVisible, loadToken]);

  return (
    <div className="karte-timeline" ref={containerRef}>
      {isLoading ? (
        <p>読み込み中...</p>
      ) : groups.length === 0 && !hasMore ? (
        <p className="patient-table__empty">
          {emptyMessage ?? "登録されている診療情報がありません。"}
        </p>
      ) : (
        groups.map((group) => {
          const dayKey = group.day || "no-date";
          return (
            <section
              className={`karte-group${highlightKey === dayKey ? " karte-group--highlight" : ""}`}
              key={dayKey}
              {...{ [KARTE_TARGET_ATTR]: dayKey }}
            >
              <h3 className="karte-group__date">{karteDayHeadingLabel(group.day)}</h3>
              {group.items.map((item) => {
                const key = karteItemKey(item);
                return (
                  <KarteCard
                    key={key}
                    item={item}
                    onEdit={onEdit}
                    onDo={onDo}
                    onOpenDetail={onOpenDetail}
                    onOpenRadiotherapyPane={onOpenRadiotherapyPane}
                    onDelete={remove}
                    onDeleted={onDeleted}
                    deleting={deletingKey === key}
                    deleteError={failure?.key === key ? failure.error : null}
                    problemsById={problemsById}
                    selectedProblemIds={selectedProblemIds}
                    highlighted={highlightKey === key}
                  />
                );
              })}
            </section>
          );
        })
      )}

      <div className="karte-timeline__sentinel" ref={sentinelRef}>
        {isFetchingMore && <p>読み込み中...</p>}
      </div>
    </div>
  );
}

/**
 * カードの削除。種別ごとの mutation を一覧で 1 組だけ持ち(カードごとに持つと
 * 表示枚数 × 17 本の購読になる)、どのカードを消している最中か・どのカードで失敗したかは
 * カードのキーで覚えてカードに配る。
 */
function useKarteItemDelete(onDeleted: (item: KarteTimelineItem) => void) {
  const mutations = {
    note: useDeleteClinicalNote(),
    prescription: useDeletePrescription(),
    // 検体検査・細菌検査・放射線検査・生理検査・内視鏡・処置は明細も ServiceRequest
    // なので、専用の削除でまとめて消す。
    "lab-order": useDeleteLabOrder(),
    "micro-order": useDeleteMicroOrder(),
    "patho-order": useDeletePathoOrder(),
    "rad-order": useDeleteRadOrder(),
    "physio-order": useDeletePhysioOrder(),
    "endoscopy-order": useDeleteEndoscopyOrder(),
    "treatment-order": useDeleteTreatmentOrder(),
    "surgery-order": useDeleteSurgeryOrder(),
    // 食事は明細を持たないので ServiceRequest 1 件を消すだけ。
    "meal-order": useDeleteMealOrder(),
    // 輸血は製剤明細も ServiceRequest なので、専用の削除でまとめて消す。
    "transfusion-order": useDeleteTransfusionOrder(),
    // リハビリは明細を持たないが、リハ部門が取った予約を道連れで取り消す。
    "rehab-order": useDeleteRehabOrder(),
    "nutrition-guidance-order": useDeleteNutritionGuidanceOrder(),
    // 他科依頼も明細を持たないが、回答済のものは消させない(回答という別の医師の
    // 記録がぶら下がっているため。mutation 側で拒否してエラー帯に出す)。
    "consult-order": useDeleteConsultOrder(),
    // 放射線治療は部門が受け付けた後は消させない(mutation 側で拒否してエラー帯に出す)。
    "radiotherapy-order": useDeleteRadiotherapyOrder(),
    qr: useDeleteQuestionnaireResponse(),
    vital: useDeleteVitalEntry(),
  };
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ key: string; error: unknown } | null>(null);

  // remove の同一性を保つため(カードの memo が効くように)、最新の mutation と
  // コールバックは ref 経由で呼ぶ。
  const mutationsRef = useRef(mutations);
  mutationsRef.current = mutations;
  const onDeletedRef = useRef(onDeleted);
  onDeletedRef.current = onDeleted;

  const remove = useCallback((item: KarteTimelineItem) => {
    const key = karteItemKey(item);
    const m = mutationsRef.current;
    setDeletingKey(key);
    setFailure(null);
    const options = {
      onSuccess: () => onDeletedRef.current(item),
      onError: (error: unknown) => setFailure({ key, error }),
      onSettled: () => setDeletingKey((current) => (current === key ? null : current)),
    };
    switch (item.kind) {
      case "note":
      case "prescription":
      case "lab-order":
      case "micro-order":
      case "patho-order":
      case "rad-order":
      case "physio-order":
      case "endoscopy-order":
      case "treatment-order":
      case "surgery-order":
      case "meal-order":
      case "transfusion-order":
      case "rehab-order":
      case "nutrition-guidance-order":
      case "consult-order":
      case "radiotherapy-order":
        m[item.kind].mutate(item.id, options);
        break;
      // テンプレート回答は、生成した Observation も一緒に消すのでリソースごと渡す。
      case "qr":
        m.qr.mutate(item.response, options);
        break;
      // バイタルは 1 回の測定が項目ごとの Observation に分かれるのでまとめて消す。
      case "vital":
        m.vital.mutate(
          item.entry.observations.map((observation) => observation.id ?? "").filter(Boolean),
          options,
        );
        break;
      // 注射は専用の確認モーダル(InjectionDeleteModal)が消す。
      case "injection":
        break;
    }
  }, []);

  return { remove, deletingKey, failure };
}

const KarteCard = memo(function KarteCard({
  item,
  onEdit,
  onDo,
  onOpenDetail,
  onOpenRadiotherapyPane,
  onDelete,
  onDeleted,
  deleting,
  deleteError,
  problemsById,
  selectedProblemIds,
  highlighted,
}: {
  item: KarteTimelineItem;
  onEdit: (item: KarteTimelineItem) => void;
  onDo: (item: KarteTimelineItem) => void;
  onOpenDetail: (target: KarteDetailTarget) => void;
  onOpenRadiotherapyPane: (kind: "adverse" | "review", srId: string) => void;
  /** 確認の後に呼ぶ削除。実行状態は deleting / deleteError で戻ってくる。 */
  onDelete: (item: KarteTimelineItem) => void;
  onDeleted: (item: KarteTimelineItem) => void;
  deleting: boolean;
  deleteError: unknown;
  problemsById: Map<string, fhir4.Condition>;
  selectedProblemIds: ReadonlySet<string> | null;
  highlighted: boolean;
}) {
  // 化学療法の日オーダー(レジメンの印が焼いてある注射・処方)。DO を出さず、削除には注意を添える。
  const regimenDay =
    (item.kind === "injection" || item.kind === "prescription") && item.serviceRequest
      ? regimenOrderOf(item.serviceRequest)
      : null;
  // 平文表示・FHIR JSON 表示はモーダルで開く(カルテの読み位置を動かさない)。
  // 詳細表示は URL に載せるので親に任せる。
  const [plainTextOpen, setPlainTextOpen] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);
  const linkActions = useKarteLinkActions();
  const [injectionDeleteOpen, setInjectionDeleteOpen] = useState(false);
  // 注射の中止・中止取消。開いているときだけモーダルを出す。
  const [injectionCancel, setInjectionCancel] = useState<"cancel" | "restore" | null>(null);
  const [injectionPerformOpen, setInjectionPerformOpen] = useState(false);
  const cancelInjectionPerforms = useCancelInjectionPerforms();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [chartOpen, setChartOpen] = useState(false);
  // 輸血の実施入力。投与するのは病棟なので、部門一覧だけでなくここからも開ける。
  const [performOpen, setPerformOpen] = useState(false);
  // 検査レポート(読影・生理検査・内視鏡の所見)の登録・編集。部門一覧と同じモーダルを開く。
  const [examReportOpen, setExamReportOpen] = useState(false);
  const examReport =
    item.kind === "rad-order" || item.kind === "physio-order" || item.kind === "endoscopy-order"
      ? {
          config: EXAM_REPORT_CONFIGS[EXAM_REPORT_KIND_OF_ORDER[item.kind]],
          reportId: item.reportId,
          reportStatus: item.reportStatus,
          completed: item.status === "completed",
          order: item.serviceRequest,
        }
      : null;

  // テンプレートは帳票レイアウトが登録されているものだけ PDF 出力できる。
  // 他の種別では canonical を渡さないので照会自体が走らない。
  const { data: layoutStatus } = useReportLayoutStatus(
    item.kind === "qr" ? item.response.questionnaire : undefined,
  );
  const pdfReady = Boolean(layoutStatus?.registered && item.id);

  function handleDelete() {
    // 注射は連日オーダーの後続日も一緒に消すか選ばせるので、専用の確認モーダルにする。
    if (item.kind === "injection") {
      setInjectionDeleteOpen(true);
      return;
    }
    // 化学療法の日オーダーを消すとクールが歯抜けになり、化学療法室の予約も残る。
    // 投与を止めるだけなら化学療法タブの投与日パネルの「中止」を使う(§8.14 N-13)。
    const regimenNote = regimenDay
      ? `\n${regimenDay.name} ${cycleDayLabel(regimenDay)} の投与日です。削除するとクールから抜けます。投与を止めるだけなら化学療法タブで中止、クールごと消すならレジメン詳細の「取消」を使ってください。`
      : "";
    if (!window.confirm(`この${karteItemKindLabel(item)}を削除します。${regimenNote}よろしいですか?`)) return;
    onDelete(item);
  }

  // プロブレム選択中は、そのプロブレムを参照しない情報を控えめに表示する
  // (件数が減ると読み込み位置が動くので、隠さず減光にとどめる)。
  const dimmed = Boolean(selectedProblemIds?.size) && !referencesProblem(item, selectedProblemIds);

  return (
    <article
      className={`karte-card karte-card--${item.kind}${dimmed ? " karte-card--dimmed" : ""}${
        highlighted ? " karte-card--highlight" : ""
      }`}
      {...{ [KARTE_TARGET_ATTR]: karteItemKey(item) }}
    >
      <header className="karte-card__header">
        {/* 見出し(バッジ・表題・メタ)だけが折り返す入れ物。DO とケバブは
            この外に置いて、幅が狭くても行が増えず右上に留まるようにする。 */}
        <div className="karte-card__header-main">
          <span className={`karte-card__badge karte-card__badge--${item.kind}`}>
            {karteItemKindLabel(item)}
          </span>
          <span className="karte-card__title">{cardTitle(item)}</span>
          <ProblemBadge problem={itemProblem(item)} problemsById={problemsById} />
          <PathwayBadge pathway={itemPathway(item)} />
          {/* 検体検査は中間報告と、確定後に直した訂正報告をカードで見分けられるようにする。 */}
          {item.kind === "lab-order" && item.reportStatus === "preliminary" && (
            <span className="micro-result__badge">結果:中間報告</span>
          )}
          {item.kind === "lab-order" && item.reportStatus === "corrected" && (
            <span className="micro-result__badge micro-result__badge--muted">
              結果:訂正報告
            </span>
          )}
          {/* 細菌検査の結果が中間報告のうちは、最終化がまだなことをカードでも示す。 */}
          {item.kind === "micro-order" && item.reportStatus === "preliminary" && (
            <span className="micro-result__badge">結果:中間報告</span>
          )}
          {/* 病理は中間報告と、確定後に直した修正報告をカードで見分けられるようにする。 */}
          {item.kind === "patho-order" && item.reportStatus === "preliminary" && (
            <span className="micro-result__badge">結果:中間報告</span>
          )}
          {item.kind === "patho-order" && item.reportStatus === "amended" && (
            <span className="micro-result__badge micro-result__badge--muted">
              結果:修正報告
            </span>
          )}
          {/* 検査レポートは暫定報告と、確定後に直した訂正報告をカードで見分けられるようにする。 */}
          {examReport?.reportStatus === "preliminary" && (
            <span className="micro-result__badge">{`${examReport.config.labels.action}:暫定報告`}</span>
          )}
          {examReport?.reportStatus === "amended" && (
            <span className="micro-result__badge micro-result__badge--muted">
              {`${examReport.config.labels.action}:訂正報告`}
            </span>
          )}
          <span className="karte-card__meta">
            {/* 検体検査・放射線検査・生理検査は部門の進捗(依頼済・受付済・実施済・中止)が
                カードだけで分かるよう、時刻・依頼元の先頭に添える。バッジにはせず、
                メタデータの 1 項目として同じ区切りで並べる(理由は .karte-card__status)。 */}
            {(item.kind === "rad-order" ||
              item.kind === "injection" ||
              item.kind === "physio-order" ||
              item.kind === "endoscopy-order" ||
              item.kind === "treatment-order" ||
              item.kind === "surgery-order" ||
              item.kind === "patho-order" ||
              item.kind === "transfusion-order" ||
              item.kind === "rehab-order" ||
              item.kind === "nutrition-guidance-order" ||
              item.kind === "consult-order" ||
              item.kind === "radiotherapy-order" ||
              item.kind === "lab-order") && (
              <>
                <span className={`karte-card__status karte-card__status--${item.status}`}>
                  {item.kind === "injection"
                    ? injectionTaskStatusDisplay(item.status)
                    : item.kind === "rad-order"
                    ? radTaskStatusDisplay(item.status)
                    : item.kind === "physio-order"
                      ? physioTaskStatusDisplay(item.status)
                      : item.kind === "endoscopy-order"
                        ? endoscopyTaskStatusDisplay(item.status)
                        : item.kind === "treatment-order"
                          ? treatmentTaskStatusDisplay(item.status)
                          : item.kind === "surgery-order"
                            ? surgeryTaskStatusDisplay(item.status)
                            : item.kind === "patho-order"
                              ? pathoTaskStatusDisplay(item.status)
                              : item.kind === "transfusion-order"
                                ? transfusionTaskStatusDisplay(item.status)
                                : item.kind === "rehab-order"
                                  ? rehabTaskStatusDisplay(item.status)
                                  : item.kind === "nutrition-guidance-order"
                                    ? nutritionGuidanceTaskStatusDisplay(item.status)
                                    : item.kind === "consult-order"
                                      ? consultTaskStatusDisplay(item.status)
                                      : item.kind === "radiotherapy-order"
                                        ? radiotherapyTaskStatusDisplay(item.status)
                                        : labTaskStatusDisplay(item.status)}
                </span>
                {cardMeta(item) && <span aria-hidden="true">|</span>}
              </>
            )}
            {cardMeta(item)}
          </span>
        </div>
        <span className="karte-card__actions">
          {/* ［決定］化学療法の日オーダーには DO を出さない。複写しても印が付かないので、
              暦にも治療歴にも進捗にも乗らない「化学療法でない抗がん剤オーダー」ができるうえ、
              投与前チェック・アレルギー照合・体格からの再計算をすべて素通りする。
              同じ内容をもう一度出す操作は「次クールの登録」で、レジメン側が持っている
              (docs/chemo-regimen-design.md §8.14 N-13)。 */}
          {!regimenDay &&
            (item.kind === "prescription" ||
            item.kind === "injection" ||
            item.kind === "lab-order" ||
            item.kind === "micro-order" ||
            item.kind === "patho-order" ||
            item.kind === "rad-order" ||
            item.kind === "physio-order" ||
            item.kind === "endoscopy-order" ||
            item.kind === "treatment-order" ||
            item.kind === "surgery-order" ||
            item.kind === "transfusion-order" ||
            item.kind === "rehab-order" ||
            item.kind === "nutrition-guidance-order" ||
            item.kind === "consult-order" ||
            item.kind === "radiotherapy-order") && (
            <button
              type="button"
              className="karte-card__icon-button karte-card__icon-button--labeled"
              title={`DO(この${karteItemKindLabel(item)}を複写して新規登録)`}
              aria-label={`DO(この${karteItemKindLabel(item)}を複写して新規登録)`}
              onClick={() => onDo(item)}
            >
              <CopyIcon />
              <span className="karte-card__icon-label">DO</span>
            </button>
          )}
          {item.kind === "qr" &&
            (pdfReady ? (
              <a
                className="button karte-card__icon-button karte-card__icon-button--labeled"
                href={questionnaireResponsePdfUrl(item.id)}
                target="_blank"
                rel="noopener"
                title="PDF を開く"
                aria-label="PDF を開く"
              >
                <DocumentIcon />
                <span className="karte-card__icon-label">PDF</span>
              </a>
            ) : (
              <button
                type="button"
                className="karte-card__icon-button karte-card__icon-button--labeled"
                disabled
                title="このテンプレートの帳票レイアウトが未登録です"
                aria-label="PDF を開く(帳票レイアウトが未登録)"
              >
                <DocumentIcon />
                <span className="karte-card__icon-label">PDF</span>
              </button>
            ))}
          <RowMenu label={`${cardTitle(item) || karteItemKindLabel(item)} の操作`}>
            {/* バイタル・パス評価はカードに中身が全部出るので詳細モーダルを持たない。 */}
            {item.kind !== "vital" && item.kind !== "pathway-evaluation" && (
              <button type="button" className="row-menu__item" onClick={() => onOpenDetail(item)}>
                詳細表示
              </button>
            )}
            {linkActions && item.kind !== "vital" && item.kind !== "pathway-evaluation" && (
              <button
                type="button"
                className="row-menu__item"
                onClick={() => void copyKarteLink(karteLinkOfItem(item), linkActions.patientId)}
              >
                リンク取得
              </button>
            )}
            {/* 検体検査・細菌検査は、結果が登録済みのオーダーだけ結果内容を開ける。 */}
            {item.kind === "lab-order" && (
              <button
                type="button"
                className="row-menu__item"
                disabled={!item.reportId}
                title={item.reportId ? undefined : "この検体検査の結果はまだ登録されていません"}
                onClick={() => onOpenDetail({ kind: "lab-result", id: item.reportId })}
              >
                検査結果表示
              </button>
            )}
            {item.kind === "micro-order" && (
              <button
                type="button"
                className="row-menu__item"
                disabled={!item.reportId}
                title={item.reportId ? undefined : "この細菌検査の結果はまだ登録されていません"}
                onClick={() => onOpenDetail({ kind: "micro-result", id: item.reportId })}
              >
                検査結果表示
              </button>
            )}
            {item.kind === "patho-order" && (
              <button
                type="button"
                className="row-menu__item"
                disabled={!item.reportId}
                title={item.reportId ? undefined : "この病理検査のレポートはまだ登録されていません"}
                onClick={() => onOpenDetail({ kind: "patho-result", id: item.reportId })}
              >
                レポート表示
              </button>
            )}
            {examReport && (
              <button
                type="button"
                className="row-menu__item"
                disabled={!examReport.reportId}
                title={
                  examReport.reportId
                    ? undefined
                    : // 「内視鏡所見レポート」のように種別名で始まる名前には「この内視鏡の」を重ねない。
                      `${
                        examReport.config.labels.report.startsWith(examReport.config.labels.order)
                          ? "この"
                          : `この${examReport.config.labels.order}の`
                      }${examReport.config.labels.report}はまだ登録されていません`
                }
                onClick={() =>
                  onOpenDetail({ kind: examReport.config.detailKind, id: examReport.reportId })
                }
              >
                {`${examReport.config.labels.report}表示`}
              </button>
            )}
            {/* 所見は検査した後にしか書けないので、実施済のときだけ出す。 */}
            {examReport?.completed && (
              <button
                type="button"
                className="row-menu__item"
                onClick={() => setExamReportOpen(true)}
              >
                {`${examReport.config.labels.report}${examReport.reportId ? "編集" : "登録"}`}
              </button>
            )}
            {/* 他科依頼の回答は診療記録なので、専用の詳細ではなく診療記録として開く
                (docs/consult-order-design.md §5)。まだ回答が無い依頼では無効化する。 */}
            {item.kind === "consult-order" && (
              <button
                type="button"
                className="row-menu__item"
                disabled={!consultReplyId(item.serviceRequest)}
                title={
                  consultReplyId(item.serviceRequest)
                    ? undefined
                    : "この他科依頼にはまだ回答がありません"
                }
                onClick={() =>
                  onOpenDetail({ kind: "note", id: consultReplyId(item.serviceRequest) })
                }
              >
                回答表示
              </button>
            )}
            {/* 依頼と治療処方の行き来(docs/radiotherapy-order-design.md §2.5)。参照は治療処方の
                側だけが持つので、依頼側はタイムラインで逆引きしたものを開く。 */}
            {item.kind === "consult-order" &&
              item.radiotherapyOrderIds.map((id) => (
                <button
                  key={id}
                  type="button"
                  className="row-menu__item"
                  onClick={() => onOpenDetail({ kind: "radiotherapy-order", id })}
                >
                  治療処方表示
                </button>
              ))}
            {item.kind === "radiotherapy-order" && (
              <button
                type="button"
                className="row-menu__item"
                disabled={!summarizeRadiotherapyOrder(item.serviceRequest).consultRequest}
                onClick={() => {
                  const consult = summarizeRadiotherapyOrder(item.serviceRequest).consultRequest;
                  if (consult) onOpenDetail({ kind: "consult-order", id: consult.id });
                }}
              >
                依頼表示
              </button>
            )}
            {/* 照射期間中の診察と、そこで見つかった有害事象(CTCAE)の記録(§6.3)。 */}
            {item.kind === "radiotherapy-order" && item.serviceRequest.id && (
              <button
                type="button"
                className="row-menu__item"
                onClick={() => onOpenRadiotherapyPane("review", item.serviceRequest.id ?? "")}
              >
                週次レビュー
              </button>
            )}
            {item.kind === "radiotherapy-order" && item.serviceRequest.id && (
              <button
                type="button"
                className="row-menu__item"
                onClick={() => onOpenRadiotherapyPane("adverse", item.serviceRequest.id ?? "")}
              >
                有害事象
              </button>
            )}
            {/* 平文は元テンプレートの項目名と突き合わせて組み立てるので、
                テンプレートが引けたときだけ開ける。 */}
            {item.kind === "qr" && (
              <button
                type="button"
                className="row-menu__item"
                disabled={!item.questionnaire}
                title={item.questionnaire ? undefined : "元テンプレートが見つかりません"}
                onClick={() => setPlainTextOpen(true)}
              >
                平文表示
              </button>
            )}
            {/* 麻酔チャート(術中リアルタイム記録)。入室後に書き始め、実施済では
                振り返りに読むので、その 2 つの進捗でだけ開ける。
                docs/anesthesia-chart-design.md */}
            {item.kind === "surgery-order" &&
              (item.status === "in-progress" || item.status === "completed") && (
                <button
                  type="button"
                  className="row-menu__item"
                  onClick={() => setChartOpen(true)}
                >
                  麻酔チャート
                </button>
              )}
            {/* 輸血の実施入力。製剤を出すのは輸血部門だが投与するのは病棟なので、
                病棟がその場で書けるようカルテからも開ける
                (docs/transfusion-order-design.md §5.1)。出庫していない製剤は
                輸血できないので、出庫済のときだけ出す。 */}
            {item.kind === "transfusion-order" && item.status === "in-progress" && (
              <button
                type="button"
                className="row-menu__item"
                onClick={() => setPerformOpen(true)}
              >
                実施入力
              </button>
            )}
            {/* 診療記録は修正のたびに版が残るので、いつ誰が直したかを辿れるようにする。 */}
            {item.kind === "note" && (
              <button
                type="button"
                className="row-menu__item"
                onClick={() => setHistoryOpen(true)}
              >
                変更履歴
              </button>
            )}
            {/* 注射の中止。注射は薬剤部・病棟が動く前に「明日からやめる」形で止まる
                ことが多いので、部門画面(注射ワークリストは別タスク)を待たずカルテから
                押せるようにする。実施済(施用した)注射は中止できない。 */}
            {/* 注射の実施入力。施用するのは病棟なので、その場で書けるようカルテから
                開ける(注射ワークリストは別タスク)。中止した注射には出さない。
                1 日に複数回の施用があるので、実施済になっても押せる。 */}
            {item.kind === "injection" && item.status !== "cancelled" && (
              <button
                type="button"
                className="row-menu__item"
                onClick={() => setInjectionPerformOpen(true)}
              >
                実施入力
              </button>
            )}
            {item.kind === "injection" && item.performs.length > 0 && (
              <button
                type="button"
                className="row-menu__item"
                disabled={cancelInjectionPerforms.isPending}
                onClick={() => {
                  if (!window.confirm("この注射の実施記録をすべて取り消します。よろしいですか?")) return;
                  cancelInjectionPerforms.mutate({
                    order: item.serviceRequest,
                    task: item.task,
                    performs: item.performs,
                  });
                }}
              >
                実施取消
              </button>
            )}
            {item.kind === "injection" && canCancelInjection(item.status) && (
              <button
                type="button"
                className="row-menu__item"
                onClick={() => setInjectionCancel("cancel")}
              >
                中止
              </button>
            )}
            {item.kind === "injection" && canRestoreInjection(item.status) && (
              <button
                type="button"
                className="row-menu__item"
                onClick={() => setInjectionCancel("restore")}
              >
                中止取消
              </button>
            )}
            <button type="button" className="row-menu__item" onClick={() => setJsonOpen(true)}>
              FHIR JSON 表示
            </button>
            {/* パス評価の記載はパスタブの評価で書き直す(カードからはその病日の日めくりを開く)。
                評価はアウトカムの記録なので、カードからは消させない。 */}
            {item.kind === "pathway-evaluation" ? (
              <button type="button" className="row-menu__item" onClick={() => onEdit(item)}>
                パス表示
              </button>
            ) : (
              <>
                <button type="button" className="row-menu__item" onClick={() => onEdit(item)}>
                  編集
                </button>
                <button
                  type="button"
                  className="row-menu__item row-menu__item--danger"
                  onClick={handleDelete}
                  // レポートが付いたオーダーを消すと、レポートが指す先が無くなる。
                  disabled={deleting || Boolean(examReport?.reportId)}
                  title={
                    examReport?.reportId
                      ? `${examReport.config.labels.report}があるため削除できません`
                      : undefined
                  }
                >
                  削除
                </button>
              </>
            )}
          </RowMenu>
        </span>
      </header>

      <ErrorBanner error={deleteError} />
      {item.kind === "injection" && <ErrorBanner error={cancelInjectionPerforms.error} />}

      <CollapsibleBody>
        <KarteCardBody item={item} />
      </CollapsibleBody>

      {plainTextOpen && item.kind === "qr" && item.questionnaire && (
        <PlainTextModal
          title="平文表示"
          text={questionnaireResponseDocumentText(item.questionnaire, item.response)}
          onClose={() => setPlainTextOpen(false)}
        />
      )}
      {jsonOpen && <KarteCardJsonModal item={item} onClose={() => setJsonOpen(false)} />}
      {injectionPerformOpen && item.kind === "injection" && (
        <InjectionPerformModal
          order={item.serviceRequest}
          medicationRequests={item.medicationRequests}
          task={item.task}
          performs={item.performs}
          onClose={() => setInjectionPerformOpen(false)}
        />
      )}
      {injectionCancel && item.kind === "injection" && (
        <InjectionCancelModal
          serviceRequest={item.serviceRequest}
          task={item.task}
          mode={injectionCancel}
          onClose={() => setInjectionCancel(null)}
          onDone={() => setInjectionCancel(null)}
        />
      )}
      {injectionDeleteOpen && item.kind === "injection" && (
        <InjectionDeleteModal
          serviceRequest={item.serviceRequest}
          onClose={() => setInjectionDeleteOpen(false)}
          onDeleted={() => {
            setInjectionDeleteOpen(false);
            onDeleted(item);
          }}
        />
      )}
      {historyOpen && item.kind === "note" && (
        <ClinicalNoteHistoryModal noteId={item.id} onClose={() => setHistoryOpen(false)} />
      )}
      {chartOpen && item.kind === "surgery-order" && (
        <AnesthesiaChartModal orderId={item.id} onClose={() => setChartOpen(false)} />
      )}
      {examReportOpen && examReport && (
        <ExamReportEntryModal
          config={examReport.config}
          orderId={examReport.order.id ?? ""}
          patientId={examReport.order.subject?.reference?.split("/").pop() ?? ""}
          onClose={() => setExamReportOpen(false)}
        />
      )}
      {performOpen && item.kind === "transfusion-order" && (
        <TransfusionPerformModal
          order={item.serviceRequest}
          itemRequests={item.itemRequests}
          task={item.task}
          onClose={() => setPerformOpen(false)}
        />
      )}
    </article>
  );
});

// DO・PDF は 1 行に並ぶので、アイコンに短いラベルを添えて幅を詰める。
// それ以外の操作(詳細表示・FHIR JSON 表示・編集・削除)はケバブメニューに畳む。

// DO は「前回と同じ処方を起こす」操作なので、複写(2 枚重ね)のアイコンで表す。
function CopyIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
        {/* 背面の 1 枚。前面に隠れる辺は描かず L 字にする。 */}
        <path d="M10 5.6V3.2a1 1 0 0 0-1-1H3.2a1 1 0 0 0-1 1V9a1 1 0 0 0 1 1h2.4" />
        <rect x="5.6" y="5.6" width="8.2" height="8.2" rx="1" />
      </g>
    </svg>
  );
}

// PDF 出力。角を折った文書のアイコン。
function DocumentIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9.4 2H4.6a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h6.8a1 1 0 0 0 1-1V5.1L9.4 2Z" />
        <path d="M9.3 2.2v3h3" />
      </g>
    </svg>
  );
}

/** 他科依頼の回答(診療記録)の id。まだ回答が無ければ空。 */
function consultReplyId(sr: fhir4.ServiceRequest): string {
  return consultReply(sr).replyId;
}

// 「リンク取得」で貼るリンク。開き方はカードの詳細モーダルと同じ。
function karteLinkOfItem(
  item: Exclude<KarteTimelineItem, { kind: "vital" } | { kind: "pathway-evaluation" }>,
): KarteLink {
  const resourceType =
    item.kind === "note" ? "Composition" : item.kind === "qr" ? "QuestionnaireResponse" : "ServiceRequest";
  return {
    kind: item.kind,
    resourceType,
    id: item.id,
    label: karteLinkLabel(
      item.kind === "qr" ? item.label : karteItemKindLabel(item),
      item.day && karteDayLabel(item.day),
      item.kind !== "qr" && cardTitle(item),
    ),
  };
}

function cardTitle(item: KarteTimelineItem): string {
  if (item.kind === "note") return item.note.title ?? "";
  // パス評価はどのアウトカムの評価かが見出し(パス名・病日は本文の先頭に出す)。
  if (item.kind === "pathway-evaluation") return item.evaluation.unitName;
  // バイタルは種別バッジだけで内容が分かるので、タイトルは持たない。
  if (item.kind === "vital") return "";
  if (item.kind === "prescription") {
    const summary = summarizeServiceRequest(item.serviceRequest);
    return [summary.settingDisplay, summary.categoryDisplay].filter(Boolean).join(" | ");
  }
  // 注射も処方と同じく区分をタイトルにする(用法種別は本文の用法行に出る)。
  if (item.kind === "injection") {
    const summary = summarizeInjectionServiceRequest(item.serviceRequest);
    return [summary.settingDisplay, summary.categoryDisplay].filter(Boolean).join(" | ");
  }
  // 処置は至急区分を持たないので入外区分だけ。
  if (item.kind === "treatment-order") {
    return summarizeTreatmentOrder(item.serviceRequest).settingDisplay;
  }
  // 食事は入外区分が常に入院なのでタイトルに出さず、いつからいつまでかを出す。
  if (item.kind === "meal-order") {
    const summary = summarizeMealOrder(item.serviceRequest);
    return `${summary.startLabel}〜${summary.continuing ? " 継続中" : ` ${summary.endLabel}`}`;
  }
  // リハビリは入外区分と期間。期間継続型なので「いつからいつまで」が見出しに要る
  // (食事と同じ。ただし入外区分は入院・外来どちらもありうるので出す)。
  if (item.kind === "rehab-order") {
    const summary = summarizeRehabOrder(item.serviceRequest);
    return [summary.settingDisplay, summary.periodLabel].filter(Boolean).join(" | ");
  }
  // 栄養指導もリハビリと同じ期間継続型なので、入外区分と期間を見出しに出す。
  if (item.kind === "nutrition-guidance-order") {
    const summary = summarizeNutritionGuidanceOrder(item.serviceRequest);
    return [summary.settingDisplay, summary.periodLabel].filter(Boolean).join(" | ");
  }
  // 放射線治療は「第何コースで何が目的か」が見出し。
  if (item.kind === "radiotherapy-order") {
    const summary = summarizeRadiotherapyOrder(item.serviceRequest);
    return [summary.settingDisplay, `第${summary.courseNumber}コース`, summary.intentDisplay]
      .filter(Boolean)
      .join(" | ");
  }
  // 他科依頼は「どこへ出したか」が見出しそのもの。至急のときだけ緊急度も並べる
  // (手術と同じ流儀で、通常はわざわざ出さない)。
  if (item.kind === "consult-order") {
    const summary = summarizeConsultOrder(item.serviceRequest);
    return [summary.settingDisplay, summary.targetLabel, summary.urgent ? "至急" : ""]
      .filter(Boolean)
      .join(" | ");
  }
  // 手術は入外区分と、緊急・準緊急のときだけ予定区分を並べる(予定はわざわざ出さない)。
  if (item.kind === "surgery-order") {
    const summary = summarizeSurgeryOrder(item.serviceRequest);
    return [summary.settingDisplay, summary.priority !== "routine" ? summary.priorityDisplay : ""]
      .filter(Boolean)
      .join(" | ");
  }
  // 病理は検査区分(組織診・細胞診・術中迅速)が「何を依頼したか」そのものなので、
  // 処方区分と同じくタイトルに並べる。他の検査は検査項目がカード本文に出るが、
  // 病理は本文が検体の一覧なので、区分が見出しに無いと何の検査か分からない。
  if (item.kind === "patho-order") {
    const summary = summarizePathoOrder(item.serviceRequest);
    return [
      summary.settingDisplay,
      summary.examCategoryDisplay,
      summary.urgent ? summary.priorityDisplay : "",
    ]
      .filter(Boolean)
      .join(" | ");
  }
  // 輸血は検査区分(交差適合試験・T&S)が輸血部門の作業を決める軸なので、病理と同じく
  // タイトルに並べる。同意書が未取得のオーダーは例外なので、そのことも見出しに出す。
  if (item.kind === "transfusion-order") {
    const summary = summarizeTransfusionOrder(item.serviceRequest);
    return [
      summary.settingDisplay,
      summary.testTypeDisplay,
      summary.urgent ? summary.priorityDisplay : "",
      summary.consentConfirmed ? "" : "同意書未取得",
    ]
      .filter(Boolean)
      .join(" | ");
  }
  // 検体検査・細菌検査・放射線検査・生理検査・内視鏡は入外区分と、至急のときだけ
  // 至急区分を並べる(通常はわざわざ出さない)。
  if (
    item.kind === "lab-order" ||
    item.kind === "micro-order" ||
    item.kind === "rad-order" ||
    item.kind === "physio-order" ||
    item.kind === "endoscopy-order"
  ) {
    const summary =
      item.kind === "lab-order"
        ? summarizeLabOrder(item.serviceRequest)
        : item.kind === "micro-order"
          ? summarizeMicroOrder(item.serviceRequest)
          : item.kind === "rad-order"
            ? summarizeRadOrder(item.serviceRequest)
            : item.kind === "physio-order"
              ? summarizePhysioOrder(item.serviceRequest)
              : summarizeEndoscopyOrder(item.serviceRequest);
    return [summary.settingDisplay, summary.urgent ? summary.priorityDisplay : ""]
      .filter(Boolean)
      .join(" | ");
  }
  return item.label;
}

function cardMeta(item: KarteTimelineItem): string {
  const time = timeOf(item.dateTime);
  // 記録系のカードも、オーダーの「依頼科 | 依頼医師」と同じ並びで診療科・記入者を出す。
  if (item.kind === "note") {
    return [
      time,
      statusLabel(item.note.status),
      departmentOf(item.note).departmentName,
      item.note.author?.[0]?.display,
    ]
      .filter(Boolean)
      .join(" | ");
  }
  if (item.kind === "qr") {
    const summary = summarizeQuestionnaireResponse(item.response);
    return [time, summary.statusLabel, departmentOf(item.response).departmentName, summary.authorName]
      .filter(Boolean)
      .join(" | ");
  }
  // バイタルは測定時刻と診療科(誰が測ったかは Observation に持たせていない)。
  if (item.kind === "vital") {
    return [time, vitalEntryDepartment(item.entry).departmentName].filter(Boolean).join(" | ");
  }
  if (item.kind === "pathway-evaluation") {
    return [
      time,
      item.evaluation.achievementLabel,
      departmentOf(item.evaluation.observation).departmentName,
      item.evaluation.performerName,
    ]
      .filter(Boolean)
      .join(" | ");
  }
  const requesterSummary = orderContextSummary(orderRequester(item.serviceRequest));
  // 放射線検査は撮影時刻を指定できるので、依頼科・依頼医師の前に添える。記入時刻を
  // 出す診療記録と紛れないよう「撮影」と付ける(未指定のオーダーでは出さない)。
  if (item.kind === "rad-order") {
    const shotTime = radOrderTime(item.serviceRequest);
    return [shotTime && `撮影 ${shotTime}`, requesterSummary].filter(Boolean).join(" | ");
  }
  // 生理検査も実施時刻を指定できる。放射線と同じ位置に「検査」と付けて添える。
  if (item.kind === "physio-order") {
    const examTime = physioOrderTime(item.serviceRequest);
    return [examTime && `検査 ${examTime}`, requesterSummary].filter(Boolean).join(" | ");
  }
  if (item.kind === "endoscopy-order") {
    const examTime = endoscopyOrderTime(item.serviceRequest);
    return [examTime && `検査 ${examTime}`, requesterSummary].filter(Boolean).join(" | ");
  }
  // 処置も実施時刻を指定できる。同じ位置に「実施」と付けて添える。
  if (item.kind === "treatment-order") {
    const performTime = treatmentOrderTime(item.serviceRequest);
    return [performTime && `実施 ${performTime}`, requesterSummary].filter(Boolean).join(" | ");
  }
  // 手術は入室予定時刻と手術室を添える(日付はカードの載る日で分かる。未定なら明示)。
  if (item.kind === "surgery-order") {
    const summary = summarizeSurgeryOrder(item.serviceRequest);
    const scheduled = summary.scheduledDate
      ? `予定 ${summary.scheduledDate} ${summary.scheduledTime}`.trim()
      : "日付未定";
    return [scheduled, summary.roomName, requesterSummary].filter(Boolean).join(" | ");
  }
  // 輸血も投与予定時刻を指定できる。同じ位置に「投与」と付けて添える。
  if (item.kind === "transfusion-order") {
    const scheduled = timeOf(item.serviceRequest.occurrenceDateTime ?? "");
    return [scheduled && `投与 ${scheduled}`, requesterSummary].filter(Boolean).join(" | ");
  }
  // 他科依頼は希望日が必須でカードもその日に載るので、日付は添えない。
  if (item.kind === "consult-order") {
    const summary = summarizeConsultOrder(item.serviceRequest);
    return [summary.replierName && `回答 ${summary.replierName}`, requesterSummary]
      .filter(Boolean)
      .join(" | ");
  }
  // 連日オーダーの注射は「何日目」かを添える(単日のオーダーでは出ない)。レジメンから
  // 出た注射・処方は「レジメン名 C1 Day8」を添え、種別バッジが「化学療法」になるぶん
  // どちらのオーダーかもここに出す。
  if (item.kind === "injection") {
    const regimen = regimenOrderLabel(item.serviceRequest);
    return [
      regimen,
      regimen ? KARTE_KIND_LABELS[item.kind] : "",
      injectionSeriesLabel(item.serviceRequest),
      requesterSummary,
    ]
      .filter(Boolean)
      .join(" | ");
  }
  if (item.kind === "prescription") {
    const regimen = regimenOrderLabel(item.serviceRequest);
    return [regimen, regimen ? KARTE_KIND_LABELS[item.kind] : "", requesterSummary]
      .filter(Boolean)
      .join(" | ");
  }
  // 処方・注射は診療記録の作成者と同じ位置に、依頼科・依頼医師を出す。登録日時
  // (authoredOn)はカードには出さない(カードの日はオーダー開始日で、いつ登録したかは
  // 詳細の「登録日時」で見る)。
  return requesterSummary;
}

// 診療日はグループ見出しに出るのでカードには時刻だけを添える。
// 日付のみの値(時刻を指定していない開始日)は時刻を持たないので空文字。
function timeOf(dateTime: string): string {
  if (dateTime.length <= 10) return "";
  const date = new Date(dateTime);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function KarteCardBody({ item }: { item: KarteTimelineItem }) {
  if (item.kind === "vital") {
    const rows = vitalDisplayRows(item.entry);
    if (rows.length === 0) return <p className="karte-card__empty">測定値がありません。</p>;
    return (
      <dl className="vital-card">
        {rows.map((row) => (
          <div className="vital-card__row" key={row.label}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    );
  }

  if (item.kind === "note") {
    const sections = noteBodySections(item.note);
    if (sections.length === 0) return <p className="karte-card__empty">本文がありません。</p>;
    return (
      <>
        {sections.map((section, index) => {
          // テンプレート由来のセクションは、記入内容に描き込み済みシェーマ画像が
          // あれば本文の「あり」の印に代えて実物を続けて出す。
          const responseId = sectionResponseId(section);
          return (
            <div className="karte-card__section" key={index}>
              <span className="karte-card__section-title">
                {section.title || sectionTitle(section.code?.coding?.[0]?.code)}
              </span>
              <RichTextView
                html={
                  responseId
                    ? stripSchemaImageNotes(section.text?.div)
                    : (section.text?.div ?? "")
                }
              />
              {responseId && <ResponseSchemaImages responseId={responseId} />}
            </div>
          );
        })}
      </>
    );
  }

  if (item.kind === "prescription") {
    const rps = groupByRp(item.medicationRequests);
    const comment = prescriptionComment(item.serviceRequest);
    if (rps.length === 0) return <p className="karte-card__empty">処方内容がありません。</p>;
    return (
      <>
        {rps.map((rp) => (
          <div className="karte-rp" key={rp.rpNumber}>
            <div className="karte-rp__head">
              <span className="karte-rp__number">{`RP${rp.rpNumber}`}</span>
            </div>
            <ul className="karte-rp__medicines">
              {rp.medicines.map((medicine) => (
                <li key={medicine.orderInRp}>
                  <span className="karte-rp__medicine-name">{medicine.name}</span>
                  {medicine.dose != null && (
                    <span className="karte-rp__medicine-dose">
                      {`${medicine.dose}${medicine.unit ?? ""}`}
                    </span>
                  )}
                  {medicine.unevenLabel && (
                    <span className="karte-rp__comment">{`（${medicine.unevenLabel}）`}</span>
                  )}
                  {medicine.comment && (
                    <span className="karte-rp__comment">{`（${medicine.comment}）`}</span>
                  )}
                </li>
              ))}
            </ul>
            {/* 紙の処方箋と同じく、用法は薬剤の後ろに置く。 */}
            <div className="karte-rp__detail">
              <span className="karte-rp__detail-label">用法:</span>
              <span className="karte-rp__usage">
                <span>{rp.usageName ?? "-"}</span>
                {rp.supplementLabel && <span>{rp.supplementLabel}</span>}
                {hasDoseDays(rp.usageCode, rp.basicCategory) && rp.doseDays != null && (
                  <span className="karte-rp__dose">{`${rp.doseDays}日分`}</span>
                )}
                {isAsNeededUsage(rp.usageCode) && rp.doseCount != null && (
                  <span className="karte-rp__dose">{`${rp.doseCount}回分`}</span>
                )}
                {rp.usageComment && (
                  <span className="karte-rp__comment">{`（${rp.usageComment}）`}</span>
                )}
              </span>
            </div>
          </div>
        ))}
        {comment && <p className="karte-card__note">{comment}</p>}
      </>
    );
  }

  if (item.kind === "injection") {
    const rps = groupInjectionByRp(item.medicationRequests);
    const comment = injectionComment(item.serviceRequest);
    if (rps.length === 0) return <p className="karte-card__empty">注射内容がありません。</p>;
    return (
      <>
        {rps.map((rp) => (
          <div className="karte-rp" key={rp.rpNumber}>
            <div className="karte-rp__head">
              <span className="karte-rp__number">{`RP${rp.rpNumber}`}</span>
            </div>
            <ul className="karte-rp__medicines">
              {rp.medicines.map((medicine) => (
                <li key={medicine.orderInRp}>
                  <span className="karte-rp__medicine-name">{medicine.name}</span>
                  {medicine.dose != null && (
                    <span className="karte-rp__medicine-dose">
                      {`${medicine.dose}${medicine.unit ?? ""}`}
                    </span>
                  )}
                  {medicine.comment && (
                    <span className="karte-rp__comment">{`（${medicine.comment}）`}</span>
                  )}
                </li>
              ))}
            </ul>
            <div className="karte-rp__detail">
              <span className="karte-rp__detail-label">用法:</span>
              <span className="karte-rp__usage">
                <span>{injectionUsageSummary(rp) || "-"}</span>
                {rp.usageComment && (
                  <span className="karte-rp__comment">{`（${rp.usageComment}）`}</span>
                )}
              </span>
            </div>
            {rp.times.length > 0 && (
              <div className="karte-rp__detail">
                <span className="karte-rp__detail-label">時刻:</span>
                <span>{injectionTimesLabel(rp.times)}</span>
              </div>
            )}
          </div>
        ))}
        {comment && <p className="karte-card__note">{comment}</p>}
        {item.performs.map((perform) => (
          <InjectionPerformSection perform={perform} key={perform.id} />
        ))}
      </>
    );
  }

  if (item.kind === "lab-order") {
    return <LabOrderCardBody serviceRequest={item.serviceRequest} itemRequests={item.itemRequests} />;
  }

  if (item.kind === "micro-order") {
    return (
      <MicroOrderCardBody serviceRequest={item.serviceRequest} itemRequests={item.itemRequests} />
    );
  }

  if (item.kind === "patho-order") {
    return (
      <PathoOrderCardBody serviceRequest={item.serviceRequest} itemRequests={item.itemRequests} />
    );
  }

  if (item.kind === "rad-order") {
    return (
      <RadOrderCardBody
        serviceRequest={item.serviceRequest}
        itemRequests={item.itemRequests}
        performs={item.performs}
      />
    );
  }

  if (item.kind === "physio-order") {
    return (
      <PhysioOrderCardBody
        serviceRequest={item.serviceRequest}
        itemRequests={item.itemRequests}
        performs={item.performs}
      />
    );
  }

  if (item.kind === "endoscopy-order") {
    return (
      <EndoscopyOrderCardBody
        serviceRequest={item.serviceRequest}
        itemRequests={item.itemRequests}
        performs={item.performs}
      />
    );
  }

  if (item.kind === "treatment-order") {
    return (
      <TreatmentOrderCardBody
        serviceRequest={item.serviceRequest}
        itemRequests={item.itemRequests}
        performs={item.performs}
      />
    );
  }

  if (item.kind === "surgery-order") {
    return (
      <SurgeryOrderCardBody
        serviceRequest={item.serviceRequest}
        itemRequests={item.itemRequests}
        performs={item.performs}
      />
    );
  }

  if (item.kind === "meal-order") {
    return <MealOrderCardBody serviceRequest={item.serviceRequest} />;
  }

  if (item.kind === "transfusion-order") {
    return (
      <TransfusionOrderCardBody
        serviceRequest={item.serviceRequest}
        itemRequests={item.itemRequests}
        performs={item.performs}
      />
    );
  }

  if (item.kind === "rehab-order") {
    return <RehabOrderCardBody serviceRequest={item.serviceRequest} performs={item.performs} />;
  }

  if (item.kind === "nutrition-guidance-order") {
    return (
      <NutritionGuidanceOrderCardBody
        serviceRequest={item.serviceRequest}
        performs={item.performs}
      />
    );
  }

  if (item.kind === "consult-order") {
    return <ConsultOrderCardBody serviceRequest={item.serviceRequest} />;
  }
  if (item.kind === "radiotherapy-order") {
    return (
      <RadiotherapyOrderCardBody
        serviceRequest={item.serviceRequest}
        fractions={item.fractions}
        hasCourseSummary={item.hasCourseSummary}
      />
    );
  }

  if (item.kind === "pathway-evaluation") {
    return <PathwayEvaluationCardBody evaluation={item.evaluation} />;
  }

  if (!item.questionnaire) {
    return (
      <p className="karte-card__empty">
        元テンプレート({item.response.questionnaire})が見つからないため内容を表示できません。
      </p>
    );
  }
  // シェーマ画像は下に実物を出すので、平文の「あり」の印は落とす。
  const schemas = schemaImageRefs(item.response);
  const lines = schemaAnnotatedLines(
    questionnaireResponsePlainText(item.questionnaire, item.response),
  );
  if (lines.length === 0 && schemas.length === 0) {
    return <p className="karte-card__empty">回答がありません。</p>;
  }
  return (
    <>
      {lines.length > 0 && (
        <ul className="karte-qr__lines">
          {lines.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
      )}
      <SchemaImageGallery refs={schemas} />
    </>
  );
}

// 情報が対象とするプロブレムのバッジ。名称は現在のプロブレムから引き直すので、
// 病名を編集しても過去の記録に古い名前が残らない。削除済みのプロブレムは
// リソースに保存してある表示名でフォールバックする。
function ProblemBadge({
  problem,
  problemsById,
}: {
  problem: ProblemRef | null;
  problemsById: Map<string, fhir4.Condition>;
}) {
  if (!problem) return null;

  const current = problemsById.get(problem.conditionId);
  return (
    <span
      className={`karte-card__problem${current ? "" : " karte-card__problem--missing"}`}
      title={current ? "対象プロブレム" : "このプロブレムは削除されています"}
    >
      {current ? problemLabel(current) : `${problem.display || "不明"} (削除済み)`}
    </span>
  );
}

// クリニカルパスのオーダー雛形から出たオーダーに付ける印。パス名は長いので
// バッジは「パス」だけにして、名前はツールチップに回す(docs/clinical-pathway-design.md §5.1)。
function PathwayBadge({ pathway }: { pathway: { code: string; name: string } | null }) {
  if (!pathway) return null;
  return (
    <span
      className="karte-card__problem karte-card__pathway"
      title={`クリニカルパス: ${pathway.name || pathway.code}`}
    >
      パス
    </span>
  );
}

// 1 情報の高さが伸びすぎないよう折りたたむ。溢れているときだけ展開ボタンを出す。
function CollapsibleBody({ children }: { children: ReactNode }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const body = bodyRef.current;
    // 展開中は clientHeight == scrollHeight になるので判定しない
    // (折りたたみボタンが消えてしまう)。
    if (!body || expanded) return;
    const check = () => setOverflowing(body.scrollHeight > body.clientHeight + 1);
    check();
    // 画像の読み込みや折り返しで高さが後から変わる。
    const observer = new ResizeObserver(check);
    observer.observe(body);
    return () => observer.disconnect();
  }, [expanded]);

  return (
    <>
      <div className={`karte-card__body${expanded ? " karte-card__body--expanded" : ""}`} ref={bodyRef}>
        {children}
      </div>
      {overflowing && (
        <button
          type="button"
          className="karte-card__toggle"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "折りたたむ" : "続き表示"}
        </button>
      )}
    </>
  );
}
