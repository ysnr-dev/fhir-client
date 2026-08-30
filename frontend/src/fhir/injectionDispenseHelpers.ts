import { toDateTimeInput, toFhirDateTime } from "./clinicalNoteHelpers";
import { groupInjectionByRp } from "./injectionHelpers";
import { buildInjectionTaskUpdate } from "./injectionTaskHelpers";
import {
  ORDER_IN_RP_SYSTEM,
  RP_NUMBER_SYSTEM,
  identifierValue,
  medicationCodeableConcept,
  medicineFromCoding,
} from "./prescriptionHelpers";
import type { Medicine } from "../api/masterClient";

// 注射の払出(MedicationDispense)の組み立て。注射一覧の「払出登録」
// (InjectionDispenseModal)から使う。処方の調剤(rxDispenseHelpers)と同じ考え方:
//
// - 薬剤(MedicationRequest)1 件につき MedicationDispense を 1 件作り、
//   authorizingPrescription で紐付ける
// - 銘柄を変えて出したら substitution.wasSubstituted = true
// - 疑義照会はオーダー全体への記録なので、進捗の Task.note に持たせる
// - 払出済(in-progress)の Task と 1 つの transaction で書く
//
// 処方と違うのは数量の意味。注射は 1 日 1 オーダーで、RP の開始時刻の数だけ施用が
// あるので、払出数量の既定は「投与量 × その日の施用回数」(開始時刻が無ければ 1 回)。
// 混注の準備(ミキシング)そのものは記録しない — 払い出した薬剤と数量が記録の対象で、
// 誰がいつ混ぜたかは実施記録(施用)側の関心事。

/** 払出者。未ログインや医療従事者と紐付かないアカウントでは空。 */
export interface InjectionDispensePerformer {
  practitionerId: string;
  practitionerName: string;
}

/** 払い出す薬剤 1 行。オーダーの薬剤行から作る。 */
export interface InjectionDispenseLine {
  medicationRequestId: string;
  rpNumber: number;
  orderInRp: number;
  /** 払い出す銘柄。オーダーの銘柄を初期値にし、代替調剤なら選び直す。 */
  medicine: Medicine;
  /** オーダーの銘柄(参考表示と代替判定)。 */
  ordered: { code: string; name: string; dose?: number; unit?: string };
  /** その日の施用回数(RP の開始時刻の数、無ければ 1)。 */
  times: number;
  /** 払出数量。 */
  quantity: string;
}

/**
 * オーダーの薬剤から払出の初期行を作る。オーダーの銘柄を Medicine 型に起こすのは
 * medicineFromCoding(処方と同じ。コードと名称・単位だけの薄い値)。
 */
export function dispenseLinesFromOrder(
  mrs: fhir4.MedicationRequest[],
): InjectionDispenseLine[] {
  const rps = groupInjectionByRp(mrs);
  const mrByKey = new Map<string, fhir4.MedicationRequest>();
  for (const mr of mrs) {
    const rp = identifierValue(mr, RP_NUMBER_SYSTEM) ?? "0";
    const order = identifierValue(mr, ORDER_IN_RP_SYSTEM) ?? "0";
    mrByKey.set(`${rp}-${order}`, mr);
  }
  return rps.flatMap((rp) => {
    const times = Math.max(1, rp.startTimes.length);
    return rp.medicines.flatMap((med) => {
      const mr = mrByKey.get(`${rp.rpNumber}-${med.orderInRp}`);
      const medicine = mr ? medicineFromCoding(mr) : null;
      if (!mr?.id || !medicine) return [];
      const dose = med.dose ?? 0;
      return [
        {
          medicationRequestId: mr.id,
          rpNumber: rp.rpNumber,
          orderInRp: med.orderInRp,
          medicine,
          ordered: { code: med.code, name: med.name, dose: med.dose, unit: med.unit },
          times,
          quantity: dose > 0 ? String(Math.round(dose * times * 1e6) / 1e6) : "",
        },
      ];
    });
  });
}

/**
 * 払出の transaction Bundle。薬剤ぶんの MedicationDispense と、払出済へ進めた
 * Task(疑義照会があれば note に追記)をまとめて書き込む。
 */
export function buildInjectionDispenseBundle(
  lines: InjectionDispenseLine[],
  order: fhir4.ServiceRequest,
  task: fhir4.Task | undefined,
  query: string,
  performer: InjectionDispensePerformer,
): fhir4.Bundle {
  const now = toFhirDateTime(toDateTimeInput(new Date()));
  const patientReference = order.subject?.reference ?? "";
  const entries: fhir4.BundleEntry[] = [];

  for (const line of lines) {
    const resource: fhir4.MedicationDispense = {
      resourceType: "MedicationDispense",
      status: "completed",
      medicationCodeableConcept: medicationCodeableConcept(line.medicine),
      subject: { reference: patientReference },
      authorizingPrescription: [{ reference: `MedicationRequest/${line.medicationRequestId}` }],
      whenHandedOver: now,
      substitution: { wasSubstituted: line.medicine.medicine_code !== line.ordered.code },
    };
    const quantity = Number(line.quantity);
    if (quantity > 0) {
      resource.quantity = {
        value: quantity,
        ...(line.medicine.unit_name ? { unit: line.medicine.unit_name } : {}),
      };
    }
    if (performer.practitionerId) {
      resource.performer = [
        {
          actor: {
            reference: `Practitioner/${performer.practitionerId}`,
            ...(performer.practitionerName ? { display: performer.practitionerName } : {}),
          },
        },
      ];
    }
    entries.push({ resource, request: { method: "POST", url: "MedicationDispense" } });
  }

  // 進捗を払出済へ。Task はステータスを最初に変えたときに作られるので、まだ無ければ作る。
  const taskResource = buildInjectionTaskUpdate(task, order, "in-progress");
  if (query) {
    taskResource.note = [...(taskResource.note ?? []), { text: query, time: now }];
  }
  entries.push({
    resource: taskResource,
    request: task?.id
      ? { method: "PUT", url: `Task/${task.id}` }
      : { method: "POST", url: "Task" },
  });

  return { resourceType: "Bundle", type: "transaction", entry: entries };
}

/** Task.note に記録した疑義照会。無ければ空。 */
export function injectionTaskQueryNotes(task: fhir4.Task | undefined): string[] {
  return (task?.note ?? []).map((n) => n.text).filter(Boolean);
}
