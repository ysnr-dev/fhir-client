import type { OrderContext } from "../orderContext";
// FHIR dateTime へのタイムゾーン付与は診療記録と同じ変換でよいので共用する。
import { toFhirDateTime } from "./clinicalNoteHelpers";
import { orderProblem, type ProblemRef } from "./conditionHelpers";
import type { TemplateBinding } from "./questionnaireResponseHelpers";
import {
  categoryCoding,
  codingBySystem,
  displayOf,
  itemNumber,
  registrationAuthoredOn,
} from "./shared";
import {
  ORDER_TYPE_SYSTEM,
  SETTING_OPTIONS,
  SETTING_SYSTEM,
  applyOrderContext,
  type PrescriptionSetting,
} from "./prescriptionHelpers";

// 手術オーダー(申込)。他の同型オーダー(放射線・生理・内視鏡・処置)と同じく
// ヘッダは ServiceRequest、明細(術式 1 件)も 1 件ずつ独立した ServiceRequest。
//
//   ヘッダ ← basedOn ── 明細(術式。identifier の並び順 1 が主術式)
//
// 既存 4 種との違い:
// - 1 オーダー = 手術 1 件。処置のような単独/まとめの分割は無く、セット・伝票
//   レイアウトも持たない(術式は検索で選ぶ)。
// - ヘッダが厚い。手術室・執刀科・体位・予定出血量・スタッフ(役割つき複数人)・
//   麻酔・輸血準備・特殊機器・検体提出予定・同意書と、申込書の記載事項を
//   ローカル拡張で持つ。標準要素に置き場所が無いため(依頼科の拡張と同じ理由)。
// - authoredOn は登録日時、予定日時は occurrenceDateTime(全種別共通の意味。fhir/shared.ts)。
//   日付未定を許すのは手術だけで、occurrence を出さないことで表す。
//   ［事実］上流の occurrence 検索は occurrenceDateTime だけを抽出する
//   (extraction_definitions/service_request.rb。Period は索引されない)ので、
//   入室予定は occurrencePeriod ではなく occurrenceDateTime に入れ、予定所要時間は
//   ローカル拡張で持つ。退室予定時刻は start + 所要時間で導出できる。
// - 実施記録(Procedure)・予約(Appointment/Slot)は第 1 段階では作らない。手術室の
//   確保は日時 + 手術室の指定のみで、重複は手術一覧で目視する。

// 処方・注射・検体検査・放射線・生理・内視鏡・処置の ServiceRequest と区別するオーダー種別。
export const SURGERY_ORDER_TYPE = { code: "surgery", display: "手術" };

// 術式マスタの独自コード。
const ORDER_ITEM_SYSTEM = "http://fhir-client.local/CodeSystem/surgery-order-item";
// レセ電算 診療行為コード(K章)。実施入力の手技(Procedure.code)と同じ発想で、
// 明細にオーダー時点のコードを写す。
const RECEIPT_CODE_SYSTEM = "http://fhir-client.local/CodeSystem/surgery-procedure-code";
// 略称。他のオーダー項目と同じ CodeSystem を使う(オーダー項目の略称という意味は同じ)。
const ABBREVIATION_SYSTEM = "http://fhir-client.local/CodeSystem/lab-item-abbreviation";
// 明細の並び順。1 が主術式で、2 以降が副術式(検体検査・処方の RP 番号と同じ考え方)。
const ITEM_NUMBER_SYSTEM = "http://fhir-client.local/IdSystem/surgery-order-item-number";
// 左右。放射線の bodySite と同じコード表(R/L/B)を使う。
const LATERALITY_SYSTEM = "http://fhir-client.local/CodeSystem/jj1017-laterality";

// ローカル拡張。手術の申込書に書く事項で、ServiceRequest の標準要素に置き場所が
// 無いもの(依頼科・病棟の拡張と同じ理由でローカル URI)。
const ROOM_EXT_URL = "http://fhir-client.local/StructureDefinition/surgery-room";
// 予定所要時間(分)。occurrence を Period にすると上流の日付検索に載らないため、
// 終了時刻ではなく所要時間そのものを拡張で持つ。
const DURATION_EXT_URL = "http://fhir-client.local/StructureDefinition/surgery-duration";
const DEPARTMENT_EXT_URL = "http://fhir-client.local/StructureDefinition/surgery-department";
const POSITION_EXT_URL = "http://fhir-client.local/StructureDefinition/surgery-position";
const BLOOD_LOSS_EXT_URL =
  "http://fhir-client.local/StructureDefinition/surgery-estimated-blood-loss";
const STAFF_EXT_URL = "http://fhir-client.local/StructureDefinition/surgery-staff";
const ANESTHESIA_METHOD_EXT_URL =
  "http://fhir-client.local/StructureDefinition/surgery-anesthesia-method";
const ANESTHESIA_MANAGEMENT_EXT_URL =
  "http://fhir-client.local/StructureDefinition/surgery-anesthesia-management";
const BLOOD_PREPARATION_EXT_URL =
  "http://fhir-client.local/StructureDefinition/surgery-blood-preparation";
const EQUIPMENT_EXT_URL = "http://fhir-client.local/StructureDefinition/surgery-equipment";
const SPECIMEN_PLAN_EXT_URL = "http://fhir-client.local/StructureDefinition/surgery-specimen-plan";
const CONSENT_EXT_URL = "http://fhir-client.local/StructureDefinition/surgery-consent";
// 術前指示(病棟への指示)の本文と、テンプレートから記載したときの回答への参照。
// 手術部への申し送り(note)とは宛先が別なので欄を分けている。命名は放射線の
// rad-remarks-questionnaire-response に合わせた。
const PREOP_EXT_URL = "http://fhir-client.local/StructureDefinition/surgery-preop-instruction";
const PREOP_QR_EXT_URL =
  "http://fhir-client.local/StructureDefinition/surgery-preop-instruction-questionnaire-response";
// 明細(術式)の到達法。
const APPROACH_EXT_URL = "http://fhir-client.local/StructureDefinition/surgery-approach";

// 拡張の valueCoding が使う CodeSystem。
const POSITION_SYSTEM = "http://fhir-client.local/CodeSystem/surgery-position";
// 実施記録の performer.function でも同じコード表を使うので export する。
export const STAFF_ROLE_SYSTEM = "http://fhir-client.local/CodeSystem/surgery-staff-role";
const ANESTHESIA_METHOD_SYSTEM =
  "http://fhir-client.local/CodeSystem/surgery-anesthesia-method";
const ANESTHESIA_MANAGEMENT_SYSTEM =
  "http://fhir-client.local/CodeSystem/surgery-anesthesia-management";
const BLOOD_PREPARATION_SYSTEM =
  "http://fhir-client.local/CodeSystem/surgery-blood-preparation";
const EQUIPMENT_SYSTEM = "http://fhir-client.local/CodeSystem/surgery-equipment";
const SPECIMEN_PLAN_SYSTEM = "http://fhir-client.local/CodeSystem/surgery-specimen-plan";
const CONSENT_SYSTEM = "http://fhir-client.local/CodeSystem/surgery-consent";
const APPROACH_SYSTEM = "http://fhir-client.local/CodeSystem/surgery-approach";

// ---- 選択肢 ----

/** 予定区分。FHIR の priority をそのまま使う(内視鏡の予定性と同じ流儀)。 */
export const SURGERY_PRIORITY_OPTIONS: {
  code: "routine" | "urgent" | "stat";
  display: string;
}[] = [
  { code: "routine", display: "予定" },
  { code: "urgent", display: "準緊急" },
  { code: "stat", display: "緊急" },
];

export const SURGERY_POSITION_OPTIONS = [
  { code: "supine", display: "仰臥位" },
  { code: "lithotomy", display: "砕石位" },
  { code: "lateral", display: "側臥位" },
  { code: "prone", display: "腹臥位" },
  { code: "jackknife", display: "ジャックナイフ位" },
  { code: "sitting", display: "座位" },
] as const;

export const SURGERY_APPROACH_OPTIONS = [
  { code: "open", display: "開腹・開胸(直視下)" },
  { code: "laparoscopic", display: "腹腔鏡" },
  { code: "thoracoscopic", display: "胸腔鏡" },
  { code: "robotic", display: "ロボット支援" },
  { code: "endoscopic-open", display: "鏡視下(開腹移行ありうる)" },
  { code: "percutaneous", display: "経皮・経管" },
  { code: "other", display: "その他" },
] as const;

/**
 * スタッフの役割。申込と実施記録で同じコード表を使う。
 *
 * 器械出し・外回り・臨床工学技士は「誰が入ったか」が当日決まるので申込では聞かない。
 * 選択肢の配列を分けてあるのはそのためで(SURGERY_STAFF_ROLE_OPTIONS = 申込の 3 役 /
 * SURGERY_PERFORM_STAFF_ROLE_OPTIONS = 実施の 6 役)、コード体系は共通なので
 * 申込で選んだ執刀医をそのまま実施記録の初期値にできる。
 */
export type SurgeryStaffRole =
  | "surgeon"
  | "assistant"
  | "anesthetist"
  | "scrub-nurse"
  | "circulating-nurse"
  | "ce";

/** 申込で選ぶ役割。 */
export const SURGERY_STAFF_ROLE_OPTIONS: { code: SurgeryStaffRole; display: string }[] = [
  { code: "surgeon", display: "執刀医" },
  { code: "assistant", display: "助手" },
  { code: "anesthetist", display: "麻酔科医" },
];

/** 実施記録で選ぶ役割。申込の 3 役に、当日決まる 3 役を足したもの。 */
export const SURGERY_PERFORM_STAFF_ROLE_OPTIONS: { code: SurgeryStaffRole; display: string }[] = [
  ...SURGERY_STAFF_ROLE_OPTIONS,
  { code: "scrub-nurse", display: "器械出し" },
  { code: "circulating-nurse", display: "外回り" },
  { code: "ce", display: "臨床工学技士" },
];

export const SURGERY_ANESTHESIA_METHOD_OPTIONS = [
  { code: "general-inhalation", display: "全身麻酔(吸入)" },
  { code: "general-tiva", display: "全身麻酔(TIVA)" },
  { code: "spinal", display: "脊椎くも膜下麻酔" },
  { code: "epidural", display: "硬膜外麻酔" },
  { code: "nerve-block", display: "伝達麻酔" },
  { code: "local", display: "局所浸潤麻酔" },
  { code: "iv-sedation", display: "静脈鎮静" },
  { code: "topical", display: "表面麻酔" },
] as const;

export const SURGERY_ANESTHESIA_MANAGEMENT_OPTIONS = [
  { code: "anesthesiologist", display: "麻酔科管理" },
  { code: "surgeon", display: "執刀医管理" },
] as const;

/** 輸血準備。交差適合・自己血は単位数を添える。 */
export const SURGERY_BLOOD_PREPARATION_OPTIONS = [
  { code: "none", display: "不要" },
  { code: "type-screen", display: "T&S" },
  { code: "crossmatch", display: "交差適合試験" },
  { code: "autologous", display: "自己血" },
] as const;

export const SURGERY_EQUIPMENT_OPTIONS = [
  { code: "microscope", display: "手術用顕微鏡" },
  { code: "navigation", display: "ナビゲーション" },
  { code: "c-arm", display: "C-arm(術中透視)" },
  { code: "ultrasonic-scalpel", display: "超音波凝固切開装置" },
  { code: "stapler", display: "自動縫合器" },
  { code: "robot", display: "手術支援ロボット" },
  { code: "neuro-monitoring", display: "術中神経モニタリング" },
  { code: "intraop-us", display: "術中エコー" },
  { code: "other", display: "その他" },
] as const;

export const SURGERY_SPECIMEN_PLAN_OPTIONS = [
  { code: "frozen-section", display: "術中迅速病理" },
  { code: "permanent", display: "永久標本" },
  { code: "culture", display: "細菌培養" },
] as const;

export const SURGERY_CONSENT_OPTIONS = [
  { code: "surgery", display: "手術同意書" },
  { code: "anesthesia", display: "麻酔同意書" },
  { code: "transfusion", display: "輸血同意書" },
] as const;

export const SURGERY_LATERALITY_OPTIONS = [
  { code: "R", display: "右" },
  { code: "L", display: "左" },
  { code: "B", display: "両側" },
] as const;

export function surgeryPriorityDisplay(code: string): string {
  return displayOf([...SURGERY_PRIORITY_OPTIONS], code);
}

export function surgeryApproachDisplay(code: string): string {
  return code ? displayOf([...SURGERY_APPROACH_OPTIONS], code) : "";
}

export function surgeryPositionDisplay(code: string): string {
  return code ? displayOf([...SURGERY_POSITION_OPTIONS], code) : "";
}

export function surgeryStaffRoleDisplay(code: string): string {
  return displayOf(SURGERY_PERFORM_STAFF_ROLE_OPTIONS, code);
}

export function surgeryAnesthesiaMethodDisplay(code: string): string {
  return displayOf([...SURGERY_ANESTHESIA_METHOD_OPTIONS], code);
}

export function surgeryAnesthesiaManagementDisplay(code: string): string {
  return code ? displayOf([...SURGERY_ANESTHESIA_MANAGEMENT_OPTIONS], code) : "";
}

export function surgeryBloodPreparationDisplay(code: string): string {
  return code ? displayOf([...SURGERY_BLOOD_PREPARATION_OPTIONS], code) : "";
}

export function surgeryEquipmentDisplay(code: string): string {
  return displayOf([...SURGERY_EQUIPMENT_OPTIONS], code);
}

export function surgerySpecimenPlanDisplay(code: string): string {
  return displayOf([...SURGERY_SPECIMEN_PLAN_OPTIONS], code);
}

export function surgeryConsentDisplay(code: string): string {
  return displayOf([...SURGERY_CONSENT_OPTIONS], code);
}

export function surgeryLateralityDisplay(code: string): string {
  return code ? displayOf([...SURGERY_LATERALITY_OPTIONS], code) : "";
}

// ---- フォーム値 ----

/** 役割つきのスタッフ 1 人。 */
export interface SurgeryStaffLine {
  role: SurgeryStaffRole;
  practitionerId: string;
  practitionerName: string;
}

/** オーダーした術式 1 件。マスタの写しなので、表示に必要な値をすべて持つ。 */
export interface SurgeryOrderItemLine {
  /** 明細の ServiceRequest の id。画面で足したばかりの項目は空(登録時に採番)。 */
  id: string;
  /** 術式マスタの項目コード。 */
  code: string;
  name: string;
  shortName: string;
  /** レセ電算 診療行為コード(K章)。マスタの写し。 */
  receiptCode: string;
  /** 部位(自由記載)。「S状結腸」のように術式名で足りない部分を書く。 */
  bodySiteText: string;
  /** 左右(R/L/B)。左右のある臓器の取り違え防止のため明細ごとに聞く。 */
  laterality: string;
  /** 到達法(SURGERY_APPROACH_OPTIONS のコード)。 */
  approach: string;
  /** 術前診断。登録病名から選ぶと Condition の id、フリーテキストなら空。 */
  reasonConditionId: string;
  reasonName: string;
}

export interface SurgeryOrderFormValues {
  setting: PrescriptionSetting;
  /** 予定手術日と入室予定時刻(HH:mm、任意)。空なら日付未定。 */
  scheduledDate: string;
  scheduledTime: string;
  /** 予定所要時間(分)。 */
  durationMinutes: string;
  /** 手術室(Location)。 */
  roomId: string;
  roomName: string;
  /** 予定区分(SURGERY_PRIORITY_OPTIONS のコード)。 */
  priority: "routine" | "urgent" | "stat";
  /** 執刀科(診療科 Organization)。依頼科と別れうるので別に持つ。 */
  surgicalDepartmentId: string;
  surgicalDepartmentName: string;
  /** 手術体位。 */
  position: string;
  /** 予定出血量(mL)。 */
  estimatedBloodLoss: string;
  staff: SurgeryStaffLine[];
  /** 麻酔方法(複数可)。 */
  anesthesiaMethods: string[];
  /** 麻酔の管理区分。 */
  anesthesiaManagement: string;
  /** 輸血準備の区分と単位数(交差適合・自己血のとき)。 */
  bloodPreparation: string;
  bloodPreparationUnits: string;
  /** 特殊機器(複数可)。other を選んだときは equipmentOther に自由記載。 */
  equipment: string[];
  equipmentOther: string;
  /** 病理・培養の提出予定(複数可)。 */
  specimenPlans: string[];
  /** 取得済みの同意書(複数可)。 */
  consents: string[];
  /** 特記・申し送り。 */
  comment: string;
  /** 術前指示(病棟への指示)。テンプレートから記載すると平文がここに入る。 */
  preopInstruction: string;
  /** 術前指示をテンプレートから記載したときの回答への紐付け。直接入力なら null。 */
  preopInstructionTemplate: TemplateBinding | null;
  // 対象プロブレム(POMR)。null なら特定の問題に紐付かない手術。
  problem: ProblemRef | null;
  items: SurgeryOrderItemLine[];
}

export function emptySurgeryOrderForm(
  problem: ProblemRef | null = null,
  setting: PrescriptionSetting = "outpatient",
): SurgeryOrderFormValues {
  return {
    setting,
    scheduledDate: "",
    scheduledTime: "",
    durationMinutes: "",
    roomId: "",
    roomName: "",
    priority: "routine",
    surgicalDepartmentId: "",
    surgicalDepartmentName: "",
    position: "",
    estimatedBloodLoss: "",
    staff: [],
    anesthesiaMethods: [],
    anesthesiaManagement: "",
    bloodPreparation: "",
    bloodPreparationUnits: "",
    equipment: [],
    equipmentOther: "",
    specimenPlans: [],
    consents: [],
    comment: "",
    preopInstruction: "",
    preopInstructionTemplate: null,
    problem,
    items: [],
  };
}

// ---- FHIR リソースの組み立て ----

/** ServiceRequest が手術オーダーかどうか。他のオーダー種別との振り分けに使う。 */
export function isSurgeryServiceRequest(sr: fhir4.ServiceRequest): boolean {
  return (sr.category ?? []).some((category) =>
    category.coding?.some(
      (c) => c.system === ORDER_TYPE_SYSTEM && c.code === SURGERY_ORDER_TYPE.code,
    ),
  );
}

// 明細 1 件(術式 1 つ)の ServiceRequest。ヘッダを basedOn で指す。
// 並び順 1 が主術式。部位・左右は bodySite、到達法はローカル拡張、術前診断は
// reasonReference(登録病名) / reasonCode.text(フリーテキスト)に載せる。
function buildItemRequest(
  item: SurgeryOrderItemLine,
  sequence: number,
  patientId: string,
  authoredOn: string,
  occurrenceDateTime: string | undefined,
  parentReference: string,
): fhir4.ServiceRequest {
  const coding: fhir4.Coding[] = [
    { system: ORDER_ITEM_SYSTEM, code: item.code, display: item.name },
  ];
  if (item.receiptCode) {
    coding.push({ system: RECEIPT_CODE_SYSTEM, code: item.receiptCode });
  }
  if (item.shortName) {
    coding.push({ system: ABBREVIATION_SYSTEM, code: item.shortName, display: item.shortName });
  }

  const resource: fhir4.ServiceRequest = {
    resourceType: "ServiceRequest",
    status: "active",
    intent: "order",
    identifier: [{ system: ITEM_NUMBER_SYSTEM, value: String(sequence) }],
    subject: { reference: `Patient/${patientId}` },
    // 登録日時・予定日時はヘッダと同じ値を写す(日付未定ならヘッダ同様に出さない)。
    authoredOn,
    ...(occurrenceDateTime ? { occurrenceDateTime } : {}),
    code: { coding, text: item.name },
    basedOn: [{ reference: parentReference }],
  };
  if (item.id) resource.id = item.id;

  const bodySite = buildBodySite(item);
  if (bodySite) resource.bodySite = [bodySite];

  if (item.approach) {
    resource.extension = [
      {
        url: APPROACH_EXT_URL,
        valueCoding: {
          system: APPROACH_SYSTEM,
          code: item.approach,
          display: surgeryApproachDisplay(item.approach),
        },
      },
    ];
  }

  if (item.reasonConditionId) {
    resource.reasonReference = [
      { reference: `Condition/${item.reasonConditionId}`, display: item.reasonName },
    ];
  } else if (item.reasonName.trim()) {
    resource.reasonCode = [{ text: item.reasonName.trim() }];
  }

  return resource;
}

/** 明細の部位表示(「右 膝関節」の形)。 */
export function surgeryBodySiteLabel(item: SurgeryOrderItemLine): string {
  return [surgeryLateralityDisplay(item.laterality), item.bodySiteText].filter(Boolean).join(" ");
}

function buildBodySite(item: SurgeryOrderItemLine): fhir4.CodeableConcept | undefined {
  if (!item.bodySiteText.trim() && !item.laterality) return undefined;

  const coding: fhir4.Coding[] = [];
  if (item.laterality) {
    coding.push({
      system: LATERALITY_SYSTEM,
      code: item.laterality,
      display: surgeryLateralityDisplay(item.laterality),
    });
  }
  return {
    ...(coding.length > 0 ? { coding } : {}),
    text: surgeryBodySiteLabel(item) || undefined,
  };
}

function parseItemRequest(request: fhir4.ServiceRequest): SurgeryOrderItemLine {
  const coding = request.code?.coding;
  const itemCoding = codingBySystem(coding, ORDER_ITEM_SYSTEM);
  const abbreviation = codingBySystem(coding, ABBREVIATION_SYSTEM);
  const bodySite = request.bodySite?.[0];
  const laterality = codingBySystem(bodySite?.coding, LATERALITY_SYSTEM)?.code ?? "";
  // text は「左右 + 部位」で保存しているので、左右の表示を頭から外して部位だけに戻す。
  const lateralityLabel = surgeryLateralityDisplay(laterality);
  const text = bodySite?.text ?? "";
  const bodySiteText =
    lateralityLabel && text.startsWith(`${lateralityLabel} `)
      ? text.slice(lateralityLabel.length + 1)
      : lateralityLabel && text === lateralityLabel
        ? ""
        : text;
  const approach =
    request.extension?.find((e) => e.url === APPROACH_EXT_URL)?.valueCoding?.code ?? "";
  const reasonReference = request.reasonReference?.[0];

  return {
    id: request.id ?? "",
    code: itemCoding?.code ?? "",
    name: itemCoding?.display ?? request.code?.text ?? "",
    shortName: abbreviation?.code ?? "",
    receiptCode: codingBySystem(coding, RECEIPT_CODE_SYSTEM)?.code ?? "",
    bodySiteText,
    laterality,
    approach,
    reasonConditionId: reasonReference?.reference?.split("/").pop() ?? "",
    reasonName: reasonReference?.display ?? request.reasonCode?.[0]?.text ?? "",
  };
}

// 明細の Bundle エントリ。既にある明細は PUT、画面で足したものは POST、
// 外した明細は DELETE(呼び出し側が元の id 一覧を渡す)。
function buildItemEntries(
  items: SurgeryOrderItemLine[],
  patientId: string,
  header: fhir4.ServiceRequest,
  headerReference: string,
  originalItemIds: string[],
): fhir4.BundleEntry[] {
  const entries: fhir4.BundleEntry[] = [];
  const keptItemIds = new Set<string>();

  items.forEach((item, index) => {
    const fullUrl = item.id ? `ServiceRequest/${item.id}` : `urn:uuid:${crypto.randomUUID()}`;
    if (item.id) keptItemIds.add(item.id);

    entries.push({
      fullUrl,
      resource: buildItemRequest(
        item,
        index + 1,
        patientId,
        header.authoredOn ?? "",
        header.occurrenceDateTime,
        headerReference,
      ),
      request: item.id
        ? { method: "PUT", url: `ServiceRequest/${item.id}` }
        : { method: "POST", url: "ServiceRequest" },
    });
  });

  for (const id of originalItemIds) {
    if (!keptItemIds.has(id)) {
      entries.push({ request: { method: "DELETE", url: `ServiceRequest/${id}` } });
    }
  }

  return entries;
}

// valueCoding の繰り返し拡張(麻酔方法・特殊機器・検体提出予定・同意書)を組み立てる。
function codingExtensions(
  url: string,
  system: string,
  codes: string[],
  display: (code: string) => string,
): fhir4.Extension[] {
  return codes.map((code) => ({
    url,
    valueCoding: { system, code, display: display(code) },
  }));
}

function codesOfExtensions(
  extension: fhir4.Extension[] | undefined,
  url: string,
): string[] {
  return (extension ?? [])
    .filter((e) => e.url === url)
    .map((e) => e.valueCoding?.code ?? "")
    .filter(Boolean);
}

function buildSurgeryOrderServiceRequest(
  values: SurgeryOrderFormValues,
  patientId: string,
  requester: OrderContext,
  // 術前指示をテンプレートから記載したときの、回答(QuestionnaireResponse)への参照。
  // Bundle 内で解決するため呼び出し側が組み立てて渡す(新規は urn:uuid、既存は実 id)。
  preopTemplateRef: string,
  authoredOn: string,
  serviceRequestId?: string,
): fhir4.ServiceRequest {
  const resource: fhir4.ServiceRequest = {
    resourceType: "ServiceRequest",
    status: "active",
    intent: "order",
    priority: values.priority,
    // 読み出し側は system で引くので順序には依存しない。入外区分は未選択のことが
    // あるので、空の Coding(code が空文字)を作らないよう選択時だけ足す。
    category: [
      { coding: [{ system: ORDER_TYPE_SYSTEM, ...SURGERY_ORDER_TYPE }] },
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
    subject: { reference: `Patient/${patientId}` },
    // 登録日時(全種別共通の意味。fhir/shared.ts)。フォームでは入力しない。
    authoredOn,
  };

  if (serviceRequestId) resource.id = serviceRequestId;

  // 予定日時(入室予定)。dateTime は時刻を持つならタイムゾーンが必須なので、
  // 実行環境のオフセットを付ける。時刻未定なら日付のみ。
  if (values.scheduledDate) {
    resource.occurrenceDateTime = values.scheduledTime
      ? toFhirDateTime(`${values.scheduledDate}T${values.scheduledTime}`)
      : values.scheduledDate;
  }

  const extension: fhir4.Extension[] = [];

  const minutes = Number(values.durationMinutes);
  if (values.durationMinutes.trim() && Number.isFinite(minutes) && minutes > 0) {
    extension.push({
      url: DURATION_EXT_URL,
      valueQuantity: { value: minutes, unit: "分" },
    });
  }

  if (values.roomId) {
    extension.push({
      url: ROOM_EXT_URL,
      valueReference: {
        reference: `Location/${values.roomId}`,
        ...(values.roomName ? { display: values.roomName } : {}),
      },
    });
  }
  if (values.surgicalDepartmentId) {
    extension.push({
      url: DEPARTMENT_EXT_URL,
      valueReference: {
        reference: `Organization/${values.surgicalDepartmentId}`,
        ...(values.surgicalDepartmentName ? { display: values.surgicalDepartmentName } : {}),
      },
    });
  }
  if (values.position) {
    extension.push({
      url: POSITION_EXT_URL,
      valueCoding: {
        system: POSITION_SYSTEM,
        code: values.position,
        display: surgeryPositionDisplay(values.position),
      },
    });
  }
  const bloodLoss = Number(values.estimatedBloodLoss);
  if (values.estimatedBloodLoss.trim() && Number.isFinite(bloodLoss)) {
    extension.push({
      url: BLOOD_LOSS_EXT_URL,
      valueQuantity: { value: bloodLoss, unit: "mL" },
    });
  }
  // スタッフ。役割(role)と人(member)の複合拡張を人数ぶん繰り返す。
  for (const line of values.staff) {
    if (!line.practitionerId) continue;
    extension.push({
      url: STAFF_EXT_URL,
      extension: [
        {
          url: "role",
          valueCoding: {
            system: STAFF_ROLE_SYSTEM,
            code: line.role,
            display: surgeryStaffRoleDisplay(line.role),
          },
        },
        {
          url: "member",
          valueReference: {
            reference: `Practitioner/${line.practitionerId}`,
            ...(line.practitionerName ? { display: line.practitionerName } : {}),
          },
        },
      ],
    });
  }
  extension.push(
    ...codingExtensions(
      ANESTHESIA_METHOD_EXT_URL,
      ANESTHESIA_METHOD_SYSTEM,
      values.anesthesiaMethods,
      surgeryAnesthesiaMethodDisplay,
    ),
  );
  if (values.anesthesiaManagement) {
    extension.push({
      url: ANESTHESIA_MANAGEMENT_EXT_URL,
      valueCoding: {
        system: ANESTHESIA_MANAGEMENT_SYSTEM,
        code: values.anesthesiaManagement,
        display: surgeryAnesthesiaManagementDisplay(values.anesthesiaManagement),
      },
    });
  }
  if (values.bloodPreparation) {
    const units = Number(values.bloodPreparationUnits);
    extension.push({
      url: BLOOD_PREPARATION_EXT_URL,
      extension: [
        {
          url: "type",
          valueCoding: {
            system: BLOOD_PREPARATION_SYSTEM,
            code: values.bloodPreparation,
            display: surgeryBloodPreparationDisplay(values.bloodPreparation),
          },
        },
        ...(values.bloodPreparationUnits.trim() && Number.isFinite(units)
          ? [{ url: "units", valueQuantity: { value: units, unit: "単位" } }]
          : []),
      ],
    });
  }
  // 特殊機器。「その他」は自由記載を display に載せる(コード表に無い機器の名前を
  // 別の拡張に分けるほどの構造は要らない)。
  for (const code of values.equipment) {
    extension.push({
      url: EQUIPMENT_EXT_URL,
      valueCoding: {
        system: EQUIPMENT_SYSTEM,
        code,
        display:
          code === "other" && values.equipmentOther.trim()
            ? values.equipmentOther.trim()
            : surgeryEquipmentDisplay(code),
      },
    });
  }
  extension.push(
    ...codingExtensions(
      SPECIMEN_PLAN_EXT_URL,
      SPECIMEN_PLAN_SYSTEM,
      values.specimenPlans,
      surgerySpecimenPlanDisplay,
    ),
  );
  extension.push(
    ...codingExtensions(CONSENT_EXT_URL, CONSENT_SYSTEM, values.consents, surgeryConsentDisplay),
  );

  // 術前指示。本文と、テンプレートから記載したときの回答への参照。
  if (values.preopInstruction.trim()) {
    extension.push({ url: PREOP_EXT_URL, valueString: values.preopInstruction.trim() });
  }
  if (preopTemplateRef) {
    extension.push({ url: PREOP_QR_EXT_URL, valueReference: { reference: preopTemplateRef } });
  }

  if (extension.length > 0) resource.extension = extension;

  if (values.comment.trim()) resource.note = [{ text: values.comment.trim() }];
  if (values.problem) {
    resource.reasonReference = [
      {
        reference: `Condition/${values.problem.conditionId}`,
        display: values.problem.display,
      },
    ];
  }
  // applyOrderContext は extension を末尾に足すので、上の組み立ての後に呼ぶ。
  applyOrderContext(resource, requester);

  return resource;
}

function transactionBundle(entry: fhir4.BundleEntry[]): fhir4.Bundle {
  return { resourceType: "Bundle", type: "transaction", entry };
}

/**
 * 術前指示のテンプレート記入内容を Bundle に積み、ヘッダから指す参照を返す。
 *
 * 記入内容はオーダー本体と同じ transaction で書く(先に単独 POST すると、オーダーを
 * 保存しなかったときに回答だけが残る)。参照が外れた回答は呼び出し側が DELETE する。
 * 放射線・生理検査・内視鏡の明細と同じ作りで、手術は 1 オーダー 1 件なのでヘッダに付く。
 */
function pushPreopTemplateEntry(
  entries: fhir4.BundleEntry[],
  binding: TemplateBinding | null,
): { reference: string; keptResponseId: string } {
  if (!binding) return { reference: "", keptResponseId: "" };
  const { responseId, draft } = binding;
  if (!draft) {
    // 再編集していない保存済みの回答 → 参照だけ引き継ぐ。
    return responseId
      ? { reference: `QuestionnaireResponse/${responseId}`, keptResponseId: responseId }
      : { reference: "", keptResponseId: "" };
  }
  // 保存済みの再編集は同じ id へ PUT、新規記入は urn:uuid で POST し、
  // 実 ID への解決は上流の transaction 処理に任せる。
  const reference = responseId
    ? `QuestionnaireResponse/${responseId}`
    : `urn:uuid:${crypto.randomUUID()}`;
  if (responseId) {
    entries.push({
      resource: { ...draft.response, id: responseId },
      request: { method: "PUT", url: reference },
    });
  } else {
    entries.push({
      fullUrl: reference,
      resource: draft.response,
      request: { method: "POST", url: "QuestionnaireResponse" },
    });
  }
  entries.push(...draft.imageEntries);
  return { reference, keptResponseId: responseId ?? "" };
}

// 1 件の ServiceRequest が参照している術前指示の回答 id。持たなければ空。
function preopResponseIdOf(sr: fhir4.ServiceRequest): string {
  const reference = sr.extension?.find((e) => e.url === PREOP_QR_EXT_URL)?.valueReference
    ?.reference;
  return reference?.match(/^QuestionnaireResponse\/(.+)$/)?.[1] ?? "";
}

/**
 * 手術オーダーが参照している術前指示の回答 id 一覧。
 *
 * 更新・削除で孤児を残さないためと、カルテのタイムラインで「オーダーのカードに
 * 描かれる回答」を単独カードから外すために使う(他部門と同じ形なので配列で受ける)。
 */
export function surgeryOrderResponseIds(serviceRequests: fhir4.ServiceRequest[]): string[] {
  return serviceRequests.map(preopResponseIdOf).filter(Boolean);
}

// 新規登録。ヘッダ 1 + 明細 N を 1 つの transaction にする。
export function buildSurgeryOrderBundle(
  values: SurgeryOrderFormValues,
  patientId: string,
  requester: OrderContext,
): fhir4.Bundle {
  const headerReference = `urn:uuid:${crypto.randomUUID()}`;
  const templateEntries: fhir4.BundleEntry[] = [];
  const preop = pushPreopTemplateEntry(templateEntries, values.preopInstructionTemplate);
  const header = buildSurgeryOrderServiceRequest(
    values,
    patientId,
    requester,
    preop.reference,
    registrationAuthoredOn(),
  );
  return transactionBundle([
    ...templateEntries,
    {
      fullUrl: headerReference,
      resource: header,
      request: { method: "POST", url: "ServiceRequest" },
    },
    ...buildItemEntries(values.items, patientId, header, headerReference, []),
  ]);
}

// 更新。ヘッダは PUT、明細は PUT/POST/差分 DELETE の混在した transaction。
// 登録日時は元のリソースから引き継ぐ(編集で動かさない)。
export function buildSurgeryOrderUpdateBundle(
  values: SurgeryOrderFormValues,
  patientId: string,
  original: fhir4.ServiceRequest,
  originalItemIds: string[],
  requester: OrderContext,
  // 元のオーダーが参照していた術前指示の回答 id。参照が外れたら同じ transaction で消す。
  originalResponseIds: string[] = [],
): fhir4.Bundle {
  const serviceRequestId = original.id ?? "";
  const headerReference = `ServiceRequest/${serviceRequestId}`;
  const templateEntries: fhir4.BundleEntry[] = [];
  const preop = pushPreopTemplateEntry(templateEntries, values.preopInstructionTemplate);
  const header = buildSurgeryOrderServiceRequest(
    values,
    patientId,
    requester,
    preop.reference,
    registrationAuthoredOn(original),
    serviceRequestId,
  );
  return transactionBundle([
    ...templateEntries,
    {
      fullUrl: headerReference,
      resource: header,
      request: { method: "PUT", url: headerReference },
    },
    ...buildItemEntries(values.items, patientId, header, headerReference, originalItemIds),
    ...originalResponseIds
      .filter((id) => id !== preop.keptResponseId)
      .map((id) => ({
        request: { method: "DELETE" as const, url: `QuestionnaireResponse/${id}` },
      })),
  ]);
}

/** 手術部が確定する日程。日程未定の申込に後から入れる。 */
export interface SurgeryScheduleValues {
  /** 予定手術日("YYYY-MM-DD")。必須。 */
  scheduledDate: string;
  /** 入室予定時刻("HH:mm")。任意。 */
  scheduledTime: string;
  /** 予定所要時間(分)。任意。 */
  durationMinutes: string;
  roomId: string;
  roomName: string;
}

/**
 * 日程の確定。オーダーヘッダの予定日時・所要時間・手術室だけを差し替える。
 *
 * 申込の中身(術式・スタッフ・麻酔・準備)には触らないので、フォームの値を組み立て
 * 直さず現物の ServiceRequest を持ち回る。他の拡張を落とさないよう、差し替える 2 本
 * (所要時間・手術室)以外の extension はそのまま残す。
 */
export function buildSurgeryScheduleServiceRequest(
  order: fhir4.ServiceRequest,
  values: SurgeryScheduleValues,
): fhir4.ServiceRequest {
  const next: fhir4.ServiceRequest = { ...order };

  // occurrence[x] は排他。古いデータが持つ occurrencePeriod は必ず落とす
  // (残すと 2 つの occurrence が並び、読み手によってどちらを見るかがぶれる)。
  delete next.occurrencePeriod;
  if (values.scheduledDate) {
    next.occurrenceDateTime = values.scheduledTime
      ? toFhirDateTime(`${values.scheduledDate}T${values.scheduledTime}`)
      : values.scheduledDate;
  } else {
    // 日付未定へ戻す。空文字を入れると occurrence:missing で拾えないので消す。
    delete next.occurrenceDateTime;
  }

  const rest = (order.extension ?? []).filter(
    (e) => e.url !== DURATION_EXT_URL && e.url !== ROOM_EXT_URL,
  );
  const added: fhir4.Extension[] = [];

  const minutes = Number(values.durationMinutes);
  if (values.durationMinutes.trim() && Number.isFinite(minutes) && minutes > 0) {
    added.push({ url: DURATION_EXT_URL, valueQuantity: { value: minutes, unit: "分" } });
  }
  if (values.roomId) {
    added.push({
      url: ROOM_EXT_URL,
      valueReference: {
        reference: `Location/${values.roomId}`,
        ...(values.roomName ? { display: values.roomName } : {}),
      },
    });
  }

  const extension = [...rest, ...added];
  if (extension.length > 0) next.extension = extension;
  else delete next.extension;

  return next;
}

/**
 * 日程の確定を 1 つの transaction にする。オーダーの日程と進捗(受付済 = 日程確定)は
 * 必ず一緒に動かす(片方だけ通ると「日程は入ったが未受付」「受付済だが日程未定」に
 * なってしまう)。Task のエントリは呼び出し側が組み立てて渡す。
 */
export function buildSurgeryScheduleBundle(
  order: fhir4.ServiceRequest,
  values: SurgeryScheduleValues,
  taskEntry: fhir4.BundleEntry,
): fhir4.Bundle {
  return transactionBundle([
    {
      fullUrl: `ServiceRequest/${order.id}`,
      resource: buildSurgeryScheduleServiceRequest(order, values),
      request: { method: "PUT", url: `ServiceRequest/${order.id}` },
    },
    taskEntry,
  ]);
}

/**
 * 日程だけを動かす transaction(手術室カレンダーのドラッグ＆ドロップ)。
 *
 * 進捗(Task)には触らない。確定モーダルの「未定 → 確定」は受付済へ進める操作だが、
 * こちらは既に日程の入っている手術を動かすだけで、申込済は申込済のまま・受付済は
 * 受付済のまま(手術部が受け付けた事実は日程を動かしても変わらない)。
 */
export function buildSurgeryMoveBundle(
  order: fhir4.ServiceRequest,
  values: SurgeryScheduleValues,
): fhir4.Bundle {
  return transactionBundle([
    {
      fullUrl: `ServiceRequest/${order.id}`,
      resource: buildSurgeryScheduleServiceRequest(order, values),
      request: { method: "PUT", url: `ServiceRequest/${order.id}` },
    },
  ]);
}

/** オーダーとその明細をまとめて消す Bundle。 */
export function buildSurgeryOrderDeleteBundle(
  serviceRequestId: string,
  itemIds: string[],
  // 術前指示のテンプレート記入内容。オーダーを消したら回答も消す(孤児を残さない)。
  responseIds: string[] = [],
): fhir4.Bundle {
  return transactionBundle([
    { request: { method: "DELETE", url: `ServiceRequest/${serviceRequestId}` } },
    ...itemIds.map((id) => ({
      request: { method: "DELETE" as const, url: `ServiceRequest/${id}` },
    })),
    ...responseIds.map((id) => ({
      request: { method: "DELETE" as const, url: `QuestionnaireResponse/${id}` },
    })),
  ]);
}

// 既存のオーダーを DO(流用)して新規登録するためのフォーム値。明細の id を落として
// 新規登録(POST)にし、予定日時は入れ直す(同じ日にもう一度手術することは無いので
// 引き継がない)。登録日時は保存時に採る。
export function buildDoSurgeryOrderForm(
  values: SurgeryOrderFormValues,
  setting: PrescriptionSetting,
): SurgeryOrderFormValues {
  return {
    ...values,
    setting,
    scheduledDate: "",
    scheduledTime: "",
    // テンプレートの紐付けは外す。同じ回答を 2 つのオーダーが指すと、片方を書き換えた
    // ときにもう片方まで変わってしまうため(放射線の DO と同じ)。文言は残るので、
    // DO 先ではフリーテキストとして直せる。
    preopInstructionTemplate: null,
    items: values.items.map((item) => ({ ...item, id: "" })),
  };
}

// ---- 一覧・カルテ表示のための parse ----

export interface SurgeryOrderSummary {
  /** 入外区分のコード。部門一覧の絞り込みに使う(表示は settingDisplay)。 */
  settingCode: string;
  settingDisplay: string;
  /** 予定区分。 */
  priority: string;
  priorityDisplay: string;
  /** 予定手術日("YYYY-MM-DD")と入室予定時刻("HH:mm")。未定なら空。 */
  scheduledDate: string;
  scheduledTime: string;
  /** 予定所要時間(分)。 */
  durationMinutes: number | null;
  roomId: string;
  roomName: string;
  surgicalDepartmentId: string;
  surgicalDepartmentName: string;
  positionCode: string;
  estimatedBloodLoss: string;
  staff: SurgeryStaffLine[];
  anesthesiaMethods: string[];
  anesthesiaManagement: string;
  bloodPreparation: string;
  bloodPreparationUnits: string;
  /** 特殊機器の表示名(「その他」は自由記載)。 */
  equipmentLabels: string[];
  specimenPlans: string[];
  consents: string[];
  comment: string;
  /** 術前指示(病棟への指示)の本文。 */
  preopInstruction: string;
  /** 術前指示をテンプレートから記載したときの回答 id。直接入力なら空。 */
  preopInstructionResponseId: string;
}

export function summarizeSurgeryOrder(sr: fhir4.ServiceRequest): SurgeryOrderSummary {
  const setting = categoryCoding(sr, SETTING_SYSTEM);
  // 旧データ(occurrencePeriod で保存した申込)も読めるよう start へフォールバック。
  const start = sr.occurrenceDateTime ?? sr.occurrencePeriod?.start ?? "";
  const duration = sr.extension?.find((e) => e.url === DURATION_EXT_URL)?.valueQuantity?.value;
  const room = sr.extension?.find((e) => e.url === ROOM_EXT_URL)?.valueReference;
  const department = sr.extension?.find((e) => e.url === DEPARTMENT_EXT_URL)?.valueReference;
  const bloodLoss = sr.extension?.find((e) => e.url === BLOOD_LOSS_EXT_URL)?.valueQuantity;
  const bloodPreparation = sr.extension?.find((e) => e.url === BLOOD_PREPARATION_EXT_URL);
  const bloodPreparationUnits = bloodPreparation?.extension?.find(
    (e) => e.url === "units",
  )?.valueQuantity;

  const staff: SurgeryStaffLine[] = (sr.extension ?? [])
    .filter((e) => e.url === STAFF_EXT_URL)
    .map((e) => {
      const role = e.extension?.find((s) => s.url === "role")?.valueCoding?.code ?? "";
      const member = e.extension?.find((s) => s.url === "member")?.valueReference;
      return {
        role: (role || "surgeon") as SurgeryStaffRole,
        practitionerId: member?.reference?.split("/").pop() ?? "",
        practitionerName: member?.display ?? "",
      };
    })
    .filter((line) => line.practitionerId);

  return {
    settingCode: setting?.code ?? "",
    settingDisplay: setting?.display ?? "",
    priority: sr.priority ?? "routine",
    priorityDisplay: surgeryPriorityDisplay(sr.priority ?? "routine"),
    scheduledDate: start.slice(0, 10),
    scheduledTime: start.length > 10 ? start.slice(11, 16) : "",
    durationMinutes: duration ?? minutesBetween(start, sr.occurrencePeriod?.end ?? ""),
    roomId: room?.reference?.split("/").pop() ?? "",
    roomName: room?.display ?? "",
    surgicalDepartmentId: department?.reference?.split("/").pop() ?? "",
    surgicalDepartmentName: department?.display ?? "",
    positionCode: sr.extension?.find((e) => e.url === POSITION_EXT_URL)?.valueCoding?.code ?? "",
    estimatedBloodLoss: bloodLoss?.value != null ? String(bloodLoss.value) : "",
    staff,
    anesthesiaMethods: codesOfExtensions(sr.extension, ANESTHESIA_METHOD_EXT_URL),
    anesthesiaManagement:
      sr.extension?.find((e) => e.url === ANESTHESIA_MANAGEMENT_EXT_URL)?.valueCoding?.code ?? "",
    bloodPreparation:
      bloodPreparation?.extension?.find((s) => s.url === "type")?.valueCoding?.code ?? "",
    bloodPreparationUnits:
      bloodPreparationUnits?.value != null ? String(bloodPreparationUnits.value) : "",
    equipmentLabels: (sr.extension ?? [])
      .filter((e) => e.url === EQUIPMENT_EXT_URL)
      .map((e) => e.valueCoding?.display ?? e.valueCoding?.code ?? "")
      .filter(Boolean),
    specimenPlans: codesOfExtensions(sr.extension, SPECIMEN_PLAN_EXT_URL),
    consents: codesOfExtensions(sr.extension, CONSENT_EXT_URL),
    comment: sr.note?.[0]?.text ?? "",
    preopInstruction: sr.extension?.find((e) => e.url === PREOP_EXT_URL)?.valueString ?? "",
    preopInstructionResponseId: preopResponseIdOf(sr),
  };
}

function minutesBetween(start: string, end: string): number | null {
  if (start.length <= 10 || end.length <= 10) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return Number.isFinite(ms) && ms > 0 ? Math.round(ms / 60000) : null;
}

/**
 * オーダーした術式(並び順のとおり。先頭が主術式)。
 *
 * items には、そのオーダーにぶら下がる明細の ServiceRequest を渡す
 * (`_revinclude:iterate=ServiceRequest:based-on` で取得したもの)。
 */
export function surgeryOrderItems(
  _sr: fhir4.ServiceRequest,
  items: fhir4.ServiceRequest[] = [],
): SurgeryOrderItemLine[] {
  return [...items]
    .sort((a, b) => itemNumber(a, ITEM_NUMBER_SYSTEM) - itemNumber(b, ITEM_NUMBER_SYSTEM))
    .map(parseItemRequest);
}

/** ServiceRequest の一覧から、指定のオーダーにぶら下がる明細だけを取り出す。 */
export function surgeryOrderItemRequests(
  serviceRequests: fhir4.ServiceRequest[],
  headerId: string,
): fhir4.ServiceRequest[] {
  return serviceRequests.filter((request) => {
    if (request.id === headerId) return false;
    const parent = request.basedOn?.[0]?.reference;
    return parent === `ServiceRequest/${headerId}`;
  });
}

export const surgeryOrderProblem = orderProblem;

// ---- 編集フォームへの復元 ----

export function parseSurgeryOrderForm(
  sr: fhir4.ServiceRequest,
  items: fhir4.ServiceRequest[] = [],
): SurgeryOrderFormValues {
  const summary = summarizeSurgeryOrder(sr);
  return {
    setting: (summary.settingCode || "") as PrescriptionSetting,
    scheduledDate: summary.scheduledDate,
    scheduledTime: summary.scheduledTime,
    durationMinutes: summary.durationMinutes != null ? String(summary.durationMinutes) : "",
    roomId: summary.roomId,
    roomName: summary.roomName,
    priority: (summary.priority || "routine") as "routine" | "urgent" | "stat",
    surgicalDepartmentId: summary.surgicalDepartmentId,
    surgicalDepartmentName: summary.surgicalDepartmentName,
    position: summary.positionCode,
    estimatedBloodLoss: summary.estimatedBloodLoss,
    staff: summary.staff,
    anesthesiaMethods: summary.anesthesiaMethods,
    anesthesiaManagement: summary.anesthesiaManagement,
    bloodPreparation: summary.bloodPreparation,
    bloodPreparationUnits: summary.bloodPreparationUnits,
    // 「その他」の自由記載は display に載せているので、コード表の表示名と違う値を
    // 自由記載として戻す。
    equipment: (sr.extension ?? [])
      .filter((e) => e.url === EQUIPMENT_EXT_URL)
      .map((e) => e.valueCoding?.code ?? "")
      .filter(Boolean),
    equipmentOther:
      (sr.extension ?? [])
        .filter((e) => e.url === EQUIPMENT_EXT_URL)
        .map((e) => e.valueCoding)
        .find((c) => c?.code === "other" && c.display !== surgeryEquipmentDisplay("other"))
        ?.display ?? "",
    specimenPlans: summary.specimenPlans,
    consents: summary.consents,
    comment: summary.comment,
    preopInstruction: summary.preopInstruction,
    // 保存済みの回答は参照だけ持つ(開き直すまで draft は無い)。
    preopInstructionTemplate: summary.preopInstructionResponseId
      ? { responseId: summary.preopInstructionResponseId, draft: null }
      : null,
    problem: surgeryOrderProblem(sr),
    items: surgeryOrderItems(sr, items),
  };
}
