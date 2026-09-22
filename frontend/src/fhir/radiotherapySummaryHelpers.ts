import { today } from "../lib/dates";
import { ORDER_TYPE_SYSTEM } from "./prescriptionHelpers";
import {
  RADIOTHERAPY_ORDER_TYPE,
  formatDose,
  summarizeRadiotherapyOrder,
  type RadiotherapyCoded,
  type RadiotherapyOrderSummary,
} from "./radiotherapyOrderHelpers";
import {
  PROCEDURE_KIND_SYSTEM,
  radiotherapyProgress,
  type RadiotherapyFractionDisplay,
} from "./radiotherapyResultHelpers";

// 治療終了サマリー(docs/radiotherapy-order-design.md §6.2)。
//
// 1 コースに 1 件の Procedure。照射記録(1 回ごとの Procedure)と同じところにぶら下がるので、
// category の 2 つ目の coding で分ける。
//
//   ServiceRequest(治療処方)
//    └ basedOn ← Procedure (治療終了サマリー。1 コースに 1 件)
//         status  completed(完遂)| stopped(途中で終わった)
//         category order-type|radiotherapy ＋ radiotherapy-procedure|course-summary
//         performedPeriod = 初回照射日 〜 最終照射日
//         performer       = 記載した医師
//         outcome         = 完遂 / 中止(ローカルコード)
//         extension[radiotherapy-course-summary]
//           fractionsDelivered / fractionsPrescribed
//           doseDeliveredToVolume ×M { volume, dose(Gy), fractions }
//           terminationReason / terminationNote
//           progressNote(治療経過) / adverseEvents(急性有害事象) / followUpPlan(今後の方針)
//
// **照射記録から下書きを組み立てる**(期間・回数・標的ごとの実照射線量・完遂かどうかは
// 数えれば分かる)。医師が書くのは経過・有害事象・方針の 3 つだけ。退院時サマリーの
// 「下書きを集め直す」(dischargeSummaryHelpers.ts)と同じ考え方で、書いた本文は残したまま
// 集計値だけを取り直す。
//
// mCODE の Radiotherapy Course Summary に要素を合わせてある(§2.6 の対応表)。

const PROCEDURE_PROFILE = "http://jpfhir.jp/fhir/core/StructureDefinition/JP_Procedure";
export const COURSE_SUMMARY_KIND = { code: "course-summary", display: "治療終了サマリー" };

const SUMMARY_EXT_URL = "http://fhir-client.local/StructureDefinition/radiotherapy-course-summary";
const OUTCOME_SYSTEM = "http://fhir-client.local/CodeSystem/radiotherapy-course-outcome";
const STOP_REASON_SYSTEM = "http://fhir-client.local/CodeSystem/radiotherapy-stop-reason";
const UCUM_SYSTEM = "http://unitsofmeasure.org";
const DOSE_UNIT = "Gy";

/** 治療の結末。処方どおり照射しきったか、途中で終わったか。 */
export const COURSE_OUTCOME_OPTIONS = [
  { code: "completed", display: "完遂" },
  { code: "discontinued", display: "中止" },
];

export interface RadiotherapyCourseSummaryFormValues {
  /** 初回照射日・最終照射日。照射記録から入るが、直せる。 */
  startDate: string;
  endDate: string;
  outcome: string;
  /** 照射した回数と処方の回数。照射記録から数えたもの(表示のみ)。 */
  fractionsDelivered: number;
  fractionsPrescribed: number;
  /** volumeId → 実照射線量(Gy)と回数。照射記録から数えたもの(表示のみ)。 */
  doses: { volumeId: string; label: string; dose: number; fractions: number }[];
  terminationReason: RadiotherapyCoded;
  terminationNote: string;
  progressNote: string;
  adverseEvents: string;
  followUpPlan: string;
  practitionerId: string;
  practitionerName: string;
}

/**
 * 照射記録から下書きを組み立てる。既存のサマリーがあれば、**書いた本文はそのまま残し**
 * 集計値だけを取り直す(退院時サマリーと同じ。あとから照射記録を直しても本文が消えない)。
 */
export function draftRadiotherapyCourseSummary(
  order: fhir4.ServiceRequest,
  fractions: RadiotherapyFractionDisplay[],
  existing?: fhir4.Procedure,
): RadiotherapyCourseSummaryFormValues {
  const summary = summarizeRadiotherapyOrder(order);
  const progress = radiotherapyProgress(summary, fractions);
  const delivered = fractions.filter((fraction) => !fraction.notDone && !fraction.planned);
  const dates = delivered.map((fraction) => fraction.performedDate).filter(Boolean).sort();
  const saved = existing ? parseRadiotherapyCourseSummary(existing, summary) : undefined;

  // 標的ごとの回数は「その標的に線量を入れた回」の数(SIB でない Boost は標的ごとに回数が違う)。
  const doses = progress.volumes.map((volume) => ({
    volumeId: volume.volumeId,
    label: volume.label,
    dose: volume.deliveredDose,
    fractions: delivered.filter((fraction) => (fraction.doses[volume.volumeId] ?? 0) > 0).length,
  }));

  return {
    startDate: saved?.startDate || dates[0] || summary.startDate,
    endDate: saved?.endDate || dates[dates.length - 1] || summary.endedOn || today(),
    outcome: saved?.outcome || (progress.finished ? "completed" : "discontinued"),
    fractionsDelivered: progress.delivered,
    fractionsPrescribed: progress.prescribed,
    doses,
    // 中止理由は治療処方(中止の操作)に入っているので、書いていなければそちらを引き継ぐ。
    terminationReason: saved?.terminationReason?.code
      ? saved.terminationReason
      : { code: "", name: summary.terminationReason },
    terminationNote: saved?.terminationNote || summary.terminationNote,
    progressNote: saved?.progressNote ?? "",
    adverseEvents: saved?.adverseEvents ?? "",
    followUpPlan: saved?.followUpPlan ?? "",
    practitionerId: saved?.practitionerId ?? "",
    practitionerName: saved?.practitionerName ?? summary.practitionerName,
  };
}

export function validateRadiotherapyCourseSummary(
  values: RadiotherapyCourseSummaryFormValues,
): string {
  if (!values.startDate) return "初回照射日を入れてください。";
  if (!values.endDate) return "最終照射日を入れてください。";
  if (values.endDate < values.startDate) {
    return "最終照射日は初回照射日と同じか、それより後にしてください。";
  }
  if (!values.outcome) return "治療の結末を選んでください。";
  if (values.outcome === "discontinued" && !values.terminationReason.name.trim()) {
    return "中止の理由を入れてください。";
  }
  return "";
}

function doseQuantity(value: number): fhir4.Quantity {
  return { value, unit: DOSE_UNIT, system: UCUM_SYSTEM, code: DOSE_UNIT };
}

function buildCourseSummaryProcedure(
  values: RadiotherapyCourseSummaryFormValues,
  order: fhir4.ServiceRequest,
  existing?: fhir4.Procedure,
): fhir4.Procedure {
  const extension: fhir4.Extension[] = [
    { url: "fractionsDelivered", valueInteger: values.fractionsDelivered },
    { url: "fractionsPrescribed", valueInteger: values.fractionsPrescribed },
  ];
  for (const dose of values.doses) {
    if (!(dose.dose > 0)) continue;
    extension.push({
      url: "doseDeliveredToVolume",
      extension: [
        { url: "volume", valueString: dose.volumeId },
        { url: "dose", valueQuantity: doseQuantity(dose.dose) },
        { url: "fractions", valueInteger: dose.fractions },
      ],
    });
  }
  if (values.outcome === "discontinued") {
    if (values.terminationReason.code) {
      extension.push({
        url: "terminationReason",
        valueCoding: {
          system: STOP_REASON_SYSTEM,
          code: values.terminationReason.code,
          display: values.terminationReason.name,
        },
      });
    } else if (values.terminationReason.name.trim()) {
      extension.push({ url: "terminationReason", valueString: values.terminationReason.name.trim() });
    }
    if (values.terminationNote.trim()) {
      extension.push({ url: "terminationNote", valueString: values.terminationNote.trim() });
    }
  }
  for (const [url, text] of [
    ["progressNote", values.progressNote],
    ["adverseEvents", values.adverseEvents],
    ["followUpPlan", values.followUpPlan],
  ] as const) {
    if (text.trim()) extension.push({ url, valueString: text.trim() });
  }

  const procedure: fhir4.Procedure = {
    ...(existing ?? {}),
    resourceType: "Procedure",
    meta: { profile: [PROCEDURE_PROFILE] },
    // 途中で終わったコースは stopped。サマリーを書いたかどうかとは別で、治療の結末を表す。
    status: values.outcome === "discontinued" ? "stopped" : "completed",
    category: {
      coding: [
        { system: ORDER_TYPE_SYSTEM, ...RADIOTHERAPY_ORDER_TYPE },
        { system: PROCEDURE_KIND_SYSTEM, ...COURSE_SUMMARY_KIND },
      ],
      text: COURSE_SUMMARY_KIND.display,
    },
    code: { text: COURSE_SUMMARY_KIND.display },
    subject: order.subject ?? {},
    basedOn: [{ reference: `ServiceRequest/${order.id ?? ""}` }],
    performedPeriod: { start: values.startDate, end: values.endDate },
    outcome: {
      coding: [
        {
          system: OUTCOME_SYSTEM,
          code: values.outcome,
          display: COURSE_OUTCOME_OPTIONS.find((o) => o.code === values.outcome)?.display,
        },
      ],
    },
    extension: [{ url: SUMMARY_EXT_URL, extension }],
  };

  if (values.practitionerId) {
    procedure.performer = [
      {
        actor: {
          reference: `Practitioner/${values.practitionerId}`,
          display: values.practitionerName || undefined,
        },
      },
    ];
  } else {
    delete procedure.performer;
  }

  return procedure;
}

/** 保存。初回は POST、書き直しは同じ Procedure への PUT(1 コースに 1 件)。 */
export function buildRadiotherapyCourseSummaryBundle(
  values: RadiotherapyCourseSummaryFormValues,
  order: fhir4.ServiceRequest,
  existing?: fhir4.Procedure,
): fhir4.Bundle {
  const resource = buildCourseSummaryProcedure(values, order, existing);
  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: [
      existing?.id
        ? { resource, request: { method: "PUT", url: `Procedure/${existing.id}` } }
        : { resource, request: { method: "POST", url: "Procedure" } },
    ],
  };
}

// ---- 表示 ----

export interface RadiotherapyCourseSummaryDisplay {
  id: string;
  startDate: string;
  endDate: string;
  /** 「2026-08-10 〜 2026-09-21」。 */
  periodLabel: string;
  outcome: string;
  outcomeDisplay: string;
  fractionsDelivered: number;
  fractionsPrescribed: number;
  /** 「28 / 28 回」。 */
  fractionLabel: string;
  doses: { volumeId: string; label: string; dose: number; fractions: number; doseLabel: string }[];
  terminationReason: RadiotherapyCoded;
  terminationNote: string;
  progressNote: string;
  adverseEvents: string;
  followUpPlan: string;
  practitionerId: string;
  practitionerName: string;
}

export function isRadiotherapyCourseSummary(procedure: fhir4.Procedure): boolean {
  return Boolean(
    procedure.category?.coding?.some(
      (c) => c.system === PROCEDURE_KIND_SYSTEM && c.code === COURSE_SUMMARY_KIND.code,
    ),
  );
}

export function parseRadiotherapyCourseSummary(
  procedure: fhir4.Procedure,
  summary: RadiotherapyOrderSummary,
): RadiotherapyCourseSummaryDisplay {
  const ext = procedure.extension?.find((e) => e.url === SUMMARY_EXT_URL);
  const sub = (url: string) => ext?.extension?.find((e) => e.url === url);
  const labelOf = new Map(summary.volumes.map((volume) => [volume.volumeId, volume.label]));

  const doses = (ext?.extension ?? [])
    .filter((e) => e.url === "doseDeliveredToVolume")
    .map((e) => {
      const volumeId = e.extension?.find((x) => x.url === "volume")?.valueString ?? "";
      const dose = e.extension?.find((x) => x.url === "dose")?.valueQuantity?.value ?? 0;
      const fractions = e.extension?.find((x) => x.url === "fractions")?.valueInteger ?? 0;
      return {
        volumeId,
        label: labelOf.get(volumeId) ?? volumeId,
        dose,
        fractions,
        doseLabel: `${formatDose(dose)} ${DOSE_UNIT} / ${fractions} 回`,
      };
    });

  const outcome = procedure.outcome?.coding?.find((c) => c.system === OUTCOME_SYSTEM)?.code ?? "";
  const reason = sub("terminationReason");
  const startDate = procedure.performedPeriod?.start?.slice(0, 10) ?? "";
  const endDate = procedure.performedPeriod?.end?.slice(0, 10) ?? "";
  const delivered = sub("fractionsDelivered")?.valueInteger ?? 0;
  const prescribed = sub("fractionsPrescribed")?.valueInteger ?? 0;
  const performer = procedure.performer?.[0]?.actor;

  return {
    id: procedure.id ?? "",
    startDate,
    endDate,
    periodLabel: [startDate, endDate].filter(Boolean).join(" 〜 "),
    outcome,
    outcomeDisplay:
      procedure.outcome?.coding?.[0]?.display ??
      COURSE_OUTCOME_OPTIONS.find((o) => o.code === outcome)?.display ??
      "",
    fractionsDelivered: delivered,
    fractionsPrescribed: prescribed,
    fractionLabel: `${delivered} / ${prescribed} 回`,
    doses,
    terminationReason: {
      code: reason?.valueCoding?.code ?? "",
      name: reason?.valueCoding?.display ?? reason?.valueString ?? "",
    },
    terminationNote: sub("terminationNote")?.valueString ?? "",
    progressNote: sub("progressNote")?.valueString ?? "",
    adverseEvents: sub("adverseEvents")?.valueString ?? "",
    followUpPlan: sub("followUpPlan")?.valueString ?? "",
    practitionerId: performer?.reference?.split("/").pop() ?? "",
    practitionerName: performer?.display ?? "",
  };
}

/** オーダーの id → その治療終了サマリー(1 件)。 */
export function radiotherapyCourseSummariesByOrderId(
  procedures: fhir4.Procedure[],
): Map<string, fhir4.Procedure> {
  const byOrderId = new Map<string, fhir4.Procedure>();
  for (const procedure of procedures) {
    if (!isRadiotherapyCourseSummary(procedure) || procedure.status === "entered-in-error") continue;
    const orderId = procedure.basedOn?.[0]?.reference?.match(/^ServiceRequest\/(.+)$/)?.[1];
    if (orderId) byOrderId.set(orderId, procedure);
  }
  return byOrderId;
}
