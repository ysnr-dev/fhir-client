import { toDateTimeInput, toFhirDateTime } from "./clinicalNoteHelpers";
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

// 到着を記録したユーザー。FHIR の Specimen に「受け取った人」を表す標準要素が
// 無いため(collection.collector は採取した人)、ローカル拡張で持つ。
const ARRIVAL_RECORDER_EXT_URL = "http://fhir-client.local/StructureDefinition/lab-arrival-recorder";

/**
 * スキャン入力の形式検証(11 桁 + M10W3 チェックデジット)。backend の採番
 * (LabLabelNumber.check_digit)と同じ計算で、手入力ミスに送信前に気付くためのもの。
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
