import { clinicalNoteProblem, referencedResponseIds } from "./clinicalNoteHelpers";
import type { ProblemRef } from "./conditionHelpers";
import { isInjectionServiceRequest } from "./injectionHelpers";
import {
  isLabServiceRequest,
  isOrderItemRequest,
  labOrderItemRequests,
  labOrderProblem,
} from "./labOrderHelpers";
import { labTaskStatus, labTasksByOrderId, type LabTaskStatus } from "./labTaskHelpers";
import { isMicroServiceRequest, microOrderItemRequests, microOrderProblem } from "./microOrderHelpers";
import {
  isPathoServiceRequest,
  pathoOrderItemRequests,
  pathoOrderProblem,
  pathoOrderResponseIds,
} from "./pathoOrderHelpers";
import { pathoTaskStatus, pathoTasksByOrderId, type PathoTaskStatus } from "./pathoTaskHelpers";
import { ORDER_TYPE_SYSTEM, prescriptionProblem } from "./prescriptionHelpers";
import { categoryCoding } from "./shared";
import {
  isRadServiceRequest,
  radOrderItemRequests,
  radOrderProblem,
  radOrderResponseIds,
} from "./radOrderHelpers";
import { radPerformsByOrderId, type RadPerformDisplay } from "./radResultHelpers";
import { radTaskStatus, radTasksByOrderId, type RadTaskStatus } from "./radTaskHelpers";
import {
  isPhysioServiceRequest,
  physioOrderItemRequests,
  physioOrderProblem,
  physioOrderResponseIds,
} from "./physioOrderHelpers";
import { physioPerformsByOrderId, type PhysioPerformDisplay } from "./physioResultHelpers";
import {
  physioTaskStatus,
  physioTasksByOrderId,
  type PhysioTaskStatus,
} from "./physioTaskHelpers";
import {
  isTreatmentServiceRequest,
  treatmentOrderItemRequests,
  treatmentOrderProblem,
} from "./treatmentOrderHelpers";
import { treatmentPerformsByOrderId, type TreatmentPerformDisplay } from "./treatmentResultHelpers";
import { isMealServiceRequest, mealOrderProblem } from "./mealOrderHelpers";
import { isNursingServiceRequest } from "./nursingOrderHelpers";
import {
  isTransfusionServiceRequest,
  transfusionOrderItemRequests,
  transfusionOrderProblem,
} from "./transfusionOrderHelpers";
import {
  transfusionTaskStatus,
  transfusionTasksByOrderId,
  type TransfusionTaskStatus,
} from "./transfusionTaskHelpers";
import {
  transfusionPerformsByOrderId,
  type TransfusionPerformDisplay,
} from "./transfusionResultHelpers";
import { isRehabServiceRequest, rehabOrderProblem } from "./rehabOrderHelpers";
import { rehabTaskStatus, rehabTasksByOrderId, type RehabTaskStatus } from "./rehabTaskHelpers";
import { rehabPerformsByOrderId, type RehabPerformDisplay } from "./rehabResultHelpers";
import {
  treatmentTaskStatus,
  treatmentTasksByOrderId,
  type TreatmentTaskStatus,
} from "./treatmentTaskHelpers";
import {
  SURGERY_ORDER_TYPE,
  isSurgeryServiceRequest,
  surgeryOrderItemRequests,
  surgeryOrderProblem,
  surgeryOrderResponseIds,
} from "./surgeryOrderHelpers";
import {
  surgeryTaskStatus,
  surgeryTasksByOrderId,
  type SurgeryTaskStatus,
} from "./surgeryTaskHelpers";
import { surgeryPerformsByOrderId, type SurgeryPerformDisplay } from "./surgeryResultHelpers";
import {
  isEndoscopyServiceRequest,
  endoscopyOrderItemRequests,
  endoscopyOrderProblem,
  endoscopyOrderResponseIds,
} from "./endoscopyOrderHelpers";
import { endoscopyPerformsByOrderId, type EndoscopyPerformDisplay } from "./endoscopyResultHelpers";
import {
  endoscopyTaskStatus,
  endoscopyTasksByOrderId,
  type EndoscopyTaskStatus,
} from "./endoscopyTaskHelpers";
import {
  questionnaireCanonical,
  questionnaireResponseProblem,
} from "./questionnaireResponseHelpers";
import { groupVitalEntries, vitalEntryProblem, type VitalEntry } from "./vitalHelpers";

// カルテ画面のタイムライン(診療日ごとの時系列表示)を組み立てる純粋ロジック。
//
// 診療記録(Composition) / 処方・注射(ServiceRequest + MedicationRequest) / 単独登録の
// テンプレート回答(QuestionnaireResponse) / バイタル(Observation)を 1 本の時系列に
// まとめる。検索は別々に
// ページングされるため、「どこまで表示してよいか」の判断が要になる
// (buildKarteTimeline の安全カットオフを参照)。
//
// 処方・注射・検体検査は同じ ServiceRequest 検索(1 本のページング)で取得し、
// category のオーダー種別でカードの種別に振り分ける。

export type KarteItemKind =
  | "note"
  | "vital"
  | "prescription"
  | "injection"
  | "lab-order"
  | "micro-order"
  | "patho-order"
  | "rad-order"
  | "physio-order"
  | "endoscopy-order"
  | "treatment-order"
  | "surgery-order"
  | "meal-order"
  | "transfusion-order"
  | "rehab-order"
  | "qr";

export const KARTE_KIND_LABELS: Record<KarteItemKind, string> = {
  note: "診療記録",
  vital: "バイタル",
  prescription: "処方",
  injection: "注射",
  "lab-order": "検体検査",
  "micro-order": "細菌検査",
  "patho-order": "病理検査",
  "rad-order": "放射線検査",
  "physio-order": "生理検査",
  "endoscopy-order": "内視鏡",
  "treatment-order": "処置",
  "surgery-order": "手術",
  "meal-order": "食事",
  "transfusion-order": "輸血",
  "rehab-order": "リハビリ",
  qr: "テンプレート",
};

interface KarteItemBase {
  id: string;
  /** 診療日 "YYYY-MM-DD"。日付を持たないリソースは空文字。 */
  day: string;
  /** 同一診療日内の並び替えに使う元の日時文字列。 */
  dateTime: string;
  /** 診療日パネルに出す見出し。 */
  label: string;
}

export type KarteTimelineItem = KarteItemBase &
  (
    | { kind: "note"; note: fhir4.Composition }
    // 1 回の測定は項目ごとの Observation に分かれるので、束ねたものを 1 枚のカードにする。
    | { kind: "vital"; entry: VitalEntry }
    | {
        kind: "prescription";
        serviceRequest: fhir4.ServiceRequest;
        medicationRequests: fhir4.MedicationRequest[];
      }
    | {
        kind: "injection";
        serviceRequest: fhir4.ServiceRequest;
        medicationRequests: fhir4.MedicationRequest[];
      }
    // 検体検査の明細(検査項目・パネルの構成項目)も ServiceRequest なので、
    // オーダーのヘッダにぶら下がるぶんを itemRequests に集めて渡す。
    | {
        kind: "lab-order";
        serviceRequest: fhir4.ServiceRequest;
        itemRequests: fhir4.ServiceRequest[];
        /** このオーダーを元に登録された検査結果の id。空なら結果はまだ無い。 */
        reportId: string;
        /** 部門の進捗。Task がまだ無いオーダー(部門が触っていない)は依頼済。 */
        status: LabTaskStatus;
      }
    // 細菌検査も明細(検体グループ・検査項目)が ServiceRequest なので同じ形。
    | {
        kind: "micro-order";
        serviceRequest: fhir4.ServiceRequest;
        itemRequests: fhir4.ServiceRequest[];
        /** このオーダーを元に登録された細菌検査結果の id。空なら結果はまだ無い。 */
        reportId: string;
        /** 結果の報告区分。"preliminary" なら中間報告のバッジを出す。 */
        reportStatus: string;
      }
    // 病理検査は明細が検体で、進捗(Task)と病理レポートの両方を持つ。
    | {
        kind: "patho-order";
        serviceRequest: fhir4.ServiceRequest;
        /** 検体明細。多部位の生検があるので複数になる。 */
        itemRequests: fhir4.ServiceRequest[];
        /** このオーダーを元に登録された病理レポートの id。空ならレポートはまだ無い。 */
        reportId: string;
        /** レポートの報告区分。"preliminary" なら中間、"amended" なら修正のバッジを出す。 */
        reportStatus: string;
        /** 部門の進捗。Task がまだ無いオーダー(部門が触っていない)は依頼済。 */
        status: PathoTaskStatus;
      }
    // 放射線検査も明細(撮影項目・セットの構成項目)が ServiceRequest なので、
    // オーダーのヘッダにぶら下がるぶんを itemRequests に集めて渡す。
    // 検査結果(ImagingStudy)との紐付けは未実装なので reportId は持たない。
    | {
        kind: "rad-order";
        serviceRequest: fhir4.ServiceRequest;
        itemRequests: fhir4.ServiceRequest[];
        /** 部門の進捗。Task がまだ無いオーダー(部門が触っていない)は依頼済。 */
        status: RadTaskStatus;
        /** 実施記録。未実施なら空。取消 → 再実施で複数残ることがある。 */
        performs: RadPerformDisplay[];
      }
    // 生理検査も明細(検査項目・セットの構成項目)が ServiceRequest なので、
    // オーダーのヘッダにぶら下がるぶんを itemRequests に集めて渡す。
    // 放射線と違い被曝線量は持たない。
    | {
        kind: "physio-order";
        serviceRequest: fhir4.ServiceRequest;
        itemRequests: fhir4.ServiceRequest[];
        /** 部門の進捗。Task がまだ無いオーダー(部門が触っていない)は依頼済。 */
        status: PhysioTaskStatus;
        /** 実施記録。未実施なら空。取消 → 再実施で複数残ることがある。 */
        performs: PhysioPerformDisplay[];
      }
    // 内視鏡も生理検査と同型。
    | {
        kind: "endoscopy-order";
        serviceRequest: fhir4.ServiceRequest;
        itemRequests: fhir4.ServiceRequest[];
        /** 部門の進捗。Task がまだ無いオーダー(部門が触っていない)は依頼済。 */
        status: EndoscopyTaskStatus;
        /** 実施記録。未実施なら空。取消 → 再実施で複数残ることがある。 */
        performs: EndoscopyPerformDisplay[];
      }
    // 処置も同型。違うのは明細が検査目的・特別指示(テンプレート回答)を持たないこと。
    | {
        kind: "treatment-order";
        serviceRequest: fhir4.ServiceRequest;
        itemRequests: fhir4.ServiceRequest[];
        /** 部門の進捗。Task がまだ無いオーダー(部門が触っていない)は依頼済。 */
        status: TreatmentTaskStatus;
        /** 実施記録。未実施なら空。取消 → 再実施で複数残ることがある。 */
        performs: TreatmentPerformDisplay[];
      }
    // 手術(申込)。他部門と同じく実施記録を持つが、進捗に入室中が挟まる。
    | {
        kind: "surgery-order";
        serviceRequest: fhir4.ServiceRequest;
        itemRequests: fhir4.ServiceRequest[];
        /** 手術部の進捗。Task がまだ無いオーダーは申込済。 */
        status: SurgeryTaskStatus;
        /** 実施記録。未実施なら空。 */
        performs: SurgeryPerformDisplay[];
      }
    // 食事(給食)。他のオーダーと違い明細も進捗 Task も実施記録も持たないので、
    // カードに出すものは ServiceRequest 1 本の中で完結する。
    | { kind: "meal-order"; serviceRequest: fhir4.ServiceRequest }
    // 輸血。病理と同じくヘッダ + 製剤明細の 2 層で、手術と同じく実施記録を持つ。
    | {
        kind: "transfusion-order";
        serviceRequest: fhir4.ServiceRequest;
        /** 製剤明細。1 オーダーに複数の製剤を混ぜられる。 */
        itemRequests: fhir4.ServiceRequest[];
        /** 輸血部門の進捗。Task がまだ無いオーダー(部門が触っていない)は依頼済。 */
        status: TransfusionTaskStatus;
        /**
         * 進捗の Task そのもの。他の種別は status しか持たないが、輸血は
         * 投与するのが病棟なのでカルテのカードからも実施入力を開く
         * (docs/transfusion-order-design.md §5.1)。実施登録は Task を実施済へ
         * 更新する transaction なので、実物が要る(無いまま POST すると
         * 既にある Task と二重になる)。
         */
        task: fhir4.Task | undefined;
        /** 実施記録。未実施なら空。 */
        performs: TransfusionPerformDisplay[];
      }
    // リハビリ。食事と同じ期間継続型で明細は持たないが、進捗 Task と実施記録は持つ。
    // 1 オーダーに実施が何十件も積み上がるので、カードは先頭数件と件数だけを出す。
    | {
        kind: "rehab-order";
        serviceRequest: fhir4.ServiceRequest;
        /** リハ部門の受け入れ状態。Task がまだ無いオーダーは依頼済。 */
        status: RehabTaskStatus;
        /** 実施記録(新しい順)。 */
        performs: RehabPerformDisplay[];
      }
    | { kind: "qr"; response: fhir4.QuestionnaireResponse; questionnaire?: fhir4.Questionnaire }
  );

export interface KarteDayGroup {
  day: string;
  items: KarteTimelineItem[];
}

export interface KarteTimelineInput {
  noteBundles: fhir4.Bundle[];
  prescriptionBundles: fhir4.Bundle[];
  /**
   * 先読みしたオーダー(日付未定 / 実施予定日が未来)。オーダーのページングは
   * authoredOn の降順なので、日付未定のものや予定日が先のものは初期表示に出てこない。
   * 件数で切らずに全件読めるよう、状態で切った別クエリの結果をここで受ける
   * (未定は未処理の仕事なので溜まらず、未来の予定も有限)。
   * ページング側と同じオーダーが入りうるが、id で寄せるので二重には出ない。
   */
  pendingBundles: fhir4.Bundle[];
  responseBundles: fhir4.Bundle[];
  vitalBundles: fhir4.Bundle[];
  noteHasNext: boolean;
  prescriptionHasNext: boolean;
  responseHasNext: boolean;
  vitalHasNext: boolean;
}

export interface KarteTimelineResult {
  groups: KarteDayGroup[];
  /** まだ読み込んでいない、より古いデータが残っているか。 */
  hasMore: boolean;
  /**
   * 表示してよい範囲の境界。この日付より新しい日だけが groups に出ている
   * (undefined は全件読み込み済み)。診療日ペインが「どの日まで読み込み済みか」の
   * 判定に使う。
   */
  cutoff: string | undefined;
  /**
   * 次ページを読むべきソース。表示範囲(カットオフ)を押し下げているものだけを
   * 対象にして、片方に大量データがある患者で無駄な取得をしないようにする。
   */
  pending: { note: boolean; prescription: boolean; qr: boolean; vital: boolean };
}

/** 未ロードのソースがあるうちは何も表示できないことを表す番兵(どの日付文字列よりも大きい)。 */
const CUTOFF_BLOCK_ALL = "￿";

/** カルテ内で一意なアイテムキー。スクロール先の特定に使う。 */
export function karteItemKey(item: Pick<KarteTimelineItem, "kind" | "id">): string {
  return `${item.kind}:${item.id}`;
}

function dedupeById<T extends fhir4.Resource>(resources: T[]): T[] {
  const byId = new Map<string, T>();
  for (const resource of resources) {
    // オフセットページングは保存と競合すると同じリソースが複数ページに現れうる。
    if (resource.id) byId.set(resource.id, resource);
  }
  return Array.from(byId.values());
}

function resourcesOf(bundles: fhir4.Bundle[]): fhir4.Resource[] {
  return bundles.flatMap((bundle) =>
    (bundle.entry ?? []).map((entry) => entry.resource).filter((r): r is fhir4.Resource => Boolean(r)),
  );
}

function pickByType<T extends fhir4.Resource>(
  resources: fhir4.Resource[],
  resourceType: T["resourceType"],
): T[] {
  return dedupeById(resources.filter((r): r is T => r.resourceType === resourceType));
}

function dayOf(dateTime: string | undefined): string {
  return dateTime?.slice(0, 10) ?? "";
}

// ---- 日付未定 ----
//
// 「実施予定日がまだ決まっていない」オーダーを置く仮想の診療日。時系列の最上部に出す。
//
// 既にある「日付なし」(day = "")とは別物。あちらは日付を持たないリソース(データ不備)を
// 最下部に集めるもので、こちらは予定が未定という正常な状態を指す。混ぜると
// 「入れ忘れ」と「これから決める」が同じ見た目になってしまう。
export const KARTE_UNSCHEDULED_DAY = "unscheduled";

/**
 * 日付未定を許すオーダー種別(CodeSystem/order-type のコード)。
 *
 * ここに無い種別は occurrence が無ければ authoredOn の日に出す。細菌検査のように
 * occurrence をそもそも書いていない種別や、実施予定日の概念が無い処方・注射が
 * 「日付未定」に落ちてしまわないようにするための明示リスト。
 * 他の種別で未定を許したくなったら、フォームの必須検証を外してここに足す。
 */
const UNSCHEDULABLE_ORDER_TYPES = new Set<string>([SURGERY_ORDER_TYPE.code]);

/** 診療日の降順比較。日付未定は常に先頭。localeCompare の照合順に依存させない。 */
export function compareKarteDaysDesc(a: string, b: string): number {
  if (a === b) return 0;
  if (a === KARTE_UNSCHEDULED_DAY) return -1;
  if (b === KARTE_UNSCHEDULED_DAY) return 1;
  return b.localeCompare(a);
}

/** 診療日の表示名。タイムラインの見出しと診療日ペインで共用する。 */
export function karteDayLabel(day: string): string {
  if (day === KARTE_UNSCHEDULED_DAY) return "日付未定";
  return day || "日付なし";
}

/**
 * オーダーのカードを置く診療日。
 *
 * 実施予定日(occurrence)があればその日。無ければ、未定を許す種別なら「日付未定」、
 * それ以外は従来どおりオーダー日(authoredOn)。
 *
 * 放射線・生理・内視鏡・処置・検体検査は occurrence に実施日と同じ値を入れているので、
 * この規則にしてもカードは動かない。手術だけが申込日から予定手術日へ移る。
 */
function orderCardDay(sr: fhir4.ServiceRequest): string {
  if (sr.occurrenceDateTime) return dayOf(sr.occurrenceDateTime);
  const orderType = categoryCoding(sr, ORDER_TYPE_SYSTEM)?.code ?? "";
  if (UNSCHEDULABLE_ORDER_TYPES.has(orderType)) return KARTE_UNSCHEDULED_DAY;
  return dayOf(sr.authoredOn);
}

// ロード済みの中で最も古い診療日。まだ 1 件も無ければ undefined。
function oldestDayOfDates(days: string[]): string | undefined {
  let oldest: string | undefined;
  for (const day of days) {
    if (oldest === undefined || day < oldest) oldest = day;
  }
  return oldest;
}

function oldestDay(items: KarteTimelineItem[]): string | undefined {
  return oldestDayOfDates(items.map((item) => item.day));
}

// 「この日付より新しいグループだけなら、以降のページを読んでも増減しない」という
// 境界を求める。まだ次ページがあるソースそれぞれについて、ロード済みの最古日より
// 古い側は歯抜けになりうる。最も新しい所で止める必要があるので max を取り、
// 同日にさらに項目が来る可能性があるためカットオフ当日も表示しない。
function safeCutoff(
  sources: { hasNext: boolean; oldest: string | undefined }[],
): string | undefined {
  let cutoff: string | undefined;
  for (const source of sources) {
    if (!source.hasNext) continue;
    const oldest = source.oldest ?? CUTOFF_BLOCK_ALL;
    if (cutoff === undefined || oldest > cutoff) cutoff = oldest;
  }
  return cutoff;
}

export function buildKarteTimeline(input: KarteTimelineInput): KarteTimelineResult {
  const noteResources = resourcesOf(input.noteBundles);
  // 先読み分を後ろに足す。pickByType の dedupeById は後勝ちなので、同じオーダーが
  // 両方に入っていても先読み側(新しく読んだ方)が残る。
  const prescriptionResources = [
    ...resourcesOf(input.prescriptionBundles),
    ...resourcesOf(input.pendingBundles),
  ];
  const responseResources = resourcesOf(input.responseBundles);
  const vitalResources = resourcesOf(input.vitalBundles);

  const compositions = pickByType<fhir4.Composition>(noteResources, "Composition");
  const serviceRequests = pickByType<fhir4.ServiceRequest>(prescriptionResources, "ServiceRequest");
  const medicationRequests = pickByType<fhir4.MedicationRequest>(
    prescriptionResources,
    "MedicationRequest",
  );
  const responses = pickByType<fhir4.QuestionnaireResponse>(
    responseResources,
    "QuestionnaireResponse",
  );
  const questionnaires = pickByType<fhir4.Questionnaire>(responseResources, "Questionnaire");

  // 診療記録のセクション・放射線オーダーの検査目的/特別指示・手術オーダーの術前指示・
  // 病理オーダーの臨床経過から参照されている回答は、そのカードの本文として既に
  // 描画されるので単独カードにしない。
  const linkedResponseIds = new Set([
    ...compositions.flatMap((c) => referencedResponseIds(c)),
    ...radOrderResponseIds(serviceRequests),
    ...physioOrderResponseIds(serviceRequests),
    ...endoscopyOrderResponseIds(serviceRequests),
    ...surgeryOrderResponseIds(serviceRequests),
    ...pathoOrderResponseIds(serviceRequests),
  ]);

  // canonical("<url>|<version>")と url 単独の両方で引けるようにしておく
  // (QuestionnaireResponse.questionnaire はバージョン無しのこともある)。
  const questionnaireByCanonical = new Map<string, fhir4.Questionnaire>();
  for (const questionnaire of questionnaires) {
    questionnaireByCanonical.set(questionnaireCanonical(questionnaire), questionnaire);
    if (questionnaire.url && !questionnaireByCanonical.has(questionnaire.url)) {
      questionnaireByCanonical.set(questionnaire.url, questionnaire);
    }
  }

  // オーダー id → そのオーダーを元にした検査結果(検体検査・細菌検査)の id と status
  // (DiagnosticReport.basedOn。カードの「検査結果表示」を出せるかの判定と、
  // 細菌検査の中間報告バッジに使う)。
  const reportByOrderId = new Map<string, { id: string; status: string }>();
  for (const report of pickByType<fhir4.DiagnosticReport>(
    prescriptionResources,
    "DiagnosticReport",
  )) {
    for (const basedOn of report.basedOn ?? []) {
      const srId = basedOn.reference?.match(/^ServiceRequest\/(.+)$/)?.[1];
      if (srId && report.id) {
        reportByOrderId.set(srId, { id: report.id, status: report.status ?? "" });
      }
    }
  }

  // 検体検査・放射線検査オーダー id → 部門の進捗(Task)。カードのステータス表示に使う
  // (Task は部門ごとに code が違うだけで同じ検索結果に混ざって届く)。
  const tasks = pickByType<fhir4.Task>(prescriptionResources, "Task");
  const labTaskByOrderId = labTasksByOrderId(tasks);
  const pathoTaskByOrderId = pathoTasksByOrderId(tasks);
  // 放射線検査は実施記録(Procedure 一式)も「実施情報」の出力に使う。
  const radTaskByOrderId = radTasksByOrderId(tasks);
  const procedures = pickByType<fhir4.Procedure>(prescriptionResources, "Procedure");
  const administrations = pickByType<fhir4.MedicationAdministration>(
    prescriptionResources,
    "MedicationAdministration",
  );
  const radPerformByOrderId = radPerformsByOrderId(
    procedures,
    administrations,
    pickByType<fhir4.Observation>(prescriptionResources, "Observation"),
  );
  // 生理検査も同じ検索結果に Procedure が混ざって届く。振り分けは
  // physioPerformsByOrderId が category(order-type)で行うので、同じ配列を渡してよい。
  const physioTaskByOrderId = physioTasksByOrderId(tasks);
  const physioPerformByOrderId = physioPerformsByOrderId(procedures, administrations);
  const endoscopyTaskByOrderId = endoscopyTasksByOrderId(tasks);
  const endoscopyPerformByOrderId = endoscopyPerformsByOrderId(procedures, administrations);
  const transfusionTaskByOrderId = transfusionTasksByOrderId(tasks);
  // 輸血も副作用の Observation を持つので、手術と同じく Observation も渡す。
  // 振り分けは transfusionPerformsByOrderId が category(order-type)で行う。
  const transfusionPerformByOrderId = transfusionPerformsByOrderId(
    procedures,
    administrations,
    pickByType<fhir4.Observation>(prescriptionResources, "Observation"),
  );
  const treatmentTaskByOrderId = treatmentTasksByOrderId(tasks);
  const surgeryTaskByOrderId = surgeryTasksByOrderId(tasks);
  // 手術は出血量などの測定値も持つので、放射線と同じく Observation も渡す。
  const surgeryPerformByOrderId = surgeryPerformsByOrderId(
    procedures,
    administrations,
    pickByType<fhir4.Observation>(prescriptionResources, "Observation"),
  );
  const treatmentPerformByOrderId = treatmentPerformsByOrderId(procedures, administrations);
  // リハビリも同じ検索結果に Task と Procedure が混ざって届く。振り分けは
  // rehabPerformsByOrderId が category(order-type)で行うので同じ配列を渡してよい。
  const rehabTaskByOrderId = rehabTasksByOrderId(tasks);
  const rehabPerformByOrderId = rehabPerformsByOrderId(procedures);

  const medicationRequestsBySr = new Map<string, fhir4.MedicationRequest[]>();
  for (const mr of medicationRequests) {
    for (const basedOn of mr.basedOn ?? []) {
      const srId = basedOn.reference?.match(/^ServiceRequest\/(.+)$/)?.[1];
      if (!srId) continue;
      const list = medicationRequestsBySr.get(srId);
      if (list) list.push(mr);
      else medicationRequestsBySr.set(srId, [mr]);
    }
  }

  const noteItems: KarteTimelineItem[] = compositions.map((note) => ({
    kind: "note",
    id: note.id ?? "",
    day: dayOf(note.date),
    dateTime: note.date ?? "",
    label: note.title || KARTE_KIND_LABELS.note,
    note,
  }));

  // 検体検査・放射線検査の明細(検査項目・構成項目)は ServiceRequest だが単独の
  // カードにはしない。オーダーのヘッダに紐づけて、カードの中身として出す。
  // 看護指示はカルテのカードにせず指示簿タブで見せる。ここで外さないと下の
  // 振り分けの最後(どの種別にも当たらない SR は処方)に落ちて処方カードになる。
  const orderRequests = serviceRequests.filter(
    (sr) => !isOrderItemRequest(sr) && !isNursingServiceRequest(sr),
  );
  const itemRequests = serviceRequests.filter(isOrderItemRequest);

  // 処方・注射・検体検査・放射線検査は同じ検索結果に混ざって届くので、category の
  // オーダー種別で振り分ける(注射より前から存在する処方の ServiceRequest は
  // オーダー種別を持たない)。
  const prescriptionItems: KarteTimelineItem[] = orderRequests.map((serviceRequest) => {
    const base = {
      id: serviceRequest.id ?? "",
      day: orderCardDay(serviceRequest),
      // 同じ日の中での並び順。日をずらしても並びが変わらないよう authoredOn のまま。
      dateTime: serviceRequest.authoredOn ?? "",
      serviceRequest,
    };
    if (isLabServiceRequest(serviceRequest)) {
      return {
        ...base,
        kind: "lab-order" as const,
        label: KARTE_KIND_LABELS["lab-order"],
        itemRequests: labOrderItemRequests(itemRequests, serviceRequest.id ?? ""),
        reportId: reportByOrderId.get(serviceRequest.id ?? "")?.id ?? "",
        status: labTaskStatus(labTaskByOrderId.get(serviceRequest.id ?? "")),
      };
    }
    if (isMicroServiceRequest(serviceRequest)) {
      const report = reportByOrderId.get(serviceRequest.id ?? "");
      return {
        ...base,
        kind: "micro-order" as const,
        label: KARTE_KIND_LABELS["micro-order"],
        itemRequests: microOrderItemRequests(itemRequests, serviceRequest.id ?? ""),
        reportId: report?.id ?? "",
        reportStatus: report?.status ?? "",
      };
    }
    if (isPathoServiceRequest(serviceRequest)) {
      const report = reportByOrderId.get(serviceRequest.id ?? "");
      return {
        ...base,
        kind: "patho-order" as const,
        label: KARTE_KIND_LABELS["patho-order"],
        itemRequests: pathoOrderItemRequests(itemRequests, serviceRequest.id ?? ""),
        reportId: report?.id ?? "",
        reportStatus: report?.status ?? "",
        status: pathoTaskStatus(pathoTaskByOrderId.get(serviceRequest.id ?? "")),
      };
    }
    if (isRadServiceRequest(serviceRequest)) {
      const status = radTaskStatus(radTaskByOrderId.get(serviceRequest.id ?? ""));
      return {
        ...base,
        kind: "rad-order" as const,
        label: KARTE_KIND_LABELS["rad-order"],
        itemRequests: radOrderItemRequests(itemRequests, serviceRequest.id ?? ""),
        status,
        // 実施情報は実施済のときだけ出す。実施の取消は Task を受付済へ戻すだけで
        // 実施記録を消していない(docs/rad-result-design.md §7-6)ため、取り消した
        // 検査に実施情報が残って見えてしまう。カルテに出す「実施したこと」は
        // 進捗が実施済であることと一致していなければならない。
        performs: status === "completed" ? (radPerformByOrderId.get(serviceRequest.id ?? "") ?? []) : [],
      };
    }
    if (isPhysioServiceRequest(serviceRequest)) {
      const status = physioTaskStatus(physioTaskByOrderId.get(serviceRequest.id ?? ""));
      return {
        ...base,
        kind: "physio-order" as const,
        label: KARTE_KIND_LABELS["physio-order"],
        itemRequests: physioOrderItemRequests(itemRequests, serviceRequest.id ?? ""),
        status,
        // 放射線検査と同じく、実施情報は進捗が実施済のときだけ出す。
        performs:
          status === "completed" ? (physioPerformByOrderId.get(serviceRequest.id ?? "") ?? []) : [],
      };
    }
    if (isEndoscopyServiceRequest(serviceRequest)) {
      const status = endoscopyTaskStatus(endoscopyTaskByOrderId.get(serviceRequest.id ?? ""));
      return {
        ...base,
        kind: "endoscopy-order" as const,
        label: KARTE_KIND_LABELS["endoscopy-order"],
        itemRequests: endoscopyOrderItemRequests(itemRequests, serviceRequest.id ?? ""),
        status,
        performs:
          status === "completed"
            ? (endoscopyPerformByOrderId.get(serviceRequest.id ?? "") ?? [])
            : [],
      };
    }
    if (isTreatmentServiceRequest(serviceRequest)) {
      const status = treatmentTaskStatus(treatmentTaskByOrderId.get(serviceRequest.id ?? ""));
      return {
        ...base,
        kind: "treatment-order" as const,
        label: KARTE_KIND_LABELS["treatment-order"],
        itemRequests: treatmentOrderItemRequests(itemRequests, serviceRequest.id ?? ""),
        status,
        performs:
          status === "completed"
            ? (treatmentPerformByOrderId.get(serviceRequest.id ?? "") ?? [])
            : [],
      };
    }
    if (isSurgeryServiceRequest(serviceRequest)) {
      const status = surgeryTaskStatus(surgeryTaskByOrderId.get(serviceRequest.id ?? ""));
      return {
        ...base,
        kind: "surgery-order" as const,
        label: KARTE_KIND_LABELS["surgery-order"],
        itemRequests: surgeryOrderItemRequests(itemRequests, serviceRequest.id ?? ""),
        status,
        // 他部門と同じく、実施情報は進捗が実施済のときだけ出す。
        performs:
          status === "completed" ? (surgeryPerformByOrderId.get(serviceRequest.id ?? "") ?? []) : [],
      };
    }
    if (isMealServiceRequest(serviceRequest)) {
      return {
        ...base,
        kind: "meal-order" as const,
        label: KARTE_KIND_LABELS["meal-order"],
      };
    }
    if (isTransfusionServiceRequest(serviceRequest)) {
      const task = transfusionTaskByOrderId.get(serviceRequest.id ?? "");
      const status = transfusionTaskStatus(task);
      return {
        ...base,
        kind: "transfusion-order" as const,
        label: KARTE_KIND_LABELS["transfusion-order"],
        itemRequests: transfusionOrderItemRequests(itemRequests, serviceRequest.id ?? ""),
        status,
        task,
        // 他部門と同じく、実施情報は進捗が実施済のときだけ出す。輸血は実施取消で
        // 記録ごと消す(手術と同じ)ので、取り消した輸血の記録が残ることは無い。
        performs:
          status === "completed"
            ? (transfusionPerformByOrderId.get(serviceRequest.id ?? "") ?? [])
            : [],
      };
    }
    if (isRehabServiceRequest(serviceRequest)) {
      const status = rehabTaskStatus(rehabTaskByOrderId.get(serviceRequest.id ?? ""));
      return {
        ...base,
        kind: "rehab-order" as const,
        label: KARTE_KIND_LABELS["rehab-order"],
        status,
        // **実施情報の表示条件だけ他部門と違う**(docs/rehab-order-design.md §5)。
        //
        // 他部門は status === "completed" のときだけ実施情報を出す。取り消した検査に
        // 実施情報が残らないようにするためで、1 オーダー 1 実施だから成り立つ条件。
        // リハビリは受付済(accepted)のまま期間中ずっと実施が積み上がるので、同じ条件に
        // すると期間中は 1 件も実施が見えない。**受付済以降は常に出す。**
        // 他部門と揃える統一リファクタで壊さないこと。
        performs:
          status === "accepted" || status === "completed"
            ? (rehabPerformByOrderId.get(serviceRequest.id ?? "") ?? [])
            : [],
      };
    }
    const withMedications = {
      ...base,
      medicationRequests: medicationRequestsBySr.get(serviceRequest.id ?? "") ?? [],
    };
    return isInjectionServiceRequest(serviceRequest)
      ? { ...withMedications, kind: "injection" as const, label: KARTE_KIND_LABELS.injection }
      : { ...withMedications, kind: "prescription" as const, label: KARTE_KIND_LABELS.prescription };
  });

  const vitalEntries = groupVitalEntries(
    pickByType<fhir4.Observation>(vitalResources, "Observation"),
  );
  const vitalItems: KarteTimelineItem[] = vitalEntries.map((entry) => ({
    kind: "vital",
    id: entry.entryId,
    day: dayOf(entry.effectiveDateTime),
    dateTime: entry.effectiveDateTime,
    label: KARTE_KIND_LABELS.vital,
    entry,
  }));

  const qrItems: KarteTimelineItem[] = responses
    .filter((response) => !linkedResponseIds.has(response.id ?? ""))
    .map((response) => {
      const questionnaire = response.questionnaire
        ? questionnaireByCanonical.get(response.questionnaire)
        : undefined;
      return {
        kind: "qr",
        id: response.id ?? "",
        day: dayOf(response.authored),
        dateTime: response.authored ?? "",
        label: questionnaire?.title ?? questionnaire?.name ?? KARTE_KIND_LABELS.qr,
        response,
        questionnaire,
      };
    });

  // 単独回答は除外後だと 0 件になりうるので、最古日は除外前の回答で測る
  // (紐付き回答しか無いページでもカットオフを前に進められる)。
  const sources = [
    { hasNext: input.noteHasNext, oldest: oldestDay(noteItems) },
    { hasNext: input.prescriptionHasNext, oldest: oldestDay(prescriptionItems) },
    {
      hasNext: input.responseHasNext,
      oldest: oldestDayOfDates(responses.map((r) => dayOf(r.authored))),
    },
    { hasNext: input.vitalHasNext, oldest: oldestDay(vitalItems) },
  ];
  const cutoff = safeCutoff(sources);
  const [notePending, prescriptionPending, qrPending, vitalPending] = sources.map(
    (source) => source.hasNext && (source.oldest ?? CUTOFF_BLOCK_ALL) >= (cutoff ?? ""),
  );

  const visible = [...noteItems, ...prescriptionItems, ...qrItems, ...vitalItems].filter(
    // 日付未定は先読みで全件持っているので、カットオフで隠さない。
    (item) =>
      item.day === KARTE_UNSCHEDULED_DAY || cutoff === undefined || item.day > cutoff,
  );

  const byDay = new Map<string, KarteTimelineItem[]>();
  for (const item of visible) {
    const list = byDay.get(item.day);
    if (list) list.push(item);
    else byDay.set(item.day, [item]);
  }

  const groups = Array.from(byDay.entries())
    .map(([day, items]) => ({
      day,
      items: items.sort((a, b) => b.dateTime.localeCompare(a.dateTime)),
    }))
    .sort((a, b) => compareKarteDaysDesc(a.day, b.day));

  return {
    groups,
    hasMore:
      input.noteHasNext || input.prescriptionHasNext || input.responseHasNext || input.vitalHasNext,
    cutoff,
    pending: {
      note: notePending,
      prescription: prescriptionPending,
      qr: qrPending,
      vital: vitalPending,
    },
  };
}

// ---- カード種での絞り込み ----

/**
 * タイムラインに出す情報の種別。テンプレートは種別が 1 つしか無いので、
 * どのテンプレートかまで指定できるようにする(社会歴だけを時系列で読む、など)。
 */
export interface KarteCardFilter {
  kind: KarteItemKind;
  /**
   * kind が "qr" のときの絞り込み先テンプレート(canonical ではなく url)。
   * テンプレートのバージョンを上げても過去の回答が外れないよう、版は見ない。
   */
  questionnaireUrl?: string;
}

/** 回答が指しているテンプレートの url(canonical からバージョンを落としたもの)。 */
function responseQuestionnaireUrl(item: KarteTimelineItem): string {
  if (item.kind !== "qr") return "";
  const canonical = item.response.questionnaire ?? "";
  return canonical ? canonical.split("|")[0] : (item.questionnaire?.url ?? "");
}

export function matchesCardFilter(item: KarteTimelineItem, filter: KarteCardFilter): boolean {
  if (item.kind !== filter.kind) return false;
  if (!filter.questionnaireUrl) return true;
  return responseQuestionnaireUrl(item) === filter.questionnaireUrl;
}

/**
 * 指定した種別の情報だけを残す。空になった診療日のグループは落とす。
 * 種別はサーバー検索に無いのでここで絞る(プロブレムの絞り込みは検索側で済む)。
 * ページングの判定は読み込み済みの全データで決まるので、ここで件数が減っても
 * 読み進みには影響しない。
 */
export function filterKarteGroupsByCard(
  groups: KarteDayGroup[],
  filter: KarteCardFilter,
): KarteDayGroup[] {
  return groups
    .map((group) => ({ ...group, items: group.items.filter((item) => matchesCardFilter(item, filter)) }))
    .filter((group) => group.items.length > 0);
}

// ---- 診療日インデックスとの突き合わせ ----

/** 診療日ペインの 1 日分。まだタイムラインを読み込んでいない日は items が null。 */
export interface KarteDayEntry {
  day: string;
  items: KarteTimelineItem[] | null;
}

/**
 * 全診療日のインデックス(useKarteDayIndex)と読み込み済みのタイムラインを重ねる。
 * 診療日ペインはタイムラインのスクロール(読み込み状況)に関係なく全日付を出す
 * ためのもので、読み込み済みの日は項目付き、まだの日は日付だけ(items: null)に
 * なる。インデックスと実データの食い違いで「読み込み済みなのに項目が無い」日は
 * 空配列で返す(読み込み中と区別が付くように)。
 */
export function mergeDayIndex(
  groups: KarteDayGroup[],
  indexDays: string[],
  cutoff: string | undefined,
): KarteDayEntry[] {
  const byDay = new Map(groups.map((group) => [group.day, group.items]));
  // 登録直後などインデックスがまだ古いことがあるので、読み込み済みの日は常に足す。
  const days = new Set([...indexDays, ...groups.map((group) => group.day)]);
  return Array.from(days)
    .sort(compareKarteDaysDesc)
    .map((day) => ({
      day,
      items:
        byDay.get(day) ??
        (day === KARTE_UNSCHEDULED_DAY || cutoff === undefined || day > cutoff ? [] : null),
    }));
}

// ---- プロブレム(POMR)との紐付け ----

// この情報が対象としているプロブレム。診療記録とテンプレート回答はアプリローカル
// 拡張、オーダー系は reasonReference(処方と同じ関数で引ける)。
export function itemProblem(item: KarteTimelineItem): ProblemRef | null {
  if (item.kind === "note") return clinicalNoteProblem(item.note);
  if (item.kind === "qr") return questionnaireResponseProblem(item.response);
  if (item.kind === "vital") return vitalEntryProblem(item.entry);
  if (item.kind === "lab-order") return labOrderProblem(item.serviceRequest);
  if (item.kind === "micro-order") return microOrderProblem(item.serviceRequest);
  if (item.kind === "patho-order") return pathoOrderProblem(item.serviceRequest);
  if (item.kind === "rad-order") return radOrderProblem(item.serviceRequest);
  if (item.kind === "physio-order") return physioOrderProblem(item.serviceRequest);
  if (item.kind === "endoscopy-order") return endoscopyOrderProblem(item.serviceRequest);
  if (item.kind === "treatment-order") return treatmentOrderProblem(item.serviceRequest);
  if (item.kind === "surgery-order") return surgeryOrderProblem(item.serviceRequest);
  if (item.kind === "meal-order") return mealOrderProblem(item.serviceRequest);
  if (item.kind === "transfusion-order") return transfusionOrderProblem(item.serviceRequest);
  if (item.kind === "rehab-order") return rehabOrderProblem(item.serviceRequest);
  if (item.kind === "prescription" || item.kind === "injection") {
    return prescriptionProblem(item.serviceRequest);
  }
  return null;
}

/**
 * この情報が対象プロブレムのいずれかを指しているか(減光の判定)。
 * 集合で受けるのは、親プロブレムを選んだときに下位プロブレムの記録も
 * 同じ扱いにするため(conditionHelpers の problemWithDescendantIds で作る)。
 */
export function referencesProblem(
  item: KarteTimelineItem,
  conditionIds: ReadonlySet<string> | null,
): boolean {
  if (!conditionIds?.size) return false;
  const id = itemProblem(item)?.conditionId;
  return Boolean(id && conditionIds.has(id));
}

