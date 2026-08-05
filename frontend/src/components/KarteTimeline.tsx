import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  useBinaryImage,
  useDeleteClinicalNote,
  useDeletePrescription,
  useDeleteQuestionnaireResponse,
} from "../api/queries";
import { questionnaireResponsePdfUrl, useReportLayoutStatus } from "../api/reportsClient";
import { clinicalNoteProblem, sectionTitle, statusLabel } from "../fhir/clinicalNoteHelpers";
import { problemLabel, type ProblemRef } from "../fhir/conditionHelpers";
import {
  KARTE_KIND_LABELS,
  karteItemKey,
  type KarteDayGroup,
  type KarteTimelineItem,
} from "../fhir/karteTimeline";
import {
  groupInjectionByRp,
  injectionComment,
  summarizeInjectionServiceRequest,
  type InjectionRpDisplay,
} from "../fhir/injectionHelpers";
import {
  groupByRp,
  orderContextSummary,
  prescriptionComment,
  prescriptionProblem,
  prescriptionRequester,
  summarizeServiceRequest,
} from "../fhir/prescriptionHelpers";
import {
  SCHEMA_IMAGE_NOTE,
  questionnaireResponsePlainText,
  schemaImageRefs,
  summarizeQuestionnaireResponse,
} from "../fhir/questionnaireResponseHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { KarteCardJsonModal } from "./KarteCardModals";
import { PlainTextModal } from "./PlainTextModal";
import { RichTextView } from "./RichTextView";
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
  onOpenDetail: (item: KarteTimelineItem) => void;
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
  onOpenDetail,
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
                onOpenDetail={onOpenDetail}
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
  onOpenDetail,
  onDeleted,
  problemsById,
  selectedProblemId,
}: {
  item: KarteTimelineItem;
  onEdit: (item: KarteTimelineItem) => void;
  onDo: (item: KarteTimelineItem) => void;
  onOpenDetail: (item: KarteTimelineItem) => void;
  onDeleted: (item: KarteTimelineItem) => void;
  problemsById: Map<string, fhir4.Condition>;
  selectedProblemId: string | null;
}) {
  const deleteNote = useDeleteClinicalNote();
  const deletePrescription = useDeletePrescription();
  const deleteResponse = useDeleteQuestionnaireResponse();
  // 平文表示・FHIR JSON 表示はモーダルで開く(カルテの読み位置を動かさない)。
  // 詳細表示は URL に載せるので親に任せる。
  const [plainTextOpen, setPlainTextOpen] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);

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
    // 注射も処方と同じ ServiceRequest + MedicationRequest 構成なので削除処理を共用する。
    else if (item.kind === "prescription" || item.kind === "injection") {
      deletePrescription.mutate(item.id, options);
    } else deleteResponse.mutate(item.id, options);
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
        <ProblemBadge problem={itemProblem(item)} problemsById={problemsById} />
        <span className="karte-card__meta">{cardMeta(item)}</span>
        <span className="karte-card__actions">
          {(item.kind === "prescription" || item.kind === "injection") && (
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
            <button type="button" className="row-menu__item" onClick={() => onOpenDetail(item)}>
              詳細表示
            </button>
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
          text={questionnaireResponsePlainText(item.questionnaire, item.response)}
          onClose={() => setPlainTextOpen(false)}
        />
      )}
      {jsonOpen && <KarteCardJsonModal item={item} onClose={() => setJsonOpen(false)} />}
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

// この情報が対象としているプロブレム。現状プロブレムを持つのは診療記録と処方・注射
// (テンプレートの紐付けは未実装)。注射も reasonReference なので処方と同じ関数で引ける。
function itemProblem(item: KarteTimelineItem): ProblemRef | null {
  if (item.kind === "note") return clinicalNoteProblem(item.note);
  if (item.kind === "prescription" || item.kind === "injection") {
    return prescriptionProblem(item.serviceRequest);
  }
  return null;
}

function referencesProblem(item: KarteTimelineItem, conditionId: string | null): boolean {
  if (!conditionId) return false;
  return itemProblem(item)?.conditionId === conditionId;
}

function cardTitle(item: KarteTimelineItem): string {
  if (item.kind === "note") return item.note.title ?? "";
  if (item.kind === "prescription") {
    const summary = summarizeServiceRequest(item.serviceRequest);
    return [summary.settingDisplay, summary.categoryDisplay].filter(Boolean).join(" | ");
  }
  // 注射も処方と同じく区分をタイトルにする(用法種別は本文の用法行に出る)。
  if (item.kind === "injection") {
    const summary = summarizeInjectionServiceRequest(item.serviceRequest);
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
    // 診療記録と同じく、時刻・ステータス・記入者を並べる。
    const summary = summarizeQuestionnaireResponse(item.response);
    return [time, summary.statusLabel, summary.authorName].filter(Boolean).join(" | ");
  }
  // 処方・注射は診療記録の作成者と同じ位置に、依頼科・依頼医師を出す。オーダー日は
  // 日付のみを入力する項目なので時刻は出さない(古い処方には時刻付きの authoredOn が
  // あり、意味のない「00:00」が出てしまうため)。
  return orderContextSummary(prescriptionRequester(item.serviceRequest));
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

// 開始時刻はカードでは「MM/DD HH:mm」に詰める(年はグループ日付から分かる)。
function shortStartTime(local: string): string {
  return local.slice(5, 16).replace("-", "/").replace("T", " ");
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
            <div className="karte-rp__usage">
              <span className="karte-rp__usage-label">用法:</span>
              <span>{injectionUsageSummary(rp) || "-"}</span>
              {rp.usageComment && (
                <span className="karte-rp__comment">{`（${rp.usageComment}）`}</span>
              )}
            </div>
            {rp.startTimes.length > 0 && (
              <div className="karte-rp__usage">
                <span className="karte-rp__usage-label">開始:</span>
                <span>{rp.startTimes.map(shortStartTime).join("、")}</span>
              </div>
            )}
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
  // シェーマ画像は下に実物を出すので、平文の「あり」の印は落とす。印だけの行
  // (答えがシェーマ画像しかない項目)は項目名が画像側のキャプションに出るので捨てる。
  const schemas = schemaImageRefs(item.response);
  const lines = questionnaireResponsePlainText(item.questionnaire, item.response)
    .split("\n")
    // 先頭のテンプレート名と空行は見出しと重複するので落とす。
    .slice(2)
    .map((line) => line.replace(SCHEMA_IMAGE_NOTE, "").trimEnd())
    .filter((line) => line.trim() && !/[:：]$/.test(line.trim()));
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
      {schemas.length > 0 && (
        <div className="karte-qr__schemas">
          {schemas.map((schema) => (
            <KarteSchemaImage key={schema.key} binaryId={schema.binaryId} label={schema.label} />
          ))}
        </div>
      )}
    </>
  );
}

// 描き込み済みシェーマ画像のサムネイル。Binary は staleTime: Infinity で
// キャッシュされるので、同じ画像を何枚出しても取得は 1 回で済む。
function KarteSchemaImage({ binaryId, label }: { binaryId: string; label: string }) {
  const { data, isLoading } = useBinaryImage(binaryId);

  return (
    <figure className="karte-qr__schema">
      {data ? (
        <img className="karte-qr__schema-image" src={data} alt={label || "シェーマ画像"} />
      ) : (
        <p className="karte-card__empty">
          {isLoading ? "画像を読み込み中..." : "画像を表示できません。"}
        </p>
      )}
      {label && <figcaption className="karte-qr__schema-caption">{label}</figcaption>}
    </figure>
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
