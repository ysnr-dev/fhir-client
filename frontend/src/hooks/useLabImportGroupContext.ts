import { useQuery } from "@tanstack/react-query";
import {
  fetchLabArrivalContext,
  fetchLabOrderCandidates,
  fetchLabelSpecimenByNumber,
  fetchPatientByNumber,
  type LabOrderCandidate,
} from "../api/queries";
import type { LabImportGroup, LabImportOrderContext } from "../fhir/labImportHelpers";
import { isValidLabelNumber, specimenOrderIdOf } from "../fhir/labSpecimenHelpers";
import { departmentOf } from "../fhir/prescriptionHelpers";
import type { LabResultSetting } from "../fhir/labResultHelpers";

// 取込の候補(ORC/OBR 群)を、どの患者のどのオーダーに載せるかを決める。
//
// 検体ラベル番号が最も確かな手掛かり(管 → オーダー → 患者が一意に決まる)。
// 番号が無いファイルは患者番号と採取日でオーダーを絞り、決められなければ人に選ばせる。

/** どの手掛かりで決まったか。画面の説明とボタンの活殺に使う。 */
export type LabImportResolvedBy =
  | "row"
  | "label"
  | "patient-single"
  | "patient-multiple"
  | "patient-none"
  | "unresolved";

export interface LabImportGroupContext {
  patient?: fhir4.Patient;
  order?: fhir4.ServiceRequest;
  /** 紐付け先のオーダー文脈。オーダーなしで登録するときは orderId が空。 */
  orderContext: LabImportOrderContext;
  /** パニック値(緊急異常値)の通知の宛先。オーダーの依頼医。 */
  requester?: fhir4.Reference;
  /** すでに結果があるオーダーなら、その結果の id(既存レポートへの追記になる)。 */
  existingReportId: string;
  /** 採取日が同じオーダーの候補。複数のときだけ画面で選ばせる。 */
  orderCandidates: LabOrderCandidate[];
  resolvedBy: LabImportResolvedBy;
  warnings: string[];
}

const EMPTY_CONTEXT: LabImportGroupContext = {
  orderContext: { orderId: "", departmentId: "", departmentName: "", setting: "" },
  existingReportId: "",
  orderCandidates: [],
  resolvedBy: "unresolved",
  warnings: [],
};

function settingOf(order: fhir4.ServiceRequest | undefined): LabResultSetting {
  const code = order?.category
    ?.flatMap((category) => category.coding ?? [])
    .find((coding) => coding.code === "inpatient" || coding.code === "outpatient")?.code;
  return code === "inpatient" || code === "outpatient" ? code : "";
}

function contextFromOrder(
  order: fhir4.ServiceRequest,
  patient: fhir4.Patient | undefined,
  candidates: LabOrderCandidate[],
  resolvedBy: LabImportResolvedBy,
  warnings: string[],
): LabImportGroupContext {
  const department = departmentOf(order);
  return {
    patient,
    order,
    orderContext: {
      orderId: order.id ?? "",
      departmentId: department.departmentId,
      departmentName: department.departmentName,
      setting: settingOf(order),
    },
    requester: order.requester,
    existingReportId: candidates.find((candidate) => candidate.id === order.id)?.reportId ?? "",
    orderCandidates: candidates,
    resolvedBy,
    warnings,
  };
}

export async function fetchLabImportGroupContext(
  group: LabImportGroup,
  selectedOrderId: string,
): Promise<LabImportGroupContext> {
  const warnings: string[] = [];

  // 1. 人が選んだ(または過去に決めた)オーダー。
  if (selectedOrderId) {
    const arrival = await fetchLabArrivalContext(selectedOrderId);
    if (arrival) {
      const candidates = arrival.patient?.id
        ? await fetchLabOrderCandidates(arrival.patient.id)
        : [];
      return contextFromOrder(arrival.order, arrival.patient, candidates, "row", warnings);
    }
    warnings.push("選んだオーダーが見つかりませんでした。");
  }

  // 2. 検体ラベル番号から管を引き、その管のオーダーを使う。
  if (group.labelNumber && isValidLabelNumber(group.labelNumber)) {
    const specimen = await fetchLabelSpecimenByNumber(group.labelNumber);
    const orderId = specimen ? specimenOrderIdOf(specimen) : "";
    const arrival = orderId ? await fetchLabArrivalContext(orderId) : null;
    if (arrival && patientMatches(arrival.patient, group.patientNumber)) {
      const candidates = arrival.patient?.id ? await fetchLabOrderCandidates(arrival.patient.id) : [];
      return contextFromOrder(arrival.order, arrival.patient, candidates, "label", warnings);
    }
    warnings.push(
      arrival
        ? `検体ラベル番号 ${group.labelNumber} の管は別の患者のものです。患者番号で照合します。`
        : `検体ラベル番号 ${group.labelNumber} の発行記録がありません。`,
    );
  }

  // 3. 患者番号で患者を引き、採取日が同じオーダーを候補にする。
  const patient = await fetchPatientByNumber(group.patientNumber);
  if (!patient?.id) {
    return { ...EMPTY_CONTEXT, warnings: [...warnings, patientNotFoundMessage(group)] };
  }

  const candidates = await fetchLabOrderCandidates(patient.id);
  const sameDay = group.collectedDate
    ? candidates.filter((candidate) => candidate.label.startsWith(group.collectedDate))
    : candidates;

  if (sameDay.length === 1) {
    const arrival = await fetchLabArrivalContext(sameDay[0].id);
    if (arrival) {
      return contextFromOrder(arrival.order, patient, candidates, "patient-single", warnings);
    }
  }

  return {
    ...EMPTY_CONTEXT,
    patient,
    orderCandidates: sameDay,
    resolvedBy: sameDay.length === 0 ? "patient-none" : "patient-multiple",
    warnings,
  };
}

// ラベル番号が引けても、その管がファイルの患者と違うなら採らない。番号の取り違えや
// 採番のずれで他の患者の結果を登録してしまわないようにする。
function patientMatches(patient: fhir4.Patient | undefined, patientNumber: string): boolean {
  if (!patient) return false;
  if (!patientNumber) return true;
  const values = (patient.identifier ?? []).map((identifier) => identifier.value);
  return values.length === 0 || values.includes(patientNumber);
}

function patientNotFoundMessage(group: LabImportGroup): string {
  return group.patientNumber
    ? `患者番号 ${group.patientNumber} の患者が見つかりません。`
    : "ファイルに患者番号がありません。";
}

/**
 * 候補カード 1 枚ぶんの文脈。カードごとに上流を 2〜3 回引くので、
 * 画面は見えているカードだけ enabled にして同時アクセスを抑える。
 */
export function useLabImportGroupContext(
  group: LabImportGroup,
  selectedOrderId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: [
      "lab-import",
      "group",
      group.rows[0]?.lab_result_import_id,
      group.groupNo,
      selectedOrderId,
    ],
    queryFn: () => fetchLabImportGroupContext(group, selectedOrderId),
    enabled,
    staleTime: 30_000,
  });
}
