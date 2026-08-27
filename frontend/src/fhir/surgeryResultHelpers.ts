import { toDateTimeInput, toFhirDateTime } from "./clinicalNoteHelpers";
import { ROUTE_SYSTEM, type CodeOption } from "./injectionHelpers";
import { MEDICINE_CODE_SYSTEM, ORDER_TYPE_SYSTEM, YJ_CODE_SYSTEM } from "./prescriptionHelpers";
import {
  STAFF_ROLE_SYSTEM,
  SURGERY_ORDER_TYPE,
  surgeryStaffRoleDisplay,
  type SurgeryStaffLine,
} from "./surgeryOrderHelpers";
import { buildSurgeryTaskUpdate } from "./surgeryTaskHelpers";

// 手術の実施記録。処置(docs/treatment-order-design.md)と同じ「ハブ Procedure に
// 子をぶら下げる」形を骨格にし、手術に固有の記録を足したもの。
//
//   ServiceRequest(申込)
//    └ basedOn ← Procedure (実施記録。オーダー単位で1件 = ハブ)
//         │  code            = 実施した術式の1件目(レセ電算 K/L コード)
//         │  performedPeriod = 入室〜退室
//         │  performer[]     = 役割つきの複数人(function に surgery-staff-role)
//         │  usedCode        = 使用した材料(数量は拡張)
//         │  complication / outcome = 合併症・転帰
//         │  note            = 実施コメント
//         │  extension       = 中間時刻4点・創分類・カウント
//         ├ partOf ← Procedure               (2件目以降の術式・麻酔の手技料)
//         ├ partOf ← MedicationAdministration (薬剤)
//         └ partOf ← Observation              (出血量・尿量・輸血量)
//
// 処置との違いは3つ。
//
// 1. **実施者が複数いる**。処置は performer[0] の1人だけだが、手術は執刀医・助手・
//    麻酔科医・器械出し・外回り・ME が誰だったかが記録の要件になる(算定でも
//    「執刀医が誰か」を問われる)。FHIR の performer は 0..* で function に役割を
//    持てるので、申込のスタッフ拡張と同じ CodeSystem を function に使う。
// 2. **時間が幅を持つ**。処置は performedDateTime の一点だが、手術は入室〜退室の
//    幅が麻酔管理料などの算定根拠になるので performedPeriod にする。
//    途中の4点(麻酔開始・執刀開始・執刀終了・麻酔終了)は Period に入れる場所が
//    ないのでローカル拡張にした(標準要素に該当が無い)。
// 3. **測定値を持つ**。出血量・尿量・輸血量は放射線の被曝線量と同じ流儀で、
//    ハブに partOf でぶら下げる Observation にする(docs/rad-result-design.md)。
//    バイタルと違い category は持たせない。手術の実施記録の一部であって、
//    経過表に並ぶ測定値ではないため。

/** JP Core の Procedure プロファイル。上流の登録先。 */
const PROCEDURE_PROFILE = "http://jpfhir.jp/fhir/core/StructureDefinition/JP_Procedure";

/**
 * Procedure.code。申込明細の K コードと同じ system を使う(予定と実施を同じ
 * コード体系で突き合わせられるようにするため)。麻酔の手技料(L章)も同じ system。
 */
const SURGERY_PROCEDURE_CODE_SYSTEM =
  "http://fhir-client.local/CodeSystem/surgery-procedure-code";
/** usedCode。算定に使うレセプト電算の特定器材コード。 */
const MEDICAL_MATERIAL_SYSTEM = "http://fhir-client.local/CodeSystem/medical-material";
/** usedCode は CodeableConcept なので数量を持てない。拡張で添える(処置と同型)。 */
const MATERIAL_QUANTITY_EXT_URL =
  "http://fhir-client.local/StructureDefinition/surgery-material-quantity";

/**
 * 入室・退室以外の時刻。performedPeriod は start/end しか持てないので、途中の4点を
 * 複合拡張にまとめる。sub-url は下の SURGERY_TIME_FIELDS の key と対。
 */
const PERFORM_TIMES_EXT_URL = "http://fhir-client.local/StructureDefinition/surgery-perform-times";

/** 創分類(SSI サーベイランスの軸)。 */
const WOUND_CLASS_EXT_URL = "http://fhir-client.local/StructureDefinition/surgery-wound-class";
const WOUND_CLASS_SYSTEM = "http://fhir-client.local/CodeSystem/surgery-wound-class";
/** ガーゼ・器械カウントの確認結果。 */
const COUNT_CHECK_EXT_URL = "http://fhir-client.local/StructureDefinition/surgery-count-check";
const COUNT_CHECK_SYSTEM = "http://fhir-client.local/CodeSystem/surgery-count-check";
/** Procedure.outcome の coding。 */
const OUTCOME_SYSTEM = "http://fhir-client.local/CodeSystem/surgery-outcome";
/** 測定値 Observation の code。 */
const OBSERVATION_SYSTEM = "http://fhir-client.local/CodeSystem/surgery-observation";
const UCUM_SYSTEM = "http://unitsofmeasure.org";

/**
 * 薬剤の投与経路。手術では麻酔・鎮痛の静注が主役なので IV を先頭に置き、硬膜外・
 * くも膜下は route-codes に対応するコードが無いので局所(TOP)・皮下で代替せず、
 * 該当するものだけを並べる。コード表は注射・処置と同じ JP Core route-codes。
 */
export const SURGERY_ROUTE_OPTIONS: CodeOption[] = [
  { code: "IV", display: "静脈内" },
  { code: "IM", display: "筋肉内" },
  { code: "SC", display: "皮下" },
  { code: "TOP", display: "外用(局所)" },
  { code: "IH", display: "吸入" },
  { code: "PO", display: "経口" },
  { code: "PR", display: "直腸内" },
];

export function surgeryRouteDisplay(code: string): string {
  return SURGERY_ROUTE_OPTIONS.find((o) => o.code === code)?.display ?? code;
}

/** 入室・退室のあいだに記録する時刻。並び順がそのまま前後関係の検証順になる。 */
export const SURGERY_TIME_FIELDS = [
  { key: "anesthesiaStart", url: "anesthesia-start", label: "麻酔開始" },
  { key: "incisionStart", url: "incision-start", label: "執刀開始" },
  { key: "incisionEnd", url: "incision-end", label: "執刀終了" },
  { key: "anesthesiaEnd", url: "anesthesia-end", label: "麻酔終了" },
] as const;

export type SurgeryTimeKey = (typeof SURGERY_TIME_FIELDS)[number]["key"];

export const SURGERY_WOUND_CLASS_OPTIONS = [
  { code: "clean", display: "清潔" },
  { code: "clean-contaminated", display: "準清潔" },
  { code: "contaminated", display: "汚染" },
  { code: "dirty", display: "感染・不潔" },
] as const;

export const SURGERY_COUNT_CHECK_OPTIONS = [
  { code: "verified", display: "合致" },
  { code: "discrepancy", display: "不一致" },
] as const;

export const SURGERY_OUTCOME_OPTIONS = [
  { code: "good", display: "良好" },
  { code: "complicated", display: "合併症あり" },
  { code: "death", display: "死亡" },
] as const;

/** 測定値。すべて mL(UCUM も mL)。入力があるものだけ Observation を作る。 */
export const SURGERY_OBSERVATION_FIELDS = [
  { key: "bloodLoss", code: "blood-loss", label: "出血量" },
  { key: "urineOutput", code: "urine-output", label: "尿量" },
  { key: "transfusionVolume", code: "transfusion-volume", label: "輸血量" },
] as const;

export type SurgeryObservationKey = (typeof SURGERY_OBSERVATION_FIELDS)[number]["key"];

function optionDisplay(
  options: readonly { code: string; display: string }[],
  code: string,
): string {
  return options.find((o) => o.code === code)?.display ?? code;
}

export const surgeryWoundClassDisplay = (code: string) =>
  optionDisplay(SURGERY_WOUND_CLASS_OPTIONS, code);
export const surgeryCountCheckDisplay = (code: string) =>
  optionDisplay(SURGERY_COUNT_CHECK_OPTIONS, code);
export const surgeryOutcomeDisplay = (code: string) =>
  optionDisplay(SURGERY_OUTCOME_OPTIONS, code);

// ---- 実施入力フォームの値 ----

/** 実施した術式・麻酔の手技料。K章・L章のどちらもここに並ぶ。 */
export interface SurgeryProcedureLine {
  code: string;
  name: string;
}

/** 薬剤の行。使用量が薬剤料の算定根拠になる(処置と同じ)。 */
export interface SurgeryMedicineLine {
  medicineCode: string;
  name: string;
  yjCode: string;
  dose: string;
  unitName: string;
  routeCode: string;
}

/** 材料の行。コードを持たない手入力の行も許す(処置と同じ)。 */
export interface SurgeryMaterialLine {
  code: string;
  name: string;
  quantity: string;
  unitName: string;
}

export interface SurgeryPerformFormValues {
  /** 入室・退室。datetime-local の入力形式(YYYY-MM-DDTHH:mm)。どちらも必須。 */
  enteredAt: string;
  exitedAt: string;
  /** 途中の時刻。入力があるものだけ拡張に載せる。 */
  times: Partial<Record<SurgeryTimeKey, string>>;
  /** 実施したスタッフ。役割つきで複数。執刀医は必須。 */
  staff: SurgeryStaffLine[];
  procedures: SurgeryProcedureLine[];
  medicines: SurgeryMedicineLine[];
  materials: SurgeryMaterialLine[];
  /** 測定値(mL)。入力があるものだけ Observation にする。 */
  observations: Partial<Record<SurgeryObservationKey, string>>;
  woundClass: string;
  countCheck: string;
  /** 合併症。自由記載(コード化は第3段階の手術記録で扱う)。 */
  complication: string;
  outcome: string;
  comment: string;
}

export function emptySurgeryPerformForm(): SurgeryPerformFormValues {
  return {
    enteredAt: "",
    exitedAt: "",
    times: {},
    staff: [],
    procedures: [],
    medicines: [],
    materials: [],
    observations: {},
    woundClass: "",
    countCheck: "",
    complication: "",
    outcome: "",
    comment: "",
  };
}

/**
 * 時刻の前後関係。入力のあるものだけを並び順どおりに比べる。
 * 破れている最初の 1 つのメッセージを返し、問題なければ null。
 */
export function validateSurgeryTimes(values: SurgeryPerformFormValues): string | null {
  const sequence: { label: string; value: string }[] = [
    { label: "入室", value: values.enteredAt },
    ...SURGERY_TIME_FIELDS.map((field) => ({
      label: field.label,
      value: values.times[field.key] ?? "",
    })),
    { label: "退室", value: values.exitedAt },
  ].filter((entry) => Boolean(entry.value));

  for (let i = 1; i < sequence.length; i += 1) {
    const previous = sequence[i - 1];
    const current = sequence[i];
    if (current.value < previous.value) {
      return `${current.label}は${previous.label}以降の時刻にしてください。`;
    }
  }
  return null;
}

// ---- FHIR リソースの組み立て ----

function usedCodeOf(line: SurgeryMaterialLine): fhir4.CodeableConcept {
  const coding: fhir4.Coding[] = line.code
    ? [{ system: MEDICAL_MATERIAL_SYSTEM, code: line.code, display: line.name }]
    : [];

  const quantity = Number(line.quantity);
  return {
    ...(coding.length > 0 ? { coding } : {}),
    text: line.name,
    ...(Number.isFinite(quantity) && quantity > 0
      ? {
          extension: [
            {
              url: MATERIAL_QUANTITY_EXT_URL,
              valueQuantity: { value: quantity, unit: line.unitName || undefined },
            },
          ],
        }
      : {}),
  };
}

function procedureCode(line: SurgeryProcedureLine): fhir4.CodeableConcept {
  return {
    coding: [{ system: SURGERY_PROCEDURE_CODE_SYSTEM, code: line.code, display: line.name }],
    text: line.name,
  };
}

/**
 * ハブ・子で共通の骨格。実施者(performer)はハブだけが持つ。子は「同じ手術の
 * 別の手技料」でしかなく、術者を二重に持たせても読み手に足す情報が無いため。
 */
function baseProcedure(
  subject: fhir4.Reference,
  orderReference: string,
  period: fhir4.Period,
): fhir4.Procedure {
  return {
    resourceType: "Procedure",
    meta: { profile: [PROCEDURE_PROFILE] },
    status: "completed",
    // 他部門の Procedure と振り分けるための区分。
    category: { coding: [{ system: ORDER_TYPE_SYSTEM, ...SURGERY_ORDER_TYPE }] },
    subject,
    basedOn: [{ reference: orderReference }],
    performedPeriod: period,
  };
}

/** 役割つきの実施者。申込のスタッフ拡張と同じコード表を function に使う。 */
function performerOf(line: SurgeryStaffLine): fhir4.ProcedurePerformer {
  return {
    function: {
      coding: [
        {
          system: STAFF_ROLE_SYSTEM,
          code: line.role,
          display: surgeryStaffRoleDisplay(line.role),
        },
      ],
    },
    actor: {
      reference: `Practitioner/${line.practitionerId}`,
      ...(line.practitionerName ? { display: line.practitionerName } : {}),
    },
  };
}

function buildMedicationAdministration(
  line: SurgeryMedicineLine,
  subject: fhir4.Reference,
  hubReference: string,
  effectiveDateTime: string,
): fhir4.MedicationAdministration {
  const coding: fhir4.Coding[] = [
    { system: MEDICINE_CODE_SYSTEM, code: line.medicineCode, display: line.name },
  ];
  if (line.yjCode) coding.push({ system: YJ_CODE_SYSTEM, code: line.yjCode });

  const dose = Number(line.dose);
  const dosage: fhir4.MedicationAdministrationDosage = {};
  if (Number.isFinite(dose) && dose > 0) {
    // 単位は製剤単位。UCUM には無いので system/code は載せない(処置・注射と同じ)。
    dosage.dose = { value: dose, ...(line.unitName ? { unit: line.unitName } : {}) };
  }
  if (line.routeCode) {
    dosage.route = {
      coding: [
        {
          system: ROUTE_SYSTEM,
          code: line.routeCode,
          display: surgeryRouteDisplay(line.routeCode),
        },
      ],
    };
  }

  return {
    resourceType: "MedicationAdministration",
    status: "completed",
    medicationCodeableConcept: { coding, text: line.name },
    subject,
    effectiveDateTime,
    partOf: [{ reference: hubReference }],
    ...(dosage.dose || dosage.route ? { dosage } : {}),
  };
}

/** 測定値 1 件。放射線の被曝線量と同じく category を持たず partOf でハブに紐づく。 */
function buildObservation(
  field: (typeof SURGERY_OBSERVATION_FIELDS)[number],
  value: number,
  subject: fhir4.Reference,
  hubReference: string,
  effectiveDateTime: string,
): fhir4.Observation {
  return {
    resourceType: "Observation",
    status: "final",
    code: {
      coding: [{ system: OBSERVATION_SYSTEM, code: field.code, display: field.label }],
      text: field.label,
    },
    subject,
    effectiveDateTime,
    valueQuantity: { value, unit: "mL", system: UCUM_SYSTEM, code: "mL" },
    partOf: [{ reference: hubReference }],
  };
}

/** 中間時刻・創分類・カウントの拡張。入力があるものだけ。 */
function performExtensions(values: SurgeryPerformFormValues): fhir4.Extension[] {
  const extension: fhir4.Extension[] = [];

  const times = SURGERY_TIME_FIELDS.filter((field) => values.times[field.key]).map((field) => ({
    url: field.url,
    valueDateTime: toFhirDateTime(values.times[field.key] as string),
  }));
  if (times.length > 0) extension.push({ url: PERFORM_TIMES_EXT_URL, extension: times });

  if (values.woundClass) {
    extension.push({
      url: WOUND_CLASS_EXT_URL,
      valueCoding: {
        system: WOUND_CLASS_SYSTEM,
        code: values.woundClass,
        display: surgeryWoundClassDisplay(values.woundClass),
      },
    });
  }
  if (values.countCheck) {
    extension.push({
      url: COUNT_CHECK_EXT_URL,
      valueCoding: {
        system: COUNT_CHECK_SYSTEM,
        code: values.countCheck,
        display: surgeryCountCheckDisplay(values.countCheck),
      },
    });
  }
  return extension;
}

/**
 * 実施記録一式(ハブ・2件目以降の手技・薬剤・測定値)の POST エントリ。
 *
 * 手技が複数あるときに1件目をハブの code に置き、2件目以降を partOf でぶら下げるのは
 * 処置と同じ理由(Procedure.code は 0..1 で、異なる手技を1つの CodeableConcept の
 * 複数 coding に混ぜるのは意味が違う)。
 */
function performEntries(
  values: SurgeryPerformFormValues,
  subject: fhir4.Reference,
  orderReference: string,
): fhir4.BundleEntry[] {
  const period: fhir4.Period = {
    start: toFhirDateTime(values.enteredAt),
    end: toFhirDateTime(values.exitedAt),
  };
  // 子リソースの時刻は入室に揃える(手術中のどの時点かは記録していないので、
  // 幅の先頭を代表値にする)。
  const effectiveDateTime = period.start as string;
  const hubReference = `urn:uuid:${crypto.randomUUID()}`;

  const hub = baseProcedure(subject, orderReference, period);
  if (values.procedures[0]) hub.code = procedureCode(values.procedures[0]);

  const performers = values.staff.filter((line) => line.practitionerId).map(performerOf);
  if (performers.length > 0) hub.performer = performers;

  if (values.materials.length > 0) hub.usedCode = values.materials.map(usedCodeOf);
  if (values.complication.trim()) hub.complication = [{ text: values.complication.trim() }];
  if (values.outcome) {
    hub.outcome = {
      coding: [
        {
          system: OUTCOME_SYSTEM,
          code: values.outcome,
          display: surgeryOutcomeDisplay(values.outcome),
        },
      ],
      text: surgeryOutcomeDisplay(values.outcome),
    };
  }
  if (values.comment.trim()) hub.note = [{ text: values.comment.trim() }];

  const extension = performExtensions(values);
  if (extension.length > 0) hub.extension = extension;

  const entries: fhir4.BundleEntry[] = [
    { fullUrl: hubReference, resource: hub, request: { method: "POST", url: "Procedure" } },
  ];

  // 2件目以降の手技。オーダーからも引けるよう basedOn も張る(処置と同じ)。
  for (const line of values.procedures.slice(1)) {
    const child = baseProcedure(subject, orderReference, period);
    child.code = procedureCode(line);
    child.partOf = [{ reference: hubReference }];
    entries.push({
      fullUrl: `urn:uuid:${crypto.randomUUID()}`,
      resource: child,
      request: { method: "POST", url: "Procedure" },
    });
  }

  for (const line of values.medicines) {
    entries.push({
      fullUrl: `urn:uuid:${crypto.randomUUID()}`,
      resource: buildMedicationAdministration(line, subject, hubReference, effectiveDateTime),
      request: { method: "POST", url: "MedicationAdministration" },
    });
  }

  for (const field of SURGERY_OBSERVATION_FIELDS) {
    const raw = values.observations[field.key];
    if (!raw?.trim()) continue;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) continue;
    entries.push({
      fullUrl: `urn:uuid:${crypto.randomUUID()}`,
      resource: buildObservation(field, value, subject, hubReference, effectiveDateTime),
      request: { method: "POST", url: "Observation" },
    });
  }

  return entries;
}

/**
 * 実施登録の transaction Bundle。実施記録一式と Task の実施済を 1 つにまとめ、
 * 実施情報だけ保存されて進捗が入室中のまま止まる状態を作らない。
 */
export function buildSurgeryPerformBundle(
  values: SurgeryPerformFormValues,
  order: fhir4.ServiceRequest,
  task: fhir4.Task | undefined,
): fhir4.Bundle {
  const entries = performEntries(values, order.subject ?? {}, `ServiceRequest/${order.id ?? ""}`);

  entries.push({
    resource: buildSurgeryTaskUpdate(task, order, "completed"),
    request: task?.id ? { method: "PUT", url: `Task/${task.id}` } : { method: "POST", url: "Task" },
  });

  return { resourceType: "Bundle", type: "transaction", entry: entries };
}

/**
 * 実施の取消で実施記録を片付ける DELETE エントリ。Task を入室中へ戻す更新と
 * 同じ transaction に積む。
 *
 * 消す(entered-in-error で残さない)のは処置と同じ理由 —— 実施しなかったものに
 * 実施記録を残すと会計連携で除外条件が増えるため。取り消した内容は上流の
 * バージョン履歴(_history)から追える。
 *
 * 子(測定値・薬剤・2件目以降の手技)を先に消す。上流は 1 つの Bundle 内では配列順に
 * 処理するので、参照先が先に消えた状態を作らない。
 */
export function buildSurgeryPerformDeleteEntries(
  procedures: fhir4.Procedure[],
  administrations: fhir4.MedicationAdministration[],
  observations: fhir4.Observation[],
): fhir4.BundleEntry[] {
  const surgeryProcedures = procedures.filter(isSurgeryProcedure);
  const children = surgeryProcedures.filter((procedure) => procedure.partOf?.length);
  const hubs = surgeryProcedures.filter((procedure) => !procedure.partOf?.length);

  const deleteEntry = (resourceType: string, id: string | undefined): fhir4.BundleEntry[] =>
    id ? [{ request: { method: "DELETE" as const, url: `${resourceType}/${id}` } }] : [];

  return [
    ...observations.flatMap((observation) => deleteEntry("Observation", observation.id)),
    ...administrations.flatMap((administration) =>
      deleteEntry("MedicationAdministration", administration.id),
    ),
    ...children.flatMap((procedure) => deleteEntry("Procedure", procedure.id)),
    ...hubs.flatMap((procedure) => deleteEntry("Procedure", procedure.id)),
  ];
}

// ---- 実施情報の表示 ----

/** 実施記録 1 件(1 回の手術)ぶんの表示内容。 */
export interface SurgeryPerformDisplay {
  /** ハブの Procedure id。表示のキー。 */
  id: string;
  /** 「2026-08-28 09:05 〜 11:20」。退室が無ければ入室だけ。 */
  periodLabel: string;
  /** 中間時刻のうち入力があるもの。「麻酔開始 09:15」の形。 */
  times: string[];
  /** 「執刀医: 医師 一郎」の形。役割の定義順に並ぶ。 */
  staff: string[];
  /** 実施した術式・麻酔。ハブの code と partOf の子。 */
  procedures: string[];
  medicines: string[];
  materials: string[];
  /** 「出血量 350mL」の形。 */
  observations: string[];
  /** 創分類・カウント・合併症・転帰のうち入力があるもの。 */
  records: string[];
  comment: string;
  statusNote: string;
}

// completed 以外の実施記録に添える注記(処置と同じ)。
const PROCEDURE_STATUS_NOTES: Record<string, string> = {
  "not-done": "実施せず",
  stopped: "途中で中止",
  "in-progress": "実施中",
  preparation: "準備中",
  "on-hold": "保留中",
  unknown: "状態不明",
};

/** 手術の実施記録か。他部門の Procedure と振り分ける唯一の軸。 */
export function isSurgeryProcedure(procedure: fhir4.Procedure): boolean {
  return Boolean(
    procedure.category?.coding?.some(
      (c) => c.system === ORDER_TYPE_SYSTEM && c.code === SURGERY_ORDER_TYPE.code,
    ),
  );
}

function referenceId(reference: string | undefined, resourceType: string): string {
  return reference?.match(new RegExp(`^${resourceType}/(.+)$`))?.[1] ?? "";
}

function conceptLabel(concept: fhir4.CodeableConcept | undefined): string {
  if (!concept) return "";
  const coding = concept.coding?.find((c) => c.display) ?? concept.coding?.[0];
  return concept.text || coding?.display || coding?.code || "";
}

function quantityLabel(quantity: fhir4.Quantity | undefined): string {
  if (!quantity || quantity.value == null) return "";
  return `${quantity.value}${quantity.unit ?? ""}`;
}

function materialLabel(usedCode: fhir4.CodeableConcept): string {
  const extension = usedCode.extension?.find((e) => e.url === MATERIAL_QUANTITY_EXT_URL);
  return [conceptLabel(usedCode), quantityLabel(extension?.valueQuantity)].filter(Boolean).join(" ");
}

function medicineLabel(administration: fhir4.MedicationAdministration): string {
  const dosage = administration.dosage;
  const route = dosage?.route?.coding?.find((c) => c.system === ROUTE_SYSTEM)?.code;
  return [
    conceptLabel(administration.medicationCodeableConcept),
    quantityLabel(dosage?.dose),
    route ? surgeryRouteDisplay(route) : conceptLabel(dosage?.route),
  ]
    .filter(Boolean)
    .join(" ");
}

/** 「HH:mm」。日付は periodLabel が持つので時刻だけにする。 */
function timeOnly(dateTime: string | undefined): string {
  const input = toDateTimeInput(dateTime);
  return input.length > 10 ? input.slice(11, 16) : "";
}

function periodLabelOf(period: fhir4.Period | undefined): string {
  if (!period?.start) return "";
  const start = toDateTimeInput(period.start).replace("T", " ");
  const end = timeOnly(period.end);
  return end ? `${start} 〜 ${end}` : start;
}

function timesOf(procedure: fhir4.Procedure): string[] {
  const times = procedure.extension?.find((e) => e.url === PERFORM_TIMES_EXT_URL)?.extension ?? [];
  return SURGERY_TIME_FIELDS.flatMap((field) => {
    const value = times.find((t) => t.url === field.url)?.valueDateTime;
    const label = timeOnly(value);
    return label ? [`${field.label} ${label}`] : [];
  });
}

function recordsOf(procedure: fhir4.Procedure): string[] {
  const codingOf = (url: string) =>
    procedure.extension?.find((e) => e.url === url)?.valueCoding?.display ?? "";

  const woundClass = codingOf(WOUND_CLASS_EXT_URL);
  const countCheck = codingOf(COUNT_CHECK_EXT_URL);
  const complication = procedure.complication?.map(conceptLabel).filter(Boolean).join("・") ?? "";
  const outcome = conceptLabel(procedure.outcome);

  return [
    woundClass && `創分類 ${woundClass}`,
    countCheck && `カウント ${countCheck}`,
    complication && `合併症 ${complication}`,
    outcome && `転帰 ${outcome}`,
  ].filter((label): label is string => Boolean(label));
}

/** performer を役割の定義順に「執刀医: 医師 一郎」で並べる。 */
function staffOf(procedure: fhir4.Procedure): string[] {
  const roleOrder = (code: string) => {
    const index = SURGERY_PERFORM_STAFF_ROLE_INDEX.get(code);
    return index === undefined ? SURGERY_PERFORM_STAFF_ROLE_INDEX.size : index;
  };
  return (procedure.performer ?? [])
    .map((performer) => ({
      role: performer.function?.coding?.find((c) => c.system === STAFF_ROLE_SYSTEM)?.code ?? "",
      name: performer.actor?.display ?? "",
    }))
    .filter((entry) => entry.name)
    .sort((a, b) => roleOrder(a.role) - roleOrder(b.role))
    .map((entry) => (entry.role ? `${surgeryStaffRoleDisplay(entry.role)}: ${entry.name}` : entry.name));
}

const SURGERY_PERFORM_STAFF_ROLE_INDEX = new Map<string, number>(
  ["surgeon", "assistant", "anesthetist", "scrub-nurse", "circulating-nurse", "ce"].map(
    (code, index) => [code, index],
  ),
);

/**
 * 実施記録をオーダー id ごとの表示内容にまとめる。
 *
 * ハブ(partOf を持たない Procedure)1 件が 1 回の実施。取消 → 再実施でハブが複数
 * 残ることは無い(手術は取消で記録ごと消す)が、他部門と同じく配列で返して
 * 入室時刻の順に並べる。
 */
export function surgeryPerformsByOrderId(
  procedures: fhir4.Procedure[],
  administrations: fhir4.MedicationAdministration[],
  observations: fhir4.Observation[],
): Map<string, SurgeryPerformDisplay[]> {
  const surgeryProcedures = procedures.filter(
    (procedure) => isSurgeryProcedure(procedure) && procedure.status !== "entered-in-error",
  );

  const childrenByHub = new Map<string, fhir4.Procedure[]>();
  const hubs: fhir4.Procedure[] = [];
  for (const procedure of surgeryProcedures) {
    const hubId = referenceId(procedure.partOf?.[0]?.reference, "Procedure");
    if (!hubId) {
      hubs.push(procedure);
      continue;
    }
    const list = childrenByHub.get(hubId);
    if (list) list.push(procedure);
    else childrenByHub.set(hubId, [procedure]);
  }

  const byOrderId = new Map<string, SurgeryPerformDisplay[]>();
  for (const hub of hubs) {
    const hubId = hub.id ?? "";
    const children = childrenByHub.get(hubId) ?? [];
    // 薬剤・測定値はハブにぶら下げるが、子に付いていても拾えるようにする。
    const partIds = new Set([hubId, ...children.map((child) => child.id ?? "")].filter(Boolean));
    const partOf = (resource: { partOf?: fhir4.Reference[] }) =>
      (resource.partOf ?? []).some((reference) =>
        partIds.has(referenceId(reference.reference, "Procedure")),
      );

    const display: SurgeryPerformDisplay = {
      id: hubId,
      periodLabel: periodLabelOf(hub.performedPeriod),
      times: timesOf(hub),
      staff: staffOf(hub),
      procedures: [hub, ...children].map((p) => conceptLabel(p.code)).filter(Boolean),
      medicines: administrations.filter(partOf).map(medicineLabel).filter(Boolean),
      materials: (hub.usedCode ?? []).map(materialLabel).filter(Boolean),
      observations: observations
        .filter(partOf)
        .map((observation) =>
          [conceptLabel(observation.code), quantityLabel(observation.valueQuantity)]
            .filter(Boolean)
            .join(" "),
        )
        .filter(Boolean),
      records: recordsOf(hub),
      comment: hub.note?.map((note) => note.text).filter(Boolean).join("\n") ?? "",
      statusNote: PROCEDURE_STATUS_NOTES[hub.status] ?? "",
    };

    for (const basedOn of hub.basedOn ?? []) {
      const orderId = referenceId(basedOn.reference, "ServiceRequest");
      if (!orderId) continue;
      const list = byOrderId.get(orderId);
      if (list) list.push(display);
      else byOrderId.set(orderId, [display]);
    }
  }

  for (const list of byOrderId.values()) {
    list.sort((a, b) => a.periodLabel.localeCompare(b.periodLabel));
  }
  return byOrderId;
}
