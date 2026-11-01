import { useMutation, useQueryClient } from "@tanstack/react-query";
import { isValidLabelNumber } from "../../fhir/labSpecimenHelpers";
import {
  PATHO_ACCESSION_SYSTEM,
  buildPathoReceptionBundle,
  containerOrderIdOf,
  isPathoContainerSpecimen,
  pathoAccessionNumber,
} from "../../fhir/pathoReceptionHelpers";
import { pathoOrderItemRequests } from "../../fhir/pathoOrderHelpers";
import { pathoTasksByOrderId } from "../../fhir/pathoTaskHelpers";
import { postBundle, searchResource, typeOperation } from "../fhirClient";
import { resourcesOfType } from "./core";
import { fetchLabelSpecimenByNumber } from "./injection";

// 病理受付(fhir/pathoReceptionHelpers、docs/patho-order-design.md §4.11)。

/** 受付で照合するオーダーの文脈。容器は病理の容器の台帳(取り下げたものも含む)。 */
export interface PathoReceptionContext {
  order: fhir4.ServiceRequest;
  patient?: fhir4.Patient;
  itemRequests: fhir4.ServiceRequest[];
  containers: fhir4.Specimen[];
  task?: fhir4.Task;
}

/** オーダー・患者・検体明細・容器・進捗を 1 回の検索で読む。オーダーが無ければ null。 */
export async function fetchPathoReceptionContext(orderId: string): Promise<PathoReceptionContext | null> {
  const params = new URLSearchParams();
  params.set("_id", orderId);
  params.append("_include", "ServiceRequest:subject");
  params.append("_revinclude", "ServiceRequest:based-on");
  params.append("_revinclude", "Specimen:request");
  params.append("_revinclude", "Task:focus");
  const { data: bundle } = await searchResource<fhir4.Resource>("ServiceRequest", params);
  const requests = resourcesOfType<fhir4.ServiceRequest>(bundle, "ServiceRequest");
  const order = requests.find((request) => request.id === orderId);
  if (!order) return null;
  const patientId = order.subject?.reference?.split("/").pop();
  return {
    order,
    patient: resourcesOfType<fhir4.Patient>(bundle, "Patient").find((patient) => patient.id === patientId),
    itemRequests: pathoOrderItemRequests(requests, orderId),
    containers: resourcesOfType<fhir4.Specimen>(bundle, "Specimen").filter(isPathoContainerSpecimen),
    task: pathoTasksByOrderId(resourcesOfType<fhir4.Task>(bundle, "Task")).get(orderId),
  };
}

/** ラベル番号で容器の台帳を引く。検体検査の採取管と同じ番号の体系。 */
export const fetchContainerByLabelNumber = fetchLabelSpecimenByNumber;

/**
 * 番号からオーダー(ヘッダ)の id を引く。11 桁のラベル番号(バーコード)なら容器の台帳から、
 * それ以外は病理受付番号として探す(JAHIS 患者安全ガイド 病理編 7.2.3「オーダ番号で呼び出す」)。
 * 見つからなければ空。
 */
export async function findPathoOrderIdByNumber(value: string): Promise<string> {
  const number = value.trim();
  if (!number) return "";
  if (isValidLabelNumber(number)) {
    const specimen = await fetchLabelSpecimenByNumber(number);
    return specimen && isPathoContainerSpecimen(specimen) ? containerOrderIdOf(specimen) : "";
  }
  const params = new URLSearchParams();
  params.set("identifier", `${PATHO_ACCESSION_SYSTEM}|${number}`);
  params.set("_elements", "id");
  const { data: bundle } = await searchResource<fhir4.ServiceRequest>("ServiceRequest", params);
  return resourcesOfType<fhir4.ServiceRequest>(bundle, "ServiceRequest")[0]?.id ?? "";
}

async function fetchNextAccessionNumber(): Promise<string> {
  const params = new URLSearchParams();
  params.set("system", PATHO_ACCESSION_SYSTEM);
  const { data } = await typeOperation<fhir4.Parameters>("ServiceRequest", "next-identifier", params);
  const value = data.parameter?.find((p) => p.name === "value")?.valueString;
  if (!value) throw new Error("病理受付番号を採番できませんでした。");
  return value;
}

/**
 * 受付。進捗・病理受付番号・容器の到着を 1 つの transaction で書く。containers は照合が済んだ容器
 * (照合をしない手動の受付では空)。受付番号が既にあるオーダーは採番しない。
 */
export function useReceivePathoOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { order: fhir4.ServiceRequest; task?: fhir4.Task; containers: fhir4.Specimen[] }) => {
      const accessionNumber = pathoAccessionNumber(input.order) || (await fetchNextAccessionNumber());
      await postBundle(buildPathoReceptionBundle({ ...input, task: input.task, accessionNumber }));
      return accessionNumber;
    },
    retry: false,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest"] });
      queryClient.invalidateQueries({ queryKey: ["Task"] });
    },
  });
}
