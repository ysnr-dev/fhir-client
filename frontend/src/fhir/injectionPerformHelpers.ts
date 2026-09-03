import { toDateTimeInput, toFhirDateTime } from "./clinicalNoteHelpers";
import {
  INJECTION_ORDER_TYPE,
  groupInjectionByRp,
  type InjectionRpDisplay,
} from "./injectionHelpers";
import { buildInjectionTaskUpdate } from "./injectionTaskHelpers";
import {
  MEDICINE_CODE_SYSTEM,
  ORDER_IN_RP_SYSTEM,
  ORDER_TYPE_SYSTEM,
  RP_NUMBER_SYSTEM,
  YJ_CODE_SYSTEM,
  identifierValue,
} from "./prescriptionHelpers";

// 注射の実施記録(施用)。輸血(transfusionResultHelpers)と同じ形で、実施 1 回を
// Procedure のハブにし、薬剤ごとの MedicationAdministration をぶら下げる。
//
//   ServiceRequest(1 日分の注射オーダー)
//    └ basedOn ← Procedure (実施 1 回。施用のたびに 1 件)
//         │  performedPeriod = 施用の開始/終了(ワンショットは開始だけ)
//         │  performer       = 実施者
//         │  status          = completed(完了) / stopped(途中で中止) / not-done(実施せず)
//         │  statusReason    = 中止・未実施の理由(text)
//         │  note            = 実施コメント
//         └ partOf ← MedicationAdministration (薬剤 1 件ごと)
//              request = その薬剤の MedicationRequest
//              dosage  = 実施量・経路・部位・手技(オーダーの用法から写す)
//
// **なぜ MedicationAdministration だけで持たないか。** FHIR としては request →
// MedicationRequest の MedicationAdministration だけで足りる。それでも Procedure を
// ハブに置くのは、このコードベースの実施記録がすべて「Procedure(basedOn オーダー)
// + partOf の子」で揃っていて、カルテの読み出し(_revinclude Procedure:based-on →
// MedicationAdministration:part-of)も実施取消もその形に乗っているため。注射だけ
// 別の形にすると読み出しの経路が増える。request は FHIR の意味を保つために併記する。
//
// **1 日に複数回の施用がある**(RP の開始時刻が 10:00 と 20:30 など)ので、ハブは
// オーダー 1 件に複数付く。進捗 Task を実施済にするのは、記録した回数がオーダーの
// 開始時刻の数に達したとき(開始時刻が無ければ 1 回で実施済)。

/** JP Core の Procedure プロファイル。上流の登録先。 */
const PROCEDURE_PROFILE = "http://jpfhir.jp/fhir/core/StructureDefinition/JP_Procedure";

/** 実施の結果。Procedure.status にそのまま写す。 */
export type InjectionPerformOutcome = "completed" | "stopped" | "not-done";

export const OUTCOME_OPTIONS: { code: InjectionPerformOutcome; display: string }[] = [
  { code: "completed", display: "実施" },
  { code: "stopped", display: "途中で中止" },
  { code: "not-done", display: "実施せず" },
];

export function outcomeDisplay(code: string): string {
  return OUTCOME_OPTIONS.find((o) => o.code === code)?.display ?? code;
}

// ---- 実施入力フォームの値 ----

/** 施用した薬剤 1 行。オーダーの薬剤行から作る。 */
export interface InjectionPerformMedicineLine {
  /** 元の MedicationRequest。request 参照と、薬剤コード・用法の写し元。 */
  medicationRequestId: string;
  rpNumber: number;
  orderInRp: number;
  code: string;
  yjCode?: string;
  name: string;
  /** 実施量。オーダーの投与量を初期値にする。 */
  dose: string;
  unit: string;
  /** オーダーの投与量(参考表示)。 */
  orderedDose?: number;
  /** この行は施用しなかった(混注のうち一部だけ入れなかったなど)。 */
  skipped: boolean;
  /** オーダーに無く実施時に足した薬剤。request を持たない MedicationAdministration になる。 */
  added: boolean;
}

export interface InjectionPerformFormValues {
  /** 施用の開始・終了。datetime-local の入力形式(YYYY-MM-DDTHH:mm)。 */
  startedAt: string;
  endedAt: string;
  performerId: string;
  performerName: string;
  outcome: InjectionPerformOutcome;
  /** 途中で中止・実施せず の理由。そのときは必須。 */
  reason: string;
  comment: string;
  medicines: InjectionPerformMedicineLine[];
}

/** オーダーの薬剤から実施入力の初期行を作る。実施量はオーダーの投与量をそのまま置く。 */
export function medicineLinesFromOrder(
  mrs: fhir4.MedicationRequest[],
): InjectionPerformMedicineLine[] {
  const rps: InjectionRpDisplay[] = groupInjectionByRp(mrs);
  const mrByKey = new Map<string, fhir4.MedicationRequest>();
  for (const mr of mrs) {
    const rp = identifierValue(mr, RP_NUMBER_SYSTEM) ?? "0";
    const order = identifierValue(mr, ORDER_IN_RP_SYSTEM) ?? "0";
    mrByKey.set(`${rp}-${order}`, mr);
  }
  return rps.flatMap((rp) =>
    rp.medicines.map((med) => ({
      medicationRequestId: mrByKey.get(`${rp.rpNumber}-${med.orderInRp}`)?.id ?? "",
      rpNumber: rp.rpNumber,
      orderInRp: med.orderInRp,
      code: med.code,
      yjCode: med.yjCode,
      name: med.name,
      dose: med.dose == null ? "" : String(med.dose),
      unit: med.unit ?? "",
      orderedDose: med.dose,
      skipped: false,
      added: false,
    })),
  );
}

/**
 * 実施入力の初期値。開始時刻は「今」。オーダーの開始時刻に合わせないのは、
 * 実施入力は施用した直後にその場で入れる想定で、予定時刻を既定にすると
 * 予定どおりでなかったときに直し忘れて予定時刻が実績になってしまうため。
 */
export function emptyInjectionPerformForm(
  mrs: fhir4.MedicationRequest[],
): InjectionPerformFormValues {
  return {
    startedAt: toDateTimeInput(new Date()),
    endedAt: "",
    performerId: "",
    performerName: "",
    outcome: "completed",
    reason: "",
    comment: "",
    medicines: medicineLinesFromOrder(mrs),
  };
}

// ---- FHIR リソースの組み立て ----

function performedPeriod(values: InjectionPerformFormValues): fhir4.Period {
  const period: fhir4.Period = { start: toFhirDateTime(values.startedAt) };
  if (values.endedAt) period.end = toFhirDateTime(values.endedAt);
  return period;
}

function buildHubProcedure(
  values: InjectionPerformFormValues,
  subject: fhir4.Reference,
  orderReference: string,
): fhir4.Procedure {
  const procedure: fhir4.Procedure = {
    resourceType: "Procedure",
    meta: { profile: [PROCEDURE_PROFILE] },
    status: values.outcome,
    // 処置・手術・輸血の Procedure と振り分けるための区分。
    category: { coding: [{ system: ORDER_TYPE_SYSTEM, ...INJECTION_ORDER_TYPE }] },
    // 施用手技のコード表は持っていないので表示名だけ。手技そのものは各薬剤の
    // MedicationAdministration.dosage.method にオーダーから写している。
    code: { text: INJECTION_ORDER_TYPE.display },
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
  if (values.outcome !== "completed" && values.reason.trim()) {
    procedure.statusReason = { text: values.reason.trim() };
  }
  if (values.comment.trim()) procedure.note = [{ text: values.comment.trim() }];

  return procedure;
}

function buildAdministration(
  line: InjectionPerformMedicineLine,
  mr: fhir4.MedicationRequest | undefined,
  values: InjectionPerformFormValues,
  subject: fhir4.Reference,
  hubReference: string,
): fhir4.MedicationAdministration {
  const period = performedPeriod(values);
  const instruction = mr?.dosageInstruction?.[0];

  const dosage: fhir4.MedicationAdministrationDosage = {};
  const dose = Number(line.dose);
  if (Number.isFinite(dose) && dose > 0) {
    dosage.dose = { value: dose, unit: line.unit || undefined };
  }
  // 経路・部位・手技はオーダーの用法をそのまま写す(施用時に変えることはまず無く、
  // 変えたなら別のオーダーになる)。
  if (instruction?.route) dosage.route = instruction.route;
  if (instruction?.site) dosage.site = instruction.site;
  if (instruction?.method) dosage.method = instruction.method;
  const rate = instruction?.doseAndRate?.[0]?.rateQuantity;
  if (rate) dosage.rateQuantity = rate;

  const administration: fhir4.MedicationAdministration = {
    resourceType: "MedicationAdministration",
    // 途中で中止した施用は、入った量を記録したうえで stopped にする。
    status: values.outcome === "stopped" ? "stopped" : "completed",
    medicationCodeableConcept: mr?.medicationCodeableConcept ?? {
      coding: [
        { system: MEDICINE_CODE_SYSTEM, code: line.code, display: line.name },
        ...(line.yjCode ? [{ system: YJ_CODE_SYSTEM, code: line.yjCode, display: line.name }] : []),
      ],
      text: line.name,
    },
    subject,
    effectivePeriod: period,
    partOf: [{ reference: hubReference }],
    ...(line.medicationRequestId
      ? { request: { reference: `MedicationRequest/${line.medicationRequestId}` } }
      : {}),
    ...(Object.keys(dosage).length ? { dosage } : {}),
  };

  if (values.performerId) {
    administration.performer = [
      {
        actor: {
          reference: `Practitioner/${values.performerId}`,
          display: values.performerName || undefined,
        },
      },
    ];
  }

  return administration;
}

/** 実施記録一式(ハブの Procedure・薬剤)の POST エントリ。 */
function performEntries(
  values: InjectionPerformFormValues,
  order: fhir4.ServiceRequest,
  mrs: fhir4.MedicationRequest[],
): fhir4.BundleEntry[] {
  const subject = order.subject ?? {};
  const hubReference = `urn:uuid:${crypto.randomUUID()}`;
  const mrById = new Map(mrs.map((mr) => [mr.id ?? "", mr]));

  const entries: fhir4.BundleEntry[] = [
    {
      fullUrl: hubReference,
      resource: buildHubProcedure(values, subject, `ServiceRequest/${order.id ?? ""}`),
      request: { method: "POST", url: "Procedure" },
    },
  ];

  // 実施せず のときは薬剤の記録を作らない(入れていない薬剤に投与記録があると嘘になる)。
  if (values.outcome === "not-done") return entries;

  for (const line of values.medicines.filter((l) => !l.skipped)) {
    entries.push({
      fullUrl: `urn:uuid:${crypto.randomUUID()}`,
      resource: buildAdministration(
        line,
        mrById.get(line.medicationRequestId),
        values,
        subject,
        hubReference,
      ),
      request: { method: "POST", url: "MedicationAdministration" },
    });
  }

  return entries;
}

/** その日に予定された施用の回数(RP の開始時刻の最大数。無ければ 1)。 */
export function scheduledPerformCount(mrs: fhir4.MedicationRequest[]): number {
  const counts = groupInjectionByRp(mrs).map((rp) => rp.times.length);
  return Math.max(1, ...counts);
}

/**
 * 実施登録の transaction Bundle。実施記録一式と、必要なら Task の実施済を 1 つに
 * まとめる(実施情報だけ保存されて進捗が止まる状態を作らない)。
 *
 * Task を実施済にするのは、この登録で「実施」または「途中で中止」の記録が予定回数に
 * 達したとき。「実施せず」は回数に数えない(その日の施用が済んだわけではない)。
 */
export function buildInjectionPerformBundle(
  values: InjectionPerformFormValues,
  order: fhir4.ServiceRequest,
  mrs: fhir4.MedicationRequest[],
  task: fhir4.Task | undefined,
  /** 既にあるこのオーダーの実施記録(実施せず を除いた件数)。 */
  donePerformCount: number,
): fhir4.Bundle {
  const entries = performEntries(values, order, mrs);

  const counted = values.outcome !== "not-done";
  const reached = counted && donePerformCount + 1 >= scheduledPerformCount(mrs);
  if (reached && task?.status !== "completed") {
    entries.push({
      resource: buildInjectionTaskUpdate(task, order, "completed"),
      request: task?.id
        ? { method: "PUT", url: `Task/${task.id}` }
        : { method: "POST", url: "Task" },
    });
  }

  return { resourceType: "Bundle", type: "transaction", entry: entries };
}

// ---- カルテ・一覧への表示 ----

export interface InjectionPerformDisplay {
  /** ハブの Procedure id。表示のキー。 */
  id: string;
  /** 施用の時間帯 "2026-08-31 10:00〜11:30"。終了が無ければ開始だけ。 */
  performedAt: string;
  performerName: string;
  /** 施用した薬剤。「生理食塩液 1袋」の形。 */
  medicines: string[];
  /** 実施の結果。完了は空、途中で中止・実施せず はその表示。 */
  statusNote: string;
  reason: string;
  comment: string;
  /** 実施取消で一緒に消す薬剤の記録。 */
  administrationIds: string[];
  /** 進捗の判定に使う。実施せず は施用の回数に数えない。 */
  counted: boolean;
}

/** 注射の実施記録か。処置・手術・輸血の Procedure と振り分ける。 */
export function isInjectionProcedure(procedure: fhir4.Procedure): boolean {
  return Boolean(
    procedure.category?.coding?.some(
      (c) => c.system === ORDER_TYPE_SYSTEM && c.code === INJECTION_ORDER_TYPE.code,
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
  return start.slice(0, 10) === end.slice(0, 10)
    ? `${start}〜${end.slice(11)}`
    : `${start}〜${end}`;
}

function medicineLabel(administration: fhir4.MedicationAdministration): string {
  const dose = administration.dosage?.dose;
  const amount = dose?.value == null ? "" : `${dose.value}${dose.unit ?? ""}`;
  const name = conceptLabel(administration.medicationCodeableConcept);
  // request が無い = オーダーに無く実施時に足した薬剤。依頼と実施の差が読めるよう印を付ける。
  const added = administration.request ? "" : "(追加)";
  return [name, amount, added].filter(Boolean).join(" ");
}

/**
 * 実施記録をオーダー id ごとの表示内容にまとめる。1 日に複数回の施用があるので
 * 1 オーダーに複数のハブが付き、施用時刻の順に並べる。
 */
export function injectionPerformsByOrderId(
  procedures: fhir4.Procedure[],
  administrations: fhir4.MedicationAdministration[],
): Map<string, InjectionPerformDisplay[]> {
  const hubs = procedures.filter(
    (procedure) => isInjectionProcedure(procedure) && procedure.status !== "entered-in-error",
  );

  const byOrderId = new Map<string, InjectionPerformDisplay[]>();
  for (const hub of hubs) {
    const hubId = hub.id ?? "";
    const children = administrations.filter((a) =>
      (a.partOf ?? []).some((r) => referenceId(r.reference, "Procedure") === hubId),
    );

    const display: InjectionPerformDisplay = {
      id: hubId,
      performedAt: periodLabel(hub.performedPeriod),
      performerName: hub.performer?.[0]?.actor?.display ?? "",
      medicines: children.map(medicineLabel).filter(Boolean),
      statusNote: hub.status === "completed" ? "" : outcomeDisplay(hub.status),
      reason: hub.statusReason?.text ?? "",
      comment: hub.note?.map((note) => note.text).filter(Boolean).join("\n") ?? "",
      administrationIds: children.map((a) => a.id).filter((id): id is string => Boolean(id)),
      counted: hub.status !== "not-done",
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

/**
 * 実施取消で消す実施記録の DELETE エントリ。
 *
 * 輸血と同じく記録ごと消す。注射の実施記録は「この薬をこの量入れた」という事実の
 * 記録そのもので、取り消したのに残っているとその記録が嘘になる(放射線検査などが
 * Task を戻すだけで記録を残すのとは違う)。子(薬剤)を先に消してから親を消す。
 */
export function buildInjectionPerformDeleteEntries(
  performs: InjectionPerformDisplay[],
): fhir4.BundleEntry[] {
  return performs.flatMap((perform) => [
    ...perform.administrationIds.map((id) => ({
      request: { method: "DELETE" as const, url: `MedicationAdministration/${id}` },
    })),
    { request: { method: "DELETE" as const, url: `Procedure/${perform.id}` } },
  ]);
}
