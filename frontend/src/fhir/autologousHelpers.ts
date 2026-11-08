import { localDay, toFhirDateTime } from "../lib/dates";
import { type Advisory, advisoryKey, severityOf } from "./advisoryHelpers";
import { COLLECTION_APPOINTMENT_EXT_URL, fulfillAppointmentEntry } from "./autologousPlanHelpers";
import { conceptLabel, referenceIdOfType } from "./shared";
import {
  BLOOD_PRODUCT_NUMBER_SYSTEM,
  DISPENSE_CATEGORY_SYSTEM,
} from "./transfusionDispenseHelpers";
import {
  PRODUCT_SYSTEM,
  bloodTypeExtensions,
  bloodTypeLabel,
  bloodTypeOfExtensions,
  type AboBloodType,
  type RhdBloodType,
} from "./transfusionOrderHelpers";

// 自己血の採血(貯血式)。JAHIS 患者安全ガイド(輸血編)7.7 の「自己血輸血」に当たる。
//
//   オーダー ServiceRequest ←basedOn── 採血記録ハブ Procedure(category = 自己血採血)
//                                        ←partOf── MedicationDispense(status = preparation)= 採った血 1 本
//
// 採った血は出庫記録と同じ MedicationDispense に持つ(製剤番号・型・有効期限)。まだ払い出して
// いないので status は preparation。出庫入力で本人の採血記録にある製剤番号だけを自己血として
// 出せる(本人の血かの照合)。有効期限は採血日に製剤マスタの有効日数を足して決め、手では
// 変えられない(ラベルの記載誤りの事例への対策)。使用予定日(オーダーの投与予定日)が有効期限より
// 後なら警告する。
//
// 採血予定(autologousPlanHelpers.ts の Appointment)に沿って採ったときは、ハブが予定を拡張で指し、
// 同じ transaction で予定を fulfilled にする。予定に無い採血(臨時)はハブだけ。

export const COLLECTION_CATEGORY = { code: "autologous-collection", display: "自己血採血" };
const COLLECTED_VOLUME_UNIT = "mL";

export interface AutologousCollectionFormValues {
  /** 採血日時。datetime-local の入力形式。 */
  collectedAt: string;
  /** 採血量(mL)。 */
  volume: string;
  /** 製剤番号。既定は患者番号・採血日・回数から作る。 */
  lotNumber: string;
  productCode: string;
  productName: string;
  /** 患者の型(検査で確定したもの)。ラベルと出庫の突き合わせに写す。 */
  abo: AboBloodType | "";
  rhd: RhdBloodType | "";
  /** 有効期限(採血日 + 製剤マスタの有効日数)。入力はできない。 */
  expiry: string;
  performerId: string;
  performerName: string;
  comment: string;
}

/** 採血日と有効日数から有効期限を決める。有効日数が無ければ空。 */
export function expiryFrom(collectedAt: string, shelfLifeDays: number | null | undefined): string {
  const day = localDay(collectedAt);
  if (!day || shelfLifeDays == null) return "";
  const date = new Date(`${day}T00:00:00`);
  date.setDate(date.getDate() + shelfLifeDays);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 製剤番号の既定。「A-<患者番号>-<採血日 YYYYMMDD>-<回数>」。 */
export function defaultLotNumber(patientNumber: string, collectedAt: string, sequence: number): string {
  const day = localDay(collectedAt).replaceAll("-", "");
  return `A-${patientNumber || "0"}-${day}-${sequence}`;
}

/** 使用予定日が有効期限より後なら警告(ガイド 7.7.3-2)。 */
export function autologousExpiryAdvisory(expiry: string, scheduledDate: string): Advisory | null {
  const target = localDay(scheduledDate);
  if (!expiry || !target || expiry >= target) return null;
  return {
    key: advisoryKey("autologous-expiry", expiry, target),
    kind: "autologous-expiry",
    severity: severityOf("autologous-expiry", true),
    message: `有効期限（${expiry}）が使用予定日（${target}）より前です`,
  };
}

function buildCollectionHub(
  values: AutologousCollectionFormValues,
  subject: fhir4.Reference,
  orderReference: string,
  appointment?: fhir4.Appointment,
): fhir4.Procedure {
  const procedure: fhir4.Procedure = {
    resourceType: "Procedure",
    status: "completed",
    category: { coding: [{ system: DISPENSE_CATEGORY_SYSTEM, ...COLLECTION_CATEGORY }] },
    code: { text: COLLECTION_CATEGORY.display },
    subject,
    basedOn: [{ reference: orderReference }],
    performedDateTime: toFhirDateTime(values.collectedAt),
  };
  if (values.performerId) {
    procedure.performer = [
      { actor: { reference: `Practitioner/${values.performerId}`, display: values.performerName || undefined } },
    ];
  }
  if (values.comment.trim()) procedure.note = [{ text: values.comment.trim() }];
  if (appointment?.id) {
    procedure.extension = [
      { url: COLLECTION_APPOINTMENT_EXT_URL, valueReference: { reference: `Appointment/${appointment.id}` } },
    ];
  }
  return procedure;
}

function buildCollectedUnit(
  values: AutologousCollectionFormValues,
  subject: fhir4.Reference,
  hubReference: string,
): fhir4.MedicationDispense {
  const unit: fhir4.MedicationDispense = {
    resourceType: "MedicationDispense",
    // まだ払い出していない(保管中)。出庫で本人のものと突き合わせる。
    status: "preparation",
    medicationCodeableConcept: {
      coding: [{ system: PRODUCT_SYSTEM, code: values.productCode, display: values.productName }],
      text: values.productName,
    },
    subject,
    partOf: [{ reference: hubReference }],
    identifier: [{ system: BLOOD_PRODUCT_NUMBER_SYSTEM, value: values.lotNumber.trim() }],
    whenPrepared: toFhirDateTime(values.collectedAt),
  };
  const volume = Number(values.volume);
  if (Number.isFinite(volume) && volume > 0) unit.quantity = { value: volume, unit: COLLECTED_VOLUME_UNIT };
  const extension = bloodTypeExtensions(values.abo, values.rhd);
  if (values.expiry) {
    extension.push({
      url: "http://fhir-client.local/StructureDefinition/transfusion-expiry",
      valueDate: values.expiry,
    });
  }
  if (extension.length > 0) unit.extension = extension;
  return unit;
}

/**
 * 採血登録の transaction Bundle(ハブ + 採った血 1 本)。進捗の Task は動かさない。
 * 予定に沿った採血なら、その予定を採血済み(fulfilled)にする PUT も同梱する。
 */
export function buildAutologousCollectionBundle(
  values: AutologousCollectionFormValues,
  order: fhir4.ServiceRequest,
  appointment?: fhir4.Appointment,
): fhir4.Bundle {
  const subject = order.subject ?? {};
  const hubReference = `urn:uuid:${crypto.randomUUID()}`;
  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: [
      {
        fullUrl: hubReference,
        resource: buildCollectionHub(values, subject, `ServiceRequest/${order.id ?? ""}`, appointment),
        request: { method: "POST", url: "Procedure" },
      },
      {
        fullUrl: `urn:uuid:${crypto.randomUUID()}`,
        resource: buildCollectedUnit(values, subject, hubReference),
        request: { method: "POST", url: "MedicationDispense" },
      },
      ...(appointment?.id ? [fulfillAppointmentEntry(appointment)] : []),
    ],
  };
}

/** 採った血の量(mL)の合計。 */
export function collectedVolumeTotal(units: AutologousUnit[]): number {
  return units.reduce((sum, unit) => sum + (parseFloat(unit.volume) || 0), 0);
}

export function isAutologousCollectionProcedure(procedure: fhir4.Procedure): boolean {
  return Boolean(
    procedure.category?.coding?.some(
      (c) => c.system === DISPENSE_CATEGORY_SYSTEM && c.code === COLLECTION_CATEGORY.code,
    ),
  );
}

/** 採った血 1 本(保存済み)。 */
export interface AutologousUnit {
  /** 採血記録ハブの Procedure id(ラベルの印刷はこれで引く)。 */
  procedureId: string;
  dispenseId: string;
  lotNumber: string;
  productCode: string;
  productName: string;
  volume: string;
  abo: string;
  rhd: string;
  collectedAt: string;
  expiry: string;
  performerName: string;
  comment: string;
  /** 「No.… 2026-11-01 採血 400mL A型 RhD＋ 期限 2026-12-06」。 */
  label: string;
}

export function parseAutologousUnit(
  hub: fhir4.Procedure,
  dispense: fhir4.MedicationDispense,
): AutologousUnit {
  const type = bloodTypeOfExtensions(dispense.extension);
  const expiry =
    dispense.extension?.find((e) => e.url.endsWith("/transfusion-expiry"))?.valueDate ?? "";
  const collectedAt = (hub.performedDateTime ?? "").slice(0, 16).replace("T", " ");
  const unit: Omit<AutologousUnit, "label"> = {
    procedureId: hub.id ?? "",
    dispenseId: dispense.id ?? "",
    lotNumber: dispense.identifier?.[0]?.value ?? "",
    productCode: dispense.medicationCodeableConcept?.coding?.find((c) => c.system === PRODUCT_SYSTEM)?.code ?? "",
    productName: conceptLabel(dispense.medicationCodeableConcept),
    volume: dispense.quantity?.value == null ? "" : `${dispense.quantity.value}${dispense.quantity.unit ?? ""}`,
    abo: type.abo,
    rhd: type.rhd,
    collectedAt,
    expiry,
    performerName: hub.performer?.[0]?.actor?.display ?? "",
    comment: hub.note?.map((n) => n.text).filter(Boolean).join("\n") ?? "",
  };
  return {
    ...unit,
    label: [
      unit.lotNumber && `No.${unit.lotNumber}`,
      collectedAt.slice(0, 10) && `${collectedAt.slice(0, 10)} 採血`,
      unit.volume,
      bloodTypeLabel(unit.abo, unit.rhd),
      expiry && `期限 ${expiry}`,
    ]
      .filter(Boolean)
      .join(" "),
  };
}

/** 採血記録をオーダー id ごとにまとめる(採血日の順)。 */
export function autologousUnitsByOrderId(
  procedures: fhir4.Procedure[],
  dispenses: fhir4.MedicationDispense[],
): Map<string, AutologousUnit[]> {
  const byOrderId = new Map<string, AutologousUnit[]>();
  for (const hub of procedures.filter(isAutologousCollectionProcedure)) {
    const hubId = hub.id ?? "";
    const own = dispenses.filter((d) =>
      (d.partOf ?? []).some((r) => referenceIdOfType(r.reference, "Procedure") === hubId),
    );
    for (const basedOn of hub.basedOn ?? []) {
      const orderId = referenceIdOfType(basedOn.reference, "ServiceRequest");
      if (!orderId) continue;
      const list = byOrderId.get(orderId) ?? [];
      list.push(...own.map((d) => parseAutologousUnit(hub, d)));
      byOrderId.set(orderId, list);
    }
  }
  for (const list of byOrderId.values()) list.sort((a, b) => a.collectedAt.localeCompare(b.collectedAt));
  return byOrderId;
}

/** 患者の採血済み・未出庫の自己血(status = preparation の MedicationDispense)。 */
export function autologousUnitsOf(
  procedures: fhir4.Procedure[],
  dispenses: fhir4.MedicationDispense[],
): AutologousUnit[] {
  const hubs = new Map(procedures.filter(isAutologousCollectionProcedure).map((p) => [p.id ?? "", p]));
  return dispenses
    .filter((d) => d.status === "preparation")
    .flatMap((d) => {
      const hub = hubs.get(referenceIdOfType(d.partOf?.[0]?.reference, "Procedure"));
      return hub ? [parseAutologousUnit(hub, d)] : [];
    })
    .sort((a, b) => a.collectedAt.localeCompare(b.collectedAt));
}

