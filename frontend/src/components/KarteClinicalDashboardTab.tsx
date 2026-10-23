import { useEffect, useMemo, useRef, useState } from "react";
import type { ClinicalDashboard } from "../api/masterClient";
import { useClinicalDashboardMutations, useClinicalDashboards } from "../api/masterQueries";
import {
  CLINICAL_DASHBOARD_MAX_CARDS,
  addClinicalCard,
  clinicalDashboardCardLabel,
  emptyClinicalDashboard,
  isClinicalDashboardCardKind,
  normalizeClinicalDashboard,
  type ClinicalDashboardBody,
  type ClinicalDashboardCard,
} from "../fhir/clinicalDashboardLayout";
import { removeTile } from "../fhir/dashboardLayout";
import { stableJson } from "../fhir/extractRecordQuery";
import { definitionOwnerOf, useDefinitionOwners } from "../hooks/useDefinitionOwners";
import { useEscapeClose } from "../hooks/useEscapeClose";
import { useGridTileDrag } from "../hooks/useGridTileDrag";
import { useKarteFullscreenTop } from "../hooks/useKarteFullscreenTop";
import { useUndoableState } from "../hooks/useUndoableState";
import { readClinicalDashboardId, storeClinicalDashboardId } from "../karteLayout";
import { addDays, today } from "../lib/dates";
import { AddClinicalCardModal } from "./dashboard/AddClinicalCardModal";
import { DashboardTileFrame } from "./dashboard/DashboardTileFrame";
import { ErrorBanner } from "./ErrorBanner";
import { ExtractQuerySelect } from "./extract/ExtractQuerySelect";
import { SaveQueryModal } from "./extract/SaveQueryModal";
import { KarteTabPanel, type KartePanelActions } from "./KarteTabPanel";
import { KarteTimelineCard } from "./KarteTimelineCard";

// 診療ダッシュボード(docs/clinical-dashboard-design.md)。カルテ左ペインのタブをカードとして
// マス目に並べ、1 画面で読む。並べ方は持ち主(院内共通 / 診療科 / 自分)ごとに名前を付けて保存する。
// 上部の基準日を変えると全カードを作り直し、各カードの既定の基準日をその日にそろえる。
// タイトル行の作り(選択・日付送り・ボタンの大きさ・全画面)はマルチチャートと同じ。

interface Props {
  patientId: string;
  /** 選択中のダッシュボードの id(URL の view)。空なら前回選んだもの、無ければ新規。 */
  view: string;
  onViewChange: (view: string | null) => void;
  actions: KartePanelActions;
}

export function KarteClinicalDashboardTab({ patientId, view, onViewChange, actions }: Props) {
  const { owners: allOwners, ready, departmentId, practitionerId } = useDefinitionOwners("自分の診療ダッシュボード");
  // チームには保存しない(院内共通・診療科・自分だけ)。
  const owners = useMemo(() => allOwners.filter((owner) => owner.scope !== "team"), [allOwners]);
  const list = useClinicalDashboards(departmentId, practitionerId, ready);
  const dashboards = useMemo(() => list.data?.items ?? [], [list.data]);
  const mutations = useClinicalDashboardMutations();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const layout = useUndoableState<ClinicalDashboardBody>(emptyClinicalDashboard());
  const [savedJson, setSavedJson] = useState(stableJson(emptyClinicalDashboard()));
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [baseDate, setBaseDate] = useState(today);
  // カードごとの表示状態(タブの view に当たるもの)。基準日を変えたら空に戻す。
  const [views, setViews] = useState<Record<string, string>>({});
  const [initialized, setInitialized] = useState(false);
  // 全画面はビューポート全体ではなく「患者情報の下」から始める(マルチチャートと同じ)。
  const [fullscreen, setFullscreen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const fullscreenTop = useKarteFullscreenTop(panelRef, fullscreen);
  // 全画面は Escape でも抜けられる。上に開いたモーダルが先に閉じる(useEscapeClose)。
  useEscapeClose(() => setFullscreen(false), fullscreen);

  const selected = dashboards.find((d) => d.id === selectedId) ?? null;
  const body = layout.present;
  const dirty = stableJson(body) !== savedJson;
  const canEditSelected = selected ? definitionOwnerOf(owners, selected)?.canEdit === true : false;
  const canSaveNew = owners.some((o) => o.canEdit);

  function load(dashboard: ClinicalDashboard | null) {
    const next = dashboard ? normalizeClinicalDashboard(dashboard.definition) : emptyClinicalDashboard();
    layout.reset(next);
    setSavedJson(stableJson(dashboard ? dashboard.definition : next));
    setSelectedId(dashboard?.id ?? null);
    setEditing(!dashboard);
    setViews({});
    storeClinicalDashboardId(dashboard?.id ?? null);
    onViewChange(dashboard ? String(dashboard.id) : null);
  }

  // URL の view(無ければ前回選んだもの)のダッシュボードを開く。一覧が届いてから 1 回、
  // その後は view が変わった(戻る・進む)ときだけ。
  const viewId = Number(view) || null;
  useEffect(() => {
    if (!list.data) return;
    if (initialized && (!viewId || viewId === selectedId)) return;
    const wanted = viewId ?? (initialized ? null : readClinicalDashboardId());
    const found = wanted ? dashboards.find((d) => d.id === wanted) : undefined;
    setInitialized(true);
    if (found) load(found);
    else if (!initialized) setEditing(true);
    // load は選択の切替でだけ呼ぶ(依存に入れると読込のたびに走る)。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.data, viewId]);

  function confirmDiscard(): boolean {
    return !dirty || window.confirm("編集中の診療ダッシュボードを破棄しますか？");
  }

  async function handleOverwrite() {
    if (!selected) return;
    const saved = await mutations.update.mutateAsync({ id: selected.id, payload: { definition: body } });
    setSavedJson(stableJson(saved.definition));
    setEditing(false);
  }

  function handleDelete() {
    if (!selected || !window.confirm(`「${selected.name}」を削除しますか？`)) return;
    mutations.remove.mutate(selected.id, { onSuccess: () => load(null) });
  }

  function changeBaseDate(next: string) {
    setBaseDate(next);
    setViews({});
  }

  // ---- 編集(掴んで動かす・大きさを変える) ----
  const { set } = layout;
  const { gridRef, beginDrag } = useGridTileDrag<ClinicalDashboardCard>({
    tiles: body.cards,
    set: (cards) => set((current) => ({ ...current, cards })),
    commit: (before, after) => layout.commit({ ...body, cards: before }, { ...body, cards: after }),
  });
  const setCards = (cards: ClinicalDashboardCard[]) => set((current) => ({ ...current, cards }), { record: true });

  const mutationError = mutations.create.error ?? mutations.update.error ?? mutations.remove.error;

  return (
    <div
      ref={panelRef}
      className={`karte-tabpanel clinical-dashboard${fullscreen ? " clinical-dashboard--fullscreen" : ""}`}
      style={fullscreen ? { top: fullscreenTop } : undefined}
    >
      <div className="patient-chart__toolbar">
        <h3 className="patient-chart__title">診療ダッシュボード</h3>
        <ExtractQuerySelect
          queries={dashboards}
          value={selectedId}
          emptyLabel="新しいダッシュボード"
          onChange={(dashboard) => {
            if (!confirmDiscard()) return;
            load(dashboard);
          }}
        />
        <div className="patient-chart__nav">
          <button
            type="button"
            className="patient-chart__step"
            onClick={() => changeBaseDate(addDays(baseDate, -1))}
            title="前の日"
            aria-label="前の日"
          >
            ◀
          </button>
          <input type="date" value={baseDate} onChange={(e) => changeBaseDate(e.target.value || today())} />
          <button
            type="button"
            className="patient-chart__step"
            onClick={() => changeBaseDate(addDays(baseDate, 1))}
            title="次の日"
            aria-label="次の日"
          >
            ▶
          </button>
          <button type="button" onClick={() => changeBaseDate(today())} disabled={baseDate === today()}>
            今日
          </button>
        </div>
        {dirty && <span className="data-extract__dirty">未保存</span>}
        {editing ? (
          <>
            <button type="button" disabled={body.cards.length >= CLINICAL_DASHBOARD_MAX_CARDS} onClick={() => setAdding(true)}>
              カード追加
            </button>
            <button type="button" disabled={!layout.canUndo} onClick={layout.undo}>
              元に戻す
            </button>
            <button type="button" disabled={!layout.canRedo} onClick={layout.redo}>
              やり直す
            </button>
            {selected && canEditSelected && (
              <button type="button" onClick={() => void handleOverwrite()} disabled={!dirty || mutations.update.isPending}>
                保存
              </button>
            )}
            {canSaveNew && (
              <button type="button" onClick={() => setSaving(true)}>
                {selected ? "別名保存" : "保存"}
              </button>
            )}
            <button type="button" onClick={() => setEditing(false)}>
              閉じる
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => setEditing(true)}>
              編集
            </button>
            {selected && canEditSelected && (
              <button type="button" onClick={handleDelete} disabled={mutations.remove.isPending}>
                削除
              </button>
            )}
          </>
        )}
        <button type="button" onClick={() => setFullscreen((prev) => !prev)}>
          {fullscreen ? "全画面終了" : "全画面"}
        </button>
      </div>

      <ErrorBanner error={list.error ?? mutationError} />

      <div className="dashboard">
        <div className={`dashboard__grid${editing ? " is-editing" : ""}`} ref={gridRef}>
          {body.cards.map((card) => (
            <DashboardTileFrame
              key={`${card.id}:${baseDate}`}
              tile={card}
              title={card.title || clinicalDashboardCardLabel(card.kind)}
              editing={editing}
              onRemove={() => setCards(removeTile(body.cards, card.id))}
              onMoveStart={(event) => beginDrag({ kind: "move", id: card.id }, event)}
              onResizeStart={(event) => beginDrag({ kind: "resize", id: card.id }, event)}
            >
              <CardBody
                card={card}
                patientId={patientId}
                baseDate={baseDate}
                view={views[card.id] ?? ""}
                onViewChange={(next) => setViews((prev) => ({ ...prev, [card.id]: next ?? "" }))}
                actions={actions}
              />
            </DashboardTileFrame>
          ))}
          {body.cards.length === 0 && (
            <p className="dashboard__empty order-select__muted">
              {editing ? "「カード追加」でカルテのタブを置きます。" : "カードはありません。「編集」で足します。"}
            </p>
          )}
        </div>
      </div>

      {adding && (
        <AddClinicalCardModal
          onAdd={(card) => {
            setCards(addClinicalCard(body.cards, card));
            setAdding(false);
          }}
          onClose={() => setAdding(false)}
        />
      )}
      {saving && (
        <SaveQueryModal
          title="診療ダッシュボードを保存"
          owners={owners}
          initialName={selected ? `${selected.name}のコピー` : ""}
          pending={mutations.create.isPending}
          error={mutations.create.error}
          onClose={() => setSaving(false)}
          onSave={async (name, owner) => {
            const created = await mutations.create.mutateAsync({
              scope: owner.scope,
              owner_id: owner.ownerId,
              owner_name: owner.ownerName,
              name,
              definition: body,
            });
            setSaving(false);
            setSelectedId(created.id);
            setSavedJson(stableJson(created.definition));
            setEditing(false);
            storeClinicalDashboardId(created.id);
            onViewChange(String(created.id));
          }}
        />
      )}
    </div>
  );
}

/** カード 1 枚の中身。カルテのタイムラインか、タブの部品をそのまま描く。 */
function CardBody({
  card,
  patientId,
  baseDate,
  view,
  onViewChange,
  actions,
}: {
  card: ClinicalDashboardCard;
  patientId: string;
  baseDate: string;
  view: string;
  onViewChange: (view: string | null) => void;
  actions: KartePanelActions;
}) {
  if (!isClinicalDashboardCardKind(card.kind)) {
    return <p className="order-select__muted">この種別は表示できません。</p>;
  }
  if (card.kind === "karte") return <KarteTimelineCard patientId={patientId} baseDate={baseDate} actions={actions} />;
  return (
    <KarteTabPanel
      tab={card.kind}
      patientId={patientId}
      view={view}
      onViewChange={onViewChange}
      baseDate={baseDate}
      actions={actions}
    />
  );
}
