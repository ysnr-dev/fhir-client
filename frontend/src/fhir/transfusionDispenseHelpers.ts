import { localDay, toFhirDateTime, today } from "../lib/dates";
import { type Advisory, advisoryKey, severityOf } from "./advisoryHelpers";
import type { BloodTypeSummary } from "./bloodTypeHelpers";
import { conceptLabel, displayOf, referenceIdOfType } from "./shared";
import {
  PRODUCT_SYSTEM,
  UNKNOWN_BLOOD_TYPE,
  bloodTypeExtensions,
  bloodTypeLabel,
  bloodTypeOfExtensions,
  compatibleAbo,
  compatibleRhd,
  crossmatchRequiredFor,
  productNeedsBloodType,
  type AboBloodType,
  type PatientBloodTypeForOrder,
  type RhdBloodType,
  type TransfusionOrderSummary,
  type TransfusionProductValues,
} from "./transfusionOrderHelpers";
import { buildTransfusionTaskUpdate } from "./transfusionTaskHelpers";

// 輸血の出庫記録(払出)。JAHIS 患者安全ガイド(輸血編)7.3〜7.4 の「割付・払出」に当たる。
//
//   オーダー ServiceRequest ←basedOn── 出庫記録ハブ Procedure(category = 出庫)
//                                        ←partOf── MedicationDispense ×N = 払い出したバッグ 1 本
//
// バッグごとに製剤番号・血液型・有効期限・照射の有無・交差適合試験の結果を持つ。実施記録
// (transfusionResultHelpers)と同じ「ハブ + 子」の形にするのは、上流の MedicationDispense が
// オーダー(ServiceRequest)を直接は参照できず(authorizingPrescription は MedicationRequest 専用)、
// 実施記録と同じ検索(`Procedure?based-on=` + `_revinclude=MedicationDispense:part-of`)で
// 引けるようにするため。ハブの category は実施記録(order-type|transfusion)と別にして、
// 実施記録を数える処理(看護必要度・医事)が出庫を実施と取り違えないようにする。
//
// 出庫取消では記録ごと消す(実施取消と同じ。取り消したのに残っていると嘘の記録になる)。

/** 出庫記録ハブの category。実施記録(order-type)とは別の体系。 */
export const DISPENSE_CATEGORY_SYSTEM = "http://fhir-client.local/CodeSystem/procedure-category";
export const DISPENSE_CATEGORY = { code: "transfusion-dispense", display: "輸血出庫" };

/** 製剤番号(献血番号)。MedicationDispense.identifier に持つ。 */
export const BLOOD_PRODUCT_NUMBER_SYSTEM = "http://fhir-client.local/IdSystem/blood-product-number";

const EXPIRY_EXT_URL = "http://fhir-client.local/StructureDefinition/transfusion-expiry";
const IRRADIATED_EXT_URL = "http://fhir-client.local/StructureDefinition/transfusion-irradiated";
const CROSSMATCH_EXT_URL = "http://fhir-client.local/StructureDefinition/transfusion-crossmatch";
export const CROSSMATCH_SYSTEM = "http://fhir-client.local/CodeSystem/transfusion-crossmatch";

/** 払出に関わった人の役割(MedicationDispense.performer.function)。 */
const PERFORMER_FUNCTION_SYSTEM = "http://fhir-client.local/CodeSystem/transfusion-dispense-performer";
const DISPENSER_FUNCTION = { code: "dispenser", display: "出庫者" };
const CROSSMATCH_FUNCTION = { code: "crossmatch", display: "適合試験者" };

/** 交差適合試験の結果。省略 = T&S や血漿など試験を行わない払出。 */
export type CrossmatchResult = "compatible" | "incompatible" | "omitted";

export const CROSSMATCH_OPTIONS: { code: CrossmatchResult; display: string }[] = [
  { code: "compatible", display: "適合" },
  { code: "incompatible", display: "不適合" },
  { code: "omitted", display: "省略" },
];

export function crossmatchDisplay(code: string): string {
  return displayOf(CROSSMATCH_OPTIONS, code);
}

// ---- 入力フォームの値 ----

/** 払い出すバッグ 1 本。 */
export interface TransfusionDispenseBag {
  productCode: string;
  productName: string;
  unitLabel: string;
  units: string;
  /** 製剤番号(献血番号)。 */
  lotNumber: string;
  /** バッグの血液型(ラベルのもの)。 */
  abo: AboBloodType | "";
  rhd: RhdBloodType | "";
  /** 有効期限 "YYYY-MM-DD"。 */
  expiry: string;
  irradiated: boolean;
  crossmatch: CrossmatchResult | "";
  /** 対応する依頼の製剤明細(ServiceRequest.id)。依頼との突き合わせに使う。 */
  orderedItemId: string;
}

export interface TransfusionDispenseFormValues {
  /** 出庫日時。datetime-local の入力形式。 */
  dispensedAt: string;
  dispenserId: string;
  dispenserName: string;
  /** 交差適合試験を行った人。出庫者と別のことがあるので名前で持つ。 */
  crossmatchPerformerName: string;
  bags: TransfusionDispenseBag[];
  comment: string;
}

export function emptyDispenseBag(): TransfusionDispenseBag {
  return {
    productCode: "",
    productName: "",
    unitLabel: "単位",
    units: "",
    lotNumber: "",
    abo: "",
    rhd: "",
    expiry: "",
    irradiated: false,
    crossmatch: "",
    orderedItemId: "",
  };
}

/** オーダーの製剤 1 行につきバッグ 1 本を初期行にする。型は依頼の型を写す。 */
export function dispenseBagsFromOrder(products: TransfusionProductValues[]): TransfusionDispenseBag[] {
  return products
    .filter((product) => product.productCode)
    .map((product) => ({
      ...emptyDispenseBag(),
      productCode: product.productCode,
      productName: product.productName,
      unitLabel: product.unitLabel,
      units: product.units,
      abo: product.abo,
      rhd: product.rhd,
      orderedItemId: product.id,
    }));
}

export function emptyTransfusionDispenseForm(
  products: TransfusionProductValues[],
  now: string,
): TransfusionDispenseFormValues {
  return {
    dispensedAt: now,
    dispenserId: "",
    dispenserName: "",
    crossmatchPerformerName: "",
    bags: dispenseBagsFromOrder(products),
    comment: "",
  };
}

// ---- 割付・払出のチェック ----

/** 依頼の製剤明細(突き合わせの相手)。 */
export interface OrderedProductLine {
  id: string;
  productCode: string;
  productName: string;
  abo: string;
  rhd: string;
}

export interface DispenseCheckContext {
  /** 突き合わせる患者の型。検査で確定した型(無ければオーダー時点の型)。 */
  patient: PatientBloodTypeForOrder;
  /** 緊急度のレベル(RhD の適合に効く)。 */
  level: number;
  /** 輸血検査区分。交差適合試験の結果が要るか。 */
  testType: string;
  /** 投与予定日(有効期限との比較)。無ければ今日。 */
  scheduledDate: string;
  ordered: OrderedProductLine[];
  /** 製剤マスタ(区分・照射と交差適合試験の要否)。 */
  productItems: {
    item_code: string;
    category: string;
    requires_crossmatch: boolean;
    requires_irradiation: boolean;
  }[];
  /** 不規則抗体スクリーニングの最新の結果(陽性なら抗原陰性血の確認を求める)。 */
  antibodyScreen: string;
}

/** 検査結果の表記から陽性かどうか。 */
function isPositive(text: string): boolean {
  const value = text.normalize("NFKC").toUpperCase();
  return /陽性|POSITIVE|^\+$|\(\+\)/.test(value);
}

function dayNumber(date: string): number {
  return Math.floor(new Date(`${date}T00:00:00`).getTime() / 86_400_000);
}

/**
 * 出庫入力のバッグに対する警告(ガイド 7.3.3 ①〜⑤・照射・交差適合試験)。
 * 製剤を選んでいない行は見ない。
 */
export function dispenseAdvisories(
  bags: TransfusionDispenseBag[],
  context: DispenseCheckContext,
): Advisory[] {
  const list: Advisory[] = [];
  const target = localDay(context.scheduledDate) || today();
  const warn = (kind: Advisory["kind"], parts: (string | number)[], message: string) =>
    list.push({ key: advisoryKey(kind, ...parts), kind, severity: severityOf(kind, true), message });

  for (const [index, bag] of bags.entries()) {
    if (!bag.productCode) continue;
    const label = `バッグ${index + 1}`;
    const item = context.productItems.find((i) => i.item_code === bag.productCode);
    const category = item?.category;
    const ordered = context.ordered.find((line) => line.id === bag.orderedItemId);
    const bagType = bloodTypeLabel(bag.abo, bag.rhd);

    // ① 患者の型との適合。
    if (productNeedsBloodType(category) && context.patient.abo) {
      const aboOk = !bag.abo || compatibleAbo(context.patient, category).includes(bag.abo);
      const rhdOk = !bag.rhd || compatibleRhd(context.patient, category, context.level).includes(bag.rhd);
      if (!aboOk || !rhdOk) {
        warn("dispense-blood-type", [index, bag.abo, bag.rhd], `${label}: ${bagType} は患者の型（${bloodTypeLabel(context.patient.abo, context.patient.rhd)}）に適合しません`);
      }
    }
    // ② 依頼の型との一致。
    if (ordered && (ordered.abo || ordered.rhd) && bag.abo && (bag.abo !== ordered.abo || (ordered.rhd && bag.rhd !== ordered.rhd))) {
      warn("dispense-requested-type", [index, bag.abo, bag.rhd], `${label}: ${bagType} は依頼の型（${bloodTypeLabel(ordered.abo, ordered.rhd)}）と違います`);
    }
    // ③ 依頼の製剤との一致。
    if (ordered && ordered.productCode !== bag.productCode) {
      warn("dispense-product", [index, bag.productCode], `${label}: ${bag.productName} は依頼の製剤（${ordered.productName}）と違います`);
    }
    // ④ 有効期限と使用予定日。
    if (!bag.expiry) {
      warn("dispense-expiry", [index, "missing"], `${label}: 有効期限が未入力です`);
    } else if (dayNumber(bag.expiry) < dayNumber(target)) {
      warn("dispense-expiry", [index, bag.expiry, target], `${label}: 有効期限（${bag.expiry}）が投与予定日（${target}）より前です`);
    }
    // 照射。
    if (item?.requires_irradiation && !bag.irradiated) {
      warn("dispense-irradiation", [index], `${label}: 照射が要る製剤ですが未照射です`);
    }
    // 交差適合試験。
    const needsCrossmatch = Boolean(item?.requires_crossmatch) && crossmatchRequiredFor(context.testType);
    if (needsCrossmatch && !bag.crossmatch) {
      warn("dispense-crossmatch", [index, "missing"], `${label}: 交差適合試験の結果が未入力です`);
    } else if (bag.crossmatch === "incompatible") {
      warn("dispense-crossmatch", [index, "incompatible"], `${label}: 交差適合試験が不適合です`);
    }
  }

  // ⑤ 不規則抗体のある患者。抗原陰性血かどうかはバッグ側に情報が無いので、確認を求める。
  if (isPositive(context.antibodyScreen)) {
    warn("antibody-positive", [context.antibodyScreen], `不規則抗体が陽性です（${context.antibodyScreen}）。抗原陰性血を確認してください`);
  }

  return list;
}

/** 検査で確定した型を優先し、無ければオーダー時点の型(不明は空)。 */
export function patientTypeForDispense(
  summary: BloodTypeSummary | null,
  order: TransfusionOrderSummary,
): PatientBloodTypeForOrder {
  if (summary?.tested) return { abo: summary.abo as AboBloodType, rhd: summary.rhd as RhdBloodType };
  return {
    abo: order.aboBloodType === UNKNOWN_BLOOD_TYPE ? "" : (order.aboBloodType as AboBloodType | ""),
    rhd: order.rhdBloodType === UNKNOWN_BLOOD_TYPE ? "" : (order.rhdBloodType as RhdBloodType | ""),
  };
}

// ---- FHIR リソースの組み立て ----

function buildDispenseHub(
  values: TransfusionDispenseFormValues,
  subject: fhir4.Reference,
  orderReference: string,
): fhir4.Procedure {
  const procedure: fhir4.Procedure = {
    resourceType: "Procedure",
    status: "completed",
    category: { coding: [{ system: DISPENSE_CATEGORY_SYSTEM, ...DISPENSE_CATEGORY }] },
    code: { text: DISPENSE_CATEGORY.display },
    subject,
    basedOn: [{ reference: orderReference }],
    performedDateTime: toFhirDateTime(values.dispensedAt),
  };
  if (values.dispenserId) {
    procedure.performer = [
      {
        actor: {
          reference: `Practitioner/${values.dispenserId}`,
          display: values.dispenserName || undefined,
        },
      },
    ];
  }
  if (values.comment.trim()) procedure.note = [{ text: values.comment.trim() }];
  return procedure;
}

function buildBagDispense(
  bag: TransfusionDispenseBag,
  values: TransfusionDispenseFormValues,
  subject: fhir4.Reference,
  hubReference: string,
): fhir4.MedicationDispense {
  const dispense: fhir4.MedicationDispense = {
    resourceType: "MedicationDispense",
    status: "completed",
    medicationCodeableConcept: {
      coding: [{ system: PRODUCT_SYSTEM, code: bag.productCode, display: bag.productName }],
      text: bag.productName,
    },
    subject,
    partOf: [{ reference: hubReference }],
    whenHandedOver: toFhirDateTime(values.dispensedAt),
  };
  if (bag.lotNumber.trim()) {
    dispense.identifier = [{ system: BLOOD_PRODUCT_NUMBER_SYSTEM, value: bag.lotNumber.trim() }];
  }
  const units = Number(bag.units);
  if (Number.isFinite(units) && units > 0) {
    dispense.quantity = { value: units, unit: bag.unitLabel || "単位" };
  }
  if (bag.orderedItemId) {
    dispense.supportingInformation = [{ reference: `ServiceRequest/${bag.orderedItemId}` }];
  }

  const performer: fhir4.MedicationDispensePerformer[] = [];
  if (values.dispenserId) {
    performer.push({
      function: { coding: [{ system: PERFORMER_FUNCTION_SYSTEM, ...DISPENSER_FUNCTION }] },
      actor: {
        reference: `Practitioner/${values.dispenserId}`,
        display: values.dispenserName || undefined,
      },
    });
  }
  if (values.crossmatchPerformerName.trim()) {
    performer.push({
      function: { coding: [{ system: PERFORMER_FUNCTION_SYSTEM, ...CROSSMATCH_FUNCTION }] },
      actor: { display: values.crossmatchPerformerName.trim() },
    });
  }
  if (performer.length > 0) dispense.performer = performer;

  const extension: fhir4.Extension[] = bloodTypeExtensions(bag.abo, bag.rhd);
  if (bag.expiry) extension.push({ url: EXPIRY_EXT_URL, valueDate: bag.expiry });
  extension.push({ url: IRRADIATED_EXT_URL, valueBoolean: bag.irradiated });
  if (bag.crossmatch) {
    extension.push({
      url: CROSSMATCH_EXT_URL,
      valueCodeableConcept: {
        coding: [{ system: CROSSMATCH_SYSTEM, code: bag.crossmatch, display: crossmatchDisplay(bag.crossmatch) }],
        text: crossmatchDisplay(bag.crossmatch),
      },
    });
  }
  dispense.extension = extension;

  return dispense;
}

/**
 * 出庫登録の transaction Bundle。出庫記録一式(ハブ・バッグ)と Task の出庫済を 1 つにまとめ、
 * 記録だけ保存されて進捗が止まる状態を作らない。
 */
export function buildTransfusionDispenseBundle(
  values: TransfusionDispenseFormValues,
  order: fhir4.ServiceRequest,
  task: fhir4.Task | undefined,
): fhir4.Bundle {
  const subject = order.subject ?? {};
  const hubReference = `urn:uuid:${crypto.randomUUID()}`;
  const entries: fhir4.BundleEntry[] = [
    {
      fullUrl: hubReference,
      resource: buildDispenseHub(values, subject, `ServiceRequest/${order.id ?? ""}`),
      request: { method: "POST", url: "Procedure" },
    },
  ];
  for (const bag of values.bags.filter((line) => line.productCode)) {
    entries.push({
      fullUrl: `urn:uuid:${crypto.randomUUID()}`,
      resource: buildBagDispense(bag, values, subject, hubReference),
      request: { method: "POST", url: "MedicationDispense" },
    });
  }
  entries.push({
    resource: buildTransfusionTaskUpdate(task, order, "in-progress"),
    request: task?.id ? { method: "PUT", url: `Task/${task.id}` } : { method: "POST", url: "Task" },
  });
  return { resourceType: "Bundle", type: "transaction", entry: entries };
}

/** 出庫記録のハブか。実施記録(order-type|transfusion)と振り分ける。 */
export function isTransfusionDispenseProcedure(procedure: fhir4.Procedure): boolean {
  return Boolean(
    procedure.category?.coding?.some(
      (c) => c.system === DISPENSE_CATEGORY_SYSTEM && c.code === DISPENSE_CATEGORY.code,
    ),
  );
}

/** 出庫取消で消す出庫記録の DELETE エントリ。子(バッグ)を先に消してからハブを消す。 */
export function buildTransfusionDispenseDeleteEntries(
  procedures: fhir4.Procedure[],
  dispenses: fhir4.MedicationDispense[],
): fhir4.BundleEntry[] {
  const hubs = procedures.filter(isTransfusionDispenseProcedure);
  const hubIds = new Set(hubs.map((procedure) => procedure.id).filter(Boolean));
  const belongsToHub = (dispense: fhir4.MedicationDispense) =>
    (dispense.partOf ?? []).some((reference) =>
      hubIds.has(referenceIdOfType(reference.reference, "Procedure")),
    );
  const deleteEntry = (resourceType: string, id: string | undefined): fhir4.BundleEntry[] =>
    id ? [{ request: { method: "DELETE" as const, url: `${resourceType}/${id}` } }] : [];
  return [
    ...dispenses.filter(belongsToHub).flatMap((d) => deleteEntry("MedicationDispense", d.id)),
    ...hubs.flatMap((procedure) => deleteEntry("Procedure", procedure.id)),
  ];
}

// ---- 読み取り・表示 ----

/** 払い出したバッグ 1 本(保存済み)。 */
export interface TransfusionDispensedBag {
  id: string;
  productCode: string;
  productName: string;
  units: string;
  unitLabel: string;
  lotNumber: string;
  abo: string;
  rhd: string;
  expiry: string;
  irradiated: boolean;
  crossmatch: string;
  crossmatchDisplay: string;
  orderedItemId: string;
  /** 「RBC-LR / 2単位 O型 RhD＋ No.… 期限 … 照射済 適合」の 1 行表示。 */
  label: string;
}

export interface TransfusionDispenseDisplay {
  /** ハブの Procedure id。表示のキー。 */
  id: string;
  dispensedAt: string;
  dispenserName: string;
  crossmatchPerformerName: string;
  comment: string;
  bags: TransfusionDispensedBag[];
}

export function parseDispensedBag(dispense: fhir4.MedicationDispense): TransfusionDispensedBag {
  const coding = dispense.medicationCodeableConcept?.coding?.find((c) => c.system === PRODUCT_SYSTEM);
  const type = bloodTypeOfExtensions(dispense.extension);
  const crossmatch =
    dispense.extension?.find((e) => e.url === CROSSMATCH_EXT_URL)?.valueCodeableConcept?.coding?.[0]
      ?.code ?? "";
  const bag: Omit<TransfusionDispensedBag, "label"> = {
    id: dispense.id ?? "",
    productCode: coding?.code ?? "",
    productName: coding?.display ?? conceptLabel(dispense.medicationCodeableConcept),
    units: dispense.quantity?.value == null ? "" : String(dispense.quantity.value),
    unitLabel: dispense.quantity?.unit ?? "単位",
    lotNumber:
      dispense.identifier?.find((i) => i.system === BLOOD_PRODUCT_NUMBER_SYSTEM)?.value ??
      dispense.identifier?.[0]?.value ??
      "",
    abo: type.abo,
    rhd: type.rhd,
    expiry: dispense.extension?.find((e) => e.url === EXPIRY_EXT_URL)?.valueDate ?? "",
    irradiated: dispense.extension?.find((e) => e.url === IRRADIATED_EXT_URL)?.valueBoolean === true,
    crossmatch,
    crossmatchDisplay: crossmatchDisplay(crossmatch),
    orderedItemId: referenceIdOfType(dispense.supportingInformation?.[0]?.reference, "ServiceRequest"),
  };
  return { ...bag, label: dispensedBagLabel(bag) };
}

function dispensedBagLabel(bag: Omit<TransfusionDispensedBag, "label">): string {
  const amount = bag.units ? `${bag.productName} / ${bag.units}${bag.unitLabel}` : bag.productName;
  return [
    amount,
    bloodTypeLabel(bag.abo, bag.rhd),
    bag.lotNumber && `No.${bag.lotNumber}`,
    bag.expiry && `期限 ${bag.expiry}`,
    bag.irradiated ? "照射済" : "",
    bag.crossmatchDisplay && `交差 ${bag.crossmatchDisplay}`,
  ]
    .filter(Boolean)
    .join(" ");
}

function performerName(dispense: fhir4.MedicationDispense | undefined, code: string): string {
  return (
    dispense?.performer?.find((p) =>
      p.function?.coding?.some((c) => c.system === PERFORMER_FUNCTION_SYSTEM && c.code === code),
    )?.actor?.display ?? ""
  );
}

/** 出庫記録をオーダー id ごとの表示内容にまとめる。 */
export function transfusionDispensesByOrderId(
  procedures: fhir4.Procedure[],
  dispenses: fhir4.MedicationDispense[],
): Map<string, TransfusionDispenseDisplay[]> {
  const byOrderId = new Map<string, TransfusionDispenseDisplay[]>();
  for (const hub of procedures.filter(isTransfusionDispenseProcedure)) {
    const hubId = hub.id ?? "";
    const own = dispenses.filter((dispense) =>
      (dispense.partOf ?? []).some(
        (reference) => referenceIdOfType(reference.reference, "Procedure") === hubId,
      ),
    );
    const display: TransfusionDispenseDisplay = {
      id: hubId,
      dispensedAt: (hub.performedDateTime ?? "").slice(0, 16).replace("T", " "),
      dispenserName: hub.performer?.[0]?.actor?.display ?? "",
      crossmatchPerformerName: performerName(own[0], CROSSMATCH_FUNCTION.code),
      comment: hub.note?.map((note) => note.text).filter(Boolean).join("\n") ?? "",
      bags: own.map(parseDispensedBag),
    };
    for (const basedOn of hub.basedOn ?? []) {
      const orderId = referenceIdOfType(basedOn.reference, "ServiceRequest");
      if (!orderId) continue;
      const list = byOrderId.get(orderId);
      if (list) list.push(display);
      else byOrderId.set(orderId, [display]);
    }
  }
  for (const list of byOrderId.values()) {
    list.sort((a, b) => a.dispensedAt.localeCompare(b.dispensedAt));
  }
  return byOrderId;
}
