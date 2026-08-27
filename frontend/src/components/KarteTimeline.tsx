import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  useDeleteClinicalNote,
  useDeleteLabOrder,
  useDeleteMicroOrder,
  useDeleteRadOrder,
  useDeletePhysioOrder,
  useDeleteTreatmentOrder,
  useDeleteSurgeryOrder,
  useDeleteEndoscopyOrder,
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
  karteDayLabel,
  karteItemKey,
  itemProblem,
  referencesProblem,
  type KarteDayGroup,
  type KarteTimelineItem,
} from "../fhir/karteTimeline";
import type { KarteDetailTarget } from "../karteUrl";
import {
  groupInjectionByRp,
  injectionComment,
  summarizeInjectionServiceRequest,
  type InjectionRpDisplay,
} from "../fhir/injectionHelpers";
import {
  groupBySpecimen,
  labOrderComment,
  labOrderItems,
  memberSummary,
  specimenGroupLabel,
  summarizeLabOrder,
} from "../fhir/labOrderHelpers";
import { labTaskStatusDisplay } from "../fhir/labTaskHelpers";
import {
  microOrderComment,
  microOrderContents,
  organismSummary,
  specimenLabel,
  summarizeMicroOrder,
} from "../fhir/microOrderHelpers";
import {
  bodySiteLabel,
  entryLabel,
  orderEntries,
  radOrderItems,
  radOrderTime,
  summarizeRadOrder,
  type RadOrderItemLine,
} from "../fhir/radOrderHelpers";
import type { RadPerformDisplay } from "../fhir/radResultHelpers";
import { radTaskStatusDisplay } from "../fhir/radTaskHelpers";
import {
  // GP の見出しの組み立ては放射線と同名の関数なので、別名で取り込む。
  entryLabel as physioEntryLabel,
  orderEntries as physioOrderEntries,
  physioOrderItems,
  physioOrderTime,
  summarizePhysioOrder,
  type PhysioOrderItemLine,
} from "../fhir/physioOrderHelpers";
import type { PhysioPerformDisplay } from "../fhir/physioResultHelpers";
import { physioTaskStatusDisplay } from "../fhir/physioTaskHelpers";
import {
  entryLabel as treatmentEntryLabel,
  orderEntries as treatmentOrderEntries,
  treatmentOrderItems,
  treatmentOrderTime,
  summarizeTreatmentOrder,
} from "../fhir/treatmentOrderHelpers";
import type { TreatmentPerformDisplay } from "../fhir/treatmentResultHelpers";
import { treatmentTaskStatusDisplay } from "../fhir/treatmentTaskHelpers";
import {
  summarizeSurgeryOrder,
  surgeryAnesthesiaMethodDisplay,
  surgeryApproachDisplay,
  surgeryBodySiteLabel,
  surgeryOrderItems,
} from "../fhir/surgeryOrderHelpers";
import { surgeryTaskStatusDisplay } from "../fhir/surgeryTaskHelpers";
import type { SurgeryPerformDisplay } from "../fhir/surgeryResultHelpers";
import {
  entryLabel as endoscopyEntryLabel,
  orderEntries as endoscopyOrderEntries,
  endoscopyOrderItems,
  endoscopyOrderTime,
  summarizeEndoscopyOrder,
  type EndoscopyOrderItemLine,
} from "../fhir/endoscopyOrderHelpers";
import type { EndoscopyPerformDisplay } from "../fhir/endoscopyResultHelpers";
import { endoscopyTaskStatusDisplay } from "../fhir/endoscopyTaskHelpers";
import {
  groupByRp,
  orderContextSummary,
  prescriptionComment,
  prescriptionRequester,
  summarizeServiceRequest,
} from "../fhir/prescriptionHelpers";
import {
  questionnaireResponseDocumentText,
  questionnaireResponsePlainText,
  schemaAnnotatedLines,
  schemaImageRefs,
  summarizeQuestionnaireResponse,
} from "../fhir/questionnaireResponseHelpers";
import { vitalDisplayRows } from "../fhir/vitalHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { ClinicalNoteHistoryModal } from "./ClinicalNoteHistoryModal";
import { KarteCardJsonModal } from "./KarteCardModals";
import { PlainTextModal } from "./PlainTextModal";
import { RichTextView } from "./RichTextView";
import { ResponseSchemaImages, SchemaImageGallery } from "./SchemaImageGallery";
import { RowMenu } from "./RowMenu";

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
  onDeleted,
  containerRef,
  problemsById,
  selectedProblemIds,
  highlightKey,
  emptyMessage,
}: KarteTimelineProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [sentinelVisible, setSentinelVisible] = useState(false);

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
              <h3 className="karte-group__date">{karteDayLabel(group.day)}</h3>
              {group.items.map((item) => (
                <KarteCard
                  key={karteItemKey(item)}
                  item={item}
                  onEdit={onEdit}
                  onDo={onDo}
                  onOpenDetail={onOpenDetail}
                  onDeleted={onDeleted}
                  problemsById={problemsById}
                  selectedProblemIds={selectedProblemIds}
                  highlighted={highlightKey === karteItemKey(item)}
                />
              ))}
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

function KarteCard({
  item,
  onEdit,
  onDo,
  onOpenDetail,
  onDeleted,
  problemsById,
  selectedProblemIds,
  highlighted,
}: {
  item: KarteTimelineItem;
  onEdit: (item: KarteTimelineItem) => void;
  onDo: (item: KarteTimelineItem) => void;
  onOpenDetail: (target: KarteDetailTarget) => void;
  onDeleted: (item: KarteTimelineItem) => void;
  problemsById: Map<string, fhir4.Condition>;
  selectedProblemIds: ReadonlySet<string> | null;
  highlighted: boolean;
}) {
  const deleteNote = useDeleteClinicalNote();
  const deletePrescription = useDeletePrescription();
  const deleteLabOrder = useDeleteLabOrder();
  const deleteMicroOrder = useDeleteMicroOrder();
  const deleteRadOrder = useDeleteRadOrder();
  const deletePhysioOrder = useDeletePhysioOrder();
  const deleteEndoscopyOrder = useDeleteEndoscopyOrder();
  const deleteTreatmentOrder = useDeleteTreatmentOrder();
  const deleteSurgeryOrder = useDeleteSurgeryOrder();
  const deleteResponse = useDeleteQuestionnaireResponse();
  const deleteVital = useDeleteVitalEntry();
  // 平文表示・FHIR JSON 表示はモーダルで開く(カルテの読み位置を動かさない)。
  // 詳細表示は URL に載せるので親に任せる。
  const [plainTextOpen, setPlainTextOpen] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const deleting =
    deleteNote.isPending ||
    deletePrescription.isPending ||
    deleteLabOrder.isPending ||
    deleteMicroOrder.isPending ||
    deleteRadOrder.isPending ||
    deletePhysioOrder.isPending ||
    deleteEndoscopyOrder.isPending ||
    deleteTreatmentOrder.isPending ||
    deleteSurgeryOrder.isPending ||
    deleteResponse.isPending ||
    deleteVital.isPending;
  const deleteError =
    deleteNote.error ??
    deletePrescription.error ??
    deleteLabOrder.error ??
    deleteMicroOrder.error ??
    deleteRadOrder.error ??
    deletePhysioOrder.error ??
    deleteEndoscopyOrder.error ??
    deleteTreatmentOrder.error ??
    deleteSurgeryOrder.error ??
    deleteResponse.error ??
    deleteVital.error;

  // テンプレートは帳票レイアウトが登録されているものだけ PDF 出力できる。
  // 他の種別では canonical を渡さないので照会自体が走らない。
  const { data: layoutStatus } = useReportLayoutStatus(
    item.kind === "qr" ? item.response.questionnaire : undefined,
  );
  const pdfReady = Boolean(layoutStatus?.registered && item.id);

  function handleDelete() {
    if (!window.confirm(`この${KARTE_KIND_LABELS[item.kind]}を削除します。よろしいですか?`)) return;
    const options = { onSuccess: () => onDeleted(item) };
    if (item.kind === "note") deleteNote.mutate(item.id, options);
    // 注射も処方と同じ ServiceRequest + MedicationRequest 構成なので削除処理を共用する。
    else if (item.kind === "prescription" || item.kind === "injection") {
      deletePrescription.mutate(item.id, options);
    }
    // 検体検査・細菌検査・放射線検査・生理検査・内視鏡・処置は明細も ServiceRequest
    // なので、専用の削除でまとめて消す。
    else if (item.kind === "lab-order") deleteLabOrder.mutate(item.id, options);
    else if (item.kind === "micro-order") deleteMicroOrder.mutate(item.id, options);
    else if (item.kind === "rad-order") deleteRadOrder.mutate(item.id, options);
    else if (item.kind === "physio-order") deletePhysioOrder.mutate(item.id, options);
    else if (item.kind === "endoscopy-order") deleteEndoscopyOrder.mutate(item.id, options);
    else if (item.kind === "treatment-order") deleteTreatmentOrder.mutate(item.id, options);
    else if (item.kind === "surgery-order") deleteSurgeryOrder.mutate(item.id, options);
    // テンプレート回答は、生成した Observation も一緒に消すのでリソースごと渡す。
    else if (item.kind === "qr") deleteResponse.mutate(item.response, options);
    // バイタルは 1 回の測定が項目ごとの Observation に分かれるのでまとめて消す。
    else if (item.kind === "vital") {
      deleteVital.mutate(
        item.entry.observations.map((observation) => observation.id ?? "").filter(Boolean),
        options,
      );
    }
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
        <span className={`karte-card__badge karte-card__badge--${item.kind}`}>
          {KARTE_KIND_LABELS[item.kind]}
        </span>
        <span className="karte-card__title">{cardTitle(item)}</span>
        <ProblemBadge problem={itemProblem(item)} problemsById={problemsById} />
        {/* 細菌検査の結果が中間報告のうちは、最終化がまだなことをカードでも示す。 */}
        {item.kind === "micro-order" && item.reportStatus === "preliminary" && (
          <span className="micro-result__badge">結果:中間報告</span>
        )}
        <span className="karte-card__meta">
          {/* 検体検査・放射線検査・生理検査は部門の進捗(依頼済・受付済・実施済・中止)が
              カードだけで分かるよう、時刻・依頼元の先頭に添える。バッジにはせず、
              メタデータの 1 項目として同じ区切りで並べる(理由は .karte-card__status)。 */}
          {(item.kind === "rad-order" ||
            item.kind === "physio-order" ||
            item.kind === "endoscopy-order" ||
            item.kind === "treatment-order" ||
            item.kind === "surgery-order" ||
            item.kind === "lab-order") && (
            <>
              <span className={`karte-card__status karte-card__status--${item.status}`}>
                {item.kind === "rad-order"
                  ? radTaskStatusDisplay(item.status)
                  : item.kind === "physio-order"
                    ? physioTaskStatusDisplay(item.status)
                    : item.kind === "endoscopy-order"
                      ? endoscopyTaskStatusDisplay(item.status)
                      : item.kind === "treatment-order"
                        ? treatmentTaskStatusDisplay(item.status)
                        : item.kind === "surgery-order"
                          ? surgeryTaskStatusDisplay(item.status)
                          : labTaskStatusDisplay(item.status)}
              </span>
              {cardMeta(item) && <span aria-hidden="true">|</span>}
            </>
          )}
          {cardMeta(item)}
        </span>
        <span className="karte-card__actions">
          {(item.kind === "prescription" ||
            item.kind === "injection" ||
            item.kind === "lab-order" ||
            item.kind === "micro-order" ||
            item.kind === "rad-order" ||
            item.kind === "physio-order" ||
            item.kind === "endoscopy-order" ||
            item.kind === "treatment-order" ||
            item.kind === "surgery-order") && (
            <button
              type="button"
              className="karte-card__icon-button karte-card__icon-button--labeled"
              title={`DO(この${KARTE_KIND_LABELS[item.kind]}を複写して新規登録)`}
              aria-label={`DO(この${KARTE_KIND_LABELS[item.kind]}を複写して新規登録)`}
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
          <RowMenu label={`${cardTitle(item) || KARTE_KIND_LABELS[item.kind]} の操作`}>
            {/* バイタルはカードに測定値が全部出るので詳細モーダルを持たない。 */}
            {item.kind !== "vital" && (
              <button type="button" className="row-menu__item" onClick={() => onOpenDetail(item)}>
                詳細表示
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
            <button type="button" className="row-menu__item" onClick={() => setJsonOpen(true)}>
              FHIR JSON 表示
            </button>
            <button type="button" className="row-menu__item" onClick={() => onEdit(item)}>
              編集
            </button>
            <button
              type="button"
              className="row-menu__item row-menu__item--danger"
              onClick={handleDelete}
              disabled={deleting}
            >
              削除
            </button>
          </RowMenu>
        </span>
      </header>

      <ErrorBanner error={deleteError} />

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
      {historyOpen && item.kind === "note" && (
        <ClinicalNoteHistoryModal noteId={item.id} onClose={() => setHistoryOpen(false)} />
      )}
    </article>
  );
}

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

function cardTitle(item: KarteTimelineItem): string {
  if (item.kind === "note") return item.note.title ?? "";
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
  // 手術は入外区分と、緊急・準緊急のときだけ予定区分を並べる(予定はわざわざ出さない)。
  if (item.kind === "surgery-order") {
    const summary = summarizeSurgeryOrder(item.serviceRequest);
    return [summary.settingDisplay, summary.priority !== "routine" ? summary.priorityDisplay : ""]
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
  if (item.kind === "note") {
    return [time, statusLabel(item.note.status), item.note.author?.[0]?.display]
      .filter(Boolean)
      .join(" | ");
  }
  if (item.kind === "qr") {
    // 診療記録と同じく、時刻・ステータス・記入者を並べる。
    const summary = summarizeQuestionnaireResponse(item.response);
    return [time, summary.statusLabel, summary.authorName].filter(Boolean).join(" | ");
  }
  // バイタルは測定時刻だけ(誰が測ったかは Observation に持たせていない)。
  if (item.kind === "vital") return time;
  const requesterSummary = orderContextSummary(prescriptionRequester(item.serviceRequest));
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
  // 手術のカードは申込日に置かれるので、予定日時と手術室をここで添える。
  if (item.kind === "surgery-order") {
    const summary = summarizeSurgeryOrder(item.serviceRequest);
    const scheduled = summary.scheduledDate
      ? `予定 ${summary.scheduledDate} ${summary.scheduledTime}`.trim()
      : "日付未定";
    return [scheduled, summary.roomName, requesterSummary].filter(Boolean).join(" | ");
  }
  // 処方・注射は診療記録の作成者と同じ位置に、依頼科・依頼医師を出す。オーダー日は
  // 日付のみを入力する項目なので時刻は出さない(古い処方には時刻付きの authoredOn が
  // あり、意味のない「00:00」が出てしまうため)。
  return requesterSummary;
}

// 注射カードの用法 1 行(「点滴 | 静脈注射 | 静脈内 | 100mL/h」)。
function injectionUsageSummary(rp: InjectionRpDisplay): string {
  return [
    rp.usageTypeDisplay,
    rp.methodDisplay,
    rp.routeDisplay,
    rp.siteDisplay,
    rp.lineDisplay,
    rp.rate != null ? `${rp.rate}mL/h` : "",
  ]
    .filter(Boolean)
    .join(" | ");
}

// 診療日はグループ見出しに出るのでカードには時刻だけを添える。
// 日付のみ(処方の authoredOn)は時刻を持たないので空文字。
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
                  {medicine.comment && (
                    <span className="karte-rp__comment">{`（${medicine.comment}）`}</span>
                  )}
                </li>
              ))}
            </ul>
            {/* 紙の処方箋と同じく、用法は薬剤の後ろに置く。 */}
            <div className="karte-rp__detail">
              <span className="karte-rp__detail-label">用法:</span>
              <span>{rp.usageName ?? "-"}</span>
              {rp.basicCategory === "内服" && rp.doseDays != null && (
                <span className="karte-rp__dose">{`${rp.doseDays}日分`}</span>
              )}
              {rp.basicCategory === "頓服" && rp.doseCount != null && (
                <span className="karte-rp__dose">{`${rp.doseCount}回分`}</span>
              )}
              {rp.usageComment && (
                <span className="karte-rp__comment">{`（${rp.usageComment}）`}</span>
              )}
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
              <span>{injectionUsageSummary(rp) || "-"}</span>
              {rp.usageComment && (
                <span className="karte-rp__comment">{`（${rp.usageComment}）`}</span>
              )}
            </div>
            {rp.startTimes.length > 0 && (
              <div className="karte-rp__detail">
                <span className="karte-rp__detail-label">開始:</span>
                <span>{rp.startTimes.join("、")}</span>
              </div>
            )}
          </div>
        ))}
        {comment && <p className="karte-card__note">{comment}</p>}
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

// 検体検査は検体(採血管)ごとにまとめて出す。採血の現場が動く単位に合わせる。
// パネル検査は構成項目もオーダーに入っているので、親の後ろに並べて添える
// (マスタではなくオーダーの内容なので、構成を後から直しても過去の表示は変わらない)。
function LabOrderCardBody({
  serviceRequest,
  itemRequests,
}: {
  serviceRequest: fhir4.ServiceRequest;
  itemRequests: fhir4.ServiceRequest[];
}) {
  const groups = groupBySpecimen(labOrderItems(serviceRequest, itemRequests));
  const comment = labOrderComment(serviceRequest);

  if (groups.length === 0) return <p className="karte-card__empty">検査項目がありません。</p>;

  return (
    <>
      {groups.map((group, index) => (
        <div className="karte-rp" key={group.specimenCode || `unset-${index}`}>
          <div className="karte-rp__head">
            <span className="karte-rp__number">{`GP${index + 1}`}</span>
            <span className="karte-order__group-name">{specimenGroupLabel(group)}</span>
          </div>
          <ul className="karte-rp__medicines">
            {group.entries.map((entry) => (
              <li key={entry.item.code}>
                <span className="karte-rp__medicine-name">{entry.item.name}</span>
                {entry.members.length > 0 && (
                  <span className="karte-rp__comment">{`（${memberSummary(entry.members)}）`}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {comment && <p className="karte-card__note">{comment}</p>}
    </>
  );
}

// 細菌検査は検体(GP)の見出しの下に検査項目を並べ、目的菌・疑い病名を添える
// (検体検査・放射線のカードと同じ組み方)。
function MicroOrderCardBody({
  serviceRequest,
  itemRequests,
}: {
  serviceRequest: fhir4.ServiceRequest;
  itemRequests: fhir4.ServiceRequest[];
}) {
  const { specimen, items } = microOrderContents(itemRequests);
  const comment = microOrderComment(serviceRequest);

  if (items.length === 0) return <p className="karte-card__empty">検査項目がありません。</p>;

  const details = [
    { label: "目的菌", value: organismSummary(specimen.organisms) },
    { label: "疑い病名", value: specimen.reasonName },
  ].filter((detail) => detail.value);

  return (
    <>
      <div className="karte-rp">
        <div className="karte-rp__head">
          <span className="karte-rp__number">GP1</span>
          <span className="karte-order__group-name">{specimenLabel(specimen)}</span>
        </div>
        <ul className="karte-rp__medicines">
          {items.map((item) => (
            <li key={item.code}>
              <span className="karte-rp__medicine-name">{item.name}</span>
            </li>
          ))}
        </ul>
        {details.map((detail) => (
          <div className="karte-rp__detail karte-rp__detail--indent" key={detail.label}>
            <span className="karte-rp__detail-label">{`${detail.label}:`}</span>
            <span>{detail.value}</span>
          </div>
        ))}
      </div>
      {comment && <p className="karte-card__note">{comment}</p>}
    </>
  );
}

// GP 単位で入力した内容。撮影項目の下に、見出し付きで 1 行ずつ並べる。
// 検査目的・特別指示はテンプレートからも記載でき、その回答にシェーマ画像が
// 含まれることがあるので、記入内容(QuestionnaireResponse)の参照も持たせる。
const RAD_GP_DETAILS: {
  label: string;
  of: (item: RadOrderItemLine) => string;
  templateOf?: (item: RadOrderItemLine) => string;
}[] = [
  { label: "依頼病名", of: (item) => item.reasonName },
  {
    label: "検査目的",
    of: (item) => item.purpose,
    templateOf: (item) => item.purposeTemplate?.responseId ?? "",
  },
  {
    label: "特別指示",
    of: (item) => item.remarks,
    templateOf: (item) => item.remarksTemplate?.responseId ?? "",
  },
];

// 放射線検査は GP(撮影項目 1 つ、またはセット 1 つ)ごとに出す。セットは構成項目も
// オーダーに入っているので、その中身を GP の下に並べる(マスタではなくオーダーの
// 内容なので、構成を後から直しても過去の表示は変わらない)。
function RadOrderCardBody({
  serviceRequest,
  itemRequests,
  performs,
}: {
  serviceRequest: fhir4.ServiceRequest;
  itemRequests: fhir4.ServiceRequest[];
  performs: RadPerformDisplay[];
}) {
  const entries = orderEntries(radOrderItems(serviceRequest, itemRequests));

  // 撮影項目が無いオーダーでも、実施情報が付いていれば出す。
  if (entries.length === 0) {
    return (
      <>
        <p className="karte-card__empty">撮影項目がありません。</p>
        <RadPerformSection performs={performs} />
      </>
    );
  }

  return (
    <>
      {entries.map((entry, index) => {
        // セットは自身が撮影ではないので、構成する撮影を並べる。単項目はその 1 件。
        const shots = entry.members.length > 0 ? entry.members : [entry.item];
        return (
          <div className="karte-rp" key={entry.item.code || `gp-${index}`}>
            <div className="karte-rp__head">
              <span className="karte-rp__number">{`GP${index + 1}`}</span>
              <span className="karte-order__group-name">{entryLabel(entry)}</span>
            </div>
            <ul className="karte-rp__medicines">
              {shots.map((shot) => (
                <li key={shot.code}>
                  <span className="karte-rp__medicine-name">{shot.name}</span>
                  {bodySiteLabel(shot) && (
                    <span className="karte-rp__comment">{bodySiteLabel(shot)}</span>
                  )}
                </li>
              ))}
            </ul>
            {/* 依頼病名・検査目的・特別指示は GP 単位の記入なので、撮影項目の後ろに
                同じ字下げで並べる(処方の用法と同じ置き方)。テンプレートから記載した
                シェーマ画像は、平文の「あり」の印に代えて実物を続けて出す
                (テンプレート回答カードと同じ見せ方)。 */}
            {RAD_GP_DETAILS.map(({ label, of, templateOf }) => {
              const lines = schemaAnnotatedLines(of(entry.item));
              const responseId = templateOf?.(entry.item) ?? "";
              if (lines.length === 0 && !responseId) return null;
              return (
                <div className="karte-rp__detail karte-rp__detail--indent" key={label}>
                  <span className="karte-rp__detail-label">{`${label}:`}</span>
                  <div className="karte-rp__detail-body">
                    {lines.map((line, lineIndex) => (
                      <span key={lineIndex}>{line}</span>
                    ))}
                    {responseId && <ResponseSchemaImages responseId={responseId} />}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
      <RadPerformSection performs={performs} />
    </>
  );
}

// 放射線検査一覧から入力した実施情報。依頼した内容(オーダー)とは別の事実なので、
// 撮影項目の下に、地を敷いた別ブロックとして出す。
// 取消 → 再実施で実施記録が複数残ることがあるため(docs/rad-result-design.md §7-6)、
// 1 件に丸めず実施ごとに並べる。
const RAD_PERFORM_ROWS: { label: string; of: (perform: RadPerformDisplay) => string[] }[] = [
  { label: "手技", of: (perform) => perform.procedures },
  { label: "造影剤", of: (perform) => perform.contrasts },
  { label: "器材", of: (perform) => perform.materials },
  { label: "被曝線量", of: (perform) => perform.doses },
];

function RadPerformSection({ performs }: { performs: RadPerformDisplay[] }) {
  if (performs.length === 0) return null;

  return (
    <>
      {performs.map((perform) => (
        <section className="karte-perform" key={perform.id}>
          <div className="karte-perform__head">
            <span className="karte-perform__title">実施情報</span>
            {perform.performedAt && (
              <span className="karte-perform__meta">{perform.performedAt}</span>
            )}
            {perform.performerName && (
              <span className="karte-perform__meta">{perform.performerName}</span>
            )}
            {/* 実施記録があるのに撮影まで至っていない例外(造影剤だけ入れて中止など)。 */}
            {perform.statusNote && (
              <span className="karte-perform__status">{perform.statusNote}</span>
            )}
          </div>
          {RAD_PERFORM_ROWS.map(({ label, of }) => {
            const values = of(perform);
            if (values.length === 0) return null;
            return (
              <div className="karte-perform__row" key={label}>
                <span className="karte-perform__label">{`${label}:`}</span>
                <span className="karte-perform__values">
                  {values.map((value, index) => (
                    <span key={index}>{value}</span>
                  ))}
                </span>
              </div>
            );
          })}
          {perform.comment && <p className="karte-perform__note">{perform.comment}</p>}
        </section>
      ))}
    </>
  );
}

// GP 単位で入力した内容。放射線検査と同じ形。
const PHYSIO_GP_DETAILS: {
  label: string;
  of: (item: PhysioOrderItemLine) => string;
  templateOf?: (item: PhysioOrderItemLine) => string;
}[] = [
  { label: "依頼病名", of: (item) => item.reasonName },
  {
    label: "検査目的",
    of: (item) => item.purpose,
    templateOf: (item) => item.purposeTemplate?.responseId ?? "",
  },
  {
    label: "特別指示",
    of: (item) => item.remarks,
    templateOf: (item) => item.remarksTemplate?.responseId ?? "",
  },
];

// 生理検査は GP(検査項目 1 つ、またはセット 1 つ)ごとに出す。放射線検査と同じだが、
// 部位は持たないので検査名だけを並べる。
function PhysioOrderCardBody({
  serviceRequest,
  itemRequests,
  performs,
}: {
  serviceRequest: fhir4.ServiceRequest;
  itemRequests: fhir4.ServiceRequest[];
  performs: PhysioPerformDisplay[];
}) {
  const entries = physioOrderEntries(physioOrderItems(serviceRequest, itemRequests));

  // 検査項目が無いオーダーでも、実施情報が付いていれば出す。
  if (entries.length === 0) {
    return (
      <>
        <p className="karte-card__empty">検査項目がありません。</p>
        <PhysioPerformSection performs={performs} />
      </>
    );
  }

  return (
    <>
      {entries.map((entry, index) => {
        // セットは自身が検査ではないので、構成する検査を並べる。単項目はその 1 件。
        const exams = entry.members.length > 0 ? entry.members : [entry.item];
        return (
          <div className="karte-rp" key={entry.item.code || `gp-${index}`}>
            <div className="karte-rp__head">
              <span className="karte-rp__number">{`GP${index + 1}`}</span>
              <span className="karte-order__group-name">{physioEntryLabel(entry)}</span>
            </div>
            <ul className="karte-rp__medicines">
              {exams.map((exam) => (
                <li key={exam.code}>
                  <span className="karte-rp__medicine-name">{exam.name}</span>
                </li>
              ))}
            </ul>
            {/* 依頼病名・検査目的・特別指示は GP 単位の記入なので、検査項目の後ろに
                同じ字下げで並べる(放射線検査と同じ置き方)。 */}
            {PHYSIO_GP_DETAILS.map(({ label, of, templateOf }) => {
              const lines = schemaAnnotatedLines(of(entry.item));
              const responseId = templateOf?.(entry.item) ?? "";
              if (lines.length === 0 && !responseId) return null;
              return (
                <div className="karte-rp__detail karte-rp__detail--indent" key={label}>
                  <span className="karte-rp__detail-label">{`${label}:`}</span>
                  <div className="karte-rp__detail-body">
                    {lines.map((line, lineIndex) => (
                      <span key={lineIndex}>{line}</span>
                    ))}
                    {responseId && <ResponseSchemaImages responseId={responseId} />}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
      <PhysioPerformSection performs={performs} />
    </>
  );
}

// 生理検査一覧から入力した実施情報。放射線検査と同じ見せ方だが、被曝線量の行は無い。
const PHYSIO_PERFORM_ROWS: { label: string; of: (perform: PhysioPerformDisplay) => string[] }[] = [
  { label: "手技", of: (perform) => perform.procedures },
  { label: "薬剤", of: (perform) => perform.medicines },
  { label: "器材", of: (perform) => perform.materials },
];

function PhysioPerformSection({ performs }: { performs: PhysioPerformDisplay[] }) {
  if (performs.length === 0) return null;

  return (
    <>
      {performs.map((perform) => (
        <section className="karte-perform" key={perform.id}>
          <div className="karte-perform__head">
            <span className="karte-perform__title">実施情報</span>
            {perform.performedAt && (
              <span className="karte-perform__meta">{perform.performedAt}</span>
            )}
            {perform.performerName && (
              <span className="karte-perform__meta">{perform.performerName}</span>
            )}
            {/* 実施記録があるのに検査まで至っていない例外(薬剤だけ入れて中止など)。 */}
            {perform.statusNote && (
              <span className="karte-perform__status">{perform.statusNote}</span>
            )}
          </div>
          {PHYSIO_PERFORM_ROWS.map(({ label, of }) => {
            const values = of(perform);
            if (values.length === 0) return null;
            return (
              <div className="karte-perform__row" key={label}>
                <span className="karte-perform__label">{`${label}:`}</span>
                <span className="karte-perform__values">
                  {values.map((value, index) => (
                    <span key={index}>{value}</span>
                  ))}
                </span>
              </div>
            );
          })}
          {perform.comment && <p className="karte-perform__note">{perform.comment}</p>}
        </section>
      ))}
    </>
  );
}

// 処置は GP(処置項目 1 つ、またはセット 1 つ)ごとに出す。生理検査と同じだが、
// GP 単位の記入欄(依頼病名・検査目的・特別指示)を持たないので項目名だけを並べる。
function SurgeryOrderCardBody({
  serviceRequest,
  itemRequests,
  performs,
}: {
  serviceRequest: fhir4.ServiceRequest;
  itemRequests: fhir4.ServiceRequest[];
  performs: SurgeryPerformDisplay[];
}) {
  const summary = summarizeSurgeryOrder(serviceRequest);
  const items = surgeryOrderItems(serviceRequest, itemRequests);
  const surgeon = summary.staff.find((line) => line.role === "surgeon");

  // 術式が無い申込でも、実施情報が付いていれば出す。
  if (items.length === 0) {
    return (
      <>
        <p className="karte-card__empty">術式がありません。</p>
        <SurgeryPerformSection performs={performs} />
      </>
    );
  }

  return (
    <>
      {items.map((item, index) => (
        <div className="karte-rp" key={item.code}>
          <div className="karte-rp__head">
            <span className="karte-rp__number">{index === 0 ? "主" : "副"}</span>
            <span className="karte-order__group-name">{item.name}</span>
            {surgeryBodySiteLabel(item) && (
              <span className="karte-rp__usage">{surgeryBodySiteLabel(item)}</span>
            )}
            {item.approach && (
              <span className="karte-rp__usage">{surgeryApproachDisplay(item.approach)}</span>
            )}
          </div>
        </div>
      ))}
      {/* 申込の要点。全部はカードに出さず(詳細表示にある)、読影ならぬ現場の
          一目で要る「誰が執刀し、どの麻酔か」だけを 1 行で添える。 */}
      {(surgeon || summary.anesthesiaMethods.length > 0) && (
        <p className="karte-order__comment">
          {[
            surgeon && `執刀: ${surgeon.practitionerName}`,
            summary.anesthesiaMethods.length > 0 &&
              `麻酔: ${summary.anesthesiaMethods
                .map(surgeryAnesthesiaMethodDisplay)
                .join("・")}`,
          ]
            .filter(Boolean)
            .join(" | ")}
        </p>
      )}
      <SurgeryPerformSection performs={performs} />
    </>
  );
}

// 手術一覧から入力した実施情報。他部門と同じ見せ方だが、実施時刻が幅(入室〜退室)で、
// 測定値と記録(創分類・カウント・合併症・転帰)の行が増える。
const SURGERY_PERFORM_ROWS: {
  label: string;
  of: (perform: SurgeryPerformDisplay) => string[];
}[] = [
  { label: "術式", of: (perform) => perform.procedures },
  { label: "スタッフ", of: (perform) => perform.staff },
  { label: "時刻", of: (perform) => perform.times },
  { label: "測定", of: (perform) => perform.observations },
  { label: "記録", of: (perform) => perform.records },
  { label: "薬剤", of: (perform) => perform.medicines },
  { label: "材料", of: (perform) => perform.materials },
];

function SurgeryPerformSection({ performs }: { performs: SurgeryPerformDisplay[] }) {
  if (performs.length === 0) return null;

  return (
    <>
      {performs.map((perform) => (
        <section className="karte-perform" key={perform.id}>
          <div className="karte-perform__head">
            <span className="karte-perform__title">実施情報</span>
            {perform.periodLabel && (
              <span className="karte-perform__meta">{perform.periodLabel}</span>
            )}
            {/* 実施記録があるのに実施まで至っていない例外。 */}
            {perform.statusNote && (
              <span className="karte-perform__status">{perform.statusNote}</span>
            )}
          </div>
          {SURGERY_PERFORM_ROWS.map(({ label, of }) => {
            const values = of(perform);
            if (values.length === 0) return null;
            return (
              <div className="karte-perform__row" key={label}>
                <span className="karte-perform__label">{label}:</span>
                <span className="karte-perform__values">
                  {values.map((value, index) => (
                    <span key={`${label}-${index}`}>{value}</span>
                  ))}
                </span>
              </div>
            );
          })}
          {perform.comment && <p className="karte-perform__note">{perform.comment}</p>}
        </section>
      ))}
    </>
  );
}

function TreatmentOrderCardBody({
  serviceRequest,
  itemRequests,
  performs,
}: {
  serviceRequest: fhir4.ServiceRequest;
  itemRequests: fhir4.ServiceRequest[];
  performs: TreatmentPerformDisplay[];
}) {
  const entries = treatmentOrderEntries(treatmentOrderItems(serviceRequest, itemRequests));

  // 処置項目が無いオーダーでも、実施情報が付いていれば出す。
  if (entries.length === 0) {
    return (
      <>
        <p className="karte-card__empty">処置項目がありません。</p>
        <TreatmentPerformSection performs={performs} />
      </>
    );
  }

  return (
    <>
      {entries.map((entry, index) => (
        // 処置は放射線・生理と違って見出しに分類軸が付かず項目名そのものなので、
        // 単項目のときは明細を出すと同じ名前が 2 行並ぶ。セットのときだけ構成する
        // 処置を並べる(オーダー画面のプレビューと同じ見せ方)。
        <div className="karte-rp" key={entry.item.code || `gp-${index}`}>
          <div className="karte-rp__head">
            <span className="karte-rp__number">{`GP${index + 1}`}</span>
            <span className="karte-order__group-name">{treatmentEntryLabel(entry)}</span>
          </div>
          {entry.members.length > 0 && (
            <ul className="karte-rp__medicines">
              {entry.members.map((member) => (
                <li key={member.code}>
                  <span className="karte-rp__medicine-name">{member.name}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      <TreatmentPerformSection performs={performs} />
    </>
  );
}

// 処置一覧から入力した実施情報。生理検査と同じ見せ方。
const TREATMENT_PERFORM_ROWS: {
  label: string;
  of: (perform: TreatmentPerformDisplay) => string[];
}[] = [
  { label: "手技", of: (perform) => perform.procedures },
  { label: "薬剤", of: (perform) => perform.medicines },
  { label: "器材", of: (perform) => perform.materials },
];

function TreatmentPerformSection({ performs }: { performs: TreatmentPerformDisplay[] }) {
  if (performs.length === 0) return null;

  return (
    <>
      {performs.map((perform) => (
        <section className="karte-perform" key={perform.id}>
          <div className="karte-perform__head">
            <span className="karte-perform__title">実施情報</span>
            {perform.performedAt && (
              <span className="karte-perform__meta">{perform.performedAt}</span>
            )}
            {perform.performerName && (
              <span className="karte-perform__meta">{perform.performerName}</span>
            )}
            {/* 実施記録があるのに実施まで至っていない例外(薬剤だけ入れて中止など)。 */}
            {perform.statusNote && (
              <span className="karte-perform__status">{perform.statusNote}</span>
            )}
          </div>
          {TREATMENT_PERFORM_ROWS.map(({ label, of }) => {
            const values = of(perform);
            if (values.length === 0) return null;
            return (
              <div className="karte-perform__row" key={label}>
                <span className="karte-perform__label">{`${label}:`}</span>
                <span className="karte-perform__values">
                  {values.map((value, index) => (
                    <span key={index}>{value}</span>
                  ))}
                </span>
              </div>
            );
          })}
          {perform.comment && <p className="karte-perform__note">{perform.comment}</p>}
        </section>
      ))}
    </>
  );
}

// GP 単位で入力した内容。生理検査と同じ形。
const ENDOSCOPY_GP_DETAILS: {
  label: string;
  of: (item: EndoscopyOrderItemLine) => string;
  templateOf?: (item: EndoscopyOrderItemLine) => string;
}[] = [
  { label: "依頼病名", of: (item) => item.reasonName },
  {
    label: "検査目的",
    of: (item) => item.purpose,
    templateOf: (item) => item.purposeTemplate?.responseId ?? "",
  },
  {
    label: "特別指示",
    of: (item) => item.remarks,
    templateOf: (item) => item.remarksTemplate?.responseId ?? "",
  },
];

// 内視鏡は GP(検査項目 1 つ、またはセット 1 つ)ごとに出す(生理検査と同じ)。
function EndoscopyOrderCardBody({
  serviceRequest,
  itemRequests,
  performs,
}: {
  serviceRequest: fhir4.ServiceRequest;
  itemRequests: fhir4.ServiceRequest[];
  performs: EndoscopyPerformDisplay[];
}) {
  const entries = endoscopyOrderEntries(endoscopyOrderItems(serviceRequest, itemRequests));

  // 検査項目が無いオーダーでも、実施情報が付いていれば出す。
  if (entries.length === 0) {
    return (
      <>
        <p className="karte-card__empty">検査項目がありません。</p>
        <EndoscopyPerformSection performs={performs} />
      </>
    );
  }

  return (
    <>
      {entries.map((entry, index) => {
        // セットは自身が検査ではないので、構成する検査を並べる。単項目はその 1 件。
        const exams = entry.members.length > 0 ? entry.members : [entry.item];
        return (
          <div className="karte-rp" key={entry.item.code || `gp-${index}`}>
            <div className="karte-rp__head">
              <span className="karte-rp__number">{`GP${index + 1}`}</span>
              <span className="karte-order__group-name">{endoscopyEntryLabel(entry)}</span>
            </div>
            <ul className="karte-rp__medicines">
              {exams.map((exam) => (
                <li key={exam.code}>
                  <span className="karte-rp__medicine-name">{exam.name}</span>
                </li>
              ))}
            </ul>
            {/* 依頼病名・検査目的・特別指示は GP 単位の記入なので、検査項目の後ろに
                同じ字下げで並べる(放射線検査と同じ置き方)。 */}
            {ENDOSCOPY_GP_DETAILS.map(({ label, of, templateOf }) => {
              const lines = schemaAnnotatedLines(of(entry.item));
              const responseId = templateOf?.(entry.item) ?? "";
              if (lines.length === 0 && !responseId) return null;
              return (
                <div className="karte-rp__detail karte-rp__detail--indent" key={label}>
                  <span className="karte-rp__detail-label">{`${label}:`}</span>
                  <div className="karte-rp__detail-body">
                    {lines.map((line, lineIndex) => (
                      <span key={lineIndex}>{line}</span>
                    ))}
                    {responseId && <ResponseSchemaImages responseId={responseId} />}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
      <EndoscopyPerformSection performs={performs} />
    </>
  );
}

// 内視鏡一覧から入力した実施情報。生理検査と同じ見せ方。
const ENDOSCOPY_PERFORM_ROWS: { label: string; of: (perform: EndoscopyPerformDisplay) => string[] }[] = [
  { label: "手技", of: (perform) => perform.procedures },
  { label: "薬剤", of: (perform) => perform.medicines },
  { label: "器材", of: (perform) => perform.materials },
];

function EndoscopyPerformSection({ performs }: { performs: EndoscopyPerformDisplay[] }) {
  if (performs.length === 0) return null;

  return (
    <>
      {performs.map((perform) => (
        <section className="karte-perform" key={perform.id}>
          <div className="karte-perform__head">
            <span className="karte-perform__title">実施情報</span>
            {perform.performedAt && (
              <span className="karte-perform__meta">{perform.performedAt}</span>
            )}
            {perform.performerName && (
              <span className="karte-perform__meta">{perform.performerName}</span>
            )}
            {/* 実施記録があるのに検査まで至っていない例外(薬剤だけ入れて中止など)。 */}
            {perform.statusNote && (
              <span className="karte-perform__status">{perform.statusNote}</span>
            )}
          </div>
          {ENDOSCOPY_PERFORM_ROWS.map(({ label, of }) => {
            const values = of(perform);
            if (values.length === 0) return null;
            return (
              <div className="karte-perform__row" key={label}>
                <span className="karte-perform__label">{`${label}:`}</span>
                <span className="karte-perform__values">
                  {values.map((value, index) => (
                    <span key={index}>{value}</span>
                  ))}
                </span>
              </div>
            );
          })}
          {perform.comment && <p className="karte-perform__note">{perform.comment}</p>}
        </section>
      ))}
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
          {expanded ? "折りたたむ" : "続きを表示"}
        </button>
      )}
    </>
  );
}
