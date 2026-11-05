import { specimenArrived, specimenOrderIdOf } from "./labSpecimenHelpers";
import { microOrderContents, specimenLabel } from "./microOrderHelpers";

// 細菌検査の容器の台帳 = 上流の Specimen(検体検査・病理と同じ作り。docs/micro-order-design.md §7.6)。
//
//   ServiceRequest(オーダー) ← request ── Specimen(容器 1 つ)
//
// ラベル発行(backend の MicroLabelReport)が容器ごとに Specimen を作り、accessionIdentifier に
// バーコードの番号(検体検査と同じ採番)を持たせる。容器は、検体の容器 1 つ(識別子 = 検体グループ明細の id)と、
// 検体と別の容器で出す検査項目(血液培養のボトル。マスタの separate_container)1 項目ずつ
// (識別子 = その検査項目明細の id)。到着確認がその Specimen に receivedTime を書き込む。
// 項目を外して刷り直すと、外れた容器は entered-in-error に取り下げられる。

export const MICRO_CONTAINER_SYSTEM = "http://fhir-client.local/IdSystem/micro-container";

/** 細菌検査の容器の台帳の Specimen か。 */
export function isMicroContainerSpecimen(specimen: fhir4.Specimen): boolean {
  return Boolean(specimen.identifier?.some((identifier) => identifier.system === MICRO_CONTAINER_SYSTEM));
}

/** 台帳の容器の識別子(検体グループ明細か、別容器の検査項目明細の id)。 */
export function microContainerKeyOf(specimen: fhir4.Specimen): string {
  return specimen.identifier?.find((identifier) => identifier.system === MICRO_CONTAINER_SYSTEM)?.value ?? "";
}

/** オーダー id → 取り下げていない容器の台帳。検索結果の振り分け用。 */
export function microContainersByOrderId(specimens: fhir4.Specimen[]): Map<string, fhir4.Specimen[]> {
  const byOrderId = new Map<string, fhir4.Specimen[]>();
  for (const specimen of specimens) {
    if (!isMicroContainerSpecimen(specimen) || specimen.status === "entered-in-error") continue;
    const orderId = specimenOrderIdOf(specimen);
    if (!orderId) continue;
    byOrderId.set(orderId, [...(byOrderId.get(orderId) ?? []), specimen]);
  }
  return byOrderId;
}

/** いまのオーダーの容器 1 つ。specimen は台帳(ラベル未発行なら無い)。 */
export interface MicroContainer {
  key: string;
  /** 「喀出痰（右 耳・吸引）」、ボトルは「血液培養（好気ボトル）」。 */
  label: string;
  bottle: boolean;
  specimen?: fhir4.Specimen;
}

/**
 * いまのオーダー内容から組んだ容器(ラベルと同じ並び)。separateCodes は別容器の検査項目の
 * 項目コード(マスタの separate_container)。検体の容器は、別容器でない項目があるか、
 * 項目が 1 つも無いときに 1 つ(backend の MicroLabelReport#build_labels と同じ規則)。
 */
export function microContainers(
  itemRequests: fhir4.ServiceRequest[],
  separateCodes: ReadonlySet<string>,
  ledger: fhir4.Specimen[],
): MicroContainer[] {
  const { specimen, items } = microOrderContents(itemRequests);
  if (!specimen.id) return [];
  const byKey = new Map(ledger.map((s) => [microContainerKeyOf(s), s]));
  const bottles = items.filter((item) => separateCodes.has(item.code));

  const containers: MicroContainer[] = [];
  if (bottles.length < items.length || items.length === 0) {
    containers.push({
      key: specimen.id,
      label: specimenLabel(specimen),
      bottle: false,
      specimen: byKey.get(specimen.id),
    });
  }
  for (const item of bottles) {
    containers.push({ key: item.id, label: item.name, bottle: true, specimen: byKey.get(item.id) });
  }
  return containers;
}

/** 容器が全部届いたか。arrivedKey はいま到着を記録しようとしている容器(まだ台帳に書いていない)。 */
export function allMicroContainersArrived(containers: MicroContainer[], arrivedKey?: string): boolean {
  return (
    containers.length > 0 &&
    containers.every(
      (container) => container.key === arrivedKey || (container.specimen && specimenArrived(container.specimen)),
    )
  );
}
