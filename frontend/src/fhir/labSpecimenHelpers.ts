import { nowFhirDateTime } from "../lib/dates";
import { toDateTimeInput, toFhirDateTime } from "./clinicalNoteHelpers";
import type { LabSpecimenGroup } from "./labOrderHelpers";
import { JLAC11_SPECIMEN_SYSTEM, LAB_LABEL_NUMBER_SYSTEM, isLabelSpecimen } from "./labResultHelpers";
import { codingBySystem } from "./prescriptionHelpers";

// 検体ラベルの台帳 = 上流の Specimen リソース(docs/lab-arrival-design.md §6-1)。
//
//   ServiceRequest(オーダー) ← request ── Specimen(採取管 1 本)
//
// ラベル発行(backend の LabLabelReport)が管ごとに Specimen を作り、
// accessionIdentifier にバーコードの番号を持たせる。到着確認はその Specimen に
// receivedTime を書き込む。発行済み = Specimen があること、到着済み = receivedTime が
// あること。結果登録はこの Specimen を参照する(所有はしない。labResultHelpers の
// isLabelSpecimen を参照)。

export { LAB_LABEL_NUMBER_SYSTEM, isLabelSpecimen };

// 管の行き先(外注先の Organization.id)。外注に出す管だけが identifier に持ち、院内で
// 測る管は持たない。backend の LabLabelReport::TUBE_DESTINATION_SYSTEM と同じ値。
const TUBE_DESTINATION_SYSTEM = "http://fhir-client.local/IdSystem/lab-tube-destination";

// 到着を記録したユーザー。FHIR の Specimen に「受け取った人」を表す標準要素が
// 無いため(collection.collector は採取した人)、ローカル拡張で持つ。
const ARRIVAL_RECORDER_EXT_URL = "http://fhir-client.local/StructureDefinition/lab-arrival-recorder";

// 外注先への提出(docs/lab-outsource-design.md §7)。提出した日時と記録したユーザーを
// 管にローカル拡張で持つ。提出していない管には無い。
const SHIPPED_AT_EXT_URL = "http://fhir-client.local/StructureDefinition/lab-outsource-shipped-at";
const SHIPMENT_RECORDER_EXT_URL =
  "http://fhir-client.local/StructureDefinition/lab-outsource-shipment-recorder";
const SHIPMENT_EXT_URLS = [SHIPPED_AT_EXT_URL, SHIPMENT_RECORDER_EXT_URL];

/**
 * スキャン入力の形式検証(11 桁 + M10W3 チェックデジット)。上流の採番
 * (Fhir::AccessionAssigner)と同じ計算で、手入力ミスに送信前に気付くためのもの。
 */
export function isValidLabelNumber(number: string): boolean {
  if (!/^\d{11}$/.test(number)) return false;
  const digits = number.slice(0, 10);
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    const weight = (digits.length - 1 - i) % 2 === 0 ? 3 : 1;
    sum += Number(digits[i]) * weight;
  }
  return String((10 - (sum % 10)) % 10) === number[10];
}

/** ラベルに刷られた番号。ラベル由来でない Specimen は空。 */
export function labelNumberOf(specimen: fhir4.Specimen): string {
  return isLabelSpecimen(specimen) ? (specimen.accessionIdentifier?.value ?? "") : "";
}

/** 検体(JLAC11 材料)コード。検体未設定の管は空。 */
export function specimenTypeCodeOf(specimen: fhir4.Specimen): string {
  return codingBySystem(specimen.type?.coding, JLAC11_SPECIMEN_SYSTEM)?.code ?? "";
}

/** 到着済みかどうか(到着確認が receivedTime を書き込む)。 */
export function specimenArrived(specimen: fhir4.Specimen): boolean {
  return Boolean(specimen.receivedTime);
}

/** 採取の元になったオーダー(ヘッダ ServiceRequest)の id。 */
export function specimenOrderIdOf(specimen: fhir4.Specimen): string {
  const reference = specimen.request?.[0]?.reference ?? "";
  return reference.match(/^ServiceRequest\/(.+)$/)?.[1] ?? "";
}

/** 管の行き先(外注先の Organization.id)。院内で測る管は空。 */
export function tubeDestinationOf(specimen: fhir4.Specimen): string {
  return specimen.identifier?.find((i) => i.system === TUBE_DESTINATION_SYSTEM)?.value ?? "";
}

/** 管が検体グループのものか(検体と行き先が同じ)。 */
export function tubeMatchesGroup(specimen: fhir4.Specimen, group: LabSpecimenGroup): boolean {
  return (
    specimenTypeCodeOf(specimen) === group.specimenCode &&
    tubeDestinationOf(specimen) === group.outsourceOrganizationId
  );
}

/** 検体グループに対応する管(ラベル発行が作った Specimen)。未発行なら無い。 */
export function tubeOfGroup(
  specimens: fhir4.Specimen[],
  group: LabSpecimenGroup,
): fhir4.Specimen | undefined {
  return specimens.find((s) => tubeMatchesGroup(s, group));
}

/**
 * ラベルの一括発行で刷る管の範囲。backend の LabLabelReport::SCOPES と同じ。
 * unissued … まだ発行していない管
 * issued   … 発行済みで、まだ検査室に届いていない管
 */
export type LabLabelScope = "unissued" | "issued";

/** オーダーの検体グループに、範囲に入る管が 1 本でもあるか。 */
export function hasLabLabelTarget(
  groups: LabSpecimenGroup[],
  specimens: fhir4.Specimen[],
  scope: LabLabelScope,
): boolean {
  return groups.some((group) => {
    const tube = tubeOfGroup(specimens, group);
    if (!tube) return scope === "unissued";
    return scope === "issued" && !specimenArrived(tube);
  });
}

/** オーダー id → その管(ラベル由来の Specimen)の一覧。検索結果の振り分け用。 */
export function labelSpecimensByOrderId(specimens: fhir4.Specimen[]): Map<string, fhir4.Specimen[]> {
  const byOrderId = new Map<string, fhir4.Specimen[]>();
  for (const specimen of specimens) {
    if (!isLabelSpecimen(specimen)) continue;
    const orderId = specimenOrderIdOf(specimen);
    if (!orderId) continue;
    const list = byOrderId.get(orderId);
    if (list) list.push(specimen);
    else byOrderId.set(orderId, [specimen]);
  }
  return byOrderId;
}

/** 到着を記録したユーザー(ローカル拡張)。ログイン医師が居ない運用では省略する。 */
export interface ArrivalRecorder {
  practitionerId: string;
  display: string;
}

/**
 * 到着を書き込んだ Specimen。受け取った時刻(receivedTime)と、採取済みで検査に
 * 使える状態(status: available)を立てる。
 */
export function buildSpecimenArrival(
  specimen: fhir4.Specimen,
  recorder?: ArrivalRecorder,
): fhir4.Specimen {
  const next: fhir4.Specimen = {
    ...specimen,
    status: "available",
    receivedTime: toFhirDateTime(toDateTimeInput(new Date())),
  };

  const extensions = (specimen.extension ?? []).filter((e) => e.url !== ARRIVAL_RECORDER_EXT_URL);
  if (recorder) {
    extensions.push({
      url: ARRIVAL_RECORDER_EXT_URL,
      valueReference: {
        reference: `Practitioner/${recorder.practitionerId}`,
        display: recorder.display || undefined,
      },
    });
  }
  if (extensions.length > 0) next.extension = extensions;
  else delete next.extension;

  return next;
}

/** 到着の取消(誤スキャン)。発行直後の状態(未採取)に戻す。 */
export function buildSpecimenArrivalCancel(specimen: fhir4.Specimen): fhir4.Specimen {
  const next: fhir4.Specimen = { ...specimen };
  delete next.status;
  delete next.receivedTime;

  const extensions = (specimen.extension ?? []).filter((e) => e.url !== ARRIVAL_RECORDER_EXT_URL);
  if (extensions.length > 0) next.extension = extensions;
  else delete next.extension;

  return next;
}

/** 外注先へ提出した日時。提出していない管は空。 */
export function specimenShippedAt(specimen: fhir4.Specimen): string {
  return specimen.extension?.find((e) => e.url === SHIPPED_AT_EXT_URL)?.valueDateTime ?? "";
}

/** 提出を書き込んだ Specimen。日時はいま。 */
export function buildSpecimenShipment(
  specimen: fhir4.Specimen,
  recorder?: ArrivalRecorder,
): fhir4.Specimen {
  const extensions = (specimen.extension ?? []).filter((e) => !SHIPMENT_EXT_URLS.includes(e.url));
  extensions.push({ url: SHIPPED_AT_EXT_URL, valueDateTime: nowFhirDateTime() });
  if (recorder) {
    extensions.push({
      url: SHIPMENT_RECORDER_EXT_URL,
      valueReference: {
        reference: `Practitioner/${recorder.practitionerId}`,
        display: recorder.display || undefined,
      },
    });
  }
  return { ...specimen, extension: extensions };
}

/** 提出の取消。提出待ちに戻す。 */
export function buildSpecimenShipmentCancel(specimen: fhir4.Specimen): fhir4.Specimen {
  const next: fhir4.Specimen = { ...specimen };
  const extensions = (specimen.extension ?? []).filter((e) => !SHIPMENT_EXT_URLS.includes(e.url));
  if (extensions.length > 0) next.extension = extensions;
  else delete next.extension;
  return next;
}
