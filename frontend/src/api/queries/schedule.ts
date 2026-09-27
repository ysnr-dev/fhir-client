import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addDays,
  buildSlotCreateBundle,
  buildSlotDeleteBundle,
  SERVICE_TYPE_SYSTEM as SCHEDULE_SERVICE_TYPE_SYSTEM,
  type ScheduleType,
  scheduleTypeOf,
  type SlotStatus,
} from "../../fhir/scheduleHelpers";
import {
  createResource,
  deleteResource,
  postBundle,
  readResource,
  searchResource,
  updateResource,
} from "../fhirClient";
import { fetchDateCounts } from "./core";
import { hasRelation } from "./patient";

// ---- 予約枠(Schedule / Slot) ----

export interface ScheduleSearchParams {
  /** 担当医の Practitioner.id。 */
  practitionerId?: string;
  /** 診察室の Location.id。 */
  locationId?: string;
  /** 使わなくなった枠表は削除せず active=false にするので、既定は有効のみ。 */
  activeOnly?: boolean;
}

const SCHEDULE_COUNT = 20;

export function useScheduleSearch(search: ScheduleSearchParams, offset: number) {
  const params = new URLSearchParams();
  // actor は参照先の型を明示して渡す(既定の参照先は Practitioner)。
  if (search.practitionerId) params.append("actor", `Practitioner/${search.practitionerId}`);
  if (search.locationId) params.append("actor", `Location/${search.locationId}`);
  if (search.activeOnly) params.set("active", "true");
  params.set("_count", String(SCHEDULE_COUNT));
  params.set("_offset", String(offset));

  const query = useQuery({
    queryKey: ["Schedule", "search", search, offset],
    queryFn: () => searchResource<fhir4.Schedule>("Schedule", params),
    placeholderData: keepPreviousData,
  });

  return {
    ...query,
    schedules:
      query.data?.data.entry
        ?.map((e) => e.resource)
        .filter((r): r is fhir4.Schedule => Boolean(r)) ?? [],
    total: query.data?.data.total ?? 0,
    count: SCHEDULE_COUNT,
    hasPrevious: hasRelation(query.data?.data, "previous"),
    hasNext: hasRelation(query.data?.data, "next"),
  };
}

export function useSchedule(id: string | undefined) {
  return useQuery({
    queryKey: ["Schedule", id],
    queryFn: () => readResource<fhir4.Schedule>("Schedule", id as string),
    enabled: Boolean(id),
  });
}

export function useCreateSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (schedule: fhir4.Schedule) => createResource(schedule),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Schedule"] });
    },
  });
}

export function useUpdateSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ schedule, etag }: { schedule: fhir4.Schedule; etag: string }) =>
      updateResource(schedule, etag),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Schedule"] });
    },
  });
}

/**
 * 枠表を削除する。上流は参照整合性を見ないので、先にぶら下がる Slot を消さないと
 * どの枠表にも属さない Slot が残る。予約の入った枠があるときは何も消さずに中断する
 * (予約の取消が先。予約の管理はこの画面の担当ではない)。
 */
export function useDeleteSchedule() {
  const queryClient = useQueryClient();
  const CHUNK = 100;

  return useMutation({
    mutationFn: async (id: string) => {
      const slots = await fetchScheduleSlots(id);
      if (slots.some((slot) => slot.status === "busy" || slot.status === "busy-tentative")) {
        throw new Error(
          "予約が入っている枠があるため削除できません。予約を取り消してから削除してください。",
        );
      }

      for (let i = 0; i < slots.length; i += CHUNK) {
        await postBundle(buildSlotDeleteBundle(slots.slice(i, i + CHUNK)));
      }
      return deleteResource("Schedule", id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Schedule"] });
      queryClient.invalidateQueries({ queryKey: ["Slot"] });
    },
  });
}

// 枠表にぶら下がる Slot。R4 は Slot.end に検索パラメータを定めていないので、
// 期間は start を 2 回並べた AND で表す(上流 README の「空き枠を探す」と同じ形)。
// 1 週間でも 15 分枠なら数百件になるため、次ページが尽きるまで読み切る。
async function fetchScheduleSlots(
  scheduleId: string,
  range?: { from: string; to: string },
  status?: string,
): Promise<fhir4.Slot[]> {
  const PAGE = 100;
  const slots: fhir4.Slot[] = [];

  for (let offset = 0; ; offset += PAGE) {
    const params = new URLSearchParams();
    params.set("schedule", `Schedule/${scheduleId}`);
    if (status) params.set("status", status);
    if (range) {
      params.append("start", `ge${range.from}`);
      params.append("start", `lt${range.to}`);
    }
    params.set("_sort", "start");
    params.set("_count", String(PAGE));
    params.set("_offset", String(offset));

    const { data: bundle } = await searchResource<fhir4.Slot>("Slot", params);
    const page =
      bundle.entry?.map((e) => e.resource).filter((r): r is fhir4.Slot => Boolean(r)) ?? [];
    slots.push(...page);
    if (page.length < PAGE) return slots;
  }
}

export function useSlotWeek(scheduleId: string | undefined, weekStartISO: string) {
  const query = useQuery({
    queryKey: ["Slot", "week", scheduleId, weekStartISO],
    queryFn: () =>
      fetchScheduleSlots(scheduleId as string, {
        from: weekStartISO,
        to: addDays(weekStartISO, 7),
      }),
    enabled: Boolean(scheduleId),
    placeholderData: keepPreviousData,
  });

  return { ...query, slots: query.data ?? [] };
}

/**
 * 一括生成の重複判定に使う、生成対象期間の既存 Slot。カレンダーは 1 週間しか
 * 読んでいないので、月単位で作るときはこちらで期間ぶんを引き直す。
 */
export function useSlotsInRange(
  scheduleId: string | undefined,
  range: { from: string; to: string },
  enabled: boolean,
) {
  const query = useQuery({
    queryKey: ["Slot", "range", scheduleId, range.from, range.to],
    queryFn: () =>
      fetchScheduleSlots(scheduleId as string, {
        from: range.from,
        // 終了日を含めたいので翌日未満で切る。
        to: addDays(range.to, 1),
      }),
    enabled: enabled && Boolean(scheduleId) && Boolean(range.from) && Boolean(range.to),
  });

  return { ...query, slots: query.data ?? [] };
}

/**
 * 曜日パターンから作った Slot をまとめて登録する。1 か月ぶんで数百件になるので、
 * 1 リクエストが大きくなりすぎないよう 100 件ずつの transaction に分けて送る。
 */
export function useGenerateSlots() {
  const queryClient = useQueryClient();
  const CHUNK = 100;

  return useMutation({
    mutationFn: async (slots: fhir4.Slot[]) => {
      for (let i = 0; i < slots.length; i += CHUNK) {
        await postBundle(buildSlotCreateBundle(slots.slice(i, i + CHUNK)));
      }
      return slots.length;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Slot"] });
    },
  });
}

/**
 * 枠の状態を変える(停止 ⇄ 再開)。カレンダーは検索結果の Slot を持っているだけで
 * ETag が無いため、単体 PUT ではなく transaction Bundle で書く
 * (useUpdateRadTaskStatus と同じ理由)。
 */
export function useUpdateSlotStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ slots, status }: { slots: fhir4.Slot[]; status: SlotStatus }) =>
      postBundle({
        resourceType: "Bundle",
        type: "transaction",
        entry: slots
          .filter((slot) => slot.id)
          .map((slot) => ({
            resource: { ...slot, status },
            request: { method: "PUT" as const, url: `Slot/${slot.id}` },
          })),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Slot"] });
    },
  });
}

export function useDeleteSlots() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (slots: fhir4.Slot[]) => postBundle(buildSlotDeleteBundle(slots)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Slot"] });
    },
  });
}

// 予約を取る画面の枠表セレクト。
// 診療科は取得後にコードで絞る。診療科を設定していない枠表をどの科からも選べるように
// 残すためで、specialty 検索では「その科 または 未設定」を 1 回で引けない。
// 種別は診察予約以外をサーバーで絞る。診察予約は種別を持たない枠表も含むので
// (scheduleTypeOf)、取得後に判定する。
export function useScheduleOptions(filter: {
  departmentCode?: string;
  practitionerId?: string;
  scheduleType?: ScheduleType;
}) {
  const params = new URLSearchParams();
  params.set("active", "true");
  if (filter.practitionerId) params.append("actor", `Practitioner/${filter.practitionerId}`);
  if (filter.scheduleType && filter.scheduleType !== "consultation") {
    params.set("service-type", `${SCHEDULE_SERVICE_TYPE_SYSTEM}|${filter.scheduleType}`);
  }
  params.set("_count", "100");

  const query = useQuery({
    queryKey: [
      "Schedule",
      "search",
      "options",
      filter.practitionerId ?? "",
      filter.scheduleType === "consultation" ? "" : (filter.scheduleType ?? ""),
    ],
    queryFn: () => searchResource<fhir4.Schedule>("Schedule", params),
  });

  const all =
    query.data?.data.entry
      ?.map((e) => e.resource)
      .filter((r): r is fhir4.Schedule => Boolean(r)) ?? [];

  const byType = filter.scheduleType
    ? all.filter((schedule) => scheduleTypeOf(schedule) === filter.scheduleType)
    : all;

  return {
    ...query,
    schedules: filter.departmentCode
      ? byType.filter((schedule) => {
          const codes =
            schedule.specialty?.flatMap((s) => s.coding?.map((c) => c.code) ?? []) ?? [];
          // 診療科を設定していない枠表は、どの科からも選べる共通の枠として残す
          // (除外すると診療科を「すべて」に戻すまで候補に出ず、気づきにくい)。
          return codes.length === 0 || codes.includes(filter.departmentCode);
        })
      : byType,
  };
}

/**
 * 月カレンダーの「その日の空き枠数」バッジ。枠の現物は要らず日付ごとの件数だけ
 * なので、$distinct-dates の件数モードで 1 リクエストにする(15 分枠なら 1 か月で
 * 数百〜千件になるため、全件読んで数える作りだと転送量が大きい)。
 */
export function useFreeSlotCountsOfMonth(
  scheduleId: string | undefined,
  range: { from: string; to: string },
) {
  const query = useQuery({
    queryKey: ["Slot", "month", "free-counts", scheduleId, range.from],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("schedule", `Schedule/${scheduleId}`);
      params.set("status", "free");
      params.append("start", `ge${range.from}`);
      params.append("start", `lt${range.to}`);
      return fetchDateCounts("Slot", params, "start");
    },
    enabled: Boolean(scheduleId),
    placeholderData: keepPreviousData,
  });

  return { ...query, freeCounts: query.data ?? new Map<string, number>() };
}

/** 選んだ日の枠(全ステータス)。時刻ごとの「空き 2/3」を出すのに使う。 */
export function useDaySlots(scheduleId: string | undefined, date: string) {
  const query = useQuery({
    queryKey: ["Slot", "day", scheduleId, date],
    queryFn: () =>
      fetchScheduleSlots(scheduleId as string, { from: date, to: addDays(date, 1) }),
    enabled: Boolean(scheduleId) && Boolean(date),
  });

  return { ...query, slots: query.data ?? [] };
}
