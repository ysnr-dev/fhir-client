import { KARTE_KIND_LABELS, orderKindOf } from "./karteTimeline";
import { orderPerformedOn, orderProgressByOrderId, type OrderProgress } from "./orderProgressHelpers";
import { SETTING_SYSTEM } from "./prescriptionHelpers";
import { categoryCoding, referenceId } from "./shared";

// 外来患者一覧の「当日オーダー」列。その日の外来オーダーを種別ごとにまとめ、
// 種別 1 つを 1 文字の印(「検」「放」など)にする。段階は印の色と塗りで表す。
// React に依存しない。
//
// 進み具合はカルテのカードと同じ判定(orderProgressByOrderId)に、検査結果
// (オーダーを basedOn で指す DiagnosticReport)の報告を重ねる。同じ種別に複数の
// オーダーがあるときは、いちばん進んでいないものを印に出す(残っている作業が
// 分かるように)。一件ずつの内訳は印の title で読む。

/** 進み具合の段階。並びがそのまま進み具合の順。 */
export type OutpatientOrderStage = "requested" | "accepted" | "done" | "partial" | "result";

const STAGE_ORDER: OutpatientOrderStage[] = ["requested", "accepted", "done", "partial", "result"];

export const OUTPATIENT_ORDER_STAGE_LABELS: Record<OutpatientOrderStage, string> = {
  requested: "依頼",
  accepted: "受付",
  done: "実施",
  partial: "中間",
  result: "結果",
};

/**
 * 印に出す種別と、その 1 文字。並びが列の中での並び。入院だけの種別は持たない。
 * 文字は種別どうしで重ならないようにする(放射線検査=放、放射線治療=照)。
 */
const KIND_MARKS = {
  prescription: "薬",
  injection: "注",
  "lab-order": "検",
  "micro-order": "菌",
  "patho-order": "病",
  "rad-order": "放",
  "physio-order": "生",
  "endoscopy-order": "内",
  "treatment-order": "処",
  "surgery-order": "手",
  "transfusion-order": "血",
  "rehab-order": "リ",
  "radiotherapy-order": "照",
  "nutrition-guidance-order": "栄",
  "medication-guidance-order": "服",
  "consult-order": "他",
} as const;

type OutpatientOrderKind = keyof typeof KIND_MARKS;

const KIND_ORDER = Object.keys(KIND_MARKS) as OutpatientOrderKind[];

/** 中止・取消として印に数えない進捗の状態。 */
const CANCELLED_STATUSES = new Set(["cancelled", "revoked", "entered-in-error", "rejected", "failed"]);
/** まだ部門が受けていない状態。 */
const REQUESTED_STATUSES = new Set(["requested", "active", "draft", "on-hold"]);
/** 報告済みの検査結果。 */
const FINAL_REPORT_STATUSES = new Set(["final", "amended", "corrected", "appended"]);
/** 報告途中の検査結果(中間報告)。 */
const PARTIAL_REPORT_STATUSES = new Set(["registered", "partial", "preliminary"]);

/** 1 種別ぶんの印。 */
export interface OutpatientOrderSummary {
  kind: OutpatientOrderKind;
  /** 印の 1 文字。 */
  mark: string;
  /** 種別の正式名(「検体検査」など)。 */
  kindLabel: string;
  /** 種別の中でいちばん進んでいない段階。 */
  stage: OutpatientOrderStage;
  /** 一件ずつの内訳(印の title に並べる)。 */
  details: string[];
}

function isOutpatientKind(kind: string | null): kind is OutpatientOrderKind {
  return kind !== null && kind in KIND_MARKS;
}

/** オーダー id → そのオーダーの検査結果の段階(結果が無ければ持たない)。 */
function reportStageByOrderId(reports: fhir4.DiagnosticReport[]): Map<string, OutpatientOrderStage> {
  const map = new Map<string, OutpatientOrderStage>();
  for (const report of reports) {
    const stage: OutpatientOrderStage | undefined = FINAL_REPORT_STATUSES.has(report.status)
      ? "result"
      : PARTIAL_REPORT_STATUSES.has(report.status)
        ? "partial"
        : undefined;
    if (!stage) continue;
    for (const ref of report.basedOn ?? []) {
      const orderId = referenceId(ref.reference);
      if (!orderId) continue;
      const current = map.get(orderId);
      if (!current || STAGE_ORDER.indexOf(stage) > STAGE_ORDER.indexOf(current)) map.set(orderId, stage);
    }
  }
  return map;
}

function orderStage(
  progress: OrderProgress,
  reportStage: OutpatientOrderStage | undefined,
  date: string,
): OutpatientOrderStage {
  if (reportStage) return reportStage;
  if (orderPerformedOn(progress, date)) return "done";
  return REQUESTED_STATUSES.has(progress.status) ? "requested" : "accepted";
}

/**
 * 患者 id → 種別ごとの印。orders はその日のオーダーのヘッダ、tasks・reports・performs は
 * それに添えて引いた進捗・検査結果・実施記録。入院のオーダーと中止したオーダーは数えない。
 */
export function outpatientOrderSummaries(
  orders: fhir4.ServiceRequest[],
  tasks: fhir4.Task[],
  reports: fhir4.DiagnosticReport[],
  performs: fhir4.Procedure[],
  date: string,
): Map<string, OutpatientOrderSummary[]> {
  const targets = orders.filter((order) => {
    const setting = categoryCoding(order, SETTING_SYSTEM)?.code;
    return (!setting || setting === "outpatient") && isOutpatientKind(orderKindOf(order));
  });
  const progressById = orderProgressByOrderId(targets, tasks, performs);
  const reportStages = reportStageByOrderId(reports);

  const byPatient = new Map<string, Map<OutpatientOrderKind, OutpatientOrderSummary>>();
  for (const order of targets) {
    const kind = orderKindOf(order);
    const patientId = referenceId(order.subject?.reference);
    const progress = order.id ? progressById.get(order.id) : undefined;
    if (!isOutpatientKind(kind) || !patientId || !progress) continue;
    if (CANCELLED_STATUSES.has(progress.status)) continue;

    const reportStage = reportStages.get(order.id ?? "");
    const stage = orderStage(progress, reportStage, date);
    const name = order.code?.text ?? order.code?.coding?.[0]?.display ?? KARTE_KIND_LABELS[kind];
    const detail = `${name}: ${reportStage ? OUTPATIENT_ORDER_STAGE_LABELS[reportStage] + "あり" : progress.label}`;

    const kinds = byPatient.get(patientId) ?? new Map<OutpatientOrderKind, OutpatientOrderSummary>();
    byPatient.set(patientId, kinds);
    const existing = kinds.get(kind);
    if (existing) {
      existing.details.push(detail);
      if (STAGE_ORDER.indexOf(stage) < STAGE_ORDER.indexOf(existing.stage)) existing.stage = stage;
    } else {
      kinds.set(kind, {
        kind,
        mark: KIND_MARKS[kind],
        kindLabel: KARTE_KIND_LABELS[kind],
        stage,
        details: [detail],
      });
    }
  }

  const result = new Map<string, OutpatientOrderSummary[]>();
  for (const [patientId, kinds] of byPatient) {
    result.set(
      patientId,
      [...kinds.values()].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)),
    );
  }
  return result;
}
