import { toDateTimeInput, toFhirDateTime } from "./clinicalNoteHelpers";
import {
  medicationCodeableConcept,
  medicineFromCoding,
  UNITS_OF_MEASURE_SYSTEM,
  type PrescriptionFormValues,
  type RpValues,
} from "./prescriptionHelpers";
import { buildRxTaskUpdate } from "./rxTaskHelpers";

// 調剤結果(MedicationDispense)の組み立て。処方一覧の「調剤登録」(RxDispenseModal)
// から使う。
//
// 処方明細(MedicationRequest)1 件につき MedicationDispense を 1 件作り、
// authorizingPrescription で紐付ける。フォームの値は処方オーダー編集と同じ
// PrescriptionFormValues(parsePrescriptionForm でオーダーから復元したもの)を使い、
// 薬局での銘柄変更・用量変更をそのまま載せる。
//
// 疑義照会は薬剤ごとではなくオーダー全体への記録なので、明細の MedicationDispense
// ではなく進捗の Task.note に持たせる(Task は部門の作業記録そのもののため)。

/** 調剤者。未ログインや医療従事者と紐付かないアカウントでは空。 */
export interface RxDispensePerformer {
  practitionerId: string;
  practitionerName: string;
}

/**
 * 調剤数量。用量の意味が用法の基本区分で変わる(処方オーダー登録の入力と同じ):
 * 内服は 1 日量 × 投与日数、頓服は 1 回量 × 投与回数、それ以外(外用など)は全量。
 */
function dispenseQuantity(rp: RpValues, dose: number): number {
  const category = rp.usage?.basic_usage_category;
  const times =
    category === "内服" ? Number(rp.doseDays) : category === "頓服" ? Number(rp.doseCount) : 1;
  const value = dose * (times >= 1 ? times : 1);
  // 0.1 × 3 = 0.30000000000000004 のような浮動小数の端数を落とす。
  return Math.round(value * 1e6) / 1e6;
}

/**
 * 銘柄の変更(代替調剤)かどうか。処方時と違うコードで調剤したら変更。
 * 一般名処方は銘柄の指定がそもそも無いので、どの銘柄で調剤しても「変更」にしない。
 */
function wasSubstituted(
  original: fhir4.MedicationRequest | undefined,
  medicineCode: string,
): boolean {
  const originalMedicine = original ? medicineFromCoding(original) : null;
  if (!originalMedicine || originalMedicine.generic) return false;
  return originalMedicine.medicine_code !== medicineCode;
}

/**
 * 調剤結果の transaction Bundle。明細ぶんの MedicationDispense と、調剤済へ進めた
 * Task(疑義照会があれば note に追記)をまとめて書き込む。
 */
export function buildRxDispenseBundle(
  values: PrescriptionFormValues,
  order: fhir4.ServiceRequest,
  task: fhir4.Task | undefined,
  originalMedicationRequests: fhir4.MedicationRequest[],
  query: string,
  performer: RxDispensePerformer,
): fhir4.Bundle {
  const now = toFhirDateTime(toDateTimeInput(new Date()));
  const patientReference = order.subject?.reference ?? "";
  const originalById = new Map(
    originalMedicationRequests.map((mr) => [mr.id ?? "", mr] as const),
  );

  const entries: fhir4.BundleEntry[] = [];

  for (const rp of values.rps) {
    for (const medLine of rp.medicines) {
      // parsePrescriptionForm で復元した行なので、id は元の MedicationRequest。
      if (!medLine.id || !medLine.medicine) continue;

      const resource: fhir4.MedicationDispense = {
        resourceType: "MedicationDispense",
        status: "completed",
        medicationCodeableConcept: medicationCodeableConcept(medLine.medicine),
        subject: { reference: patientReference },
        authorizingPrescription: [{ reference: `MedicationRequest/${medLine.id}` }],
        whenHandedOver: now,
        substitution: {
          wasSubstituted: wasSubstituted(originalById.get(medLine.id), medLine.medicine.medicine_code),
        },
      };

      const dose = Number(medLine.dose);
      if (dose > 0) {
        resource.quantity = {
          value: dispenseQuantity(rp, dose),
          ...(medLine.medicine.unit_name ? { unit: medLine.medicine.unit_name } : {}),
        };
      }
      if (rp.usage?.basic_usage_category === "内服" && Number(rp.doseDays) >= 1) {
        resource.daysSupply = {
          value: Number(rp.doseDays),
          unit: "日",
          system: UNITS_OF_MEASURE_SYSTEM,
          code: "d",
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
  }

  // 進捗を調剤済へ。Task はステータスを最初に変えたときに作られるので、まだ無ければ作る。
  const taskResource = buildRxTaskUpdate(task, order, "in-progress");
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
export function rxTaskQueryNotes(task: fhir4.Task | undefined): string[] {
  return (task?.note ?? []).map((n) => n.text).filter(Boolean);
}
