import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { PatientCaution } from "../api/masterClient";
import { usePatientCautions, useWardMap } from "../api/masterQueries";
import {
  useAllergiesForPatients,
  useFlagsForPatients,
  useInfectionsForPatients,
  useInpatientEncounters,
  usePlannedAdmissions,
  useWardGrid,
  useWardOptions,
} from "../api/queries";
import { AdmissionExecuteModal } from "../components/AdmissionExecuteModal";
import { AdmissionModal } from "../components/AdmissionModal";
import { BedTransferModal } from "../components/BedTransferModal";
import { DateStepper } from "../components/DateStepper";
import { DischargeModal } from "../components/DischargeModal";
import { DischargePlanModal } from "../components/DischargePlanModal";
import { ErrorBanner } from "../components/ErrorBanner";
import { LeaveModal } from "../components/LeaveModal";
import {
  AllergyPictogramBadges,
  CautionPictogramBadges,
  InfectionPictogramBadge,
} from "../components/PatientPictograms";
import { RowMenu } from "../components/RowMenu";
import { TransferPlanModal } from "../components/TransferPlanModal";
import { WardMapBedCard, type BedCardState } from "../components/WardMapBedCard";
import { WardMapCanvas } from "../components/WardMapCanvas";
import { WardMapLegend, type LegendItem } from "../components/WardMapLegend";
import { WardMapMoveConfirmModal } from "../components/WardMapMoveConfirmModal";
import { WardMapMovePanel } from "../components/WardMapMovePanel";
import { WardMapPlannedPanel } from "../components/WardMapPlannedPanel";
import { WardMapWorkspace } from "../components/WardMapWorkspace";
import {
  applyMoves,
  bedPlaceLabel,
  cancelMove,
  dropOnBed,
  dropOnWorkspace,
  emptyMovePlan,
  WORKSPACE,
  type BedPlace,
  type MovePlan,
} from "../fhir/bedMovePlanHelpers";
import {
  admittedBedLabelByPatient,
  encounterBedId,
  encounterDischargePlan,
  encounterLeaves,
  encounterPatientId,
  encounterTransferPlan,
  occupiedBedIds as occupiedBedIdSet,
  plannedAdmissionDate,
  plannedWardId,
} from "../fhir/encounterHelpers";
import { locationDisplayName } from "../fhir/locationHelpers";
import { calculateAge, displayName, genderShortLabel } from "../fhir/patientHelpers";
import type { BedRoomIds } from "../fhir/wardHelpers";
import {
  buildInitialLayout,
  clientToGrid,
  hitTestBed,
  normalizeLayout,
  type BedObject,
  type WardMapLayout,
} from "../fhir/wardMapHelpers";
import { useCardDrag, type DragState } from "../hooks/useCardDrag";
import { useWardMapViewport } from "../hooks/useWardMapViewport";
import { nowDateTimeInput, today } from "../lib/dates";
import { useReturnLinkState } from "../returnTo";

// 病棟マップ。病棟の間取り(master_ward_maps)の上に、その日の入院患者を
// ベッドごとに出す。入院患者一覧(表)の別の見え方で、同じ ?ward= と ?date= を持つ。
// マップが未作成の病棟は、病室とベッドを機械的に並べて出す(保存はしない)。
//
// 今日の表示では患者カードを掴んで床から床へ運べる。落としても書き込まず、保留中の
// 移動(fhir/bedMovePlanHelpers.ts)として積み、「転床を確定」でまとめて書く。

const LEGEND: LegendItem[] = [
  { modifier: "empty", label: "空床" },
  { modifier: "occupied", label: "入院中" },
  { modifier: "moved-away", label: "移動元(保留中)" },
  { modifier: "moved-in", label: "移動先(保留中)" },
  { modifier: "stale", label: "削除された場所" },
];

type ViewDragItem = { kind: "bed" | "workspace" | "planned"; encounter: fhir4.Encounter };
type DropTarget = { kind: "bed"; bedId: string } | { kind: "workspace" } | null;

/** ベッドカードのケバブから開くモーダル。 */
interface RowAction {
  kind: "bedTransfer" | "leave" | "transferPlan" | "dischargePlan" | "discharge";
  encounter: fhir4.Encounter;
  patient?: fhir4.Patient;
  place: BedPlace;
}

/** 入院実施の対象(入院予定パネルから)。 */
interface ExecuteTarget {
  encounter: fhir4.Encounter;
  patient?: fhir4.Patient;
  initialPlace?: BedRoomIds;
}

/** 見ている日に外出泊中か。今日なら時刻まで、他の日は日付で判定する。 */
function onLeaveAt(encounter: fhir4.Encounter, date: string): boolean {
  const now = date === today() ? nowDateTimeInput() : `${date}T23:59`;
  const dayStart = `${date}T00:00`;
  return encounterLeaves(encounter).some(
    (leave) => leave.start <= now && (!leave.end || leave.end >= dayStart),
  );
}

/** 予定日の短い表示(M/D)。 */
function shortDate(value: string): string {
  const [, m, d] = value.slice(0, 10).split("-");
  return m && d ? `${Number(m)}/${Number(d)}` : value;
}

export function WardMapPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const wardId = searchParams.get("ward") ?? "";
  const date = searchParams.get("date") || today();
  const navigate = useNavigate();
  const returnLinkState = useReturnLinkState();

  function setParams(next: Record<string, string>, replace = false) {
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    setSearchParams(params, { replace });
  }

  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  const wardOptions = useWardOptions();
  const grid = useWardGrid(wardId || undefined);
  const map = useWardMap(wardId || undefined);
  const inpatients = useInpatientEncounters(date);

  // 病棟が未指定なら先頭の病棟を開く(入院患者一覧と同じ)。
  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current || wardId) return;
    const first = wardOptions.wards[0];
    if (!first?.id) return;
    initialized.current = true;
    setParams({ ward: first.id }, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wardId, wardOptions.wards]);

  // 機械的な並びは Location の取得結果(grid.data)から作る。useWardGrid の戻り値は
  // 毎回新しいオブジェクトなので、それに依存すると描画のたびに並べ直してしまう。
  const gridData = grid.data;
  const layout = useMemo<WardMapLayout | null>(() => {
    if (map.data) return normalizeLayout(map.data.layout);
    if (map.isSuccess && gridData) return buildInitialLayout(gridData);
    return null;
  }, [map.data, map.isSuccess, gridData]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const viewport = useWardMapViewport(scrollRef);
  const zoom = viewport.zoom;

  const byBedOriginal = useMemo(
    () => inpatients.data?.byBed ?? new Map<string, fhir4.Encounter>(),
    [inpatients.data],
  );
  const patientsById = inpatients.data?.patientsById;
  const occupiedBedIds = useMemo(
    () => occupiedBedIdSet(inpatients.data?.encounters ?? []),
    [inpatients.data],
  );
  const admittedBedLabelByPatientId = useMemo(
    () => admittedBedLabelByPatient(inpatients.data?.encounters ?? []),
    [inpatients.data],
  );

  /** ベッド id → ベッドと病室(表示名と検証に使う)。 */
  const bedPlaces = useMemo(() => {
    const result = new Map<string, BedPlace>();
    for (const room of grid.rooms) {
      for (const bed of grid.bedsByRoom.get(room.id ?? "") ?? []) {
        if (bed.id) result.set(bed.id, { bed, room });
      }
    }
    return result;
  }, [grid.rooms, grid.bedsByRoom]);

  // 在床・空床の数は Location(実体)から数える(マップに置き忘れた床も数に入れる)。
  const counts = useMemo(() => {
    const total = bedPlaces.size;
    const occupied = [...bedPlaces.keys()].filter((bedId) => byBedOriginal.has(bedId)).length;
    return { total, occupied, empty: total - occupied };
  }, [bedPlaces, byBedOriginal]);

  const patientName = useCallback(
    (encounter: fhir4.Encounter) => {
      const patient = patientsById?.get(encounterPatientId(encounter) ?? "");
      return patient ? displayName(patient) : "(患者不明)";
    },
    [patientsById],
  );
  const bedLabel = useCallback((bedId: string) => bedPlaceLabel(bedPlaces.get(bedId)), [bedPlaces]);

  // ---- 移動プラン ----

  const movable = date === today();
  const [plan, setPlan] = useState<MovePlan>(emptyMovePlan);
  const [confirming, setConfirming] = useState(false);
  const applied = useMemo(() => applyMoves(byBedOriginal, plan), [byBedOriginal, plan]);

  // ---- 当日と日付未定の入院予定(この病棟宛て、または病棟未定) ----
  //
  // 日付未定の予定はいつ来てもおかしくないので、当日ぶんと一緒に並べて
  // そのまま入院実施できるようにする(日付を確定する段階は置かない)。

  const planned = usePlannedAdmissions();
  const plannedForWard = useMemo(() => {
    if (!movable) return [];
    return (planned.data?.encounters ?? []).filter((encounter) => {
      const ward = plannedWardId(encounter);
      return !ward || ward === wardId;
    });
  }, [planned.data, movable, wardId]);
  const plannedToday = useMemo(
    () => plannedForWard.filter((encounter) => plannedAdmissionDate(encounter) === date),
    [plannedForWard, date],
  );
  const plannedUndated = useMemo(
    () => plannedForWard.filter((encounter) => !plannedAdmissionDate(encounter)),
    [plannedForWard],
  );
  const [executeTarget, setExecuteTarget] = useState<ExecuteTarget | null>(null);

  // ---- ピクトグラム(マップに出ている患者ぶんをまとめて引く) ----

  const shownPatientIds = useMemo(() => {
    const ids = new Set<string>();
    for (const encounter of [...applied.byBed.values(), ...applied.workspace]) {
      const id = encounterPatientId(encounter);
      if (id) ids.add(id);
    }
    return [...ids];
  }, [applied]);
  const cautions = usePatientCautions();
  const cautionsByCode = useMemo(
    () => new Map<string, PatientCaution>((cautions.data?.items ?? []).map((c) => [c.code, c])),
    [cautions.data],
  );
  const flags = useFlagsForPatients(shownPatientIds);
  const allergies = useAllergiesForPatients(shownPatientIds);
  const infections = useInfectionsForPatients(shownPatientIds);

  // ---- ケバブから開くモーダル ----

  const [rowAction, setRowAction] = useState<RowAction | null>(null);
  const [admissionTarget, setAdmissionTarget] = useState<BedPlace | null>(null);

  // 病棟や日付が変わったらプランは意味を失うので捨てる。
  useEffect(() => {
    setPlan(emptyMovePlan());
  }, [wardId, date]);

  /** 病棟・日付を変える前に、保留中の移動があれば確かめる。 */
  function changeParams(next: Record<string, string>) {
    if (plan.size > 0 && !window.confirm("保留中の移動を破棄します。よろしいですか?")) return;
    setParams(next);
  }

  const [dropTarget, setDropTarget] = useState<DropTarget>(null);

  const resolveDropTarget = useCallback(
    (item: ViewDragItem, clientX: number, clientY: number): DropTarget => {
      const workspace = workspaceRef.current?.getBoundingClientRect();
      if (
        item.kind !== "planned" &&
        workspace &&
        clientX >= workspace.left &&
        clientX <= workspace.right &&
        clientY >= workspace.top &&
        clientY <= workspace.bottom
      ) {
        return { kind: "workspace" };
      }
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect || !layout) return null;
      const { gx, gy } = clientToGrid(rect, layout.grid_size, zoom, clientX, clientY);
      const bed = hitTestBed(layout, Math.floor(gx), Math.floor(gy));
      if (!bed || !bedPlaces.has(bed.location_id)) return null;
      // 入院予定は、サーバー上も保留中の移動先としても空いている床にしか落とせない
      // (入院実施は即書き込みなので、転床プランと同じ床を取り合わない)。
      if (
        item.kind === "planned" &&
        (byBedOriginal.has(bed.location_id) || applied.moveByToBed.has(bed.location_id))
      ) {
        return null;
      }
      return { kind: "bed", bedId: bed.location_id };
    },
    [layout, zoom, bedPlaces, byBedOriginal, applied],
  );

  function handleDrop(state: DragState<ViewDragItem>) {
    const target = resolveDropTarget(state.item, state.x, state.y);
    setDropTarget(null);
    if (!target) return;
    const encounter = state.item.encounter;
    if (state.item.kind === "planned") {
      if (target.kind !== "bed") return;
      const place = bedPlaces.get(target.bedId);
      setExecuteTarget({
        encounter,
        // 入院予定の患者は入院中の一覧には居ないので、予定側の患者から引く。
        patient: planned.data?.patientsById.get(encounterPatientId(encounter) ?? ""),
        initialPlace: { wardId, roomId: place?.room.id ?? "", bedId: target.bedId },
      });
      return;
    }
    setPlan((current) =>
      target.kind === "workspace"
        ? dropOnWorkspace(current, encounter)
        : dropOnBed(current, byBedOriginal, encounter, target.bedId),
    );
  }

  const { drag, start, consumeClick } = useCardDrag<ViewDragItem>({ onDrop: handleDrop });

  useEffect(() => {
    if (!drag) {
      setDropTarget(null);
      return;
    }
    setDropTarget(resolveDropTarget(drag.item, drag.x, drag.y));
  }, [drag, resolveDropTarget]);

  function startBedDrag(encounter: fhir4.Encounter, event: React.PointerEvent) {
    if (!movable) return;
    start({ kind: "bed", encounter }, event);
  }

  /** ドラッグ札に出す患者名(性別・年齢つき)。入院予定は予定側の患者から引く。 */
  function dragPatientLabel(item: ViewDragItem): string {
    const patientId = encounterPatientId(item.encounter) ?? "";
    const patient =
      item.kind === "planned" ? planned.data?.patientsById.get(patientId) : patientsById?.get(patientId);
    if (!patient) return "(患者不明)";
    const age = patient.birthDate ? calculateAge(patient.birthDate) : undefined;
    return `${displayName(patient)} ${genderShortLabel(patient.gender)}${age != null ? ` ${age}` : ""}`.trim();
  }

  /** ドラッグ札に出す元の場所。 */
  function dragOriginLabel(item: ViewDragItem): string {
    if (item.kind === "planned") return "入院予定";
    const place = plan.get(item.encounter.id ?? "")?.toBedId ?? encounterBedId(item.encounter) ?? "";
    return place === WORKSPACE ? "一時退避から" : `${bedLabel(place)} から`;
  }

  function openKarte(patientId: string) {
    if (consumeClick()) return;
    navigate(`/patients/${patientId}/karte`, { state: returnLinkState });
  }

  // ---- 描画 ----

  function renderBed(_object: BedObject, bed: fhir4.Location | undefined, room: fhir4.Location | undefined) {
    const bedId = bed?.id ?? "";
    const encounter = bedId ? applied.byBed.get(bedId) : undefined;
    const patientId = encounter ? encounterPatientId(encounter) : undefined;
    const patient = patientId ? patientsById?.get(patientId) : undefined;
    const movedIn = bedId ? applied.moveByToBed.get(bedId) : undefined;
    const movedAway = bedId ? applied.moveByFromBed.get(bedId) : undefined;

    let state: BedCardState | undefined;
    let note: string | undefined;
    if (dropTarget?.kind === "bed" && dropTarget.bedId === bedId) {
      state = "drop-target";
    } else if (drag && encounter && drag.item.encounter.id === encounter.id) {
      state = "dragging";
    } else if (movedIn) {
      state = "moved-in";
      note = `← ${bedLabel(movedIn.fromBedId)}`;
    } else if (movedAway && !encounter) {
      state = "moved-away";
      note = movedAway.toBedId === WORKSPACE ? "→ 退避" : `→ ${bedLabel(movedAway.toBedId)}`;
    }

    const place = bedId ? bedPlaces.get(bedId) : undefined;
    const pictograms = patientId ? (
      <>
        <CautionPictogramBadges
          flags={flags.byPatient.get(patientId) ?? []}
          cautionsByCode={cautionsByCode}
          patientId={patientId}
          size={16}
        />
        <AllergyPictogramBadges allergies={allergies.byPatient.get(patientId) ?? []} patientId={patientId} size={16} />
        <InfectionPictogramBadge rows={infections.byPatient.get(patientId) ?? []} patientId={patientId} size={16} />
      </>
    ) : undefined;

    const tags: React.ReactNode[] = [];
    if (encounter) {
      const discharge = encounterDischargePlan(encounter);
      if (discharge) tags.push(<span key="discharge" className="ward-map__bed-tag ward-map__bed-tag--discharge">退院予定 {shortDate(discharge.at)}</span>);
      const transfer = encounterTransferPlan(encounter);
      if (transfer) {
        tags.push(
          <span key="transfer" className="ward-map__bed-tag ward-map__bed-tag--transfer">
            転棟予定 {shortDate(transfer.date)} {transfer.wardName}
          </span>,
        );
      }
      if (onLeaveAt(encounter, date)) tags.push(<span key="leave" className="ward-map__bed-tag ward-map__bed-tag--leave">外出泊中</span>);
    }

    // 今日の表示でだけ操作を出す(過去・未来日に対する転床や退院は入院患者一覧で行う)。
    const menu =
      movable && place ? (
        encounter ? (
          <RowMenu label={`${patient ? displayName(patient) : "この患者"} の操作`}>
            {patientId && (
              <Link className="row-menu__item" to={`/patients/${patientId}/karte`} state={returnLinkState}>
                カルテ
              </Link>
            )}
            {(
              [
                ["bedTransfer", "転室・転床"],
                ["leave", "外出泊"],
                ["transferPlan", "転科・転棟予定"],
                ["dischargePlan", "退院予定"],
                ["discharge", "退院"],
              ] as const
            ).map(([kind, label]) => (
              <button
                key={kind}
                type="button"
                className="row-menu__item"
                onClick={() => setRowAction({ kind, encounter, patient, place })}
              >
                {label}
              </button>
            ))}
          </RowMenu>
        ) : (
          <RowMenu label={`${bedPlaceLabel(place)} の操作`}>
            <button type="button" className="row-menu__item" onClick={() => setAdmissionTarget(place)}>
              入院登録
            </button>
          </RowMenu>
        )
      ) : undefined;

    return (
      <WardMapBedCard
        bed={bed}
        roomName={room ? locationDisplayName(room) : ""}
        encounter={encounter}
        patient={patient}
        date={date}
        state={state}
        note={note}
        movable={movable && Boolean(encounter)}
        onPointerDown={encounter ? (event) => startBedDrag(encounter, event) : undefined}
        onOpen={patientId ? () => openKarte(patientId) : undefined}
        pictograms={pictograms}
        tags={tags.length > 0 ? tags : undefined}
        menu={menu}
      />
    );
  }

  return (
    <div className="page ward-map">
      {/* 見出しは置かない。マップは縦を目一杯使う画面で、画面名はメニューから来た
          時点で分かっている(他画面への導線だけをこの行の右端に置く)。 */}
      <div className="ward-map__toolbar">
        <label>
          病棟
          <select value={wardId} onChange={(e) => changeParams({ ward: e.target.value })}>
            {wardOptions.wards.map((ward) => (
              <option key={ward.id} value={ward.id}>
                {locationDisplayName(ward)}
              </option>
            ))}
          </select>
        </label>
        <DateStepper value={date} onChange={(next) => changeParams({ date: next })} />
        <span className="ward-map__counts">
          在床 {counts.occupied} / 空床 {counts.empty} / 全 {counts.total} 床
        </span>
        <span className="ward-map__zoom" role="group" aria-label="表示倍率">
          <button type="button" onClick={viewport.zoomOut} disabled={!viewport.canZoomOut} aria-label="縮小">
            −
          </button>
          <button type="button" onClick={viewport.resetZoom} title="100% に戻す">
            {Math.round(zoom * 100)}%
          </button>
          <button type="button" onClick={viewport.zoomIn} disabled={!viewport.canZoomIn} aria-label="拡大">
            ＋
          </button>
          {layout && (
            <button type="button" onClick={() => viewport.fitToWidth(layout.canvas.width * layout.grid_size)}>
              幅に合わせる
            </button>
          )}
        </span>
        {!movable && <span className="ward-map__readonly">今日以外は閲覧のみ</span>}
        <span className="ward-map__toolbar-links">
          <Link className="button" to={`/inpatients?ward=${wardId}&date=${date}`}>
            入院患者一覧
          </Link>
          {wardId && (
            <Link className="button" to={`/wards/${wardId}/map/edit`}>
              マップを編集
            </Link>
          )}
        </span>
      </div>

      <ErrorBanner
        error={
          wardOptions.error ??
          grid.error ??
          map.error ??
          inpatients.error ??
          planned.error ??
          flags.error ??
          allergies.error ??
          infections.error
        }
      />
      {inpatients.data?.truncated && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--warning">
            入院患者が多く、一部を表示できていません。
          </p>
        </div>
      )}
      {map.isSuccess && !map.data && wardId && (
        <p className="ward-map__notice">
          この病棟のマップはまだ作られていません。病室とベッドを機械的に並べて表示しています。
          <Link to={`/wards/${wardId}/map/edit`}>マップを編集</Link>して保存すると、その配置で表示されます。
        </p>
      )}

      <div className="ward-map__body">
        <div ref={scrollRef} className="ward-map__scroll">
          {layout ? (
            <WardMapCanvas
              layout={layout}
              grid={grid}
              zoom={zoom}
              canvasRef={canvasRef}
              renderBed={renderBed}
              className={drag ? "is-dragging" : ""}
            />
          ) : (
            !map.error && !grid.error && <p className="master-search__empty">読み込み中...</p>
          )}
        </div>
        <div className="ward-map__side">
          {movable && (
            <>
              <WardMapMovePanel
                plan={plan}
                patientName={patientName}
                bedLabel={bedLabel}
                onCancel={(encounterId) => setPlan((current) => cancelMove(current, encounterId))}
                onClear={() => setPlan(emptyMovePlan())}
                onConfirm={() => setConfirming(true)}
              />
              <WardMapWorkspace
                encounters={applied.workspace}
                patientsById={patientsById}
                fromLabel={(encounter) => bedLabel(plan.get(encounter.id ?? "")?.fromBedId ?? "")}
                containerRef={workspaceRef}
                active={dropTarget?.kind === "workspace"}
                onPointerDown={(encounter, event) => start({ kind: "workspace", encounter }, event)}
                onReturn={(encounter) => setPlan((current) => cancelMove(current, encounter.id ?? ""))}
              />
              <WardMapPlannedPanel
                encounters={plannedToday}
                undated={plannedUndated}
                patientsById={planned.data?.patientsById}
                onPointerDown={(encounter, event) => start({ kind: "planned", encounter }, event)}
                onExecute={(encounter) =>
                  setExecuteTarget({
                    encounter,
                    patient: planned.data?.patientsById.get(encounterPatientId(encounter) ?? ""),
                  })
                }
              />
            </>
          )}
          <div className="ward-map__panel">
            <h3>凡例</h3>
            <WardMapLegend items={LEGEND} />
          </div>
        </div>
      </div>

      {rowAction?.kind === "bedTransfer" && (
        <BedTransferModal
          encounter={rowAction.encounter}
          patient={rowAction.patient}
          wardId={wardId}
          currentBedLabel={bedPlaceLabel(rowAction.place)}
          occupiedBedIds={occupiedBedIds}
          onClose={() => setRowAction(null)}
        />
      )}
      {rowAction?.kind === "leave" && (
        <LeaveModal encounter={rowAction.encounter} patient={rowAction.patient} onClose={() => setRowAction(null)} />
      )}
      {rowAction?.kind === "transferPlan" && (
        <TransferPlanModal
          encounter={rowAction.encounter}
          patient={rowAction.patient}
          onClose={() => setRowAction(null)}
        />
      )}
      {rowAction?.kind === "dischargePlan" && (
        <DischargePlanModal
          encounter={rowAction.encounter}
          patient={rowAction.patient}
          onClose={() => setRowAction(null)}
        />
      )}
      {rowAction?.kind === "discharge" && (
        <DischargeModal
          encounter={rowAction.encounter}
          patient={rowAction.patient}
          bedLabel={bedPlaceLabel(rowAction.place)}
          onClose={() => setRowAction(null)}
        />
      )}
      {admissionTarget && (
        <AdmissionModal
          bed={admissionTarget.bed}
          roomName={locationDisplayName(admissionTarget.room)}
          defaultAdmissionDate={date}
          admittedBedLabelByPatientId={admittedBedLabelByPatientId}
          onClose={() => setAdmissionTarget(null)}
        />
      )}
      {executeTarget && (
        <AdmissionExecuteModal
          plan={executeTarget.encounter}
          patient={executeTarget.patient}
          occupiedBedIds={occupiedBedIds}
          admittedBedLabelByPatientId={admittedBedLabelByPatientId}
          initialPlace={executeTarget.initialPlace}
          onClose={() => setExecuteTarget(null)}
        />
      )}

      {/* 掴んでいる間、ポインタに付いて回る札。誰をどこから運んでいるかを示す
          (元のカードは薄くなるので、それだけでは分かりにくい)。押す操作を
          邪魔しないよう pointer-events は切る。 */}
      {drag && (
        <div
          className="ward-map__drag-ghost"
          style={{ left: drag.x + 14, top: drag.y + 14 }}
          aria-hidden="true"
        >
          <span className="ward-map__drag-ghost-name">{dragPatientLabel(drag.item)}</span>
          <span className="ward-map__drag-ghost-from">{dragOriginLabel(drag.item)}</span>
        </div>
      )}

      {confirming && (
        <WardMapMoveConfirmModal
          plan={plan}
          byBedOriginal={byBedOriginal}
          bedPlaces={bedPlaces}
          patientName={patientName}
          onClose={() => setConfirming(false)}
          onCommitted={() => {
            setConfirming(false);
            setPlan(emptyMovePlan());
          }}
        />
      )}
    </div>
  );
}
