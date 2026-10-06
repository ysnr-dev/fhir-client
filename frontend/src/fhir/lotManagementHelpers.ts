import { dateTimeLabel } from "../lib/dates";
import { ENDOSCOPY_ORDER_TYPE } from "./endoscopyOrderHelpers";
import { INJECTION_ORDER_TYPE } from "./injectionHelpers";
import { lotNumberOf } from "./lotNumberHelpers";
import { ORDER_TYPE_SYSTEM } from "./orderHeader";
import { displayName, patientNumberOf } from "./patientHelpers";
import { MEDICINE_CODE_SYSTEM } from "./prescriptionHelpers";
import { RAD_ORDER_TYPE } from "./radOrderHelpers";
import { conceptLabel, quantityLabel, referenceId, referenceIdOfType, resourcesOfType } from "./shared";
import { SURGERY_ORDER_TYPE } from "./surgeryOrderHelpers";
import { TRANSFUSION_ORDER_TYPE } from "./transfusionOrderHelpers";
import { TREATMENT_ORDER_TYPE } from "./treatmentOrderHelpers";

// ロット管理(docs/lot-number-design.md)。ロット番号から患者を逆引きする一覧と、ロット管理の薬で
// ロットが未入力の投与の一覧に出す行を、MedicationAdministration と実施記録(ハブの Procedure)・
// 患者から組み立てる。

/** 薬を記録する実施記録の種別。未入力一覧は輸血を除く(製剤番号は輸血の実施入力で必須)。 */
export const LOT_RECORD_ORDER_TYPES = [
  INJECTION_ORDER_TYPE,
  TREATMENT_ORDER_TYPE,
  SURGERY_ORDER_TYPE,
  ENDOSCOPY_ORDER_TYPE,
  RAD_ORDER_TYPE,
];

const KIND_LABELS = new Map(
  [...LOT_RECORD_ORDER_TYPES, TRANSFUSION_ORDER_TYPE].map((type) => [type.code, type.display]),
);

export interface LotRecordRow {
  administration: fhir4.MedicationAdministration;
  /** 実施日時の表示。 */
  performedAt: string;
  /** 並べ替え用の実施日時(FHIR の値)。 */
  performedSort: string;
  patientId: string;
  patientNumber: string;
  patientName: string;
  medicineCode: string;
  medicineName: string;
  dose: string;
  lotNumber: string;
  /** 実施記録の種別(注射・処置…)。 */
  kind: string;
}

function performedOf(administration: fhir4.MedicationAdministration): string {
  return administration.effectiveDateTime ?? administration.effectivePeriod?.start ?? "";
}

export function medicineCodeOf(administration: fhir4.MedicationAdministration): string {
  return administration.medicationCodeableConcept?.coding?.find((c) => c.system === MEDICINE_CODE_SYSTEM)?.code ?? "";
}

function kindOf(procedure: fhir4.Procedure | undefined): string {
  const code = procedure?.category?.coding?.find((c) => c.system === ORDER_TYPE_SYSTEM)?.code;
  return (code && KIND_LABELS.get(code)) || "";
}

/** 検索の応答(MA・ハブの Procedure・患者が混ざった Bundle 群)から一覧の行を作る。新しい順。 */
export function lotRecordRows(
  administrations: fhir4.MedicationAdministration[],
  bundles: fhir4.Bundle[],
): LotRecordRow[] {
  const patients = new Map(
    bundles.flatMap((b) => resourcesOfType<fhir4.Patient>(b, "Patient")).map((p) => [p.id ?? "", p]),
  );
  const procedures = new Map(
    bundles.flatMap((b) => resourcesOfType<fhir4.Procedure>(b, "Procedure")).map((p) => [p.id ?? "", p]),
  );
  return administrations
    .map((administration) => {
      const patientId = referenceIdOfType(administration.subject?.reference, "Patient");
      const patient = patients.get(patientId);
      const hub = procedures.get(referenceId(administration.partOf?.[0]?.reference) ?? "");
      const performed = performedOf(administration);
      return {
        administration,
        performedAt: dateTimeLabel(performed),
        performedSort: performed,
        patientId,
        patientNumber: (patient && patientNumberOf(patient)) ?? "",
        patientName: patient ? displayName(patient) : "",
        medicineCode: medicineCodeOf(administration),
        medicineName: conceptLabel(administration.medicationCodeableConcept),
        dose: quantityLabel(administration.dosage?.dose),
        lotNumber: lotNumberOf(administration),
        kind: kindOf(hub),
      };
    })
    .sort((a, b) => b.performedSort.localeCompare(a.performedSort));
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** 一覧の CSV(Excel で開けるよう BOM 付き UTF-8・CRLF)。 */
export function lotRecordCsv(rows: LotRecordRow[]): Blob {
  const header = ["実施日時", "患者番号", "氏名", "種別", "医薬品コード", "医薬品名", "量", "ロット番号"];
  const lines = [header, ...rows.map((r) => [
    r.performedAt,
    r.patientNumber,
    r.patientName,
    r.kind,
    r.medicineCode,
    r.medicineName,
    r.dose,
    r.lotNumber,
  ])].map((cells) => cells.map(csvCell).join(","));
  return new Blob(["﻿", lines.join("\r\n"), "\r\n"], { type: "text/csv;charset=utf-8" });
}
