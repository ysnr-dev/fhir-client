import { nowFhirDateTime } from "../lib/dates";
import {
  PATHO_CONTAINER_SYSTEM,
  isPathoContainerSpecimen,
  organLabel,
  pathoOrderSpecimens,
} from "./pathoOrderHelpers";
import { buildPathoTaskUpdate } from "./pathoTaskHelpers";

// 病理受付(JAHIS 患者安全ガイド 病理編 7.2。docs/patho-order-design.md §4.11)。
//
//   ServiceRequest(オーダー) ← request ── Specimen(容器の台帳。検体ラベルの発行で作る)
//                           ← focus ─── Task(進捗。受付で accepted)
//
// 届いた容器のラベルを全部読み、オーダーの容器(検体明細ごとの容器数の和)と過不足なく揃ったときだけ受付できる。
// 受付では、進捗を受付済にし、病理受付番号をオーダーの identifier に振り、読んだ容器に到着(receivedTime)を
// 書く。この 3 つは 1 つの transaction にする(番号だけ振られて受付されない、を作らない)。

/** 病理受付番号。上流の $next-identifier で連番を払い出す(番号に意味は持たせない)。 */
export const PATHO_ACCESSION_SYSTEM = "http://fhir-client.local/IdSystem/patho-accession-number";

/** オーダーの病理受付番号。未受付なら空。 */
export function pathoAccessionNumber(order: fhir4.ServiceRequest | undefined): string {
  return order?.identifier?.find((identifier) => identifier.system === PATHO_ACCESSION_SYSTEM)?.value ?? "";
}

/** オーダーの容器 1 つ。ラベルの「容器 k/N」と同じ並び(backend の PathoLabelReport と同じ規則)。 */
export interface ExpectedContainer {
  /** 台帳の Specimen の identifier の値(「検体明細の id:明細内の容器の順番」)。 */
  key: string;
  /** オーダー通しの容器番号(1 始まり)。 */
  number: number;
  specimenNumber: number;
  organ: string;
}

export function expectedPathoContainers(itemRequests: fhir4.ServiceRequest[]): ExpectedContainer[] {
  const containers: ExpectedContainer[] = [];
  pathoOrderSpecimens(itemRequests).forEach((specimen, index) => {
    const count = Number(specimen.containerCount) > 0 ? Number(specimen.containerCount) : 1;
    for (let k = 1; k <= count; k += 1) {
      containers.push({
        key: `${specimen.id}:${k}`,
        number: containers.length + 1,
        specimenNumber: index + 1,
        organ: organLabel(specimen) || specimen.organName || "臓器未設定",
      });
    }
  });
  return containers;
}

/** 容器の台帳の Specimen の鍵。病理の容器でなければ空。 */
export function containerKeyOf(specimen: fhir4.Specimen): string {
  return specimen.identifier?.find((identifier) => identifier.system === PATHO_CONTAINER_SYSTEM)?.value ?? "";
}

/** 取り下げた容器(採取で容器数を減らした・検体を外した)のラベルか。 */
export function isRetiredContainer(specimen: fhir4.Specimen): boolean {
  return specimen.status === "entered-in-error";
}

/** 容器の台帳の Specimen が指すオーダー(ヘッダ)の id。request の先頭がオーダー。 */
export function containerOrderIdOf(specimen: fhir4.Specimen): string {
  return specimen.request?.[0]?.reference?.match(/^ServiceRequest\/(.+)$/)?.[1] ?? "";
}

export { isPathoContainerSpecimen };

/**
 * 受付の transaction。進捗を受付済に、オーダーに病理受付番号を、容器に到着を書く。
 * order と containers は読んだ版のまま渡す(postBundle が版で If-Match を付ける)。
 * 受付番号が既に振られているオーダー(取り消して受け付け直す)は番号を変えない。
 */
export function buildPathoReceptionBundle(input: {
  order: fhir4.ServiceRequest;
  task: fhir4.Task | undefined;
  accessionNumber: string;
  containers: fhir4.Specimen[];
}): fhir4.Bundle {
  const { order, task, accessionNumber, containers } = input;
  const now = nowFhirDateTime();
  const nextTask = buildPathoTaskUpdate(task, order, "accepted");
  const entry: fhir4.BundleEntry[] = [
    {
      resource: nextTask,
      request: nextTask.id ? { method: "PUT", url: `Task/${nextTask.id}` } : { method: "POST", url: "Task" },
    },
  ];
  if (accessionNumber && !pathoAccessionNumber(order)) {
    const updated: fhir4.ServiceRequest = {
      ...order,
      identifier: [...(order.identifier ?? []), { system: PATHO_ACCESSION_SYSTEM, value: accessionNumber }],
    };
    entry.push({ resource: updated, request: { method: "PUT", url: `ServiceRequest/${order.id}` } });
  }
  for (const specimen of containers) {
    if (!specimen.id) continue;
    const received: fhir4.Specimen = { ...specimen, status: "available", receivedTime: specimen.receivedTime ?? now };
    entry.push({ resource: received, request: { method: "PUT", url: `Specimen/${specimen.id}` } });
  }
  return { resourceType: "Bundle", type: "transaction", entry };
}
