import { useEffect, useState } from "react";
import {
  useCreateMicroResult,
  useMicroOrderCandidates,
  useMicroResultNavigation,
  useMicroResultSearch,
  useUpdateMicroResult,
} from "../api/queries";
import {
  buildMicroResultBundle,
  buildMicroResultUpdateBundle,
  type MicroResultFormValues,
} from "../fhir/microResultHelpers";
import { useMicroResultInitialValues } from "../hooks/useMicroResultInitialValues";
import { ErrorBanner } from "./ErrorBanner";
import { MicroResultDetailPanel } from "./MicroResultDetailPanel";
import { MicroResultForm } from "./MicroResultForm";
import { MicroResultTable } from "./MicroResultTable";
import { Pagination } from "./Pagination";

// カルテ画面の「細菌検査」タブ。一覧・表示・登録・編集・削除を左ペイン内で
// 完結させる(検体検査の「検査結果」タブと同じ構成)。細菌検査はレポート単位の
// 内容表示が本体で「項目×日付」の表にならないため、時系列表示は持たない。
//
// 一覧・内容表示は URL(view パラメータ)で表す。登録・編集は入力途中の内容を
// URL では復元できないので、このコンポーネント内の状態に留める。

type Mode =
  | { kind: "list" }
  | { kind: "detail"; reportId: string }
  | { kind: "create" }
  | { kind: "edit"; reportId: string };

const MODE_TITLES: Record<Mode["kind"], string> = {
  list: "細菌検査結果",
  detail: "細菌検査結果内容",
  create: "細菌検査結果登録",
  edit: "細菌検査結果編集",
};

type FormMode = Extract<Mode, { kind: "create" } | { kind: "edit" }> | null;

interface KarteMicroResultTabProps {
  patientId: string;
  /** URL から渡される表示対象。細菌検査結果の ID、空なら一覧。 */
  view: string;
  onViewChange: (view: string | null) => void;
}

export function KarteMicroResultTab({ patientId, view, onViewChange }: KarteMicroResultTabProps) {
  const [form, setForm] = useState<FormMode>(null);
  const [offset, setOffset] = useState(0);

  // 戻る・進むで表示対象が変わったら、開いていたフォームは畳む。
  useEffect(() => setForm(null), [view]);

  const mode: Mode = form ?? (view ? { kind: "detail", reportId: view } : { kind: "list" });

  const { resources, total, count, hasPrevious, hasNext, isLoading, error } = useMicroResultSearch(
    patientId,
    offset,
  );

  function backToList() {
    setForm(null);
    onViewChange(null);
  }

  // 内容表示は前後移動(ページ送り)のために結果の並び順を引くので、
  // 一覧など他モードで無駄に取得しないよう別コンポーネントに切り出している。
  if (mode.kind === "detail") {
    return (
      <DetailPane
        patientId={patientId}
        reportId={mode.reportId}
        onSelect={(reportId) => onViewChange(reportId)}
        onEdit={() => setForm({ kind: "edit", reportId: mode.reportId })}
        onBack={backToList}
      />
    );
  }

  if (mode.kind !== "list") {
    return (
      <div className="karte-tabpanel">
        <div className="karte-tabpanel__header">
          <h3>{MODE_TITLES[mode.kind]}</h3>
          <div className="karte-tabpanel__actions">
            <button type="button" onClick={backToList}>
              ← 一覧に戻る
            </button>
          </div>
        </div>
        {mode.kind === "create" ? (
          <CreateForm patientId={patientId} onSaved={backToList} />
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
          <button type="button" onClick={() => setForm({ kind: "create" })}>
            新規登録
          </button>
        </div>
      </div>

      <ErrorBanner error={error} />

      {isLoading || !resources ? (
        <p>読み込み中...</p>
      ) : (
        <>
          <MicroResultTable
            resources={resources}
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

// 内容表示。検体検査結果と同じく前後移動(新しい順)を持つ。
function DetailPane({
  patientId,
  reportId,
  onSelect,
  onEdit,
  onBack,
}: {
  patientId: string;
  reportId: string;
  onSelect: (reportId: string) => void;
  onEdit: () => void;
  onBack: () => void;
}) {
  const nav = useMicroResultNavigation(patientId, reportId);

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
              title="前の細菌検査結果（新しい順で1つ前）"
              aria-label="前の細菌検査結果"
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
              title="次の細菌検査結果（新しい順で1つ後）"
              aria-label="次の細菌検査結果"
            >
              ＞
            </button>
          </div>
        </div>
        <div className="karte-tabpanel__actions">
          <button type="button" onClick={onEdit}>
            編集
          </button>
          <button type="button" onClick={onBack}>
            ← 一覧に戻る
          </button>
        </div>
      </div>

      <MicroResultDetailPanel reportId={reportId} />
    </div>
  );
}

function CreateForm({ patientId, onSaved }: { patientId: string; onSaved: () => void }) {
  const createMicroResult = useCreateMicroResult();
  const orders = useMicroOrderCandidates(patientId);

  function handleSubmit(values: MicroResultFormValues) {
    createMicroResult.mutate(buildMicroResultBundle(values, patientId), { onSuccess: onSaved });
  }

  return (
    <>
      <ErrorBanner error={orders.error} />

      <MicroResultForm
        onSubmit={handleSubmit}
        submitting={createMicroResult.isPending}
        submitError={createMicroResult.error}
        orderCandidates={orders.candidates}
        orderCandidatesLoading={orders.isLoading}
      />
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
  const updateMicroResult = useUpdateMicroResult();
  const { report, observations, specimens, initialValues, ready, patientMismatch, error } =
    useMicroResultInitialValues(reportId, patientId);
  // 編集中の結果が紐付けているオーダーは、候補から落とさない。
  const orders = useMicroOrderCandidates(patientId, reportId);

  function handleSubmit(values: MicroResultFormValues) {
    // 別患者の結果を更新すると subject が書き換わり、結果が付け替わってしまう。
    if (!report || patientMismatch) return;
    const originalIds = observations.map((o) => o.id).filter((id): id is string => Boolean(id));
    updateMicroResult.mutate(
      buildMicroResultUpdateBundle(values, patientId, reportId, originalIds, specimens[0]?.id),
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
          <MicroResultForm
            initialValues={initialValues}
            onSubmit={handleSubmit}
            submitting={updateMicroResult.isPending}
            submitError={updateMicroResult.error}
            submitLabel="更新"
            orderCandidates={orders.candidates}
            orderCandidatesLoading={orders.isLoading}
          />
        )
      )}
    </>
  );
}
