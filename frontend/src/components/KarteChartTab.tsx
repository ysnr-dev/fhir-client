import { useEffect, useMemo, useRef, useState } from "react";
import type { ChartDefinition } from "../api/masterClient";
import { useChartDefinitionMutations, useChartDefinitions } from "../api/masterQueries";
import {
  usePatientChartObservations,
  usePatientEncounterEvents,
  useKarteConditions,
  usePatientChartInjections,
  usePatientChartPrescriptions,
  usePatientPerformedProcedures,
  usePatientRadiotherapyOrders,
  usePatientSurgeryPerforms,
  useRadiotherapyProcedures,
  useRegimenApplications,
  useRegimenDayOrders,
} from "../api/queries";
import { useCurrentPractitioner } from "../api/authQueries";
import { findLabReportIdOf, usePractitionerRoles, useVitalThresholds } from "../api/queries";
import {
  baseRoleOf,
  isDoctorRoleCode,
  parseDepartmentRoles,
  parsePractitionerRole,
} from "../fhir/practitionerRoleHelpers";
import { useOrderContext } from "../hooks/useOrderContext";
import {
  CHART_AXIS_UNIT_LABELS,
  CHART_COLUMN_CHOICES,
  buildChartLanes,
  centeredBaseDate,
  buildDrugTracks,
  buildChemoChartEvents,
  buildConditionChartEvents,
  buildEncounterChartEvents,
  buildPrescriptionChartEvents,
  buildProcedureChartEvents,
  buildRadiotherapyChartEvents,
  buildSurgeryChartEvents,
  chartColumnsFor,
  chartItemCodings,
  chartProcedureTypeCodes,
  chartRangeOf,
  filterChartEvents,
  normalizeChartDefinitionBody,
  ownerKeyOf,
  type ChartAxisUnit,
  type ChartEvent,
  type ChartEventKind,
  type ChartItemSource,
  type ChartPoint,
} from "../fhir/chartDefinitionHelpers";
import { formatChartView, parseChartView, type KarteDetailTarget } from "../karteUrl";
import { addDays, today } from "../lib/dates";
import {
  ChartDefinitionEditorModal,
  type ChartDefinitionDraft,
  type ChartOwnerOption,
} from "./ChartDefinitionEditorModal";
import { ErrorBanner } from "./ErrorBanner";
import { PatientChartPanel } from "./PatientChartPanel";
import { RowMenu } from "./RowMenu";

// カルテのチャートタブ。保存してあるチャート定義を選び、その患者のデータを当てて描く。
// 定義は患者を持たないので、同じ定義を次の患者でもそのまま開ける。

interface Props {
  patientId: string;
  view: string;
  onViewChange?: (view: string | null) => void;
  onOpenDetail?: (target: KarteDetailTarget) => void;
}

type Editing = { mode: "create" | "edit" | "copy"; draft: ChartDefinitionDraft } | null;

export function KarteChartTab({ patientId, view, onViewChange, onOpenDetail }: Props) {
  // タブの外(別ペイン)から使うときは URL に載せずローカルに持つ(経過表と同じ)。
  const [localView, setLocalView] = useState("");
  const parsed = parseChartView(onViewChange ? view : localView);
  // ハンドラや Escape の購読から最新の view を読む(毎描画で張り直さないため)。
  const viewRef = useRef(parsed);
  viewRef.current = parsed;

  const updateView = (next: Parameters<typeof formatChartView>[0]) => {
    const formatted = formatChartView(next, today());
    if (onViewChange) onViewChange(formatted);
    else setLocalView(formatted ?? "");
  };



  const { practitionerId, practitioner, sessionLoading } = useCurrentPractitioner();
  const practitionerRoles = usePractitionerRoles(practitionerId ?? undefined);
  const baseRole = baseRoleOf(practitionerRoles.roles);
  const isDoctor = isDoctorRoleCode(
    baseRole ? parsePractitionerRole(baseRole).roleCode : undefined,
  );
  const myDepartments = useMemo(
    () => parseDepartmentRoles(practitionerRoles.roles),
    [practitionerRoles.roles],
  );
  // ヘッダーで選んでいる依頼科を優先し、無ければ担当科の先頭。
  const orderContext = useOrderContext();
  const department =
    myDepartments.find((d) => d.organizationId === orderContext.departmentId) ?? myDepartments[0];

  const owners: ChartOwnerOption[] = useMemo(() => {
    const practitionerName = practitioner
      ? practitioner.name?.[0]?.text ||
        [practitioner.name?.[0]?.family, ...(practitioner.name?.[0]?.given ?? [])]
          .filter(Boolean)
          .join(" ")
      : "";
    return [
      { scope: "facility", ownerId: null, ownerName: null, label: "院内共通", canEdit: isDoctor },
      {
        scope: "department",
        ownerId: department?.organizationId ?? null,
        ownerName: department?.name ?? null,
        label: department?.name ?? "診療科",
        canEdit: isDoctor && Boolean(department),
      },
      {
        scope: "practitioner",
        ownerId: practitionerId,
        ownerName: practitionerName || null,
        // 自分だけが見るチャートは医師でなくても持てる(読むための設定なので)。
        label: "自分のチャート",
        canEdit: Boolean(practitionerId),
      },
    ];
  }, [isDoctor, department, practitionerId, practitioner]);

  // 持ち主(自分・診療科)が決まる前に引くと、院内共通だけの一覧を一度返して
  // 「チャートがありません」がちらつくので、決まってから引く。
  const ownersReady = !sessionLoading && (!practitionerId || !practitionerRoles.isPending);
  const list = useChartDefinitions(
    department?.organizationId,
    practitionerId ?? undefined,
    ownersReady,
  );
  const listLoading = !ownersReady || list.isPending;
  const mutations = useChartDefinitionMutations();
  const definitions = useMemo(() => list.data?.items ?? [], [list.data]);

  // 指定が無ければ自分 → 診療科 → 院内共通の順で先頭を開く。
  const selected = useMemo(() => {
    const byId = definitions.find((entry) => entry.id === parsed.chartId);
    if (byId) return byId;
    const rank = (entry: ChartDefinition) =>
      entry.scope === "practitioner" ? 0 : entry.scope === "department" ? 1 : 2;
    return [...definitions].sort((a, b) => rank(a) - rank(b))[0] ?? null;
  }, [definitions, parsed.chartId]);

  const body = useMemo(
    () => normalizeChartDefinitionBody(selected?.definition),
    [selected?.definition],
  );
  const baseDate = parsed.baseDate ?? today();
  // 横軸と重ね表示は定義が既定を持ち、URL の view があればそちらが勝つ(その場の見え方)。
  const unit = parsed.unit ?? body.axis.unit;
  const columns = parsed.columns ?? body.axis.columns;
  const range = useMemo(() => chartRangeOf(baseDate, { unit, columns }), [baseDate, unit, columns]);

  const codings = useMemo(() => chartItemCodings(body.items), [body.items]);
  const observations = usePatientChartObservations(
    selected ? patientId : undefined,
    codings,
    range.rangeStart,
    range.rangeEnd,
  );
  const vitalThresholds = useVitalThresholds();
  const lanes = useMemo(
    () => buildChartLanes(body.items, observations.data ?? [], vitalThresholds),
    [body.items, observations.data, vitalThresholds],
  );

  const events = useChartEvents(patientId, body.events, range.rangeStart, range.rangeEnd);
  // 薬剤の行。処方は帯の「処方」と同じ検索なので、両方 ON でもキャッシュを分け合う。
  const drugPatientId = body.drugs.length > 0 ? patientId : undefined;
  const drugPrescriptions = usePatientChartPrescriptions(drugPatientId, range.rangeStart, range.rangeEnd);
  const drugInjections = usePatientChartInjections(drugPatientId, range.rangeStart, range.rangeEnd);
  const drugTracks = useMemo(
    () => buildDrugTracks(body.drugs, drugPrescriptions.data, drugInjections.data, range),
    [body.drugs, drugPrescriptions.data, drugInjections.data, range],
  );
  const shownEvents = useMemo(() => filterChartEvents(events, range), [events, range]);

  const [editing, setEditing] = useState<Editing>(null);
  const [error, setError] = useState<unknown>(null);

  // 全画面はビューポート全体ではなく「患者情報の下」から始める(経過表・パスシートと同じ)。
  const overlay = parsed.overlay ?? body.overlay;
  const values = Boolean(parsed.values);
  const fullscreen = Boolean(parsed.fullscreen);
  const panelRef = useRef<HTMLDivElement>(null);
  const [fullscreenTop, setFullscreenTop] = useState(0);
  useEffect(() => {
    if (!fullscreen) return;
    function measure() {
      const layout = panelRef.current?.closest(".karte-layout");
      setFullscreenTop(layout ? Math.max(0, layout.getBoundingClientRect().top) : 0);
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [fullscreen]);

  // 全画面は Escape でも抜けられるようにする。編集モーダルを開いている間は、
  // そちらを閉じる操作なのでここでは拾わない。
  useEffect(() => {
    if (!fullscreen || editing) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") updateView({ ...viewRef.current, fullscreen: false });
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullscreen, editing]);

  // 定義を消した後など、URL が指している id が無くなったら指定を落とす。
  // **引き直している間は触らない** —— 作った直後は一覧がまだ古く、作ったチャートを
  // 「無くなった」と誤判定して選択が外れてしまう。
  useEffect(() => {
    if (list.isFetching || !parsed.chartId || definitions.length === 0) return;
    if (definitions.some((entry) => entry.id === parsed.chartId)) return;
    updateView({ ...parsed, chartId: undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [definitions, parsed.chartId, list.isFetching]);

  // 基準の日を見ているあいだは、横軸を変えても基準が真ん中に来るように右端を置き直す。
  function changeAxis(nextUnit: ChartAxisUnit, nextColumns: number) {
    const anchorBase = parsed.anchor
      ? centeredBaseDate(parsed.anchor, { unit: nextUnit, columns: nextColumns })
      : parsed.baseDate;
    updateView({ ...parsed, unit: nextUnit, columns: nextColumns, baseDate: anchorBase });
  }

  // 点の元の記録。検査は結果の載った報告書を引いてから開く(点は Observation しか持たない)。
  async function openPoint(source: ChartItemSource, point: ChartPoint) {
    if (!onOpenDetail) return;
    if (source === "template") {
      if (point.responseId) onOpenDetail({ kind: "qr", id: point.responseId });
      return;
    }
    try {
      const reportId = await findLabReportIdOf(point.observationId);
      if (reportId) onOpenDetail({ kind: "lab-result", id: reportId });
      else setError(new Error("この結果の検査報告が見つかりません。"));
    } catch (err) {
      setError(err);
    }
  }

  function openEditor(mode: "create" | "edit" | "copy") {
    const owner = owners.find((entry) => entry.canEdit) ?? owners[0];
    if (mode === "create") {
      setEditing({
        mode,
        draft: {
          name: "",
          scope: owner.scope,
          ownerId: owner.ownerId,
          ownerName: owner.ownerName,
          // 新規は、いま見ている横軸と表示のしかたを初期値にする。
          definition: {
            schema_version: 1,
            axis: { unit, columns },
            items: [],
            events: [],
            drugs: [],
            overlay,
          },
        },
      });
      return;
    }
    if (!selected) return;
    setEditing({
      mode,
      draft: {
        name: mode === "copy" ? `${selected.name}のコピー` : selected.name,
        scope: mode === "copy" ? owner.scope : selected.scope,
        ownerId: mode === "copy" ? owner.ownerId : selected.owner_id,
        ownerName: mode === "copy" ? owner.ownerName : selected.owner_name,
        definition: body,
      },
    });
  }

  async function handleSave(draft: ChartDefinitionDraft) {
    setError(null);
    try {
      const payload = {
        scope: draft.scope,
        owner_id: draft.ownerId,
        owner_name: draft.ownerName,
        name: draft.name,
        definition: draft.definition,
      };
      if (editing?.mode === "edit" && selected) {
        await mutations.update.mutateAsync({ id: selected.id, payload });
      } else {
        const created = await mutations.create.mutateAsync(payload);
        updateView({ ...parsed, chartId: created.id });
      }
      setEditing(null);
    } catch (e) {
      setError(e);
    }
  }

  async function handleDelete() {
    if (!selected) return;
    if (!window.confirm(`チャート「${selected.name}」を削除します。よろしいですか?`)) return;
    setError(null);
    try {
      await mutations.remove.mutateAsync(selected.id);
      updateView({ ...parsed, chartId: undefined });
    } catch (e) {
      setError(e);
    }
  }

  const canEditSelected =
    selected != null &&
    owners.some(
      (owner) =>
        owner.canEdit && ownerKeyOf(owner.scope, owner.ownerId) === ownerKeyOf(selected.scope, selected.owner_id),
    );
  const busy = mutations.create.isPending || mutations.update.isPending;

  return (
    <div
      ref={panelRef}
      className={`karte-tabpanel patient-chart${fullscreen ? " patient-chart--fullscreen" : ""}`}
      style={fullscreen ? { top: fullscreenTop } : undefined}
    >
      <div className="patient-chart__toolbar">
        <h3 className="patient-chart__title">マルチチャート</h3>
        <select
          value={selected?.id ?? ""}
          onChange={(e) => updateView({ ...parsed, chartId: Number(e.target.value) || undefined })}
          disabled={definitions.length === 0}
        >
          {definitions.length === 0 && (
            <option value="">{listLoading ? "読み込み中..." : "チャートがありません"}</option>
          )}
          {(["practitioner", "department", "facility"] as const).map((scope) => {
            const group = definitions.filter((entry) => entry.scope === scope);
            if (group.length === 0) return null;
            const label =
              scope === "practitioner" ? "自分" : scope === "department" ? "診療科" : "院内共通";
            return (
              <optgroup key={scope} label={label}>
                {group.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </optgroup>
            );
          })}
        </select>

        <div className="patient-chart__nav">
          <button
            type="button"
            className="patient-chart__step"
            onClick={() => updateView({ ...parsed, baseDate: shiftBase(baseDate, unit, columns, -1) })}
            title="前へ"
            aria-label="前へ"
          >
            ◀
          </button>
          <input
            type="date"
            value={baseDate}
            onChange={(e) => updateView({ ...parsed, baseDate: e.target.value })}
          />
          <button
            type="button"
            className="patient-chart__step"
            onClick={() => updateView({ ...parsed, baseDate: shiftBase(baseDate, unit, columns, 1) })}
            title="次へ"
            aria-label="次へ"
          >
            ▶
          </button>
          <button type="button" onClick={() => updateView({ ...parsed, baseDate: undefined })}>
            今日
          </button>
        </div>

        {parsed.anchor && (
          <button
            type="button"
            className="patient-chart__anchor-chip"
            onClick={() => updateView({ ...parsed, anchor: undefined })}
            title="基準を外す"
          >
            基準 {parsed.anchor.replaceAll("-", "/")} ✕
          </button>
        )}

        <div className="patient-chart__unit">
          <select
            value={unit}
            aria-label="横軸の単位"
            onChange={(e) => {
              const next = e.target.value as ChartAxisUnit;
              changeAxis(next, chartColumnsFor(next, columns));
            }}
          >
            {(Object.keys(CHART_AXIS_UNIT_LABELS) as ChartAxisUnit[]).map((key) => (
              <option key={key} value={key}>
                {CHART_AXIS_UNIT_LABELS[key]}
              </option>
            ))}
          </select>
          <select
            value={columns}
            aria-label="表示する列数"
            onChange={(e) => changeAxis(unit, Number(e.target.value))}
          >
            {CHART_COLUMN_CHOICES[unit].map((choice) => (
              <option key={choice} value={choice}>
                {choice}
              </option>
            ))}
          </select>
        </div>

        <OverlayToggle
          overlay={overlay}
          onToggle={() => updateView({ ...parsed, overlay: !overlay })}
        />

        <ValuesToggle
          values={values}
          onToggle={() => updateView({ ...parsed, values: !values })}
        />

        <button type="button" onClick={() => updateView({ ...parsed, fullscreen: !fullscreen })}>
          {fullscreen ? "全画面を終了" : "全画面"}
        </button>

        <RowMenu label="チャートの操作">
          <button type="button" className="row-menu__item" onClick={() => openEditor("create")}>
            新規
          </button>
          <button
            type="button"
            className="row-menu__item"
            onClick={() => openEditor("edit")}
            disabled={!canEditSelected}
          >
            編集
          </button>
          <button
            type="button"
            className="row-menu__item"
            onClick={() => openEditor("copy")}
            disabled={!selected}
          >
            名前を付けて保存
          </button>
          <button
            type="button"
            className="row-menu__item"
            onClick={handleDelete}
            disabled={!canEditSelected}
          >
            削除
          </button>
        </RowMenu>
      </div>

      <ErrorBanner
        error={
          error ?? list.error ?? observations.error ?? drugPrescriptions.error ?? drugInjections.error
        }
      />

      {listLoading ? (
        <p className="patient-chart__empty">読み込み中...</p>
      ) : definitions.length === 0 ? (
        <p className="patient-chart__empty">チャートがありません。</p>
      ) : (
        <PatientChartPanel
          range={range}
          lanes={lanes}
          events={shownEvents}
          drugTracks={drugTracks}
          eventKinds={body.events}
          overlay={overlay}
          values={values}
          fullscreen={fullscreen}
          // 別のチャートに切り替えた直後は前の値が仮に入っている(項目が違うので点にならない)。
          loading={observations.isLoading || observations.isPlaceholderData}
          anchor={parsed.anchor}
          onAnchor={(date) =>
            updateView({ ...parsed, anchor: date, baseDate: centeredBaseDate(date, { unit, columns }) })
          }
          onOpenDetail={onOpenDetail}
          onOpenPoint={onOpenDetail ? openPoint : undefined}
        />
      )}

      {editing && (
        <ChartDefinitionEditorModal
          mode={editing.mode}
          initial={editing.draft}
          owners={owners}
          busy={busy}
          error={error}
          onSave={handleSave}
          onClose={() => {
            setEditing(null);
            setError(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * 項目ごとに分けて並べるか、1 つのグラフに重ねるかの切り替え。
 * アイコンは「横罫で区切った 2 段」と「重なった 2 本の線」。
 */
function OverlayToggle({ overlay, onToggle }: { overlay: boolean; onToggle: () => void }) {
  const label = overlay ? "項目ごとに分けて表示" : "すべてを 1 つのグラフに重ねて表示";
  return (
    <button
      type="button"
      className={`patient-chart__mode${overlay ? " is-active" : ""}`}
      aria-pressed={overlay}
      title={label}
      aria-label={label}
      onClick={onToggle}
    >
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
        <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
        {overlay ? (
          // 重ねる: 1 つの枠の中で 2 本の線が交わる。
          <>
            <path d="M3.5 11.5 6.5 7 9.5 9.5 12.5 5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M3.5 6 6.5 9.5 9.5 5.5 12.5 10.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.55" />
          </>
        ) : (
          // 分ける: 枠を横罫で 2 段に割り、それぞれに線を 1 本ずつ。
          <>
            <path d="M1.5 8h13" stroke="currentColor" strokeWidth="1.2" />
            <path d="M3.5 6 6.5 4.5 9.5 6.5 12.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M3.5 12 6.5 10 9.5 12 12.5 9.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </>
        )}
      </svg>
    </button>
  );
}

/** グラフ上に数値を出すかどうかの切り替え。アイコンは枠の中に数字。 */
function ValuesToggle({ values, onToggle }: { values: boolean; onToggle: () => void }) {
  const label = values ? "数値を隠す" : "グラフ上に数値を出す";
  return (
    <button
      type="button"
      className={`patient-chart__mode${values ? " is-active" : ""}`}
      aria-pressed={values}
      title={label}
      aria-label={label}
      onClick={onToggle}
    >
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
        <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <text x="8" y="11.5" textAnchor="middle" fontSize="8" fill="currentColor">
          12
        </text>
      </svg>
    </button>
  );
}

/** 期間 1 つぶん前後に送る。 */
function shiftBase(baseDate: string, unit: ChartAxisUnit, columns: number, direction: number): string {
  if (unit === "day") return addDays(baseDate, columns * direction);
  const [year, month, day] = baseDate.split("-").map(Number);
  const shifted =
    unit === "month"
      ? new Date(year, month - 1 + columns * direction, day)
      : new Date(year + columns * direction, month - 1, day);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${shifted.getFullYear()}-${pad(shifted.getMonth() + 1)}-${pad(shifted.getDate())}`;
}

/**
 * 帯に出すイベント。種別ごとに取得元が違うので、定義で OFF のものは patientId を
 * 渡さずに止める(フックの数は変えない)。
 */
function useChartEvents(
  patientId: string,
  kinds: readonly ChartEventKind[],
  rangeStart: string,
  rangeEnd: string,
): ChartEvent[] {
  const wants = (kind: ChartEventKind) => (kinds.includes(kind) ? patientId : undefined);

  // 病名はカルテのプロブレム一覧と同じ検索(キャッシュを分け合う)。
  const conditionQuery = useKarteConditions(wants("condition"));
  // conditions は描画のたびに作り直される配列なので、元の data で束ねる。
  const conditionData = conditionQuery.data;
  const conditions = useMemo(
    () => (conditionData ? conditionQuery.conditions : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conditionData],
  );
  const encounters = usePatientEncounterEvents(wants("encounter"), rangeStart, rangeEnd);
  const surgeries = usePatientSurgeryPerforms(wants("surgery"), rangeStart, rangeEnd);
  const applications = useRegimenApplications(wants("chemo"));
  const instanceIds = useMemo(
    () => (applications.data?.applications ?? []).map((a) => a.instanceId),
    [applications.data],
  );
  const dayOrders = useRegimenDayOrders(wants("chemo"), instanceIds);
  const radiotherapyOrders = usePatientRadiotherapyOrders(wants("radiotherapy"));
  const radiotherapyIds = useMemo(
    () => (radiotherapyOrders.data ?? []).map((order) => order.id ?? ""),
    [radiotherapyOrders.data],
  );
  const radiotherapy = useRadiotherapyProcedures(radiotherapyIds);
  const procedureCodes = useMemo(
    () => chartProcedureTypeCodes([...kinds]),
    [kinds],
  );
  const procedures = usePatientPerformedProcedures(
    procedureCodes.length > 0 ? patientId : undefined,
    procedureCodes,
    rangeStart,
    rangeEnd,
  );
  const prescriptions = usePatientChartPrescriptions(wants("prescription"), rangeStart, rangeEnd);

  return useMemo(() => {
    const events: ChartEvent[] = [];
    if (conditions) events.push(...buildConditionChartEvents(conditions));
    if (encounters.data) {
      events.push(
        ...buildEncounterChartEvents(encounters.data.events, encounters.data.stays, rangeEnd),
      );
    }
    if (surgeries.data) events.push(...buildSurgeryChartEvents(surgeries.data));
    if (applications.data && dayOrders.data) {
      events.push(...buildChemoChartEvents(applications.data.applications, dayOrders.data));
    }
    if (radiotherapyOrders.data && radiotherapy.data) {
      events.push(
        ...buildRadiotherapyChartEvents(radiotherapyOrders.data, radiotherapy.data.fractions),
      );
    }
    if (procedures.data) events.push(...buildProcedureChartEvents(procedures.data));
    if (prescriptions.data) {
      events.push(
        ...buildPrescriptionChartEvents(
          prescriptions.data.orders,
          prescriptions.data.medicationRequests,
          prescriptions.data.tasks,
        ),
      );
    }
    return events;
  }, [
    conditions,
    encounters.data,
    surgeries.data,
    applications.data,
    dayOrders.data,
    radiotherapyOrders.data,
    radiotherapy.data,
    procedures.data,
    prescriptions.data,
    rangeEnd,
  ]);
}
