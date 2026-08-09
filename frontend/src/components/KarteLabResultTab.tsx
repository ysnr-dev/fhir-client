import { useEffect, useMemo, useState } from "react";
import {
  useCreateLabResult,
  useLabOrderCandidates,
  useLabResultNavigation,
  useLabResultSearch,
  useUpdateLabResult,
} from "../api/queries";
import {
  buildDoLabResultForm,
  buildLabResultBundle,
  buildLabResultUpdateBundle,
  specimenRefsFrom,
  type LabResultFormValues,
} from "../fhir/labResultHelpers";
import { useLabResultInitialValues } from "../hooks/useLabResultInitialValues";
import { LAB_TIMELINE_VIEW } from "../karteUrl";
import { ErrorBanner } from "./ErrorBanner";
import { LabResultDetailPanel } from "./LabResultDetailPanel";
import { LabResultForm } from "./LabResultForm";
import { LabResultTable } from "./LabResultTable";
import { LabResultTimelinePanel } from "./LabResultTimelinePanel";
import { Pagination } from "./Pagination";

// カルテ画面の「検査結果」タブ。一覧・表示・時系列表示・登録・編集・削除を
// 左ペイン内で完結させる。
//
// 一覧・内容表示・時系列表示は URL(view パラメータ)で表す。登録・編集は入力途中の
// 内容を URL では復元できないので、このコンポーネント内の状態に留める。

type Mode =
  | { kind: "list" }
  | { kind: "detail"; reportId: string }
  | { kind: "timeline" }
  | { kind: "create"; sourceReportId?: string }
  | { kind: "edit"; reportId: string };

const MODE_TITLES: Record<Mode["kind"], string> = {
  list: "検査結果",
  detail: "検査結果内容",
  timeline: "検査結果 時系列表示",
  create: "検査結果登録",
  edit: "検査結果編集",
};

type FormMode = Extract<Mode, { kind: "create" } | { kind: "edit" }> | null;

function modeTitle(mode: Mode) {
  if (mode.kind === "create" && mode.sourceReportId) return "検査結果登録(DO)";
  return MODE_TITLES[mode.kind];
}

interface KarteLabResultTabProps {
  patientId: string;
  /** URL から渡される表示対象。検査結果 ID か "timeline"、空なら一覧。 */
  view: string;
  onViewChange: (view: string | null) => void;
}

export function KarteLabResultTab({ patientId, view, onViewChange }: KarteLabResultTabProps) {
  const [form, setForm] = useState<FormMode>(null);
  const [offset, setOffset] = useState(0);

  // 戻る・進むで表示対象が変わったら、開いていたフォームは畳む。
  useEffect(() => setForm(null), [view]);

  const mode: Mode =
    form ??
    (view === LAB_TIMELINE_VIEW
      ? { kind: "timeline" }
      : view
        ? { kind: "detail", reportId: view }
        : { kind: "list" });

  const { bundle, total, count, hasPrevious, hasNext, isLoading, error } = useLabResultSearch(
    patientId,
    offset,
  );
  const reports =
    bundle?.entry?.map((e) => e.resource).filter((r): r is fhir4.DiagnosticReport => Boolean(r)) ??
    [];

  function backToList() {
    setForm(null);
    onViewChange(null);
  }

  // 内容表示は前後移動(ページ送り)のために検査結果の並び順を引くので、
  // 一覧など他モードで無駄に取得しないよう別コンポーネントに切り出している。
  if (mode.kind === "detail") {
    return (
      <DetailPane
        patientId={patientId}
        reportId={mode.reportId}
        onSelect={(reportId) => onViewChange(reportId)}
        onDo={() => setForm({ kind: "create", sourceReportId: mode.reportId })}
        onEdit={() => setForm({ kind: "edit", reportId: mode.reportId })}
        onBack={backToList}
      />
    );
  }

  if (mode.kind !== "list") {
    return (
      <div className="karte-tabpanel">
        <div className="karte-tabpanel__header">
          <h3>{modeTitle(mode)}</h3>
          <div className="karte-tabpanel__actions">
            <button type="button" onClick={backToList}>
              ← 一覧に戻る
            </button>
          </div>
        </div>
        {mode.kind === "timeline" ? (
          <LabResultTimelinePanel patientId={patientId} />
        ) : mode.kind === "create" ? (
          <CreateForm
            patientId={patientId}
            sourceReportId={mode.sourceReportId}
            onSaved={backToList}
          />
        ) : (
          <EditForm patientId={patientId} reportId={mode.reportId} onSaved={backToList} />
        )}
      </div>
    );
  }

  return (
    <div className="karte-tabpanel">
      <div className="karte-tabpanel__header">
        <h3>{MODE_TITLES.list}</h3>
        <div className="karte-tabpanel__actions">
          <button type="button" onClick={() => onViewChange(LAB_TIMELINE_VIEW)}>
            時系列表示
          </button>
          <button type="button" onClick={() => setForm({ kind: "create" })}>
            新規登録
          </button>
        </div>
      </div>

      <ErrorBanner error={error} />

      {isLoading ? (
        <p>読み込み中...</p>
      ) : (
        <>
          <LabResultTable
            reports={reports}
            onView={(reportId) => onViewChange(reportId)}
            onEdit={(reportId) => setForm({ kind: "edit", reportId })}
          />
          <Pagination
            offset={offset}
            count={count}
            total={total}
            hasPrevious={hasPrevious}
            hasNext={hasNext}
            onPrevious={() => setOffset((o) => Math.max(0, o - count))}
            onNext={() => setOffset((o) => o + count)}
          />
        </>
      )}
    </div>
  );
}

// 内容表示。詳細ページと同じく前後移動(新しい順)と DO を持つ。
function DetailPane({
  patientId,
  reportId,
  onSelect,
  onDo,
  onEdit,
  onBack,
}: {
  patientId: string;
  reportId: string;
  onSelect: (reportId: string) => void;
  onDo: () => void;
  onEdit: () => void;
  onBack: () => void;
}) {
  const nav = useLabResultNavigation(patientId, reportId);

  return (
    <div className="karte-tabpanel">
      <div className="karte-tabpanel__header">
        <div className="karte-tabpanel__title">
          <h3>{MODE_TITLES.detail}</h3>
          <div className="record-nav">
            <button
              type="button"
              className="record-nav__button"
              onClick={() => nav.previousId && onSelect(nav.previousId)}
              disabled={!nav.previousId}
              title="前の検査結果（新しい順で1つ前）"
              aria-label="前の検査結果"
            >
              ＜
            </button>
            <span className="record-nav__status">
              {nav.position ? `${nav.position} / ${nav.total} 件` : "-"}
            </span>
            <button
              type="button"
              className="record-nav__button"
              onClick={() => nav.nextId && onSelect(nav.nextId)}
              disabled={!nav.nextId}
              title="次の検査結果（新しい順で1つ後）"
              aria-label="次の検査結果"
            >
              ＞
            </button>
          </div>
        </div>
        <div className="karte-tabpanel__actions">
          <button type="button" onClick={onDo}>
            DO
          </button>
          <button type="button" onClick={onEdit}>
            編集
          </button>
          <button type="button" onClick={onBack}>
            ← 一覧に戻る
          </button>
        </div>
      </div>

      <LabResultDetailPanel reportId={reportId} />
    </div>
  );
}

function CreateForm({
  patientId,
  sourceReportId,
  onSaved,
}: {
  patientId: string;
  /** DO(検査項目のみ流用して新規登録)する元の DiagnosticReport id。 */
  sourceReportId?: string;
  onSaved: () => void;
}) {
  const createLabResult = useCreateLabResult();
  const source = useLabResultInitialValues(sourceReportId, patientId);
  const orders = useLabOrderCandidates(patientId);

  const initialValues = useMemo(
    () => (source.initialValues ? buildDoLabResultForm(source.initialValues) : undefined),
    [source.initialValues],
  );

  function handleSubmit(values: LabResultFormValues) {
    createLabResult.mutate(buildLabResultBundle(values, patientId), { onSuccess: onSaved });
  }

  return (
    <>
      <ErrorBanner error={source.error} />
      <ErrorBanner error={orders.error} />

      {/* DO 元の読み込み完了を待ってからフォームを描画する(初期値は初回描画時のみ反映される)。 */}
      {sourceReportId && !source.ready ? (
        <p>読み込み中...</p>
      ) : (
        <LabResultForm
          initialValues={initialValues}
          onSubmit={handleSubmit}
          submitting={createLabResult.isPending}
          submitError={createLabResult.error}
          orderCandidates={orders.candidates}
          orderCandidatesLoading={orders.isLoading}
        />
      )}
    </>
  );
}

function EditForm({
  patientId,
  reportId,
  onSaved,
}: {
  patientId: string;
  reportId: string;
  onSaved: () => void;
}) {
  const updateLabResult = useUpdateLabResult();
  const { report, observations, specimens, initialValues, ready, patientMismatch, error } =
    useLabResultInitialValues(reportId, patientId);
  // 編集中の検査結果が紐付けているオーダーは、候補から落とさない。
  const orders = useLabOrderCandidates(patientId, reportId);

  function handleSubmit(values: LabResultFormValues) {
    // 別患者の検査結果を更新すると subject が書き換わり、検査結果が付け替わってしまう。
    if (!report || patientMismatch) return;
    const originalIds = observations.map((o) => o.id).filter((id): id is string => Boolean(id));
    updateLabResult.mutate(
      buildLabResultUpdateBundle(
        values,
        patientId,
        reportId,
        originalIds,
        specimenRefsFrom(specimens),
      ),
      { onSuccess: onSaved },
    );
  }

  return (
    <>
      <ErrorBanner error={error} />
      <ErrorBanner error={orders.error} />

      {!ready ? (
        <p>読み込み中...</p>
      ) : (
        report &&
        initialValues && (
          <LabResultForm
            initialValues={initialValues}
            onSubmit={handleSubmit}
            submitting={updateLabResult.isPending}
            submitError={updateLabResult.error}
            submitLabel="更新"
            orderCandidates={orders.candidates}
            orderCandidatesLoading={orders.isLoading}
          />
        )
      )}
    </>
  );
}
