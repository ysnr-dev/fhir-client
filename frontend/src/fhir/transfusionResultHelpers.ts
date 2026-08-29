import { toDateTimeInput, toFhirDateTime } from "./clinicalNoteHelpers";
import { ORDER_TYPE_SYSTEM } from "./prescriptionHelpers";
import {
  PRODUCT_SYSTEM,
  TRANSFUSION_ORDER_TYPE,
  transfusionOrderProducts,
  type TransfusionProductValues,
} from "./transfusionOrderHelpers";
import { buildTransfusionTaskUpdate } from "./transfusionTaskHelpers";

// 輸血の実施記録。手術(docs/surgery-result-design.md)と同じ形。
//
//   ServiceRequest(オーダー)
//    └ basedOn ← Procedure (実施記録。オーダー単位で1件)
//         │  performedPeriod = 輸血の開始/終了
//         │  performer       = 実施者
//         │  note            = 実施コメント
//         ├ partOf ← MedicationAdministration (バッグ 1 本ごと)
//         └ partOf ← Observation              (副作用の有無)
//
// 他部門の実施記録と違うところ:
//
// - **時点ではなく期間で持つ**。輸血は「いつ始めていつ終わったか」が副作用の判断に
//   直結する(開始 15 分以内の観察が要る)ため、処置の performedDateTime(時点)では
//   なく performedPeriod にする。バッグごとの時刻も MedicationAdministration の
//   effectivePeriod(R4 標準)で持つ。
// - **製剤番号をローカル拡張で持つ**。FHIR で製剤のロット番号を標準的に置く場所は
//   Medication.batch.lotNumber だが、このコードベースは処方・注射・処置・手術の
//   どこでも contained Medication を使っておらず(すべて medicationCodeableConcept)、
//   ここだけ別の作法を持ち込むと読み手が 2 通りの形を覚えることになる。在庫引当を
//   しないので Medication インスタンスを作る動機も無い
//   (docs/transfusion-order-design.md §2.6)。
// - **副作用は「なし」も記録する**。輸血では観察したうえで無かったことが記録として
//   要るので、Observation が無い = 未観察、値が none = 観察して無かった、を区別する。
//
// Procedure.code は輸血手技のコード表を持っていないので text だけ("輸血")。
// 輸血管理料・輸血手技料の算定は未実装(申し送り)。

/** JP Core の Procedure プロファイル。上流の登録先。 */
const PROCEDURE_PROFILE = "http://jpfhir.jp/fhir/core/StructureDefinition/JP_Procedure";

/** 製剤番号(ロット番号)。MedicationAdministration に直接付ける。 */
const LOT_NUMBER_EXT_URL = "http://fhir-client.local/StructureDefinition/transfusion-lot-number";

/** 実施記録の Observation の code。手術の surgery-observation と同じ役割。 */
const OBSERVATION_SYSTEM = "http://fhir-client.local/CodeSystem/transfusion-observation";
/** 副作用の値(なし / あり)。code の体系とは別に持つ。 */
const REACTION_SYSTEM = "http://fhir-client.local/CodeSystem/transfusion-reaction";

const REACTION_CODE = { code: "reaction", display: "輸血副作用" };

/**
 * 副作用の有無。「未観察」を選択肢に置かないのは、観察していないことを
 * Observation を作らないことで表すため(§2.7)。
 */
export type TransfusionReaction = "none" | "present";

export const REACTION_OPTIONS: { code: TransfusionReaction; display: string }[] = [
  { code: "none", display: "なし" },
  { code: "present", display: "あり" },
];

export function reactionDisplay(code: string): string {
  return REACTION_OPTIONS.find((o) => o.code === code)?.display ?? code;
}

// ---- 実施入力フォームの値 ----

/** 輸血したバッグ 1 本。製剤番号は遡及調査の起点になるので 1 本ずつ持つ。 */
export interface TransfusionBagLine {
  productCode: string;
  productName: string;
  /** 単位数。オーダーの単位数を初期値にする。 */
  units: string;
  /** 単位の呼び方(単位 / mL / 本)。 */
  unitLabel: string;
  /** 製剤番号(ロット番号)。 */
  lotNumber: string;
  /**
   * このバッグの開始・終了。空なら輸血全体の開始・終了を使う
   * (1 本だけの輸血でいちいち同じ時刻を 2 回入れさせないため)。
   */
  startedAt: string;
  endedAt: string;
}

export interface TransfusionPerformFormValues {
  /** 輸血全体の開始・終了。datetime-local の入力形式(YYYY-MM-DDTHH:mm)。 */
  startedAt: string;
  endedAt: string;
  performerId: string;
  performerName: string;
  bags: TransfusionBagLine[];
  /** 副作用の有無。必ず選ばせる(未選択のままでは登録させない)。 */
  reaction: TransfusionReaction | "";
  /** 副作用の内容。あり のときだけ使う。 */
  reactionNote: string;
  comment: string;
}

/** オーダーの製剤から実施入力の初期行を作る。単位数はオーダーの値をそのまま置く。 */
export function bagLinesFromOrder(
  itemRequests: fhir4.ServiceRequest[],
): TransfusionBagLine[] {
  return transfusionOrderProducts(itemRequests).map((product: TransfusionProductValues) => ({
    productCode: product.productCode,
    productName: product.productName,
    units: product.units,
    unitLabel: product.unitLabel,
    lotNumber: "",
    startedAt: "",
    endedAt: "",
  }));
}

export function emptyTransfusionPerformForm(
  itemRequests: fhir4.ServiceRequest[],
): TransfusionPerformFormValues {
  const now = toDateTimeInput(new Date());
  return {
    startedAt: now,
    endedAt: "",
    performerId: "",
    performerName: "",
    bags: bagLinesFromOrder(itemRequests),
    reaction: "",
    reactionNote: "",
    comment: "",
  };
}

// ---- FHIR リソースの組み立て ----

function performedPeriod(values: TransfusionPerformFormValues): fhir4.Period {
  const period: fhir4.Period = { start: toFhirDateTime(values.startedAt) };
  if (values.endedAt) period.end = toFhirDateTime(values.endedAt);
  return period;
}

function buildHubProcedure(
  values: TransfusionPerformFormValues,
  subject: fhir4.Reference,
  orderReference: string,
): fhir4.Procedure {
  const procedure: fhir4.Procedure = {
    resourceType: "Procedure",
    meta: { profile: [PROCEDURE_PROFILE] },
    status: "completed",
    // 処方・処置・手術の Procedure と振り分けるための区分。
    category: { coding: [{ system: ORDER_TYPE_SYSTEM, ...TRANSFUSION_ORDER_TYPE }] },
    // 輸血手技のコード表を持っていないので表示名だけ。
    code: { text: TRANSFUSION_ORDER_TYPE.display },
    subject,
    basedOn: [{ reference: orderReference }],
    performedPeriod: performedPeriod(values),
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
  if (values.comment.trim()) procedure.note = [{ text: values.comment.trim() }];

  return procedure;
}

function buildBagAdministration(
  bag: TransfusionBagLine,
  values: TransfusionPerformFormValues,
  subject: fhir4.Reference,
  hubReference: string,
): fhir4.MedicationAdministration {
  // effective[x] は 1..1 なので必ず埋める。バッグごとの時刻を入れていなければ
  // 輸血全体の時間帯をそのまま使う。
  const period: fhir4.Period = {
    start: toFhirDateTime(bag.startedAt || values.startedAt),
  };
  const end = bag.endedAt || values.endedAt;
  if (end) period.end = toFhirDateTime(end);

  const dosage: fhir4.MedicationAdministrationDosage = {};
  const units = Number(bag.units);
  if (Number.isFinite(units) && units > 0) {
    // 単位は製剤マスタの数え方(単位 / mL / 本)。UCUM には無いので表示名だけ持たせる。
    dosage.dose = { value: units, unit: bag.unitLabel || "単位" };
  }

  const administration: fhir4.MedicationAdministration = {
    resourceType: "MedicationAdministration",
    status: "completed",
    medicationCodeableConcept: {
      coding: [{ system: PRODUCT_SYSTEM, code: bag.productCode, display: bag.productName }],
      text: bag.productName,
    },
    subject,
    effectivePeriod: period,
    partOf: [{ reference: hubReference }],
    ...(dosage.dose ? { dosage } : {}),
  };

  if (bag.lotNumber.trim()) {
    administration.extension = [{ url: LOT_NUMBER_EXT_URL, valueString: bag.lotNumber.trim() }];
  }

  return administration;
}

function buildReactionObservation(
  values: TransfusionPerformFormValues,
  subject: fhir4.Reference,
  hubReference: string,
): fhir4.Observation {
  const display = reactionDisplay(values.reaction);
  const observation: fhir4.Observation = {
    resourceType: "Observation",
    status: "final",
    // 他部門の Observation(手術の出血量など)と振り分けるための区分。
    category: [{ coding: [{ system: ORDER_TYPE_SYSTEM, ...TRANSFUSION_ORDER_TYPE }] }],
    code: {
      coding: [{ system: OBSERVATION_SYSTEM, ...REACTION_CODE }],
      text: REACTION_CODE.display,
    },
    subject,
    effectiveDateTime: toFhirDateTime(values.startedAt),
    valueCodeableConcept: {
      coding: [{ system: REACTION_SYSTEM, code: values.reaction, display }],
      text: display,
    },
    partOf: [{ reference: hubReference }],
  };

  if (values.reaction === "present" && values.reactionNote.trim()) {
    observation.note = [{ text: values.reactionNote.trim() }];
  }

  return observation;
}

/** 実施記録一式(ハブの Procedure・バッグ・副作用)の POST エントリ。 */
function performEntries(
  values: TransfusionPerformFormValues,
  subject: fhir4.Reference,
  orderReference: string,
): fhir4.BundleEntry[] {
  const hubReference = `urn:uuid:${crypto.randomUUID()}`;

  const entries: fhir4.BundleEntry[] = [
    {
      fullUrl: hubReference,
      resource: buildHubProcedure(values, subject, orderReference),
      request: { method: "POST", url: "Procedure" },
    },
  ];

  // 製剤が選ばれていない行(追加したまま入力しなかった行)は保存しない。
  for (const bag of values.bags.filter((line) => line.productCode)) {
    entries.push({
      fullUrl: `urn:uuid:${crypto.randomUUID()}`,
      resource: buildBagAdministration(bag, values, subject, hubReference),
      request: { method: "POST", url: "MedicationAdministration" },
    });
  }

  if (values.reaction) {
    entries.push({
      fullUrl: `urn:uuid:${crypto.randomUUID()}`,
      resource: buildReactionObservation(values, subject, hubReference),
      request: { method: "POST", url: "Observation" },
    });
  }

  return entries;
}

/**
 * 実施登録の transaction Bundle。実施記録一式と Task の完了を 1 つにまとめ、
 * 実施情報だけ保存されて進捗が止まる状態を作らない。
 */
export function buildTransfusionPerformBundle(
  values: TransfusionPerformFormValues,
  order: fhir4.ServiceRequest,
  task: fhir4.Task | undefined,
): fhir4.Bundle {
  const entries = performEntries(values, order.subject ?? {}, `ServiceRequest/${order.id ?? ""}`);

  // 進捗の完了。Task はステータスを最初に変えたときに作られるので、まだ無ければ作る。
  entries.push({
    resource: buildTransfusionTaskUpdate(task, order, "completed"),
    request: task?.id
      ? { method: "PUT", url: `Task/${task.id}` }
      : { method: "POST", url: "Task" },
  });

  return { resourceType: "Bundle", type: "transaction", entry: entries };
}

/**
 * 実施取消で消す実施記録の DELETE エントリ。
 *
 * 手術と同じく実施記録ごと消す(放射線・生理・内視鏡・処置は Task を戻すだけで
 * 記録を残している)。輸血の実施記録は「このバッグを輸血した」という遡及調査の
 * 記録そのもので、取り消したのに残っているとその記録が嘘になるため。
 */
export function buildTransfusionPerformDeleteEntries(
  procedures: fhir4.Procedure[],
  administrations: fhir4.MedicationAdministration[],
  observations: fhir4.Observation[],
): fhir4.BundleEntry[] {
  const hubs = procedures.filter(isTransfusionProcedure);
  const hubIds = new Set(hubs.map((procedure) => procedure.id).filter(Boolean));
  const belongsToHub = (resource: { partOf?: fhir4.Reference[] }) =>
    (resource.partOf ?? []).some((reference) =>
      hubIds.has(referenceId(reference.reference, "Procedure")),
    );

  const deleteEntry = (resourceType: string, id: string | undefined): fhir4.BundleEntry[] =>
    id ? [{ request: { method: "DELETE" as const, url: `${resourceType}/${id}` } }] : [];

  // 子(バッグ・副作用)を先に消してから親を消す。
  return [
    ...observations.filter(belongsToHub).flatMap((o) => deleteEntry("Observation", o.id)),
    ...administrations
      .filter(belongsToHub)
      .flatMap((a) => deleteEntry("MedicationAdministration", a.id)),
    ...hubs.flatMap((procedure) => deleteEntry("Procedure", procedure.id)),
  ];
}

// ---- カルテ・一覧への表示 ----

export interface TransfusionPerformDisplay {
  /** ハブの Procedure id。表示のキー。 */
  id: string;
  /** 実施時間帯 "2026-08-31 14:00〜15:30"。終了が無ければ開始だけ。 */
  performedAt: string;
  performerName: string;
  /** 輸血したバッグ。「赤血球液-LR 2単位 (No.1234)」の形。 */
  bags: string[];
  /** 副作用。「なし」「あり: 発熱」。記録が無ければ空。 */
  reaction: string;
  comment: string;
  /**
   * 実施まで至らなかった記録の注記(status が completed 以外)。
   * 通常は空で、途中で中止したときなどに入る。
   */
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

/** 輸血の実施記録か。処方・処置・手術の Procedure と振り分ける。 */
export function isTransfusionProcedure(procedure: fhir4.Procedure): boolean {
  return Boolean(
    procedure.category?.coding?.some(
      (c) => c.system === ORDER_TYPE_SYSTEM && c.code === TRANSFUSION_ORDER_TYPE.code,
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

/** 「YYYY-MM-DD HH:mm〜HH:mm」。日をまたぐときは終了側も日付ごと出す。 */
function periodLabel(period: fhir4.Period | undefined): string {
  if (!period?.start) return "";
  const start = toDateTimeInput(period.start).replace("T", " ");
  if (!period.end) return start;
  const end = toDateTimeInput(period.end).replace("T", " ");
  // 同じ日なら終了は時刻だけにして短くする。
  return start.slice(0, 10) === end.slice(0, 10)
    ? `${start}〜${end.slice(11)}`
    : `${start}〜${end}`;
}

function bagLabel(administration: fhir4.MedicationAdministration): string {
  const dose = administration.dosage?.dose;
  const amount = dose?.value == null ? "" : `${dose.value}${dose.unit ?? ""}`;
  const lot = administration.extension?.find((e) => e.url === LOT_NUMBER_EXT_URL)?.valueString;
  return [conceptLabel(administration.medicationCodeableConcept), amount, lot && `(No.${lot})`]
    .filter(Boolean)
    .join(" ");
}

function reactionLabel(observation: fhir4.Observation | undefined): string {
  if (!observation) return "";
  const value = conceptLabel(observation.valueCodeableConcept);
  const note = observation.note?.map((n) => n.text).filter(Boolean).join(" ");
  return note ? `${value}: ${note}` : value;
}

/**
 * 実施記録をオーダー id ごとの表示内容にまとめる。
 *
 * 実施取消では記録ごと消すので、1 オーダーに残るハブは通常 1 件。それでも配列で
 * 返すのは、消し損ねが残ったときに黙って 1 件だけ出すより全部見えた方が安全なため。
 */
export function transfusionPerformsByOrderId(
  procedures: fhir4.Procedure[],
  administrations: fhir4.MedicationAdministration[],
  observations: fhir4.Observation[],
): Map<string, TransfusionPerformDisplay[]> {
  // 誤登録として取り消されたものは実施していないのと同じなので出さない。
  const hubs = procedures.filter(
    (procedure) => isTransfusionProcedure(procedure) && procedure.status !== "entered-in-error",
  );

  const byOrderId = new Map<string, TransfusionPerformDisplay[]>();
  for (const hub of hubs) {
    const hubId = hub.id ?? "";
    const partOfHub = (resource: { partOf?: fhir4.Reference[] }) =>
      (resource.partOf ?? []).some(
        (reference) => referenceId(reference.reference, "Procedure") === hubId,
      );

    const display: TransfusionPerformDisplay = {
      id: hubId,
      performedAt: periodLabel(hub.performedPeriod),
      performerName: hub.performer?.[0]?.actor?.display ?? "",
      bags: administrations.filter(partOfHub).map(bagLabel).filter(Boolean),
      reaction: reactionLabel(observations.find(partOfHub)),
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
