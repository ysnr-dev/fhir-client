import type { OrderContext } from "../orderContext";
import { toDateTimeInput, toFhirDateTime } from "./clinicalNoteHelpers";
import { ROUTE_SYSTEM, type CodeOption } from "./injectionHelpers";
import { MEDICINE_CODE_SYSTEM, ORDER_TYPE_SYSTEM, YJ_CODE_SYSTEM } from "./prescriptionHelpers";
import {
  ENDOSCOPY_ORDER_TYPE,
  buildEndoscopyOrderSplitEntries,
  splitEndoscopyOrderValues,
  type EndoscopyOrderBooking,
  type EndoscopyOrderFormValues,
} from "./endoscopyOrderHelpers";
import { buildEndoscopyTaskUpdate } from "./endoscopyTaskHelpers";

// 内視鏡の実施記録。放射線検査(docs/rad-result-design.md)と同じ形。
//
//   ServiceRequest(オーダー)
//    └ basedOn ← Procedure (実施記録。オーダー単位で1件)
//         │  code     = 主たる手技(レセ電算 診療行為コード)
//         │  usedCode = 使用した器材
//         │  note     = 実施コメント
//         ├ partOf ← Procedure               (2件目以降の手技)
//         └ partOf ← MedicationAdministration (薬剤)
//
// 薬剤を usedCode に混ぜないのは、usedCode(CodeableConcept)が数量を持てないため。
// 薬剤は使用量(製剤単位)が薬剤料の算定根拠になるので MedicationAdministration にする。
//
// 放射線検査との違い:
// - 被曝線量(Observation)を持たない。内視鏡に電離放射線はない。
// - 器材は施設内の器材マスタを挟まず、算定コードである特定保険医療材料
//   (master_medical_materials)を直接指す。内視鏡は止血クリップ等の特定保険医療
//   材料が実在するが、算定コードで直接足りるので施設内コードの段は挟まない
//   (生理検査と同じ判断)。マスタが未整備でも入れられるよう名称は手入力もできる。
// - 薬剤は造影剤に限らない(鎮静剤・鎮痙剤・咽頭麻酔・前処置薬など)ので、
//   医薬品の絞り込みをせず投与経路の選択肢も内視鏡で使うものに絞る。

/** JP Core の Procedure プロファイル。上流の登録先。 */
const PROCEDURE_PROFILE = "http://jpfhir.jp/fhir/core/StructureDefinition/JP_Procedure";

/** Procedure.code。オーダー項目マスタの receipt_code と同じレセ電算の診療行為コード。 */
const ENDOSCOPY_PROCEDURE_CODE_SYSTEM = "http://fhir-client.local/CodeSystem/endoscopy-procedure-code";
/** usedCode。算定に使うレセプト電算の特定器材コード。 */
const MEDICAL_MATERIAL_SYSTEM = "http://fhir-client.local/CodeSystem/medical-material";

// usedCode は CodeableConcept なので数量を持てない。器材は数量で算定するため、
// 拡張で数量を添える(行を数量ぶん繰り返す形にはしない)。
const MATERIAL_QUANTITY_EXT_URL =
  "http://fhir-client.local/StructureDefinition/endoscopy-material-quantity";

/**
 * 薬剤の投与経路。内視鏡の実態(鎮静剤=静注、鎮痙剤=静注・筋注、咽頭麻酔=局所、
 * 前処置=経口・直腸内)に合わせて、生理検査の PHYSIO_ROUTE_OPTIONS から吸入と
 * 動注を外し、外用(咽頭麻酔・スプレー)と直腸内(前処置の坐剤・浣腸)を足した。
 * コード表は注射・放射線と同じ JP Core route-codes。
 */
export const ENDOSCOPY_ROUTE_OPTIONS: CodeOption[] = [
  { code: "IV", display: "静脈内" },
  { code: "IM", display: "筋肉内" },
  { code: "SC", display: "皮下" },
  { code: "PO", display: "経口" },
  { code: "TOP", display: "外用(局所)" },
  { code: "PR", display: "直腸内" },
];

export function endoscopyRouteDisplay(code: string): string {
  return ENDOSCOPY_ROUTE_OPTIONS.find((o) => o.code === code)?.display ?? code;
}

// ---- 実施入力フォームの値 ----

/** 手技料の行。オーダー時点で確定していない追加の手技を入れる。 */
export interface EndoscopyProcedureLine {
  code: string;
  name: string;
}

/** 薬剤の行。使用量が薬剤料の算定根拠になる。 */
export interface EndoscopyMedicineLine {
  medicineCode: string;
  name: string;
  /** YJ コード。処方・注射と同じ coding を載せるために持つ(無ければ空)。 */
  yjCode: string;
  /** 使用量。単位は製剤単位(unitName)で、処方・注射と同じ数え方。 */
  dose: string;
  /** 医薬品マスタの単位名(本・筒・g など)。未取込の医薬品では空。 */
  unitName: string;
  routeCode: string;
}

/**
 * 器材の行。放射線と違い施設内の器材マスタを挟まないので、code がそのまま
 * 算定用の特定保険医療材料コードになる。マスタ未整備でも入れられるよう、
 * コードを持たず名称だけの行(手入力)も許す。
 */
export interface EndoscopyMaterialLine {
  /** 特定保険医療材料コード。手入力の行では空。 */
  code: string;
  name: string;
  quantity: string;
  unitName: string;
}

export interface EndoscopyPerformFormValues {
  /** 実施時刻。datetime-local の入力形式(YYYY-MM-DDTHH:mm)。 */
  performedAt: string;
  performerId: string;
  performerName: string;
  procedures: EndoscopyProcedureLine[];
  medicines: EndoscopyMedicineLine[];
  materials: EndoscopyMaterialLine[];
  comment: string;
}

function usedCodeOf(line: EndoscopyMaterialLine): fhir4.CodeableConcept {
  // 算定用のコード。マスタから選ばず名称だけ手入力した行では載らない
  // (その場合も text に名称が残るので、何を使ったかは読める)。
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

function baseProcedure(
  values: EndoscopyPerformFormValues,
  subject: fhir4.Reference,
  // オーダー(ヘッダ)を指す参照。即実施では同じ Bundle 内の fullUrl(urn:uuid)。
  orderReference: string,
  performedDateTime: string,
): fhir4.Procedure {
  const procedure: fhir4.Procedure = {
    resourceType: "Procedure",
    meta: { profile: [PROCEDURE_PROFILE] },
    status: "completed",
    // 処方・検体検査の Procedure と振り分けるための区分。
    category: { coding: [{ system: ORDER_TYPE_SYSTEM, ...ENDOSCOPY_ORDER_TYPE }] },
    subject,
    basedOn: [{ reference: orderReference }],
    performedDateTime,
  };

  if (values.performerId) {
    procedure.performer = [
      {
        actor: {
          reference: `Practitioner/${values.performerId}`,
          display: values.performerName || undefined,
        },
      },
    ];
  }
  return procedure;
}

function procedureCode(line: EndoscopyProcedureLine): fhir4.CodeableConcept {
  return {
    coding: [{ system: ENDOSCOPY_PROCEDURE_CODE_SYSTEM, code: line.code, display: line.name }],
    text: line.name,
  };
}

function buildMedicationAdministration(
  line: EndoscopyMedicineLine,
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
    // 単位は医薬品マスタの製剤単位(本・筒・g など)。処方・注射の doseQuantity と
    // 同じ数え方にして、薬剤料の算定根拠を揃える。UCUM には無い単位なので
    // system/code は載せず、表示名だけを持たせる。
    dosage.dose = { value: dose, ...(line.unitName ? { unit: line.unitName } : {}) };
  }
  if (line.routeCode) {
    dosage.route = {
      coding: [
        { system: ROUTE_SYSTEM, code: line.routeCode, display: endoscopyRouteDisplay(line.routeCode) },
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

/**
 * 実施記録一式(ハブの Procedure・2 件目以降の手技・薬剤)の POST エントリ。
 *
 * 手技が複数あるときは、1件目を Procedure.code に置き、2件目以降を partOf で
 * ぶら下げる。Procedure.code は 0..1 で複数手技を1リソースには載せられず、
 * 異なる手技を1つの CodeableConcept の複数 coding に混ぜるのは(coding は同一概念の
 * 別表現を並べるもの)意味が違うため。
 */
function performEntries(
  values: EndoscopyPerformFormValues,
  subject: fhir4.Reference,
  orderReference: string,
): fhir4.BundleEntry[] {
  const performedDateTime = toFhirDateTime(values.performedAt);
  const hubReference = `urn:uuid:${crypto.randomUUID()}`;

  const hub = baseProcedure(values, subject, orderReference, performedDateTime);
  if (values.procedures[0]) hub.code = procedureCode(values.procedures[0]);
  if (values.materials.length > 0) hub.usedCode = values.materials.map(usedCodeOf);
  if (values.comment.trim()) hub.note = [{ text: values.comment.trim() }];

  const entries: fhir4.BundleEntry[] = [
    { fullUrl: hubReference, resource: hub, request: { method: "POST", url: "Procedure" } },
  ];

  // 2件目以降の手技。オーダーからも引けるよう basedOn も張る。
  for (const line of values.procedures.slice(1)) {
    const child = baseProcedure(values, subject, orderReference, performedDateTime);
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
      resource: buildMedicationAdministration(line, subject, hubReference, performedDateTime),
      request: { method: "POST", url: "MedicationAdministration" },
    });
  }

  return entries;
}

/**
 * 実施登録の transaction Bundle。実施記録一式と Task の完了を 1 つにまとめ、
 * 実施情報だけ保存されて進捗が止まる状態を作らない。
 */
export function buildEndoscopyPerformBundle(
  values: EndoscopyPerformFormValues,
  order: fhir4.ServiceRequest,
  task: fhir4.Task | undefined,
): fhir4.Bundle {
  const entries = performEntries(values, order.subject ?? {}, `ServiceRequest/${order.id ?? ""}`);

  // 進捗の完了。Task はステータスを最初に変えたときに作られるので、まだ無ければ作る。
  entries.push({
    resource: buildEndoscopyTaskUpdate(task, order, "completed"),
    request: task?.id
      ? { method: "PUT", url: `Task/${task.id}` }
      : { method: "POST", url: "Task" },
  });

  return { resourceType: "Bundle", type: "transaction", entry: entries };
}

// ---- 即実施(オーダー登録と同時の実施) ----
//
// 診察室でその場で検査する運用のために、オーダー画面から実施まで一度に登録する。
// 作るリソースは内視鏡一覧の「実施」と同じ(実施記録一式 + 実施済の Task)で、
// 違うのは参照先のオーダーがまだ採番されていない点だけ。同じ Bundle 内の
// fullUrl(urn:uuid)を指しておけば、上流が transaction 内で実 id に解決する。

/**
 * 即実施の実施入力。キーは `splitEndoscopyOrderValues` のキー(どのオーダーぶんか)。
 * 値が null のオーダーは実施記録を作らず Task の完了だけにする(オーダー項目マスタで
 * 実施入力をしないことにしてある項目。内視鏡一覧の「実施」と同じ扱い)。
 */
export type EndoscopyImmediatePerforms = Map<string, EndoscopyPerformFormValues | null>;

function immediatePerformEntries(
  values: EndoscopyPerformFormValues | null,
  header: fhir4.ServiceRequest,
  headerReference: string,
): fhir4.BundleEntry[] {
  const entries = values ? performEntries(values, header.subject ?? {}, headerReference) : [];
  entries.push({
    resource: buildEndoscopyTaskUpdate(undefined, header, "completed", headerReference),
    request: { method: "POST", url: "Task" },
  });
  return entries;
}

/**
 * 即実施でのオーダー登録。オーダー(ヘッダ + 明細)・実施記録・実施済の Task を
 * 1 つの transaction にまとめ、オーダーだけ登録されて実施が落ちる状態を作らない。
 *
 * 単独オーダーの項目を混ぜて選んだ場合はオーダーが分かれるので、実施記録も
 * オーダーごとに作る(薬剤・器材・手技料が複数のオーダーに二重に載らないように)。
 */
export function buildEndoscopyOrderWithPerformBundle(
  values: EndoscopyOrderFormValues,
  patientId: string,
  requester: OrderContext,
  performs: EndoscopyImmediatePerforms,
  booking?: EndoscopyOrderBooking,
): fhir4.Bundle {
  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: splitEndoscopyOrderValues(values).flatMap((split) => {
      const { header, headerReference, entries } = buildEndoscopyOrderSplitEntries(
        split,
        patientId,
        requester,
        booking,
      );
      // 即実施は登録するオーダーごとに選べる。選んでいないオーダーは通常の登録の
      // まま(実施記録も Task も作らない)。
      if (!performs.has(split.key)) return entries;

      return [
        ...entries,
        ...immediatePerformEntries(performs.get(split.key) ?? null, header, headerReference),
      ];
    }),
  };
}

/** 実施入力の要約。オーダー画面の「選択中」に、入れた内容の確認として出す。 */
export function endoscopyPerformSummary(values: EndoscopyPerformFormValues): string {
  return [
    values.performedAt.replace("T", " "),
    values.procedures.length > 0 ? `手技 ${values.procedures.length}` : "",
    values.medicines.length > 0 ? `薬剤 ${values.medicines.length}` : "",
    values.materials.length > 0 ? `器材 ${values.materials.length}` : "",
    values.comment.trim() ? "コメントあり" : "",
  ]
    .filter(Boolean)
    .join(" / ");
}

/**
 * 実施の取消で実施記録を片付ける DELETE エントリ。Task を受付済へ戻す更新と
 * 同じ transaction に積む。
 *
 * 消す(status = entered-in-error で残さない)のは、実施しなかったものに実施記録を
 * 残すと会計連携で除外条件が増えるため。中止で Procedure を作らない
 * 判断(docs/rad-result-design.md §2(内視鏡も同じ扱い))と同じ理由で、生きている実施記録だけが
 * 残るようにする。取り消した内容は上流のバージョン履歴(_history)から追える。
 *
 * 子(薬剤・2 件目以降の手技)を先に消す。上流は 1 つの Bundle 内では
 * 配列順に処理するので、参照先が先に消えた状態を作らない。
 */
export function buildEndoscopyPerformDeleteEntries(
  procedures: fhir4.Procedure[],
  administrations: fhir4.MedicationAdministration[],
): fhir4.BundleEntry[] {
  // 他部門の Procedure を巻き込まないよう、内視鏡の実施記録だけを対象にする。
  const endoscopyProcedures = procedures.filter(isEndoscopyProcedure);
  const children = endoscopyProcedures.filter((procedure) => procedure.partOf?.length);
  const hubs = endoscopyProcedures.filter((procedure) => !procedure.partOf?.length);

  const deleteEntry = (resourceType: string, id: string | undefined): fhir4.BundleEntry[] =>
    id ? [{ request: { method: "DELETE" as const, url: `${resourceType}/${id}` } }] : [];

  return [
    ...administrations.flatMap((administration) =>
      deleteEntry("MedicationAdministration", administration.id),
    ),
    ...children.flatMap((procedure) => deleteEntry("Procedure", procedure.id)),
    ...hubs.flatMap((procedure) => deleteEntry("Procedure", procedure.id)),
  ];
}

// ---- 実施情報の表示 ----
//
// 登録の逆をたどって、Procedure(ハブ)+ 子の手技 + 薬剤を
// 1 回の実施として読み解く。カルテのオーダーカードが使う。

/** 実施記録 1 件(1 回の実施)ぶんの表示内容。 */
export interface EndoscopyPerformDisplay {
  /** ハブの Procedure id。表示のキー。 */
  id: string;
  /** 実施日時 "YYYY-MM-DD HH:mm"。持たない実施記録では空。 */
  performedAt: string;
  performerName: string;
  /** 実施した手技。ハブの code と、partOf でぶら下がる 2 件目以降。 */
  procedures: string[];
  /** 薬剤。「アトロピン硫酸塩注 1管 静脈内」の形。 */
  medicines: string[];
  /** 使用した器材。「電極 10枚」の形。 */
  materials: string[];
  comment: string;
  /**
   * 検査まで至らなかった実施の注記(status が completed 以外)。
   * 通常は空で、薬剤だけ入れて中止したときなどに入る。
   */
  statusNote: string;
}

// completed 以外の実施記録に添える注記。実施記録があるのに実施していない、という
// 例外的な状態を黙って隠さないために出す。
const PROCEDURE_STATUS_NOTES: Record<string, string> = {
  "not-done": "実施せず",
  stopped: "途中で中止",
  "in-progress": "実施中",
  preparation: "準備中",
  "on-hold": "保留中",
  unknown: "状態不明",
};

/** 内視鏡の実施記録か。処方・検体検査・放射線検査の Procedure と振り分ける。 */
export function isEndoscopyProcedure(procedure: fhir4.Procedure): boolean {
  return Boolean(
    procedure.category?.coding?.some(
      (c) => c.system === ORDER_TYPE_SYSTEM && c.code === ENDOSCOPY_ORDER_TYPE.code,
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

// usedCode は数量を持てないので、登録時に付けた拡張から数量を読む。
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
    route ? endoscopyRouteDisplay(route) : conceptLabel(dosage?.route),
  ]
    .filter(Boolean)
    .join(" ");
}

/** 実施日時。カードの診療日と実施日は別日になりうるので日付ごと出す。 */
function performedLabel(procedure: fhir4.Procedure): string {
  const performed = procedure.performedDateTime ?? procedure.performedPeriod?.start;
  return toDateTimeInput(performed).replace("T", " ");
}

/**
 * 実施記録をオーダー id ごとの表示内容にまとめる。
 *
 * ハブ(partOf を持たない Procedure)1 件が 1 回の実施。取消 → 再実施でハブが複数
 * 残ることがある(docs/rad-result-design.md §7-6(内視鏡も同じ扱い))ため、オーダー 1 件に対して
 * 配列を返し、古い実施も落とさずに実施時刻の順で並べる。
 */
export function endoscopyPerformsByOrderId(
  procedures: fhir4.Procedure[],
  administrations: fhir4.MedicationAdministration[],
): Map<string, EndoscopyPerformDisplay[]> {
  // 誤登録として取り消されたものは実施していないのと同じなので出さない。
  const endoscopyProcedures = procedures.filter(
    (procedure) => isEndoscopyProcedure(procedure) && procedure.status !== "entered-in-error",
  );

  const childrenByHub = new Map<string, fhir4.Procedure[]>();
  const hubs: fhir4.Procedure[] = [];
  for (const procedure of endoscopyProcedures) {
    const hubId = referenceId(procedure.partOf?.[0]?.reference, "Procedure");
    if (!hubId) {
      hubs.push(procedure);
      continue;
    }
    const list = childrenByHub.get(hubId);
    if (list) list.push(procedure);
    else childrenByHub.set(hubId, [procedure]);
  }

  const byOrderId = new Map<string, EndoscopyPerformDisplay[]>();
  for (const hub of hubs) {
    const hubId = hub.id ?? "";
    const children = childrenByHub.get(hubId) ?? [];
    // 薬剤はハブにぶら下げるが、子の手技に付いていても拾えるようにする。
    const partIds = new Set([hubId, ...children.map((child) => child.id ?? "")].filter(Boolean));
    const partOf = (resource: { partOf?: fhir4.Reference[] }) =>
      (resource.partOf ?? []).some((reference) =>
        partIds.has(referenceId(reference.reference, "Procedure")),
      );

    const display: EndoscopyPerformDisplay = {
      id: hubId,
      performedAt: performedLabel(hub),
      performerName: hub.performer?.[0]?.actor?.display ?? "",
      procedures: [hub, ...children].map((p) => conceptLabel(p.code)).filter(Boolean),
      medicines: administrations.filter(partOf).map(medicineLabel).filter(Boolean),
      materials: (hub.usedCode ?? []).map(materialLabel).filter(Boolean),
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
    list.sort((a, b) => a.performedAt.localeCompare(b.performedAt));
  }
  return byOrderId;
}
