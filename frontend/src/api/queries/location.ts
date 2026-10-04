import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LOCATION_TYPE_CODES, sortLocations } from "../../fhir/locationHelpers";
import {
  bedNumber,
  buildRoomDeleteBundle,
  buildRoomSaveBundle,
  countByParent,
  MAX_BED_COUNT,
  partOfId,
  type RoomSaveInput,
  WARD_TYPE_CODE,
} from "../../fhir/wardHelpers";
import {
  createResource,
  deleteResource,
  postBundle,
  readResource,
  searchResource,
  updateResource,
} from "../fhirClient";
import { hasRelation } from "./patient";
import { resourcesOfType } from "./core";

// ---- 場所(Location) ----
//
// 診察室・撮影室のマスタ。単体で使うことはなく、予約枠(Schedule.actor)の
// 主体として参照する。

export interface LocationSearchParams {
  name?: string;
  status?: string;
}

const LOCATION_COUNT = 20;

export function useLocationSearch(search: LocationSearchParams, offset: number) {
  const params = new URLSearchParams();
  if (search.name) params.set("name", search.name);
  if (search.status) params.set("status", search.status);
  // 入院の場所(病棟・病室・ベッド)はこの一覧の担当ではない(/wards が持つ)。
  // 診察室の種別だけを挙げて OR で引く。取得後に落とすやり方だと total とページ内件数が
  // ずれるため、サーバー側で絞りきる。
  params.set("type", LOCATION_TYPE_CODES.join(","));
  params.set("_count", String(LOCATION_COUNT));
  params.set("_offset", String(offset));

  const query = useQuery({
    queryKey: ["Location", "search", search, offset],
    queryFn: () => searchResource<fhir4.Location>("Location", params),
    placeholderData: keepPreviousData,
  });

  return {
    ...query,
    locations:
      resourcesOfType<fhir4.Location>(query.data?.data, "Location"),
    total: query.data?.data.total ?? 0,
    count: LOCATION_COUNT,
    hasPrevious: hasRelation(query.data?.data, "previous"),
    hasNext: hasRelation(query.data?.data, "next"),
  };
}

// 選択肢用。使用しない場所を枠の主体に選べても仕方がないので active だけ返す。
export function useLocationOptions() {
  const params = new URLSearchParams();
  params.set("status", "active");
  // 診察室のセレクトなので、入院の場所は除く(useLocationSearch と同じ理由)。
  params.set("type", LOCATION_TYPE_CODES.join(","));
  params.set("_count", "100");

  const query = useQuery({
    queryKey: ["Location", "search", "options"],
    queryFn: () => searchResource<fhir4.Location>("Location", params),
  });

  return {
    ...query,
    // 表示順 → 名称の順。上流は独自拡張で _sort できないのでここで並べる
    // (全件を 1 回で読む選択肢なので、読み手で並べても取りこぼしは出ない)。
    locations: sortLocations(
      resourcesOfType<fhir4.Location>(query.data?.data, "Location"),
    ),
  };
}

export function useLocation(id: string | undefined) {
  return useQuery({
    queryKey: ["Location", id],
    queryFn: () => readResource<fhir4.Location>("Location", id as string),
    enabled: Boolean(id),
  });
}

export function useCreateLocation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (location: fhir4.Location) => createResource(location),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Location"] });
    },
  });
}

export function useUpdateLocation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ location, etag }: { location: fhir4.Location; etag: string }) =>
      updateResource(location, etag),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Location"] });
    },
  });
}

export function useDeleteLocation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteResource("Location", id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Location"] });
    },
  });
}

// ---- 病棟・病室・ベッド(Location の 3 階層) ----
//
// 入院の場所マスタ。病棟(type=HU)の下に病室(partOf=病棟)、その下にベッド
// (partOf=病室)がぶら下がる。上の「場所」節(診察室・撮影室)とは画面も一覧も
// 分ける。階層とコードの決め方は fhir/wardHelpers.ts の冒頭にまとめてある。
//
// 病棟・病室・ベッドはどれも Location なので、作成・単体取得・更新は上の
// useCreateLocation / useLocation / useUpdateLocation をそのまま使う。ここに
// 足すのは、階層があるせいでやり方が変わるもの(子ごと引く検索、子を巻き込む
// 保存・削除)だけ。
//
// 一覧に出す「病室数」「ベッド数」は _revinclude=Location:partof で子ごと取って
// 数える。_revinclude の結果は _count の対象外(上流 IncludeResolver)なので
// 子を取りこぼさない。行ごとに件数を数えるクエリを投げるより 1 往復で済む。

/** 検索結果を match(親)と include(子)に分ける。どちらも Location なので型では分けられない。 */
export function splitLocationMatches(bundle: fhir4.Bundle<fhir4.Resource> | undefined) {
  const matches: fhir4.Location[] = [];
  const children: fhir4.Location[] = [];

  for (const entry of bundle?.entry ?? []) {
    const resource = entry.resource;
    if (resource?.resourceType !== "Location") continue;
    if (entry.search?.mode === "include") children.push(resource as fhir4.Location);
    else matches.push(resource as fhir4.Location);
  }

  return { matches, children };
}

export interface WardSearchParams {
  name?: string;
  status?: string;
}

const WARD_COUNT = 20;
const ROOM_COUNT = 20;

export function useWardSearch(search: WardSearchParams, offset: number) {
  const params = new URLSearchParams();
  params.set("type", WARD_TYPE_CODE);
  if (search.name) params.set("name", search.name);
  if (search.status) params.set("status", search.status);
  // 並びは病棟名順。既定の id 順では登録のたびに順番が変わって読みにくい。
  params.set("_sort", "name");
  params.set("_count", String(WARD_COUNT));
  params.set("_offset", String(offset));
  // 一覧に病室数を出すため、ぶら下がる病室も一緒に取る。
  params.set("_revinclude", "Location:partof");

  const query = useQuery({
    queryKey: ["Location", "wards", search, offset],
    queryFn: () => searchResource<fhir4.Resource>("Location", params),
    placeholderData: keepPreviousData,
  });

  const { matches, children } = splitLocationMatches(query.data?.data);

  return {
    ...query,
    wards: matches,
    /** 病棟 id -> 病室数。 */
    roomCounts: countByParent(children),
    total: query.data?.data.total ?? 0,
    count: WARD_COUNT,
    hasPrevious: hasRelation(query.data?.data, "previous"),
    hasNext: hasRelation(query.data?.data, "next"),
  };
}

/** 1 つの病棟にぶら下がる病室。配下のベッドも一緒に取って件数と削除に使う。 */
export function useRoomSearch(wardId: string | undefined, offset: number) {
  const params = new URLSearchParams();
  params.set("partof", `Location/${wardId}`);
  // 「301号室」「302号室」と並べたいので病室名順。
  params.set("_sort", "name");
  params.set("_count", String(ROOM_COUNT));
  params.set("_offset", String(offset));
  params.set("_revinclude", "Location:partof");

  const query = useQuery({
    queryKey: ["Location", "rooms", wardId, offset],
    queryFn: () => searchResource<fhir4.Resource>("Location", params),
    placeholderData: keepPreviousData,
    enabled: Boolean(wardId),
  });

  const { matches, children } = splitLocationMatches(query.data?.data);

  return {
    ...query,
    rooms: matches,
    /** 表示中の病室にぶら下がるベッド。件数表示と、病室削除の巻き込みに使う。 */
    beds: children,
    /** 病室 id -> ベッド数。 */
    bedCounts: countByParent(children),
    total: query.data?.data.total ?? 0,
    count: ROOM_COUNT,
    hasPrevious: hasRelation(query.data?.data, "previous"),
    hasNext: hasRelation(query.data?.data, "next"),
  };
}

/** 1 つの病室のベッド。編集画面がベッド数の初期値と増減の差分に使う。 */
export function useRoomBeds(roomId: string | undefined) {
  const params = new URLSearchParams();
  params.set("partof", `Location/${roomId}`);
  // ベッド数の上限ぶん取れれば足りる(MAX_BED_COUNT を超えては作れない)。
  params.set("_count", String(MAX_BED_COUNT + 1));

  const query = useQuery({
    queryKey: ["Location", "beds", roomId],
    queryFn: () => searchResource<fhir4.Location>("Location", params),
    enabled: Boolean(roomId),
  });

  return {
    ...query,
    beds:
      resourcesOfType<fhir4.Location>(query.data?.data, "Location"),
  };
}

/**
 * 病棟を削除する。上流に参照整合性は無いので、配下の病室が残っていないかを
 * ここで確かめてから消す(残したまま消すと親のいない病室が宙に浮く)。
 */
export function useDeleteWard() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const params = new URLSearchParams();
      params.set("partof", `Location/${id}`);
      params.set("_summary", "count");
      const { data } = await searchResource<fhir4.Location>("Location", params);
      if ((data.total ?? 0) > 0) {
        throw new Error(
          "この病棟には病室が登録されています。先に病室をすべて削除してください。",
        );
      }
      return deleteResource("Location", id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Location"] });
    },
  });
}

/** 病室の登録・更新。ベッドの増減を巻き込むので単体 PUT ではなく Bundle で書く。 */
export function useSaveRoom() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RoomSaveInput) => postBundle(buildRoomSaveBundle(input)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Location"] });
    },
  });
}

/** 病室を配下のベッドごと削除する。 */
export function useDeleteRoom() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ roomId, beds }: { roomId: string; beds: fhir4.Location[] }) =>
      postBundle(buildRoomDeleteBundle(roomId, beds)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Location"] });
    },
  });
}

/** 病棟のセレクト用。使わない病棟を選べても仕方がないので active だけ返す。 */
export function useWardOptions() {
  const params = new URLSearchParams();
  params.set("type", WARD_TYPE_CODE);
  params.set("status", "active");
  params.set("_sort", "name");
  params.set("_count", "100");

  const query = useQuery({
    queryKey: ["Location", "wards", "options"],
    queryFn: () => searchResource<fhir4.Location>("Location", params),
  });

  return {
    ...query,
    wards:
      resourcesOfType<fhir4.Location>(query.data?.data, "Location"),
  };
}

export interface WardGrid {
  /** 病室名順。 */
  rooms: fhir4.Location[];
  /** 病室 id -> その病室のベッド(番号順)。 */
  bedsByRoom: Map<string, fhir4.Location[]>;
}

/**
 * 入院患者一覧のグリッド用に、1 つの病棟の病室とベッドをまとめて取る。
 * 一覧(useRoomSearch)と違ってページングしないのは、病棟ぶんの表を 1 画面に
 * 出しきるため。_revinclude の子は _count の対象外なのでベッドは取りこぼさない。
 */
async function fetchWardGrid(wardId: string): Promise<WardGrid> {
  const PAGE = 100;
  const rooms: fhir4.Location[] = [];
  const beds: fhir4.Location[] = [];

  for (let offset = 0; ; offset += PAGE) {
    const params = new URLSearchParams();
    params.set("partof", `Location/${wardId}`);
    params.set("_sort", "name");
    params.set("_count", String(PAGE));
    params.set("_offset", String(offset));
    params.set("_revinclude", "Location:partof");

    const { data: bundle } = await searchResource<fhir4.Resource>("Location", params);
    const { matches, children } = splitLocationMatches(bundle);
    rooms.push(...matches);
    beds.push(...children);
    if (matches.length < PAGE) break;
  }

  const bedsByRoom = new Map<string, fhir4.Location[]>();
  for (const bed of beds) {
    const roomId = partOfId(bed);
    if (!roomId) continue;
    const list = bedsByRoom.get(roomId);
    if (list) list.push(bed);
    else bedsByRoom.set(roomId, [bed]);
  }
  for (const list of bedsByRoom.values()) {
    list.sort((a, b) => (bedNumber(a) ?? 0) - (bedNumber(b) ?? 0));
  }

  return { rooms, bedsByRoom };
}

export function useWardGrid(wardId: string | undefined) {
  const query = useQuery({
    queryKey: ["Location", "ward-grid", wardId],
    queryFn: () => fetchWardGrid(wardId as string),
    enabled: Boolean(wardId),
    placeholderData: keepPreviousData,
  });

  return {
    ...query,
    rooms: query.data?.rooms ?? [],
    bedsByRoom: query.data?.bedsByRoom ?? new Map<string, fhir4.Location[]>(),
  };
}
