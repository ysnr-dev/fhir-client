import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { locationDisplayName } from "../../fhir/locationHelpers";
import { partOfId, PHYSICAL_TYPE_SYSTEM, ROOM_PHYSICAL_TYPE, WARD_PHYSICAL_TYPE, WARD_TYPE_CODE } from "../../fhir/wardHelpers";
import {
  ADMISSION_CLASS_CODE,
  ADMISSION_STATUS,
  buildCancelledEncounter,
  buildDischargedEncounter,
  buildEncounterUpdateBundle,
  DISCHARGED_STATUS,
  encounterBedId,
  type EncounterEvent,
  encounterEvents,
  latestEncounterByBed,
  PLANNED_STATUS,
  sortPlannedAdmissions,
  withEventWards,
} from "../../fhir/encounterHelpers";
import { INJECTION_ORDER_TYPE } from "../../fhir/injectionHelpers";
import { serviceRequestsOf } from "../../fhir/labOrderHelpers";
import {
  groupByRp,
  isPrescriptionServiceRequest,
  ORDER_TYPE_SYSTEM,
  PRESCRIPTION_CATEGORY_SYSTEM,
} from "../../fhir/prescriptionHelpers";
import { rpEndDate } from "../../fhir/medicationScheduleHelpers";
import { type ActiveMedication, ingredientKey } from "../../fhir/medicationSafetyHelpers";
import { rxTasksByOrderId, rxTaskStatus } from "../../fhir/rxTaskHelpers";
import { isMealServiceRequest, MEAL_ORDER_TYPE } from "../../fhir/mealOrderHelpers";
import { buildNursingOrderStopEntries } from "../../fhir/nursingOrderHelpers";
import { buildRehabOrderStopEntries } from "../../fhir/rehabOrderHelpers";
import { buildNutritionGuidanceOrderStopEntries } from "../../fhir/nutritionGuidanceOrderHelpers";
import { SURGERY_ORDER_TYPE } from "../../fhir/surgeryOrderHelpers";
import { isSurgeryProcedure } from "../../fhir/surgeryResultHelpers";
import { type EncounterStay, encounterStays, FLOWSHEET_EXAM_TYPES } from "../../fhir/flowsheetEventHelpers";
import type { FlowsheetInjectionData } from "../../fhir/flowsheetInjectionHelpers";
import type { FlowsheetOralData } from "../../fhir/flowsheetOralHelpers";
import { buildOralPerformDeleteEntries, type OralPerformDisplay } from "../../fhir/oralPerformHelpers";
import { addDays } from "../../fhir/scheduleHelpers";
import { createResource, postBundle, searchResource } from "../fhirClient";
import { fetchYakkaCodes } from "../masterClient";
import { ORAL_LOOKBACK_DAYS, resourcesOfType, searchAllPages, setOrderPeriod } from "./core";
import { splitLocationMatches } from "./location";
import { fetchNursingPerforms, nursingOrderParams, nursingOrderSetOf, nursingPerformParams } from "./nursing";

// ---- 入院(Encounter) ----
//
// 入院は Encounter 1 件で「その患者が今どのベッドに居るか」を表す
// (組み立て方は fhir/encounterHelpers.ts の冒頭)。
//
// 病棟で絞らず院内の入院を全部取ってからベッド id で突き合わせる。上流の
// 多段チェーン検索(location.partof.partof=<病棟>)で病棟で絞る
// こともできるが、件数はベッド総数が上限で高が知れているうえ、全部持っていれば
// 「この患者は既に別の病棟に入院している」の判定も追加のリクエスト無しでできる
// ため、あえて全件のままにしている(病床数が増えて truncated が出るようなら
// チェーン検索で絞る作りに変える)。
//
// 「その日に在院していた患者」を出すので、退院済み(finished)も含めて期間が
// その日に重なるものを引く。FHIR の date 検索は期間に対して eq が「検索値の範囲が
// 対象の期間を完全に含む」と定められていて重なりではないので、重なりは ge と le の
// AND で表す(仕様どおりの書き方であって、上流の制限ではない):
//   date=ge<日> → 退院していない、またはその日以降に退院した
//   date=le<日> → その日までに入院している
// 取り消した入院(entered-in-error)は在院ではないので status で外す。

const INPATIENT_PAGE = 500;
const INPATIENT_MAX_PAGES = 2;

export interface InpatientResult {
  /** ベッド id -> 入院中の Encounter。 */
  byBed: Map<string, fhir4.Encounter>;
  /** 患者 id -> 患者。_include で一緒に取ったもの。 */
  patientsById: Map<string, fhir4.Patient>;
  /** 入院中の Encounter 全件(既入院の判定に使う)。 */
  encounters: fhir4.Encounter[];
  /** 上限ページまで読んでも終わらなかった(表示が欠けている)。 */
  truncated: boolean;
}

export async function fetchInpatients(date: string): Promise<InpatientResult> {
  const encounters: fhir4.Encounter[] = [];
  const patientsById = new Map<string, fhir4.Patient>();
  let truncated = false;

  for (let page = 0; page < INPATIENT_MAX_PAGES; page += 1) {
    const params = new URLSearchParams();
    params.set("status", `${ADMISSION_STATUS},${DISCHARGED_STATUS}`);
    params.set("class", ADMISSION_CLASS_CODE);
    // 同じ名前を 2 回渡すと AND になる(重なりの条件。上のコメント参照)。
    params.append("date", `ge${date}`);
    params.append("date", `le${date}`);
    params.set("_count", String(INPATIENT_PAGE));
    params.set("_offset", String(page * INPATIENT_PAGE));
    // 氏名・カナ・生年月日・性別を出すのに患者の現物が要る。
    params.set("_include", "Encounter:subject");

    const { data: bundle } = await searchResource<fhir4.Resource>("Encounter", params);

    let matched = 0;
    for (const entry of bundle.entry ?? []) {
      const resource = entry.resource;
      if (resource?.resourceType === "Encounter") {
        encounters.push(resource as fhir4.Encounter);
        matched += 1;
      } else if (resource?.resourceType === "Patient" && resource.id) {
        patientsById.set(resource.id, resource as fhir4.Patient);
      }
    }

    if (matched < INPATIENT_PAGE) break;
    if (page === INPATIENT_MAX_PAGES - 1) truncated = true;
  }

  return { byBed: latestEncounterByBed(encounters), patientsById, encounters, truncated };
}

/** ベッドが属する病棟。 */
export interface BedWard {
  wardId: string;
  wardName: string;
}

/**
 * ベッド id -> その病棟。入院中の患者に「入院病棟」を出す/病棟で絞るのに使う。
 *
 * ［事実］入院(Encounter)が記録するのは**ベッドだけ**で、display も「301号室 ベッド1」
 * (bedDisplayName)なので病棟名を含まない。病棟は ベッド → 病室 → 病棟 の partOf を
 * 辿らないと分からない。
 *
 * ［実装］病棟ごとに引くと病棟数だけリクエストが増えるので、**全病棟をまとめて 1 本**で
 * 引く(partof のカンマ OR)。`_revinclude=Location:partof` の子は `_count` の対象外
 * なので、病室のページングだけ見ればベッドは取りこぼさない(fetchWardGrid と同じ作り)。
 */
async function fetchBedWardIndex(): Promise<Map<string, BedWard>> {
  const wardParams = new URLSearchParams();
  wardParams.set("type", WARD_TYPE_CODE);
  wardParams.set("status", "active");
  wardParams.set("_count", "100");
  const { data: wardBundle } = await searchResource<fhir4.Location>("Location", wardParams);
  const wards =
    wardBundle.entry
      ?.map((e) => e.resource)
      .filter((r): r is fhir4.Location => r?.resourceType === "Location") ?? [];
  if (wards.length === 0) return new Map();

  const PAGE = 100;
  const rooms: fhir4.Location[] = [];
  const beds: fhir4.Location[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const params = new URLSearchParams();
    params.set("partof", wards.map((ward) => `Location/${ward.id}`).join(","));
    params.set("_count", String(PAGE));
    params.set("_offset", String(offset));
    params.set("_revinclude", "Location:partof");

    const { data: bundle } = await searchResource<fhir4.Resource>("Location", params);
    const { matches, children } = splitLocationMatches(bundle);
    rooms.push(...matches);
    beds.push(...children);
    if (matches.length < PAGE) break;
  }

  // 病室は途中のページに散るので、全ページ読み終えてから突き合わせる。
  const wardById = new Map(wards.map((ward) => [ward.id ?? "", ward]));
  const wardIdByRoom = new Map<string, string>();
  for (const room of rooms) {
    const wardId = partOfId(room);
    if (room.id && wardId) wardIdByRoom.set(room.id, wardId);
  }

  const index = new Map<string, BedWard>();
  for (const bed of beds) {
    const roomId = partOfId(bed);
    const wardId = roomId ? wardIdByRoom.get(roomId) : undefined;
    const ward = wardId ? wardById.get(wardId) : undefined;
    if (!bed.id || !ward?.id) continue;
    index.set(bed.id, { wardId: ward.id, wardName: locationDisplayName(ward) });
  }
  return index;
}

export function useBedWardIndex() {
  const query = useQuery({
    queryKey: ["Location", "bed-ward-index"],
    queryFn: fetchBedWardIndex,
    // 病棟の構成は日に何度も変わらない。開くたびに引き直さない。
    staleTime: 5 * 60 * 1000,
  });
  return { ...query, bedWards: query.data ?? new Map<string, BedWard>() };
}

/** date(YYYY-MM-DD)にベッドを使っていた入院。既定は当日ぶん。 */
export function useInpatientEncounters(date: string) {
  return useQuery({
    queryKey: ["Encounter", "inpatients", date],
    queryFn: () => fetchInpatients(date),
    enabled: Boolean(date),
    placeholderData: keepPreviousData,
  });
}

/**
 * 病棟マップの転床の一括確定。組み立て済みの transaction Bundle(複数の Encounter の PUT)を
 * そのまま送る。組み立ては fhir/bedMovePlanHelpers.ts。
 */
export function useCommitBedMoves() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Encounter"] });
    },
  });
}

/** 空きベッドへの入院登録。 */
export function useAdmitPatient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (encounter: fhir4.Encounter) => createResource(encounter),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Encounter"] });
    },
  });
}

/**
 * 退院。入院を終える(記録は status=finished + 退院日時として残る)。継続する食事・
 * リハビリ・栄養指導・看護指示を一緒に止められる(退院後も食事が出続けたり、終わった
 * はずのリハビリが部門一覧に並び続けるのを防ぐ)。入院の書き換えと同じ transaction に
 * 載せるので、退院だけ通ってオーダーが残ることはない。
 *
 * 食事のエントリは画面が fhir/mealEncounterSync で組んで渡す(退院時刻までに出た
 * 最後の食事で止め、退院予定で止めていたものは理由を退院に上書きする)。
 */
export function useDischargePatient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      encounter,
      dischargeAt,
      mealEntries = [],
      rehabOrders = [],
      nutritionGuidanceOrders = [],
      nursingOrders = [],
      extraEntries = [],
    }: {
      encounter: fhir4.Encounter;
      /** 退院日時(YYYY-MM-DDTHH:mm)。 */
      dischargeAt: string;
      /** 退院と同じ transaction に載せるその他の entry(退院時サマリーの督促 Task など)。 */
      extraEntries?: fhir4.BundleEntry[];
      /** 食事オーダーの連動エントリ(buildDischargeSyncEntries)。画面で外したときは空。 */
      mealEntries?: fhir4.BundleEntry[];
      /** 一緒に終了させるリハビリオーダー。退院日を終了日にする。 */
      rehabOrders?: fhir4.ServiceRequest[];
      /** 一緒に終了させる栄養指導オーダー。退院日を終了日にする。 */
      nutritionGuidanceOrders?: fhir4.ServiceRequest[];
      /** 一緒に終了させる看護指示。退院日を終了日にする(指示受け Task は触らない)。 */
      nursingOrders?: fhir4.ServiceRequest[];
    }) => {
      const dischargeDate = dischargeAt.slice(0, 10);
      return postBundle(
        buildEncounterUpdateBundle(buildDischargedEncounter(encounter, dischargeAt), [
          ...mealEntries,
          // リハビリは食事と違い時間帯を持たないので、退院日をそのまま終了日にする。
          // 進捗 Task はここでは触らない(部門が「終了」で締める。オーダーに終了日が
          // 入っていれば翌日以降の部門一覧には出てこない)。
          ...buildRehabOrderStopEntries(rehabOrders, dischargeDate),
          // 栄養指導もリハビリと同じ期間継続型なので同じ扱い。
          ...buildNutritionGuidanceOrderStopEntries(nutritionGuidanceOrders, dischargeDate),
          ...buildNursingOrderStopEntries(nursingOrders, dischargeDate),
          ...extraEntries,
        ]),
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Encounter"] });
      // 食事・リハビリの終了もこの transaction で書いているので読み直させる。
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest"] });
      // 退院時サマリーの督促(通知 Task)と持参薬の鑑別依頼。
      queryClient.invalidateQueries({ queryKey: ["Task"] });
      // 持参薬を退院で終了にする。
      queryClient.invalidateQueries({ queryKey: ["MedicationStatement"] });
    },
  });
}

/** 入院登録の取り消し(誤登録)。退院とは別物なので退院日は残さない。 */
export function useCancelAdmission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (encounter: fhir4.Encounter) =>
      postBundle(buildEncounterUpdateBundle(buildCancelledEncounter(encounter))),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Encounter"] });
    },
  });
}

/**
 * 組み立て済みの Encounter で上書きする汎用の更新。入院実施・予定取消・転室・
 * 外出泊・転科転棟予定・退院予定のように「helpers で書き換えた 1 件を保存する」
 * 操作をまとめて受ける。
 *
 * 外出泊・退院予定のように食事オーダーも一緒に書くときは `{ encounter, extraEntries }` で
 * 渡す(同じ transaction に載る)。
 */
export function useUpdateEncounter() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (
      input: fhir4.Encounter | { encounter: fhir4.Encounter; extraEntries: fhir4.BundleEntry[] },
    ) =>
      "resourceType" in input
        ? postBundle(buildEncounterUpdateBundle(input))
        : postBundle(buildEncounterUpdateBundle(input.encounter, input.extraEntries)),
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: ["Encounter"] });
      if (!("resourceType" in input) && input.extraEntries.length > 0) {
        queryClient.invalidateQueries({ queryKey: ["ServiceRequest"] });
      }
    },
  });
}

export interface PlannedAdmissionsResult {
  /** 入院予定の Encounter。日付未定を先頭に、あとは入院予定日順。 */
  encounters: fhir4.Encounter[];
  patientsById: Map<string, fhir4.Patient>;
  truncated: boolean;
}

// 入院予定は日付で絞れない(予定日はどこまでも先があり得る)ので全件取る。
// ページングの形は fetchInpatients と同じ。
async function fetchPlannedAdmissions(): Promise<PlannedAdmissionsResult> {
  const encounters: fhir4.Encounter[] = [];
  const patientsById = new Map<string, fhir4.Patient>();
  let truncated = false;

  for (let page = 0; page < INPATIENT_MAX_PAGES; page += 1) {
    const params = new URLSearchParams();
    params.set("status", PLANNED_STATUS);
    params.set("class", ADMISSION_CLASS_CODE);
    // 入院予定日(period.start)の早い順。
    params.set("_sort", "date");
    params.set("_count", String(INPATIENT_PAGE));
    params.set("_offset", String(page * INPATIENT_PAGE));
    params.set("_include", "Encounter:subject");

    const { data: bundle } = await searchResource<fhir4.Resource>("Encounter", params);

    let matched = 0;
    for (const entry of bundle.entry ?? []) {
      const resource = entry.resource;
      if (resource?.resourceType === "Encounter") {
        encounters.push(resource as fhir4.Encounter);
        matched += 1;
      } else if (resource?.resourceType === "Patient" && resource.id) {
        patientsById.set(resource.id, resource as fhir4.Patient);
      }
    }

    if (matched < INPATIENT_PAGE) break;
    if (page === INPATIENT_MAX_PAGES - 1) truncated = true;
  }

  return { encounters: sortPlannedAdmissions(encounters), patientsById, truncated };
}

/** 入院予定(status=planned)の一覧。 */
export function usePlannedAdmissions() {
  return useQuery({
    queryKey: ["Encounter", "planned-admissions"],
    queryFn: fetchPlannedAdmissions,
    placeholderData: keepPreviousData,
  });
}

// ---- カルテの患者情報に出す入院 ----
//
// 「その患者が今どの病棟・病室に入院しているか」を患者 id だけで引く。入院患者一覧と
// 違って病棟が分かっていないので、Encounter が指すベッドから partOf を辿って
// 病室名・病棟名を取る(Encounter に控えた display は「301号室 ベッド1」の書き方で、
// 病棟名も入っていないのでここでは使わない)。

export interface PatientAdmission {
  encounter: fhir4.Encounter;
  /** 病棟の Location.id。辿れなければ空文字。オーダーに焼き付ける病棟の参照に使う。 */
  wardId: string;
  /** 病棟名。辿れなければ空文字。 */
  wardName: string;
  /** 病室名。辿れなければ空文字。 */
  roomName: string;
}

async function fetchPatientAdmission(patientId: string): Promise<PatientAdmission | null> {
  const params = new URLSearchParams();
  params.set("subject", `Patient/${patientId}`);
  params.set("status", ADMISSION_STATUS);
  params.set("class", ADMISSION_CLASS_CODE);
  params.set("_count", "10");

  const { data: bundle } = await searchResource<fhir4.Encounter>("Encounter", params);
  const encounters =
    bundle.entry
      ?.map((e) => e.resource)
      .filter((r): r is fhir4.Encounter => r?.resourceType === "Encounter") ?? [];
  // 同じ患者に入院中が 2 件並ぶことは無い想定だが、あれば入院日が新しい方を採る
  // (データがおかしくてもカルテの見出しが壊れないように)。
  const encounter = encounters.reduce<fhir4.Encounter | undefined>(
    (latest, current) =>
      !latest || (current.period?.start ?? "") > (latest.period?.start ?? "") ? current : latest,
    undefined,
  );
  if (!encounter) return null;

  const bedId = encounterBedId(encounter);
  if (!bedId) return { encounter, wardId: "", wardName: "", roomName: "" };

  // ベッドと、その上の病室・病棟をまとめて引く。階層は physicalType(wa/ro/bd)で見分ける。
  const locationParams = new URLSearchParams();
  locationParams.set("_id", bedId);
  locationParams.append("_include", "Location:partof");
  locationParams.append("_include:iterate", "Location:partof");

  const { data: locationBundle } = await searchResource<fhir4.Location>(
    "Location",
    locationParams,
  );
  const locations =
    locationBundle.entry
      ?.map((e) => e.resource)
      .filter((r): r is fhir4.Location => r?.resourceType === "Location") ?? [];
  const ofType = (code: string) =>
    locations.find((location) =>
      location.physicalType?.coding?.some(
        (coding) => coding.system === PHYSICAL_TYPE_SYSTEM && coding.code === code,
      ),
    );

  const room = ofType(ROOM_PHYSICAL_TYPE.code);
  const ward = ofType(WARD_PHYSICAL_TYPE.code);

  return {
    encounter,
    wardId: ward?.id ?? "",
    wardName: ward?.name ?? "",
    roomName: room?.name ?? "",
  };
}

/** 患者が入院中ならその入院と病棟名。入院していなければ null。 */
export function usePatientAdmission(patientId: string | undefined) {
  return useQuery({
    queryKey: ["Encounter", "patient-admission", patientId],
    queryFn: () => fetchPatientAdmission(patientId as string),
    enabled: Boolean(patientId),
  });
}

/**
 * その期間にかかる入院(入院中・退院済)から、イベントと入院期間を取り出す。
 * date を ge/le で 2 回渡して「期間が範囲と重なる」入院を引く(fetchInpatients と同じ手)。
 * 誤登録(entered-in-error)と入院予定はイベントにならないので status で外す。
 *
 * 食事カレンダー(月の暦の印)と経過表(イベントの帯・病日)の両方が使う。
 * イベントは範囲内に絞るが、**入院期間は絞らない**。範囲より前に始まった入院でも、
 * 範囲内の列の病日を数えるのに要るため。
 */
export function usePatientEncounterEvents(
  patientId: string | undefined,
  rangeStart: string,
  rangeEnd: string,
) {
  const params = new URLSearchParams();
  if (patientId) params.set("subject", `Patient/${patientId}`);
  params.set("status", `${ADMISSION_STATUS},${DISCHARGED_STATUS}`);
  params.set("class", ADMISSION_CLASS_CODE);
  params.append("date", `ge${rangeStart}`);
  params.append("date", `le${rangeEnd}`);
  params.set("_sort", "-date");
  params.set("_count", String(INPATIENT_PAGE));

  return useQuery({
    queryKey: ["Encounter", "patient-events", patientId, rangeStart, rangeEnd],
    queryFn: async (): Promise<{ events: EncounterEvent[]; stays: EncounterStay[] }> => {
      const { data: bundle } = await searchResource<fhir4.Encounter>("Encounter", params);
      const encounters =
        bundle.entry
          ?.map((e) => e.resource)
          .filter((r): r is fhir4.Encounter => r?.resourceType === "Encounter") ?? [];
      const events = encounters
        .flatMap((encounter) => encounterEvents(encounter))
        .filter((event) => event.date >= rangeStart && event.date <= rangeEnd);
      const bedIds = Array.from(
        new Set(events.flatMap((e) => [e.bedId, e.fromBedId]).filter((id): id is string => !!id)),
      );
      return {
        events: withEventWards(events, await fetchWardNameByBed(bedIds)),
        stays: encounterStays(encounters),
      };
    },
    enabled: Boolean(patientId) && Boolean(rangeStart) && Boolean(rangeEnd),
  });
}

/**
 * 経過表のイベントの帯に出す手術の実施記録(ハブ Procedure)。
 *
 * 手術は performedPeriod を持ち、上流の `date` は期間として索引しているので、
 * from〜to に掛かる手術だけを引く(術後日数の行のために表示期間より前の手術も要るので、
 * 呼び出し側が from を術後日数の上限ぶん前にずらす)。
 */
export function usePatientSurgeryPerforms(patientId: string | undefined, from: string, to: string) {
  return useQuery({
    queryKey: ["Procedure", "search", "surgery-patient", patientId, from, to],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("patient", `Patient/${patientId}`);
      params.set("category", `${ORDER_TYPE_SYSTEM}|${SURGERY_ORDER_TYPE.code}`);
      params.append("date", `ge${from}`);
      params.append("date", `le${to}`);
      // 2 件目以降の術式(partOf 付き)はハブと同じ日時なので、ハブだけをイベントにする。
      params.set("part-of:missing", "true");
      params.set("status:not", "entered-in-error,not-done");
      params.set("_count", "100");
      const { data: bundle } = await searchResource<fhir4.Procedure>("Procedure", params);
      return resourcesOfType<fhir4.Procedure>(bundle, "Procedure").filter(isSurgeryProcedure);
    },
    enabled: Boolean(patientId) && Boolean(from) && Boolean(to),
  });
}

/**
 * オーダーと、薬剤・進捗・実施記録(ハブの Procedure と薬剤ごとの MedicationAdministration)を
 * 1 つの検索で揃える。経過表・注射カレンダーは期間ぶんを読むので、ページを辿って全件読む。
 */
async function fetchOrdersWithPerforms(params: URLSearchParams): Promise<FlowsheetInjectionData> {
  params.append("_revinclude", "MedicationRequest:based-on");
  params.append("_revinclude", "Task:focus");
  params.append("_revinclude", "Procedure:based-on");
  params.append("_revinclude:iterate", "MedicationAdministration:part-of");
  const { matches, bundles } = await searchAllPages<fhir4.ServiceRequest>("ServiceRequest", params, {
    page: 500,
    maxPages: 4,
  });
  const of = <T extends fhir4.Resource>(type: T["resourceType"]) =>
    bundles.flatMap((bundle) => resourcesOfType<T>(bundle, type));
  return {
    orders: matches,
    medicationRequests: of<fhir4.MedicationRequest>("MedicationRequest"),
    tasks: of<fhir4.Task>("Task"),
    procedures: of<fhir4.Procedure>("Procedure"),
    administrations: of<fhir4.MedicationAdministration>("MedicationAdministration"),
  };
}

/**
 * 経過表の注射欄と注射カレンダーに出す、その期間の注射オーダー一式。
 *
 * 注射は 1 施行(= 1 日)= 1 ServiceRequest で、薬剤(用法・開始時刻)・進捗・実施記録が
 * それぞれ別リソースに分かれる(fetchOrdersWithPerforms で揃える)。
 */
export function usePatientInjectionOrders(
  patientId: string | undefined,
  rangeStart: string,
  rangeEnd: string,
) {
  return useQuery({
    queryKey: ["ServiceRequest", "search", "flowsheet-injections", patientId, rangeStart, rangeEnd],
    queryFn: async (): Promise<FlowsheetInjectionData> => {
      const params = new URLSearchParams();
      params.set("patient", `Patient/${patientId}`);
      params.set("category", `${ORDER_TYPE_SYSTEM}|${INJECTION_ORDER_TYPE.code}`);
      params.set("based-on:missing", "true");
      params.append("occurrence", `ge${rangeStart}`);
      params.append("occurrence", `le${rangeEnd}`);
      return fetchOrdersWithPerforms(params);
    },
    enabled: Boolean(patientId) && Boolean(rangeStart) && Boolean(rangeEnd),
  });
}

/**
 * 注射カレンダーのマスから開くモーダルに出す注射(1 日分)。比べる前の日のオーダーも一緒に読む。
 * 中身は usePatientInjectionOrders と同じ組み(オーダー・薬剤・進捗・実施記録)。
 */
export function useInjectionDayOrders(srIds: string[]) {
  const ids = srIds.filter(Boolean);
  return useQuery({
    queryKey: ["ServiceRequest", "search", "injection-day", ids.join(",")],
    queryFn: async (): Promise<FlowsheetInjectionData> => {
      const params = new URLSearchParams();
      params.set("_id", ids.join(","));
      return fetchOrdersWithPerforms(params);
    },
    enabled: ids.length > 0,
  });
}

/**
 * 経過表の内服欄に出す、その期間にかかる入院処方と与薬の記録。
 *
 * 処方の ServiceRequest は order-type の category を持たない(持たないこと自体が処方の
 * 印)ので、注射のように種別で絞れない。処方だけが持つ `PRESCRIPTION_CATEGORY_SYSTEM` を
 * **system だけ指定**して絞り(処方ワークリストと同じ手)、入外区分と処方かどうかの最終
 * 判定はクライアントで行う。
 *
 * 処方は 1 件が投与日数ぶん続くので、期間の開始より前に始まったものも要る。投与日数は
 * 上流で索引できないため、下限は「期間の開始 − 92 日」で引く(注射の連日展開の上限
 * 90 日に合わせた経験則。これを超える長期処方は期間を過去に送れば読める)。
 */
export function usePatientOralPrescriptions(
  patientId: string | undefined,
  rangeStart: string,
  rangeEnd: string,
) {
  return useQuery({
    queryKey: ["ServiceRequest", "search", "flowsheet-oral", patientId, rangeStart, rangeEnd],
    queryFn: async (): Promise<FlowsheetOralData> => {
      const params = new URLSearchParams();
      params.set("patient", `Patient/${patientId}`);
      params.set("category", `${PRESCRIPTION_CATEGORY_SYSTEM}|`);
      params.append("occurrence", `ge${addDays(rangeStart, -ORAL_LOOKBACK_DAYS)}`);
      params.append("occurrence", `le${rangeEnd}`);
      return fetchOrdersWithPerforms(params);
    },
    enabled: Boolean(patientId) && Boolean(rangeStart) && Boolean(rangeEnd),
  });
}

/**
 * 重複投与チェック(`docs/order-common-backlog.md` §3)に使う、基準日に効いている処方の薬剤。
 *
 * 処方の絞り込みは経過表の内服欄と同じ手(`usePatientOralPrescriptions` のコメント)。
 * 投与日数は上流で索引できないので基準日の 92 日前から引き、効いているかどうかは
 * 投与終了日(`rpEndDate`)を出してクライアントで判定する。中止した処方は数えない。
 */
export function useActiveMedications(patientId: string | undefined, onDate: string) {
  const rangeStart = onDate ? addDays(onDate, -ORAL_LOOKBACK_DAYS) : "";

  const query = useQuery({
    queryKey: ["ServiceRequest", "search", "active-medications", patientId, onDate],
    queryFn: async (): Promise<ActiveMedication[]> => {
      const params = new URLSearchParams();
      params.set("patient", `Patient/${patientId}`);
      params.set("category", `${PRESCRIPTION_CATEGORY_SYSTEM}|`);
      params.append("occurrence", `ge${rangeStart}`);
      params.append("occurrence", `le${onDate}`);
      params.append("_revinclude", "MedicationRequest:based-on");
      params.append("_revinclude", "Task:focus");
      params.set("_sort", "occurrence");

      const { bundles } = await searchAllPages<fhir4.ServiceRequest>("ServiceRequest", params, {
        page: 500,
        maxPages: 2,
      });
      const resources = bundles.flatMap((bundle) =>
        (bundle.entry ?? []).map((entry) => entry.resource).filter((r): r is fhir4.Resource => Boolean(r)),
      );
      const orders = resources
        .filter((r): r is fhir4.ServiceRequest => r.resourceType === "ServiceRequest")
        .filter(isPrescriptionServiceRequest);
      const medicationRequests = resources.filter(
        (r): r is fhir4.MedicationRequest => r.resourceType === "MedicationRequest",
      );
      const tasksByOrder = rxTasksByOrderId(
        resources.filter((r): r is fhir4.Task => r.resourceType === "Task"),
      );

      const active: ActiveMedication[] = [];
      const lines: {
        orderId: string;
        name: string;
        endDate: string;
        medicine: { yj_code?: string | null; medicine_code: string; generic?: boolean };
      }[] = [];
      for (const order of orders) {
        if (!order.id) continue;
        if (rxTaskStatus(tasksByOrder.get(order.id)) === "cancelled") continue;
        const startDate = (order.occurrenceDateTime ?? "").slice(0, 10);
        if (!startDate) continue;
        const mrs = medicationRequests.filter((mr) =>
          mr.basedOn?.some((ref) => ref.reference === `ServiceRequest/${order.id}`),
        );
        for (const rp of groupByRp(mrs)) {
          const endDate = rpEndDate(startDate, rp) ?? startDate;
          if (endDate < onDate) continue;
          for (const line of rp.medicines) {
            lines.push({
              orderId: order.id,
              name: line.name,
              endDate,
              medicine: { yj_code: line.yjCode, medicine_code: line.code, generic: line.generic },
            });
          }
        }
      }

      // YJ コードを持たない薬(統一名収載品など)は、医薬品マスタの薬価基準コードで成分を補う。
      const missing = lines
        .filter((l) => !ingredientKey(l.medicine) && l.medicine.medicine_code)
        .map((l) => l.medicine.medicine_code);
      const yakkaCodes = missing.length > 0 ? await fetchYakkaCodes(missing) : new Map<string, string>();

      for (const line of lines) {
        const ingredient = ingredientKey({
          ...line.medicine,
          yakka_code: yakkaCodes.get(line.medicine.medicine_code),
        });
        if (!ingredient) continue;
        active.push({ orderId: line.orderId, name: line.name, ingredient, endDate: line.endDate });
      }
      return active;
    },
    enabled: Boolean(patientId) && Boolean(onDate),
    staleTime: 30 * 1000,
  });

  return { ...query, medications: query.data ?? [] };
}

/** 与薬の記録(1 枠ぶん)。ハブと薬剤の記録を 1 transaction で作る。 */
export function useRegisterOralPerform() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
    },
  });
}

/** 与薬の取消。記録ごと消す(進捗 Task は動かしていないので戻す先が無い)。 */
export function useCancelOralPerforms() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (performs: OralPerformDisplay[]) =>
      postBundle({
        resourceType: "Bundle",
        type: "transaction",
        entry: buildOralPerformDeleteEntries(performs),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
    },
  });
}

/**
 * 経過表の看護欄に出す、その期間に有効な看護指示と実施記録。
 *
 * 指示は「期間 + 頻度」で持ち日時を持たないので、期間に掛かっているものを
 * order-period で引く。実施は Observation(観察)と Procedure(行為)に分かれるので、
 * 既存の `useNursingPerformsOf` と同じ取り方をする。
 */
export function usePatientNursingFlowsheet(
  patientId: string | undefined,
  rangeStart: string,
  rangeEnd: string,
) {
  return useQuery({
    queryKey: ["ServiceRequest", "search", "flowsheet-nursing", patientId, rangeStart, rangeEnd],
    queryFn: async () => {
      const params = nursingOrderParams(patientId, "active");
      setOrderPeriod(params, rangeStart, rangeEnd);
      // 実施は**表示している期間だけ**引く(患者の全期間を引くと、長期入院で
      // 200 件の上限に当たって古い記録しか返らない)。
      const setRange = (p: URLSearchParams) => {
        p.set("patient", `Patient/${patientId}`);
        p.append("date", `ge${rangeStart}`);
        p.append("date", `le${rangeEnd}`);
      };
      const observationParams = nursingPerformParams();
      setRange(observationParams);

      const [{ data: bundle }, performsByOrderId, { data: observationBundle }] = await Promise.all([
        searchResource<fhir4.Resource>("ServiceRequest", params),
        fetchNursingPerforms(setRange),
        // 水分出納は値(mL)を足すので、整形前の Observation も要る。
        searchResource<fhir4.Observation>("Observation", observationParams),
      ]);
      const set = nursingOrderSetOf(bundle);
      return {
        orders: set.orders,
        performsByOrderId,
        observations: resourcesOfType<fhir4.Observation>(observationBundle, "Observation"),
      };
    },
    enabled: Boolean(patientId) && Boolean(rangeStart) && Boolean(rangeEnd),
  });
}

/**
 * 経過表の食事摂取量。期間にかかる食事オーダーと、記録の Observation を引く。
 *
 * 食事オーダーは継続オーダーで、前の月から続いているものがその日の食事を決めている
 * ことがあるので、`useMealOrderMonth` と同じく期間に掛かっているオーダーを引く。
 */
export function usePatientMealIntake(
  patientId: string | undefined,
  rangeStart: string,
  rangeEnd: string,
) {
  return useQuery({
    queryKey: ["ServiceRequest", "search", "flowsheet-meal", patientId, rangeStart, rangeEnd],
    queryFn: async () => {
      const orderParams = new URLSearchParams();
      orderParams.set("subject", `Patient/${patientId}`);
      orderParams.set("category", `${ORDER_TYPE_SYSTEM}|${MEAL_ORDER_TYPE.code}`);
      orderParams.set("status", "active");
      setOrderPeriod(orderParams, rangeStart, rangeEnd);
      orderParams.set("_count", "100");

      const observationParams = new URLSearchParams();
      observationParams.set("patient", `Patient/${patientId}`);
      observationParams.set("category", `${ORDER_TYPE_SYSTEM}|${MEAL_ORDER_TYPE.code}`);
      observationParams.append("date", `ge${rangeStart}`);
      observationParams.append("date", `le${rangeEnd}`);
      observationParams.set("_count", "200");

      const [{ data: orderBundle }, { data: observationBundle }] = await Promise.all([
        searchResource<fhir4.ServiceRequest>("ServiceRequest", orderParams),
        searchResource<fhir4.Observation>("Observation", observationParams),
      ]);
      return {
        orders: serviceRequestsOf(orderBundle).filter(isMealServiceRequest),
        observations: resourcesOfType<fhir4.Observation>(observationBundle, "Observation"),
      };
    },
    enabled: Boolean(patientId) && Boolean(rangeStart) && Boolean(rangeEnd),
  });
}

/** 食事摂取量の記録(1 食ぶん)。作成・上書き・削除を 1 transaction で送る。 */
export function useSaveMealIntake() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search", "flowsheet-meal"] });
    },
  });
}

/**
 * 経過表のイベントの帯に出す検査オーダー(放射線・内視鏡・生理)のヘッダ。
 * 検体・細菌・病理は患者が動かないうえ毎日の採血で帯が埋まるので出さない
 * (そちらは検体検査時系列タブに表がある)。
 */
export function usePatientExamOrders(
  patientId: string | undefined,
  rangeStart: string,
  rangeEnd: string,
) {
  return useQuery({
    queryKey: ["ServiceRequest", "search", "flowsheet-exams", patientId, rangeStart, rangeEnd],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("patient", `Patient/${patientId}`);
      params.set(
        "category",
        FLOWSHEET_EXAM_TYPES.map((type) => `${ORDER_TYPE_SYSTEM}|${type.code}`).join(","),
      );
      // 日時を持つのはヘッダだけ(明細は持たない)。ヘッダは code も持たないので、
      // 検査名はぶら下がる明細から採る(イベント一覧の「内容」に出す)。
      params.set("based-on:missing", "true");
      params.append("occurrence", `ge${rangeStart}`);
      params.append("occurrence", `le${rangeEnd}`);
      params.set("status:not", "revoked,entered-in-error");
      params.set("_count", "100");
      params.append("_revinclude:iterate", "ServiceRequest:based-on");
      // 実施記録(ハブ Procedure)。予定と実施を印で塗り分けるのに使う。
      params.append("_revinclude", "Procedure:based-on");
      const { data: bundle } = await searchResource<fhir4.Resource>("ServiceRequest", params);
      const resources = (bundle.entry ?? [])
        .map((entry) => entry.resource)
        .filter((r): r is fhir4.Resource => Boolean(r));
      // status の条件はヘッダにしか掛からないので、_revinclude で届く明細にも同じ条件を掛ける。
      const all = resources
        .filter((r): r is fhir4.ServiceRequest => r.resourceType === "ServiceRequest")
        .filter((sr) => sr.status !== "revoked" && sr.status !== "entered-in-error");
      // _revinclude で明細も混ざって返るので、ヘッダ(basedOn 無し)と分けて返す。
      return {
        headers: all.filter((sr) => !sr.basedOn?.length),
        items: all.filter((sr) => sr.basedOn?.length),
        procedures: resources.filter(
          (r): r is fhir4.Procedure => r.resourceType === "Procedure",
        ),
      };
    },
    enabled: Boolean(patientId) && Boolean(rangeStart) && Boolean(rangeEnd),
  });
}

/** ベッド id → 病棟名。ベッドと親の病室・病棟をまとめて引き、partOf を 2 段辿る。 */
export async function fetchWardNameByBed(bedIds: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (bedIds.length === 0) return result;

  const params = new URLSearchParams();
  params.set("_id", bedIds.join(","));
  params.append("_include", "Location:partof");
  params.append("_include:iterate", "Location:partof");
  params.set("_count", String(bedIds.length));
  const { data: bundle } = await searchResource<fhir4.Location>("Location", params);
  const byId = new Map<string, fhir4.Location>();
  for (const entry of bundle.entry ?? []) {
    const r = entry.resource;
    if (r?.resourceType === "Location" && r.id) byId.set(r.id, r);
  }

  for (const bedId of bedIds) {
    const bed = byId.get(bedId);
    const roomId = bed ? partOfId(bed) : undefined;
    const room = roomId ? byId.get(roomId) : undefined;
    const ward = room ? byId.get(partOfId(room) ?? "") : undefined;
    if (ward?.name) result.set(bedId, ward.name);
  }
  return result;
}
