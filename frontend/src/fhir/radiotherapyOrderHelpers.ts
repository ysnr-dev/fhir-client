import type {
  RadiotherapyProtocol,
  RadiotherapyDevice,
  RadiotherapyModality,
  RadiotherapyTechnique,
} from "../api/masterClient";
import { today } from "../lib/dates";
import { orderProblem, type ProblemRef } from "./conditionHelpers";
import { JJ1017P_SYSTEM, JJ1017_LATERALITY_SYSTEM } from "./radOrderHelpers";
import {
  categoryCoding,
  codingBySystem,
  displayOf,
  orderComment,
  orderDay,
  referenceId,
  registrationAuthoredOn,
} from "./shared";
import {
  ORDER_TYPE_SYSTEM,
  SETTING_OPTIONS,
  SETTING_SYSTEM,
  applyOrderContext,
  type OrderAttribution,
  type PrescriptionSetting,
} from "./prescriptionHelpers";

// 放射線治療オーダー = 放射線治療医が書く「治療処方」(docs/radiotherapy-order-design.md)。
//
// 臨床医から放射線治療医への依頼は他科依頼で出し(§1.2)、ここで扱うのはその後に
// 放射線治療医が決める治療コース 1 件ぶんの処方。依頼・治療処方・治療計画・照射実績を
// 同じデータにしない、というのが全体の方針で、このファイルが持つのは治療処方だけ。
//
//   ServiceRequest(治療処方 = Course 1 件。明細は持たない)
//     extension[radiotherapy-course]   コース番号・治療目的・併用療法・プロトコル・終了/中止
//     extension[radiotherapy-volume]×N 標的(volumeId で Phase の線量行から指す)
//     extension[radiotherapy-phase]×N  Phase(モダリティ・技法・分割回数・標的別線量)
//     extension[radiotherapy-consult-request] 元になった他科依頼への参照
//     ←focus── Task(部門の進捗。radiotherapyTaskHelpers.ts)
//
// Phase を子 ServiceRequest にしないのは、basedOn を持つ ServiceRequest がこのアプリの
// 至る所で「明細」扱いになるため(§2.1)。要素の構成は HL7 mCODE / CodeX RT の
// Course Prescription・Phase Prescription・Radiotherapy Volume に 1:1 で対応させてある
// (§2.6 の対応表)。volumeId / phaseId は後続の照射記録(Procedure)が指す安定キーなので、
// 編集では保ち、DO では振り直す。
//
// 命名の注意: `rad` は放射線検査のオーダー種別として既に使われている。治療は
// `radiotherapy` で統一する(JJ1017 頻用コードの区分 radiotherapy と同じ語)。

/** 他のオーダー種別の ServiceRequest と区別するオーダー種別。 */
export const RADIOTHERAPY_ORDER_TYPE = { code: "radiotherapy", display: "放射線治療" };

const ORDER_CODE_SYSTEM = "http://fhir-client.local/CodeSystem/radiotherapy-order";
const COURSE_PRESCRIPTION_CODE = { code: "course-prescription", display: "放射線治療処方" };

const INTENT_SYSTEM = "http://fhir-client.local/CodeSystem/radiotherapy-intent";
const CONCURRENT_SYSTEM = "http://fhir-client.local/CodeSystem/radiotherapy-concurrent-therapy";
const VOLUME_TYPE_SYSTEM = "http://fhir-client.local/CodeSystem/radiotherapy-volume-type";
// モダリティ・技法・装置・プロトコル・中止理由は施設のマスタ(§3)。コードと名称を焼く。
const MODALITY_SYSTEM = "http://fhir-client.local/CodeSystem/radiotherapy-modality";
const TECHNIQUE_SYSTEM = "http://fhir-client.local/CodeSystem/radiotherapy-technique";
const DEVICE_SYSTEM = "http://fhir-client.local/CodeSystem/radiotherapy-device";
const PROTOCOL_SYSTEM = "http://fhir-client.local/CodeSystem/radiotherapy-protocol";
const STOP_REASON_SYSTEM = "http://fhir-client.local/CodeSystem/radiotherapy-stop-reason";

const COURSE_EXT_URL = "http://fhir-client.local/StructureDefinition/radiotherapy-course";
const VOLUME_EXT_URL = "http://fhir-client.local/StructureDefinition/radiotherapy-volume";
const PHASE_EXT_URL = "http://fhir-client.local/StructureDefinition/radiotherapy-phase";
/**
 * 元になった他科依頼への参照。basedOn を使わないのは、basedOn を持つ ServiceRequest が
 * 明細扱いになって一覧・カルテから消えるため(§2.5)。
 */
const CONSULT_REQUEST_EXT_URL =
  "http://fhir-client.local/StructureDefinition/radiotherapy-consult-request";

const UCUM_SYSTEM = "http://unitsofmeasure.org";
/** 線量は Gy で持つ(mCODE は cGy。輸出時に ×100。§2.6)。 */
const DOSE_UNIT = "Gy";

// ---- 固定の分類 ----

export type RadiotherapyIntent =
  | "curative"
  | "neoadjuvant"
  | "adjuvant"
  | "palliative"
  | "prophylactic";

/** 治療目的。治療プロトコルマスタの intent と同じコード。 */
export const RADIOTHERAPY_INTENT_OPTIONS: { code: RadiotherapyIntent; display: string }[] = [
  { code: "curative", display: "根治" },
  { code: "neoadjuvant", display: "術前" },
  { code: "adjuvant", display: "術後" },
  { code: "palliative", display: "緩和" },
  { code: "prophylactic", display: "予防" },
];

export const CONCURRENT_THERAPY_OPTIONS = [
  { code: "none", display: "なし" },
  { code: "concurrent-chemo", display: "同時化学療法" },
  { code: "sequential-chemo", display: "逐次化学療法" },
  { code: "hormone", display: "内分泌療法" },
  { code: "other", display: "その他" },
];

export const VOLUME_TYPE_OPTIONS = [
  { code: "GTV", display: "GTV" },
  { code: "CTV", display: "CTV" },
  { code: "ITV", display: "ITV" },
  { code: "PTV", display: "PTV" },
  { code: "other", display: "その他" },
];

/**
 * 部位を JJ1017 の部品表から選ばず、名前で書くときの選択肢。**フォームの中だけの値**で、
 * オーダーには焼かない(部位のコードが付かず bodySite.text だけが入る)。未選択(空文字)と
 * 区別するために置いている。
 */
export const FREE_TEXT_BODY_PART = "free-text";

/** 標的の左右。JJ1017 の左右等のうち、照射部位の指定に使うものだけ。 */
export const RADIOTHERAPY_LATERALITY_OPTIONS = [
  { code: "R", display: "右側" },
  { code: "L", display: "左側" },
  { code: "B", display: "両側" },
];

// ---- フォームの値 ----

/** マスタから選んだ値。コードと名称の写し(マスタが変わってもオーダーの表示は変わらない)。 */
export interface RadiotherapyCoded {
  code: string;
  name: string;
}

const EMPTY_CODED: RadiotherapyCoded = { code: "", name: "" };

export interface RadiotherapyVolumeValues {
  /** Phase の線量行と後続の照射記録が指す安定キー。 */
  volumeId: string;
  label: string;
  type: string;
  bodyPart: RadiotherapyCoded;
  laterality: string;
  description: string;
}

export interface RadiotherapyPhaseValues {
  phaseId: string;
  label: string;
  /** revoked は再計画で打ち切った Phase(第1段階では画面から作らない。§8)。 */
  status: "active" | "revoked";
  modality: RadiotherapyCoded;
  technique: RadiotherapyCoded;
  device: RadiotherapyCoded;
  /** 分割回数。入力欄で扱うので文字列で持つ。 */
  fractions: string;
  fractionsPerWeek: string;
  /** volumeId → 1 回線量(Gy)。空の標的はこの Phase では照射しない。 */
  fractionDoses: Record<string, string>;
}

export interface RadiotherapyOrderFormValues {
  setting: PrescriptionSetting;
  intent: RadiotherapyIntent | "";
  courseNumber: string;
  concurrentTherapy: string;
  /** 開始予定日(照射初日の予定)。 */
  startDate: string;
  /** 担当医(放射線治療医)。空なら処方医が担当。 */
  practitionerId: string;
  practitionerName: string;
  protocol: RadiotherapyCoded;
  volumes: RadiotherapyVolumeValues[];
  phases: RadiotherapyPhaseValues[];
  comment: string;
  problem: ProblemRef | null;
  /** 元になった他科依頼(ServiceRequest.id)。 */
  consultOrderId: string;
  consultOrderDisplay: string;
}

function newKey(): string {
  return crypto.randomUUID().slice(0, 8);
}

export function emptyRadiotherapyVolume(index: number): RadiotherapyVolumeValues {
  return {
    volumeId: newKey(),
    label: `PTV${index + 1}`,
    type: "PTV",
    bodyPart: EMPTY_CODED,
    laterality: "",
    description: "",
  };
}

export function emptyRadiotherapyPhase(): RadiotherapyPhaseValues {
  return {
    phaseId: newKey(),
    label: "",
    status: "active",
    modality: EMPTY_CODED,
    technique: EMPTY_CODED,
    device: EMPTY_CODED,
    fractions: "",
    fractionsPerWeek: "5",
    fractionDoses: {},
  };
}

export function emptyRadiotherapyOrderForm(
  setting: PrescriptionSetting,
): RadiotherapyOrderFormValues {
  return {
    setting,
    intent: "",
    courseNumber: "1",
    concurrentTherapy: "",
    startDate: today(),
    practitionerId: "",
    practitionerName: "",
    protocol: EMPTY_CODED,
    volumes: [emptyRadiotherapyVolume(0)],
    phases: [emptyRadiotherapyPhase()],
    comment: "",
    problem: null,
    consultOrderId: "",
    consultOrderDisplay: "",
  };
}

/** Phase の名称。未入力なら並び順から付ける。 */
export function radiotherapyPhaseLabel(phase: { label: string }, index: number): string {
  return phase.label.trim() || `Phase ${index + 1}`;
}

/**
 * 総線量 = 1 回線量 × 分割回数。1.8 × 28 のような積が浮動小数の誤差で 50.400000000000006 に
 * ならないよう、cGy の整数で掛けてから Gy に戻す。
 */
export function radiotherapyTotalDose(fractionDose: number, fractions: number): number {
  return (Math.round(fractionDose * 100) * fractions) / 100;
}

function positiveNumber(text: string): number | null {
  const value = Number(text);
  return text.trim() !== "" && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * 治療プロトコル(定型処方)をフォームへ展開する。標的と Phase を置き換え、治療目的は
 * プロトコルに決まっていれば上書きする。展開後は自由に直せる。
 */
export function applyRadiotherapyProtocol(
  values: RadiotherapyOrderFormValues,
  protocol: RadiotherapyProtocol,
  masters: {
    modalities: RadiotherapyModality[];
    techniques: RadiotherapyTechnique[];
    devices: RadiotherapyDevice[];
  },
): RadiotherapyOrderFormValues {
  const volumeIds = new Map(protocol.volumes.map((v) => [v.key, newKey()]));
  const coded = (items: { code: string; name: string }[], code?: string | null) => {
    const found = items.find((item) => item.code === code);
    return found ? { code: found.code, name: found.name } : EMPTY_CODED;
  };

  return {
    ...values,
    intent: (protocol.intent as RadiotherapyIntent | null) || values.intent,
    protocol: { code: protocol.code, name: protocol.name },
    volumes: protocol.volumes.map((v) => ({
      volumeId: volumeIds.get(v.key) as string,
      label: v.label,
      type: v.volume_type ?? "",
      bodyPart: v.body_part_code
        ? { code: v.body_part_code, name: v.body_part_name ?? "" }
        : EMPTY_CODED,
      laterality: v.laterality_code ?? "",
      description: "",
    })),
    phases: protocol.phases.map((p) => ({
      phaseId: newKey(),
      label: p.label ?? "",
      status: "active" as const,
      modality: coded(masters.modalities, p.modality_code),
      technique: coded(masters.techniques, p.technique_code),
      device: coded(masters.devices, p.device_code),
      fractions: String(p.fractions),
      fractionsPerWeek: p.fractions_per_week ? String(p.fractions_per_week) : "",
      fractionDoses: Object.fromEntries(
        p.doses
          .filter((d) => volumeIds.has(d.volume_key))
          .map((d) => [volumeIds.get(d.volume_key) as string, String(d.fraction_dose)]),
      ),
    })),
  };
}

/** 入力の検証。空文字なら妥当。 */
export function validateRadiotherapyOrderForm(
  values: RadiotherapyOrderFormValues,
  /** requireDates を偽にすると開始予定日を求めない(セットの内容としての入力)。 */
  { requireDates = true }: { requireDates?: boolean } = {},
): string {
  if (!values.intent) return "治療目的を選んでください。";
  const courseNumber = Number(values.courseNumber);
  if (!Number.isInteger(courseNumber) || courseNumber < 1) {
    return "コース番号は 1 以上の整数で入れてください。";
  }
  if (requireDates && !values.startDate) return "開始予定日を入れてください。";

  if (values.volumes.length === 0) return "標的を 1 件以上入れてください。";
  for (const volume of values.volumes) {
    if (!volume.label.trim()) return "標的の名称を入れてください。";
    if (!volume.bodyPart.code) return `${volume.label} の部位を選んでください。`;
    if (volume.bodyPart.code === FREE_TEXT_BODY_PART && !volume.bodyPart.name.trim()) {
      return `${volume.label} の部位名を入れてください。`;
    }
  }

  if (values.phases.length === 0) return "Phase を 1 件以上入れてください。";
  const treated = new Set<string>();
  for (const [index, phase] of values.phases.entries()) {
    const label = radiotherapyPhaseLabel(phase, index);
    if (!phase.modality.code) return `${label} のモダリティを選んでください。`;
    if (!phase.technique.code) return `${label} の照射技法を選んでください。`;

    const fractions = Number(phase.fractions);
    if (!Number.isInteger(fractions) || fractions < 1 || fractions > 99) {
      return `${label} の分割回数は 1〜99 の整数で入れてください。`;
    }
    if (phase.fractionsPerWeek) {
      const perWeek = Number(phase.fractionsPerWeek);
      if (!Number.isInteger(perWeek) || perWeek < 1 || perWeek > 14) {
        return `${label} の週あたり回数は 1〜14 の整数で入れてください。`;
      }
    }

    let doses = 0;
    for (const volume of values.volumes) {
      const text = phase.fractionDoses[volume.volumeId] ?? "";
      if (!text.trim()) continue;
      if (positiveNumber(text) === null) {
        return `${label} の ${volume.label} の 1 回線量は正の数で入れてください。`;
      }
      treated.add(volume.volumeId);
      doses += 1;
    }
    if (doses === 0) return `${label} の 1 回線量を入れてください。`;
  }

  const untreated = values.volumes.find((v) => !treated.has(v.volumeId));
  if (untreated) return `${untreated.label} に線量を処方している Phase がありません。`;

  return "";
}

// ---- FHIR リソースの組み立て ----

/** 放射線治療オーダーの ServiceRequest か。他オーダーとの振り分けに使う。 */
export function isRadiotherapyServiceRequest(sr: fhir4.ServiceRequest): boolean {
  return categoryCoding(sr, ORDER_TYPE_SYSTEM)?.code === RADIOTHERAPY_ORDER_TYPE.code;
}

function codedConcept(system: string, value: RadiotherapyCoded): fhir4.CodeableConcept {
  return { coding: [{ system, code: value.code, display: value.name }], text: value.name };
}

function bodySiteConcept(volume: RadiotherapyVolumeValues): fhir4.CodeableConcept {
  const coding: fhir4.Coding[] = [];
  if (volume.bodyPart.code && volume.bodyPart.code !== FREE_TEXT_BODY_PART) {
    coding.push({ system: JJ1017P_SYSTEM, code: volume.bodyPart.code, display: volume.bodyPart.name });
  }
  if (volume.laterality) {
    coding.push({
      system: JJ1017_LATERALITY_SYSTEM,
      code: volume.laterality,
      display: displayOf(RADIOTHERAPY_LATERALITY_OPTIONS, volume.laterality),
    });
  }
  const text = [
    volume.laterality ? displayOf(RADIOTHERAPY_LATERALITY_OPTIONS, volume.laterality) : "",
    volume.bodyPart.name.trim(),
  ]
    .filter(Boolean)
    .join(" ");
  return { ...(coding.length > 0 ? { coding } : {}), text };
}

function doseQuantity(value: number): fhir4.Quantity {
  return { value, unit: DOSE_UNIT, system: UCUM_SYSTEM, code: DOSE_UNIT };
}

function volumeExtension(volume: RadiotherapyVolumeValues): fhir4.Extension {
  const extension: fhir4.Extension[] = [
    { url: "volumeId", valueString: volume.volumeId },
    { url: "label", valueString: volume.label.trim() },
  ];
  if (volume.type) {
    extension.push({
      url: "type",
      valueCoding: {
        system: VOLUME_TYPE_SYSTEM,
        code: volume.type,
        display: displayOf(VOLUME_TYPE_OPTIONS, volume.type),
      },
    });
  }
  extension.push({ url: "bodySite", valueCodeableConcept: bodySiteConcept(volume) });
  if (volume.description.trim()) {
    extension.push({ url: "description", valueString: volume.description.trim() });
  }
  return { url: VOLUME_EXT_URL, extension };
}

function phaseExtension(
  phase: RadiotherapyPhaseValues,
  index: number,
  volumes: RadiotherapyVolumeValues[],
): fhir4.Extension {
  const fractions = Number(phase.fractions);
  const extension: fhir4.Extension[] = [
    { url: "phaseId", valueString: phase.phaseId },
    { url: "number", valueInteger: index + 1 },
    { url: "label", valueString: radiotherapyPhaseLabel(phase, index) },
    { url: "status", valueCode: phase.status },
    {
      url: "modalityAndTechnique",
      extension: [
        { url: "modality", valueCodeableConcept: codedConcept(MODALITY_SYSTEM, phase.modality) },
        { url: "technique", valueCodeableConcept: codedConcept(TECHNIQUE_SYSTEM, phase.technique) },
      ],
    },
    { url: "fractionsPrescribed", valueUnsignedInt: fractions },
  ];
  if (phase.device.code) {
    extension.push({ url: "device", valueCodeableConcept: codedConcept(DEVICE_SYSTEM, phase.device) });
  }
  const perWeek = Number(phase.fractionsPerWeek);
  if (phase.fractionsPerWeek && Number.isInteger(perWeek) && perWeek > 0) {
    extension.push({ url: "fractionsPerWeek", valueInteger: perWeek });
  }
  // 標的の並び順で線量を積む(フォームの表示順と保存順をそろえる)。
  for (const volume of volumes) {
    const fractionDose = positiveNumber(phase.fractionDoses[volume.volumeId] ?? "");
    if (fractionDose === null) continue;
    extension.push({
      url: "dosePrescribedToVolume",
      extension: [
        { url: "volume", valueString: volume.volumeId },
        { url: "fractionDose", valueQuantity: doseQuantity(fractionDose) },
        { url: "totalDose", valueQuantity: doseQuantity(radiotherapyTotalDose(fractionDose, fractions)) },
      ],
    });
  }
  return { url: PHASE_EXT_URL, extension };
}

/** 終了・中止の情報。編集フォームの管理外で、進捗の変更と一緒に書く(§4)。 */
const TERMINATION_KEYS = ["endedOn", "terminationReason", "terminationNote"];
/** 休止の情報。再開すると落ちる(§6.4)。 */
const SUSPENSION_KEYS = ["suspendedOn", "suspensionReason", "suspensionNote"];
const STATE_KEYS = [...TERMINATION_KEYS, ...SUSPENSION_KEYS];

function courseExtension(
  values: RadiotherapyOrderFormValues,
  original?: fhir4.ServiceRequest,
): fhir4.Extension {
  const extension: fhir4.Extension[] = [
    { url: "courseNumber", valueInteger: Number(values.courseNumber) || 1 },
  ];
  if (values.intent) {
    extension.push({
      url: "intent",
      valueCoding: {
        system: INTENT_SYSTEM,
        code: values.intent,
        display: displayOf(RADIOTHERAPY_INTENT_OPTIONS, values.intent),
      },
    });
  }
  if (values.concurrentTherapy) {
    extension.push({
      url: "concurrentTherapy",
      valueCoding: {
        system: CONCURRENT_SYSTEM,
        code: values.concurrentTherapy,
        display: displayOf(CONCURRENT_THERAPY_OPTIONS, values.concurrentTherapy),
      },
    });
  }
  if (values.protocol.code) {
    extension.push({
      url: "protocol",
      valueCoding: { system: PROTOCOL_SYSTEM, code: values.protocol.code, display: values.protocol.name },
    });
  }
  const kept = original?.extension
    ?.find((e) => e.url === COURSE_EXT_URL)
    ?.extension?.filter((e) => STATE_KEYS.includes(e.url));
  return { url: COURSE_EXT_URL, extension: [...extension, ...(kept ?? [])] };
}

function buildRadiotherapyServiceRequest(
  values: RadiotherapyOrderFormValues,
  patientId: string,
  requester: OrderAttribution,
  authoredOn: string,
  original?: fhir4.ServiceRequest,
): fhir4.ServiceRequest {
  const resource: fhir4.ServiceRequest = {
    resourceType: "ServiceRequest",
    // status は編集フォームの管理外。進捗(Task)と一緒にしか動かさない(§4)。
    status: original?.status ?? "active",
    intent: "order",
    category: [
      { coding: [{ system: ORDER_TYPE_SYSTEM, ...RADIOTHERAPY_ORDER_TYPE }] },
      ...(values.setting
        ? [
            {
              coding: [
                {
                  system: SETTING_SYSTEM,
                  code: values.setting,
                  display: displayOf(SETTING_OPTIONS, values.setting),
                },
              ],
            },
          ]
        : []),
    ],
    code: {
      coding: [{ system: ORDER_CODE_SYSTEM, ...COURSE_PRESCRIPTION_CODE }],
      text: COURSE_PRESCRIPTION_CODE.display,
    },
    subject: { reference: `Patient/${patientId}` },
    authoredOn,
    // 開始予定日。カルテカードはこの日に置く。実際の照射日は照射記録(Procedure)が持つ。
    occurrenceDateTime: values.startDate,
  };
  if (original?.id) resource.id = original.id;

  if (values.practitionerId) {
    resource.performer = [
      {
        reference: `Practitioner/${values.practitionerId}`,
        ...(values.practitionerName ? { display: values.practitionerName } : {}),
      },
    ];
  }

  // 標的の部位の写し。患者の過去コースと部位を突き合わせる(再照射の気づき)のに使う。
  resource.bodySite = values.volumes.map(bodySiteConcept);

  const extension: fhir4.Extension[] = [
    courseExtension(values, original),
    ...values.volumes.map(volumeExtension),
    ...values.phases.map((phase, index) => phaseExtension(phase, index, values.volumes)),
  ];
  if (values.consultOrderId) {
    extension.push({
      url: CONSULT_REQUEST_EXT_URL,
      valueReference: {
        reference: `ServiceRequest/${values.consultOrderId}`,
        ...(values.consultOrderDisplay ? { display: values.consultOrderDisplay } : {}),
      },
    });
  }
  resource.extension = extension;

  if (values.comment.trim()) resource.note = [{ text: values.comment.trim() }];

  if (values.problem) {
    resource.reasonReference = [
      { reference: `Condition/${values.problem.conditionId}`, display: values.problem.display },
    ];
  }

  applyOrderContext(resource, requester);

  return resource;
}

function transactionBundle(entry: fhir4.BundleEntry[]): fhir4.Bundle {
  return { resourceType: "Bundle", type: "transaction", entry };
}

/** 新規登録。明細が無いのでヘッダ 1 件の POST だけ。 */
export function buildRadiotherapyOrderBundle(
  values: RadiotherapyOrderFormValues,
  patientId: string,
  requester: OrderAttribution,
): fhir4.Bundle {
  return transactionBundle([
    {
      // fullUrl は来歴(Provenance)とクリニカルパスのタスクがこのオーダーを指すのに使う。
      fullUrl: `urn:uuid:${crypto.randomUUID()}`,
      resource: buildRadiotherapyServiceRequest(values, patientId, requester, registrationAuthoredOn()),
      request: { method: "POST", url: "ServiceRequest" },
    },
  ]);
}

/** 更新。status と終了・中止の情報は元のリソースから引き継ぐ。 */
export function buildRadiotherapyOrderUpdateBundle(
  values: RadiotherapyOrderFormValues,
  patientId: string,
  original: fhir4.ServiceRequest,
  requester: OrderAttribution,
): fhir4.Bundle {
  return transactionBundle([
    {
      resource: buildRadiotherapyServiceRequest(
        values,
        patientId,
        requester,
        registrationAuthoredOn(original),
        original,
      ),
      request: { method: "PUT", url: `ServiceRequest/${original.id}` },
    },
  ]);
}

export function buildRadiotherapyOrderDeleteBundle(serviceRequestId: string): fhir4.Bundle {
  return transactionBundle([
    { request: { method: "DELETE", url: `ServiceRequest/${serviceRequestId}` } },
  ]);
}

export interface RadiotherapyTermination {
  /** 終了日・中止日・休止日。 */
  endedOn: string;
  reason?: RadiotherapyCoded;
  note?: string;
}

/**
 * 進捗の変更に合わせて ServiceRequest.status を動かす PUT エントリ(§4)。終了・中止では
 * 終了日と理由を、休止では休止日と理由を書く。治療中へ戻すときはどちらも落とす。
 */
export function buildRadiotherapyOrderStatusEntry(
  sr: fhir4.ServiceRequest,
  status: fhir4.ServiceRequest["status"],
  termination?: RadiotherapyTermination,
): fhir4.BundleEntry {
  const course = sr.extension?.find((e) => e.url === COURSE_EXT_URL);
  const inner = (course?.extension ?? []).filter((e) => !STATE_KEYS.includes(e.url));
  if (status !== "active" && termination) {
    const keys = status === "on-hold" ? SUSPENSION_KEYS : TERMINATION_KEYS;
    const [dateKey, reasonKey, noteKey] = keys;
    inner.push({ url: dateKey, valueDate: termination.endedOn });
    if (termination.reason?.code) {
      inner.push({
        url: reasonKey,
        valueCoding: {
          system: STOP_REASON_SYSTEM,
          code: termination.reason.code,
          display: termination.reason.name,
        },
      });
    }
    if (termination.note?.trim()) {
      inner.push({ url: noteKey, valueString: termination.note.trim() });
    }
  }

  const next: fhir4.ServiceRequest = {
    ...sr,
    status,
    extension: [
      { url: COURSE_EXT_URL, extension: inner },
      ...(sr.extension ?? []).filter((e) => e.url !== COURSE_EXT_URL),
    ],
  };
  return { resource: next, request: { method: "PUT", url: `ServiceRequest/${sr.id}` } };
}

/**
 * 既存のオーダーを DO(流用)して新規登録するためのフォーム値。新しいコースなので
 * コース番号は呼び出し側が振り直し、標的と Phase のキーも振り直す(照射記録は
 * コースをまたいで同じキーを指さない)。元の他科依頼への参照は引き継がない。
 */
export function buildDoRadiotherapyOrderForm(
  values: RadiotherapyOrderFormValues,
  setting: PrescriptionSetting,
): RadiotherapyOrderFormValues {
  const volumeIds = new Map(values.volumes.map((v) => [v.volumeId, newKey()]));
  return {
    ...values,
    setting,
    startDate: today(),
    consultOrderId: "",
    consultOrderDisplay: "",
    volumes: values.volumes.map((v) => ({ ...v, volumeId: volumeIds.get(v.volumeId) as string })),
    phases: values.phases
      .filter((p) => p.status === "active")
      .map((p) => ({
        ...p,
        phaseId: newKey(),
        fractionDoses: Object.fromEntries(
          Object.entries(p.fractionDoses).map(([id, dose]) => [volumeIds.get(id) ?? id, dose]),
        ),
      })),
  };
}

// ---- 一覧・カルテ表示のための parse ----

function sub(ext: fhir4.Extension | undefined, url: string): fhir4.Extension | undefined {
  return ext?.extension?.find((e) => e.url === url);
}

function conceptCoded(concept: fhir4.CodeableConcept | undefined, system: string): RadiotherapyCoded {
  const coding = codingBySystem(concept?.coding, system);
  return { code: coding?.code ?? "", name: coding?.display ?? concept?.text ?? "" };
}

function parseVolume(ext: fhir4.Extension): RadiotherapyVolumeValues {
  const bodySite = sub(ext, "bodySite")?.valueCodeableConcept;
  const part = codingBySystem(bodySite?.coding, JJ1017P_SYSTEM);
  const laterality = codingBySystem(bodySite?.coding, JJ1017_LATERALITY_SYSTEM)?.code ?? "";
  // 部位を自由記載したときは text に「左右 + 部位名」が入っているので、左右を外して戻す。
  const lateralityName = laterality ? displayOf(RADIOTHERAPY_LATERALITY_OPTIONS, laterality) : "";
  const textName = (bodySite?.text ?? "").replace(new RegExp(`^${lateralityName}\\s*`), "");
  const bodyPart = part?.code
    ? { code: part.code, name: part.display ?? "" }
    : textName
      ? { code: FREE_TEXT_BODY_PART, name: textName }
      : EMPTY_CODED;
  return {
    volumeId: sub(ext, "volumeId")?.valueString ?? "",
    label: sub(ext, "label")?.valueString ?? "",
    type: sub(ext, "type")?.valueCoding?.code ?? "",
    bodyPart,
    laterality,
    description: sub(ext, "description")?.valueString ?? "",
  };
}

function parsePhase(ext: fhir4.Extension): RadiotherapyPhaseValues {
  const mt = sub(ext, "modalityAndTechnique");
  const fractions = sub(ext, "fractionsPrescribed")?.valueUnsignedInt;
  const perWeek = sub(ext, "fractionsPerWeek")?.valueInteger;
  const fractionDoses: Record<string, string> = {};
  for (const dose of ext.extension?.filter((e) => e.url === "dosePrescribedToVolume") ?? []) {
    const volumeId = sub(dose, "volume")?.valueString;
    const value = sub(dose, "fractionDose")?.valueQuantity?.value;
    if (volumeId && typeof value === "number") fractionDoses[volumeId] = String(value);
  }
  return {
    phaseId: sub(ext, "phaseId")?.valueString ?? "",
    label: sub(ext, "label")?.valueString ?? "",
    status: sub(ext, "status")?.valueCode === "revoked" ? "revoked" : "active",
    modality: conceptCoded(sub(mt, "modality")?.valueCodeableConcept, MODALITY_SYSTEM),
    technique: conceptCoded(sub(mt, "technique")?.valueCodeableConcept, TECHNIQUE_SYSTEM),
    device: conceptCoded(sub(ext, "device")?.valueCodeableConcept, DEVICE_SYSTEM),
    fractions: fractions == null ? "" : String(fractions),
    fractionsPerWeek: perWeek == null ? "" : String(perWeek),
    fractionDoses,
  };
}

/** 元になった他科依頼(ServiceRequest.id と表示)。 */
export function radiotherapyConsultRequest(
  sr: fhir4.ServiceRequest,
): { id: string; display: string } | null {
  const reference = sr.extension?.find((e) => e.url === CONSULT_REQUEST_EXT_URL)?.valueReference;
  const id = referenceId(reference?.reference);
  return id ? { id, display: reference?.display ?? "" } : null;
}

export function parseRadiotherapyOrderForm(sr: fhir4.ServiceRequest): RadiotherapyOrderFormValues {
  const course = sr.extension?.find((e) => e.url === COURSE_EXT_URL);
  const protocol = sub(course, "protocol")?.valueCoding;
  const performer = sr.performer?.find((p) => p.reference?.startsWith("Practitioner/"));
  const consult = radiotherapyConsultRequest(sr);
  const courseNumber = sub(course, "courseNumber")?.valueInteger;

  return {
    setting: (categoryCoding(sr, SETTING_SYSTEM)?.code ?? "") as PrescriptionSetting,
    intent: (sub(course, "intent")?.valueCoding?.code ?? "") as RadiotherapyIntent | "",
    courseNumber: courseNumber == null ? "1" : String(courseNumber),
    concurrentTherapy: sub(course, "concurrentTherapy")?.valueCoding?.code ?? "",
    startDate: orderDay(sr) || today(),
    practitionerId: referenceId(performer?.reference) ?? "",
    practitionerName: performer?.display ?? "",
    protocol: { code: protocol?.code ?? "", name: protocol?.display ?? "" },
    volumes: (sr.extension ?? []).filter((e) => e.url === VOLUME_EXT_URL).map(parseVolume),
    phases: (sr.extension ?? []).filter((e) => e.url === PHASE_EXT_URL).map(parsePhase),
    comment: orderComment(sr),
    problem: orderProblem(sr),
    consultOrderId: consult?.id ?? "",
    consultOrderDisplay: consult?.display ?? "",
  };
}

/** 標的 1 件のコース合計(有効な Phase の和)。 */
export interface RadiotherapyVolumeTotal {
  volumeId: string;
  label: string;
  /** 「右側 乳房」。 */
  siteLabel: string;
  bodyPartCode: string;
  laterality: string;
  totalDose: number;
  fractions: number;
  /** 「50 Gy / 25 回」。 */
  doseLabel: string;
}

/** 表示用の線量。末尾の 0 を落とす(50.40 → 50.4)。 */
export function formatDose(value: number): string {
  return String(Math.round(value * 100) / 100);
}

export function radiotherapyVolumeTotals(
  values: Pick<RadiotherapyOrderFormValues, "volumes" | "phases">,
): RadiotherapyVolumeTotal[] {
  return values.volumes.map((volume) => {
    let cGy = 0;
    let fractions = 0;
    for (const phase of values.phases) {
      if (phase.status !== "active") continue;
      const fractionDose = positiveNumber(phase.fractionDoses[volume.volumeId] ?? "");
      const count = Number(phase.fractions);
      if (fractionDose === null || !Number.isInteger(count) || count < 1) continue;
      cGy += Math.round(fractionDose * 100) * count;
      fractions += count;
    }
    const totalDose = cGy / 100;
    return {
      volumeId: volume.volumeId,
      label: volume.label,
      siteLabel: bodySiteConcept(volume).text ?? "",
      bodyPartCode: volume.bodyPart.code,
      laterality: volume.laterality,
      totalDose,
      fractions,
      doseLabel: fractions > 0 ? `${formatDose(totalDose)} ${DOSE_UNIT} / ${fractions} 回` : "",
    };
  });
}

export interface RadiotherapyPhaseSummary {
  phaseId: string;
  label: string;
  status: "active" | "revoked";
  /** 「X線 VMAT」。 */
  methodLabel: string;
  deviceCode: string;
  /** 照射技法の coding。照射記録が「照射方法」として写す(§6.1)。 */
  techniqueCoding?: fhir4.Coding;
  deviceName: string;
  fractions: number;
  fractionsPerWeek?: number;
  doses: { volumeId: string; volumeLabel: string; fractionDose: number; totalDose: number }[];
}

export interface RadiotherapyOrderSummary {
  settingDisplay: string;
  courseNumber: number;
  intent: string;
  intentDisplay: string;
  concurrentTherapyDisplay: string;
  protocolName: string;
  startDate: string;
  practitionerName: string;
  volumes: RadiotherapyVolumeTotal[];
  phases: RadiotherapyPhaseSummary[];
  /** 「右側 乳房」「前立腺」を読点でつないだもの。 */
  siteLabel: string;
  /** 「PTV 全乳房 50 Gy / 25 回、PTV 腫瘍床 10 Gy / 5 回」。 */
  doseLabel: string;
  /** 「3D-CRT」「3D-CRT・電子線照射」。 */
  techniqueLabel: string;
  consultRequest: { id: string; display: string } | null;
  endedOn: string;
  terminationReason: string;
  terminationNote: string;
  /** 休止した日と理由(休止中だけ入る)。 */
  suspendedOn: string;
  suspensionReason: string;
  suspensionNote: string;
  comment: string;
}

export function summarizeRadiotherapyOrder(sr: fhir4.ServiceRequest): RadiotherapyOrderSummary {
  const values = parseRadiotherapyOrderForm(sr);
  const course = sr.extension?.find((e) => e.url === COURSE_EXT_URL);
  const volumes = radiotherapyVolumeTotals(values);
  const labelOf = new Map(values.volumes.map((v) => [v.volumeId, v.label]));

  const phases = values.phases.map((phase, index) => {
    const fractions = Number(phase.fractions) || 0;
    const perWeek = Number(phase.fractionsPerWeek);
    return {
      phaseId: phase.phaseId,
      label: radiotherapyPhaseLabel(phase, index),
      status: phase.status,
      methodLabel: [phase.modality.name, phase.technique.name].filter(Boolean).join(" "),
      ...(phase.technique.code
        ? {
            techniqueCoding: {
              system: TECHNIQUE_SYSTEM,
              code: phase.technique.code,
              display: phase.technique.name,
            },
          }
        : {}),
      deviceCode: phase.device.code,
      deviceName: phase.device.name,
      fractions,
      ...(perWeek > 0 ? { fractionsPerWeek: perWeek } : {}),
      doses: values.volumes.flatMap((volume) => {
        const fractionDose = positiveNumber(phase.fractionDoses[volume.volumeId] ?? "");
        if (fractionDose === null) return [];
        return [
          {
            volumeId: volume.volumeId,
            volumeLabel: labelOf.get(volume.volumeId) ?? "",
            fractionDose,
            totalDose: radiotherapyTotalDose(fractionDose, fractions),
          },
        ];
      }),
    };
  });

  const techniques = [
    ...new Set(values.phases.filter((p) => p.status === "active").map((p) => p.technique.name)),
  ].filter(Boolean);

  return {
    settingDisplay: categoryCoding(sr, SETTING_SYSTEM)?.display ?? "",
    courseNumber: Number(values.courseNumber) || 1,
    intent: values.intent,
    intentDisplay: values.intent ? displayOf(RADIOTHERAPY_INTENT_OPTIONS, values.intent) : "",
    concurrentTherapyDisplay:
      values.concurrentTherapy && values.concurrentTherapy !== "none"
        ? displayOf(CONCURRENT_THERAPY_OPTIONS, values.concurrentTherapy)
        : "",
    protocolName: values.protocol.name,
    startDate: values.startDate,
    practitionerName: values.practitionerName,
    volumes,
    phases,
    siteLabel: [...new Set(volumes.map((v) => v.siteLabel))].filter(Boolean).join("、"),
    doseLabel: volumes
      .filter((v) => v.doseLabel)
      .map((v) => `${v.label} ${v.doseLabel}`)
      .join("、"),
    techniqueLabel: techniques.join("・"),
    consultRequest: radiotherapyConsultRequest(sr),
    endedOn: sub(course, "endedOn")?.valueDate ?? "",
    terminationReason: sub(course, "terminationReason")?.valueCoding?.display ?? "",
    terminationNote: sub(course, "terminationNote")?.valueString ?? "",
    suspendedOn: sub(course, "suspendedOn")?.valueDate ?? "",
    suspensionReason: sub(course, "suspensionReason")?.valueCoding?.display ?? "",
    suspensionNote: sub(course, "suspensionNote")?.valueString ?? "",
    comment: orderComment(sr),
  };
}

/** 「2026-09-21 第1コース 乳房 50 Gy / 25 回」のような 1 行要約。 */
export function radiotherapyOrderLabel(sr: fhir4.ServiceRequest): string {
  const summary = summarizeRadiotherapyOrder(sr);
  return [summary.startDate, `第${summary.courseNumber}コース`, summary.siteLabel, summary.doseLabel]
    .filter(Boolean)
    .join(" ");
}

/**
 * 過去コースのうち、今回の標的と同じ部位に照射したもの(再照射の気づき。§5.3)。
 * JJ1017 の部位コードが一致し、左右が食い違わない(片方が未指定・両側なら一致とみなす)
 * ものを拾う。隣接部位や累積線量の評価はしない。
 */
export function overlapsRadiotherapySite(
  current: Pick<RadiotherapyVolumeValues, "bodyPart" | "laterality">[],
  past: RadiotherapyVolumeTotal[],
): boolean {
  return current.some((volume) =>
    past.some((p) => {
      // 自由記載の部位は照合しない(同じ名前でも同じ部位とは限らない)。
      if (!volume.bodyPart.code || volume.bodyPart.code === FREE_TEXT_BODY_PART) return false;
      if (volume.bodyPart.code !== p.bodyPartCode) return false;
      const a = volume.laterality;
      const b = p.laterality;
      return !a || !b || a === "B" || b === "B" || a === b;
    }),
  );
}

export const radiotherapyOrderProblem = orderProblem;
