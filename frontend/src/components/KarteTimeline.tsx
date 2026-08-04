import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  useDeleteClinicalNote,
  useDeletePrescription,
  useDeleteQuestionnaireResponse,
} from "../api/queries";
import { questionnaireResponsePdfUrl, useReportLayoutStatus } from "../api/reportsClient";
import { clinicalNoteProblem, sectionTitle, statusLabel } from "../fhir/clinicalNoteHelpers";
import { problemLabel } from "../fhir/conditionHelpers";
import {
  KARTE_KIND_LABELS,
  karteItemKey,
  type KarteDayGroup,
  type KarteTimelineItem,
} from "../fhir/karteTimeline";
import {
  groupByRp,
  orderContextSummary,
  prescriptionComment,
  prescriptionRequester,
  summarizeServiceRequest,
} from "../fhir/prescriptionHelpers";
import {
  qrStatusLabel,
  questionnaireResponsePlainText,
} from "../fhir/questionnaireResponseHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { RichTextView } from "./RichTextView";

interface KarteTimelineProps {
  groups: KarteDayGroup[];
  isLoading: boolean;
  hasMore: boolean;
  isFetchingMore: boolean;
  /** 追加読み込みの再判定トリガー。ページ数や取得状態が変わるたびに変化させる。 */
  loadToken: string;
  onLoadMore: () => void;
  onEdit: (item: KarteTimelineItem) => void;
  onDo: (serviceRequestId: string) => void;
  /** 削除された項目。右ペインで開いていたら閉じるために親へ通知する。 */
  onDeleted: (item: KarteTimelineItem) => void;
  /** スクロールコンテナ。診療日パネルからのスクロール指示に使う。 */
  containerRef: RefObject<HTMLDivElement | null>;
  /** プロブレム(Condition)を id で引く辞書。バッジを最新の名称で描くために使う。 */
  problemsById: Map<string, fhir4.Condition>;
  /** 選択中のプロブレム。これを参照しない診療記録は控えめに表示する。 */
  selectedProblemId: string | null;
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
  onDeleted,
  containerRef,
  problemsById,
  selectedProblemId,
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
        <p className="patient-table__empty">登録されている診療情報がありません。</p>
      ) : (
        groups.map((group) => (
          <section
            className="karte-group"
            key={group.day || "no-date"}
            {...{ [KARTE_TARGET_ATTR]: group.day || "no-date" }}
          >
            <h3 className="karte-group__date">{group.day || "日付なし"}</h3>
            {group.items.map((item) => (
              <KarteCard
                key={karteItemKey(item)}
                item={item}
                onEdit={onEdit}
                onDo={onDo}
                onDeleted={onDeleted}
                problemsById={problemsById}
                selectedProblemId={selectedProblemId}
              />
            ))}
          </section>
        ))
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
  onDeleted,
  problemsById,
  selectedProblemId,
}: {
  item: KarteTimelineItem;
  onEdit: (item: KarteTimelineItem) => void;
  onDo: (serviceRequestId: string) => void;
  onDeleted: (item: KarteTimelineItem) => void;
  problemsById: Map<string, fhir4.Condition>;
  selectedProblemId: string | null;
}) {
  const deleteNote = useDeleteClinicalNote();
  const deletePrescription = useDeletePrescription();
  const deleteResponse = useDeleteQuestionnaireResponse();

  const deleting =
    deleteNote.isPending || deletePrescription.isPending || deleteResponse.isPending;
  const deleteError = deleteNote.error ?? deletePrescription.error ?? deleteResponse.error;

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
    else if (item.kind === "prescription") deletePrescription.mutate(item.id, options);
    else deleteResponse.mutate(item.id, options);
  }

  // プロブレム選択中は、そのプロブレムを参照しない情報を控えめに表示する
  // (件数が減ると読み込み位置が動くので、隠さず減光にとどめる)。
  const dimmed = Boolean(selectedProblemId) && !referencesProblem(item, selectedProblemId);

  return (
    <article
      className={`karte-card karte-card--${item.kind}${dimmed ? " karte-card--dimmed" : ""}`}
      {...{ [KARTE_TARGET_ATTR]: karteItemKey(item) }}
    >
      <header className="karte-card__header">
        <span className={`karte-card__badge karte-card__badge--${item.kind}`}>
          {KARTE_KIND_LABELS[item.kind]}
        </span>
        <span className="karte-card__title">{cardTitle(item)}</span>
        {item.kind === "note" && (
          <NoteProblemBadge note={item.note} problemsById={problemsById} />
        )}
        <span className="karte-card__meta">{cardMeta(item)}</span>
        <span className="karte-card__actions">
          {item.kind === "prescription" && (
            <button type="button" onClick={() => onDo(item.id)}>
              DO
            </button>
          )}
          {item.kind === "qr" &&
            (pdfReady ? (
              <a
                className="button"
                href={questionnaireResponsePdfUrl(item.id)}
                target="_blank"
                rel="noopener"
              >
                PDF
              </a>
            ) : (
              <button
                type="button"
                disabled
                title="このテンプレートの帳票レイアウトが未登録です"
              >
                PDF
              </button>
            ))}
          <button type="button" onClick={() => onEdit(item)}>
            編集
          </button>
          <button type="button" onClick={handleDelete} disabled={deleting}>
            削除
          </button>
        </span>
      </header>

      <ErrorBanner error={deleteError} />

      <CollapsibleBody>
        <KarteCardBody item={item} />
      </CollapsibleBody>
    </article>
  );
}

// この情報が指定プロブレムに紐付いているか。現状プロブレムを持つのは診療記録だけ
// (処方・テンプレートの紐付けは未実装)。
function referencesProblem(item: KarteTimelineItem, conditionId: string | null): boolean {
  if (!conditionId || item.kind !== "note") return false;
  return clinicalNoteProblem(item.note)?.conditionId === conditionId;
}

function cardTitle(item: KarteTimelineItem): string {
  if (item.kind === "note") return item.note.title ?? "";
  if (item.kind === "prescription") {
    const summary = summarizeServiceRequest(item.serviceRequest);
    return [summary.settingDisplay, summary.categoryDisplay].filter(Boolean).join(" | ");
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
    return [time, qrStatusLabel(item.response.status)].filter(Boolean).join(" | ");
  }
  // 処方は診療記録の作成者と同じ位置に、依頼科・依頼医師を出す。処方日は日付のみを
  // 入力する項目なので時刻は出さない(古い処方には時刻付きの authoredOn があり、
  // 意味のない「00:00」が出てしまうため)。
  return orderContextSummary(prescriptionRequester(item.serviceRequest));
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
  if (item.kind === "note") {
    const sections = item.note.section ?? [];
    if (sections.length === 0) return <p className="karte-card__empty">本文がありません。</p>;
    return (
      <>
        {sections.map((section, index) => (
          <div className="karte-card__section" key={index}>
            <span className="karte-card__section-title">
              {section.title || sectionTitle(section.code?.coding?.[0]?.code)}
            </span>
            <RichTextView html={section.text?.div ?? ""} />
          </div>
        ))}
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
            <div className="karte-rp__usage">
              <span className="karte-rp__usage-label">用法:</span>
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

  if (!item.questionnaire) {
    return (
      <p className="karte-card__empty">
        元テンプレート({item.response.questionnaire})が見つからないため内容を表示できません。
      </p>
    );
  }
  // 平文化は改行区切りなので、そのまま行ごとに描画する。
  const lines = questionnaireResponsePlainText(item.questionnaire, item.response)
    .split("\n")
    // 先頭のテンプレート名と空行は見出しと重複するので落とす。
    .slice(2)
    .filter((line) => line.trim());
  if (lines.length === 0) return <p className="karte-card__empty">回答がありません。</p>;
  return (
    <ul className="karte-qr__lines">
      {lines.map((line, index) => (
        <li key={index}>{line}</li>
      ))}
    </ul>
  );
}

// 診療記録が対象とするプロブレムのバッジ。名称は現在のプロブレムから引き直すので、
// 病名を編集しても過去の記録に古い名前が残らない。削除済みのプロブレムは
// 拡張に保存してある表示名でフォールバックする。
function NoteProblemBadge({
  note,
  problemsById,
}: {
  note: fhir4.Composition;
  problemsById: Map<string, fhir4.Condition>;
}) {
  const problem = clinicalNoteProblem(note);
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
