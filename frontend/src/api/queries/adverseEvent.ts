import { ADVERSE_EVENT_CATEGORY, type AdverseEventRecord, parseAdverseEvent } from "../../fhir/adverseEventHelpers";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OrderActivity } from "../../fhir/provenanceHelpers";
import { completeRegimenEntry, holdRegimenEntry, type RegimenDayOrder } from "../../fhir/regimenOrderHelpers";
import { deleteResource, postBundle, searchResource } from "../fhirClient";
import { invalidateProvenance, useActivityProvenance, useOrderEnterer } from "./provenance";
import {
  chemoAppointmentCancelEntries,
  invalidateRegimen,
  pendingRegimenOrders,
  regimenDayTaskEntry,
} from "./regimen";
import { resourcesOfType } from "./core";

// ---- 有害事象(CTCAE Grade。§7.6 C-3) ----

/** 患者の有害事象の記録。適用・クールでの絞り込みは画面側(1 患者で多くても数十件)。 */
function parseAdverseEvents(bundle: fhir4.Bundle<fhir4.Observation>): AdverseEventRecord[] {
  return resourcesOfType<fhir4.Observation>(bundle, "Observation")
    .map(parseAdverseEvent)
    .filter((r): r is AdverseEventRecord => r !== null);
}

/** 患者の有害事象をすべて読む。チャートと化学療法タブのように、治療をまたいで並べる画面が使う。 */
export function usePatientAdverseEvents(patientId: string | undefined) {
  const params = new URLSearchParams();
  if (patientId) params.set("patient", `Patient/${patientId}`);
  params.set("category", ADVERSE_EVENT_CATEGORY.code);
  params.set("_count", "200");
  params.set("_sort", "-date");

  return useQuery({
    queryKey: ["Observation", "search", patientId, "adverse-event"],
    queryFn: async (): Promise<AdverseEventRecord[]> => {
      const { data: bundle } = await searchResource<fhir4.Observation>("Observation", params);
      return parseAdverseEvents(bundle);
    },
    enabled: Boolean(patientId),
  });
}

/** ある治療(レジメン適用 / 治療処方)の有害事象だけを `Observation?based-on=` で引く。 */
export function useTreatmentAdverseEvents(treatmentSrId: string | undefined) {
  const params = new URLSearchParams();
  if (treatmentSrId) params.set("based-on", `ServiceRequest/${treatmentSrId}`);
  params.set("category", ADVERSE_EVENT_CATEGORY.code);
  params.set("_count", "200");
  params.set("_sort", "-date");

  return useQuery({
    queryKey: ["Observation", "search", "adverse-event", "treatment", treatmentSrId],
    queryFn: async (): Promise<AdverseEventRecord[]> => {
      const { data: bundle } = await searchResource<fhir4.Observation>("Observation", params);
      return parseAdverseEvents(bundle);
    },
    enabled: Boolean(treatmentSrId),
  });
}

function invalidateAdverseEvents(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["Observation", "search"] });
}

/**
 * 有害事象の登録・更新(id があれば PUT)。楽観ロックは使わない(同時編集する場面がない)。
 * 記録者(performer)が入っていなければログイン中の医療従事者を入れる(§8.14 N-10)。
 */
export function useSaveAdverseEvent() {
  const queryClient = useQueryClient();
  const enterer = useOrderEnterer();
  return useMutation({
    mutationFn: (input: fhir4.Observation) => {
      const observation: fhir4.Observation =
        input.performer?.length || !enterer
          ? input
          : {
              ...input,
              performer: [
                { reference: `Practitioner/${enterer.practitionerId}`, display: enterer.display || undefined },
              ],
            };
      return postBundle({
        resourceType: "Bundle",
        type: "transaction",
        entry: [
          {
            resource: observation,
            request: observation.id
              ? { method: "PUT", url: `Observation/${observation.id}` }
              : { method: "POST", url: "Observation" },
          },
        ],
      });
    },
    onSuccess: () => invalidateAdverseEvents(queryClient),
  });
}

export function useDeleteAdverseEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteResource("Observation", id),
    onSuccess: () => invalidateAdverseEvents(queryClient),
  });
}

/**
 * クールごと取り消す(§7.6 C-7)。登録した日オーダーを薬剤・進捗ごと消し、化学療法室の予約も
 * 取り消す。誤って登録したクールを片付けるための操作なので、部門が動き出した日を含むクールは
 * 呼ぶ側(`canDeleteCycle`)が弾く。
 *
 * ［決定］中止(Task を cancelled にする)ではなく**削除**にする。中止だと暦に打ち消し線の行が
 * 残り続け、「予定していたが止めた」と「そもそも登録が誤りだった」が区別できなくなる。
 */
export function useDeleteRegimenCycle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (targets: RegimenDayOrder[]) =>
      postBundle({
        resourceType: "Bundle",
        type: "transaction",
        entry: [
          ...targets.flatMap((order) => [
            { request: { method: "DELETE" as const, url: `ServiceRequest/${order.serviceRequest.id}` } },
            {
              request: {
                method: "DELETE" as const,
                url: `MedicationRequest?based-on=ServiceRequest/${order.serviceRequest.id}`,
              },
            },
            // 進捗の Task は残すと孤児になる(他種別の削除では残っている既知の課題)。
            // ここは対象が手元にあるので一緒に消す。
            ...(order.task?.id
              ? [{ request: { method: "DELETE" as const, url: `Task/${order.task.id}` } }]
              : []),
          ]),
          ...(await chemoAppointmentCancelEntries(targets)),
        ],
      }),
    onSuccess: () => invalidateRegimen(queryClient),
  });
}

/**
 * レジメンの完了・休止・再開(§7.6 C-1)。完了は中止と同じく未実施の日オーダーを止め、
 * その日の化学療法室の予約も取り消す(完了したのに予定が残るのは矛盾)。
 * 休止・再開はヘッダの状態だけを変える(可逆)。
 */
export function useUpdateRegimenStatus() {
  const queryClient = useQueryClient();
  const activityProvenance = useActivityProvenance();
  return useMutation({
    mutationFn: async ({
      header,
      status,
      targets,
    }: {
      header: fhir4.ServiceRequest;
      status: "completed" | "on-hold" | "active";
      targets: RegimenDayOrder[];
    }) => {
      const pending = status === "completed" ? pendingRegimenOrders(targets) : [];
      const activity: OrderActivity =
        status === "completed" ? "COMPLETE" : status === "on-hold" ? "SUSPEND" : "RESUME";
      return postBundle({
        resourceType: "Bundle",
        type: "transaction",
        entry: [
          ...(status === "completed"
            ? [
                completeRegimenEntry(header),
                ...pending.map((order) => regimenDayTaskEntry(order, "cancelled", "レジメン完了")),
                ...(await chemoAppointmentCancelEntries(pending)),
              ]
            : [holdRegimenEntry(header, status === "on-hold")]),
          ...activityProvenance([header], activity),
        ],
      });
    },
    onSuccess: () => {
      invalidateRegimen(queryClient);
      invalidateProvenance(queryClient);
    },
  });
}
