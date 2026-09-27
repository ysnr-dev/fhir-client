import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type MasterSearchResult,
  type RadiotherapyDevice,
  radiotherapyDeviceClient,
  type RadiotherapyMasterSearchParams,
  type RadiotherapyModality,
  radiotherapyModalityClient,
  type RadiotherapyProtocol,
  radiotherapyProtocolClient,
  type RadiotherapyStopReason,
  radiotherapyStopReasonClient,
  type RadiotherapyTechnique,
  radiotherapyTechniqueClient,
} from "../masterClient";

// ---- 放射線治療の施設固有マスタ ----
//
// どれも施設ごとに数十件で収まるので、一覧も選択肢も全件をまとめて引く。

const RADIOTHERAPY_MASTER_PER = 500;

function radiotherapyMasterHooks<T extends { id: number }>(
  name: string,
  client: {
    search: (params: RadiotherapyMasterSearchParams) => Promise<MasterSearchResult<T>>;
    create: (payload: Partial<Omit<T, "id">>) => Promise<T>;
    update: (id: number, payload: Partial<Omit<T, "id">>) => Promise<T>;
    remove: (id: number) => Promise<void>;
  },
) {
  const key = ["master", name];

  return {
    /** マスタ画面の一覧(無効な行も含む全件)。 */
    useList(filters: { name?: string } = {}) {
      return useQuery({
        queryKey: [...key, "list", filters],
        queryFn: () => client.search({ name: filters.name || undefined, per: RADIOTHERAPY_MASTER_PER }),
        placeholderData: keepPreviousData,
      });
    },
    /** 処方フォームの選択肢(有効な行だけ)。 */
    useOptions(params: { kind?: string } = {}) {
      const query = useQuery({
        queryKey: [...key, "options", params],
        staleTime: Infinity,
        queryFn: () => client.search({ ...params, enabled: true, per: RADIOTHERAPY_MASTER_PER }),
      });
      return { ...query, items: query.data?.items ?? EMPTY_RADIOTHERAPY_ITEMS as T[] };
    },
    useMutations() {
      const queryClient = useQueryClient();
      const invalidate = () => queryClient.invalidateQueries({ queryKey: key });
      return {
        create: useMutation({
          mutationFn: (payload: Partial<Omit<T, "id">>) => client.create(payload),
          retry: false,
          onSuccess: invalidate,
        }),
        update: useMutation({
          mutationFn: ({ id, payload }: { id: number; payload: Partial<Omit<T, "id">> }) =>
            client.update(id, payload),
          retry: false,
          onSuccess: invalidate,
        }),
        remove: useMutation({
          mutationFn: (id: number) => client.remove(id),
          retry: false,
          onSuccess: invalidate,
        }),
      };
    },
  };
}

const EMPTY_RADIOTHERAPY_ITEMS: never[] = [];

export const radiotherapyModalityHooks = radiotherapyMasterHooks<RadiotherapyModality>(
  "radiotherapy_modalities",
  radiotherapyModalityClient,
);
export const radiotherapyTechniqueHooks = radiotherapyMasterHooks<RadiotherapyTechnique>(
  "radiotherapy_techniques",
  radiotherapyTechniqueClient,
);
export const radiotherapyDeviceHooks = radiotherapyMasterHooks<RadiotherapyDevice>(
  "radiotherapy_devices",
  radiotherapyDeviceClient,
);
export const radiotherapyStopReasonHooks = radiotherapyMasterHooks<RadiotherapyStopReason>(
  "radiotherapy_stop_reasons",
  radiotherapyStopReasonClient,
);
export const radiotherapyProtocolHooks = radiotherapyMasterHooks<RadiotherapyProtocol>(
  "radiotherapy_protocols",
  radiotherapyProtocolClient,
);
