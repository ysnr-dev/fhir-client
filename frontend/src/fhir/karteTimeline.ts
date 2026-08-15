import { clinicalNoteProblem, referencedResponseIds } from "./clinicalNoteHelpers";
import type { ProblemRef } from "./conditionHelpers";
import { isInjectionServiceRequest } from "./injectionHelpers";
import {
  isLabServiceRequest,
  isOrderItemRequest,
  labOrderItemRequests,
  labOrderProblem,
} from "./labOrderHelpers";
import { isMicroServiceRequest, microOrderItemRequests, microOrderProblem } from "./microOrderHelpers";
import { prescriptionProblem } from "./prescriptionHelpers";
import {
  isRadServiceRequest,
  radOrderItemRequests,
  radOrderProblem,
  radOrderResponseIds,
} from "./radOrderHelpers";
import { radPerformsByOrderId, type RadPerformDisplay } from "./radResultHelpers";
import { radTaskStatus, radTasksByOrderId, type RadTaskStatus } from "./radTaskHelpers";
import { questionnaireCanonical } from "./questionnaireResponseHelpers";

// カルテ画面のタイムライン(診療日ごとの時系列表示)を組み立てる純粋ロジック。
//
// 診療記録(Composition) / 処方・注射(ServiceRequest + MedicationRequest) / 単独登録の
// テンプレート回答(QuestionnaireResponse)を 1 本の時系列にまとめる。検索は別々に
// ページングされるため、「どこまで表示してよいか」の判断が要になる
// (buildKarteTimeline の安全カットオフを参照)。
//
// 処方・注射・検体検査は同じ ServiceRequest 検索(1 本のページング)で取得し、
// category のオーダー種別でカードの種別に振り分ける。

export type KarteItemKind =
  | "note"
  | "prescription"
  | "injection"
  | "lab-order"
  | "micro-order"
  | "rad-order"
  | "qr";

export const KARTE_KIND_LABELS: Record<KarteItemKind, string> = {
  note: "診療記録",
  prescription: "処方",
  injection: "注射",
  "lab-order": "検体検査",
  "micro-order": "細菌検査",
  "rad-order": "放射線検査",
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
    | { kind: "qr"; response: fhir4.QuestionnaireResponse; questionnaire?: fhir4.Questionnaire }
  );

export interface KarteDayGroup {
  day: string;
  items: KarteTimelineItem[];
}

export interface KarteTimelineInput {
  noteBundles: fhir4.Bundle[];
  prescriptionBundles: fhir4.Bundle[];
  responseBundles: fhir4.Bundle[];
  noteHasNext: boolean;
  prescriptionHasNext: boolean;
  responseHasNext: boolean;
}

export interface KarteTimelineResult {
  groups: KarteDayGroup[];
  /** まだ読み込んでいない、より古いデータが残っているか。 */
  hasMore: boolean;
  /**
   * 次ページを読むべきソース。表示範囲(カットオフ)を押し下げているものだけを
   * 対象にして、片方に大量データがある患者で無駄な取得をしないようにする。
   */
  pending: { note: boolean; prescription: boolean; qr: boolean };
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
  const prescriptionResources = resourcesOf(input.prescriptionBundles);
  const responseResources = resourcesOf(input.responseBundles);

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

  // 診療記録のセクション・放射線オーダーの検査目的/特別指示から参照されている回答は、
  // そのカードの本文として既に描画されるので単独カードにしない。
  const linkedResponseIds = new Set([
    ...compositions.flatMap((c) => referencedResponseIds(c)),
    ...radOrderResponseIds(serviceRequests),
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

  // 放射線検査オーダー id → 部門の進捗(Task)と実施記録(Procedure 一式)。
  // カードのステータス表示と「実施情報」の出力に使う。
  const radTaskByOrderId = radTasksByOrderId(pickByType<fhir4.Task>(prescriptionResources, "Task"));
  const radPerformByOrderId = radPerformsByOrderId(
    pickByType<fhir4.Procedure>(prescriptionResources, "Procedure"),
    pickByType<fhir4.MedicationAdministration>(prescriptionResources, "MedicationAdministration"),
    pickByType<fhir4.Observation>(prescriptionResources, "Observation"),
  );

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
  const orderRequests = serviceRequests.filter((sr) => !isOrderItemRequest(sr));
  const itemRequests = serviceRequests.filter(isOrderItemRequest);

  // 処方・注射・検体検査・放射線検査は同じ検索結果に混ざって届くので、category の
  // オーダー種別で振り分ける(注射より前から存在する処方の ServiceRequest は
  // オーダー種別を持たない)。
  const prescriptionItems: KarteTimelineItem[] = orderRequests.map((serviceRequest) => {
    const base = {
      id: serviceRequest.id ?? "",
      day: dayOf(serviceRequest.authoredOn),
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
    const withMedications = {
      ...base,
      medicationRequests: medicationRequestsBySr.get(serviceRequest.id ?? "") ?? [],
    };
    return isInjectionServiceRequest(serviceRequest)
      ? { ...withMedications, kind: "injection" as const, label: KARTE_KIND_LABELS.injection }
      : { ...withMedications, kind: "prescription" as const, label: KARTE_KIND_LABELS.prescription };
  });

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
  ];
  const cutoff = safeCutoff(sources);
  const [notePending, prescriptionPending, qrPending] = sources.map(
    (source) => source.hasNext && (source.oldest ?? CUTOFF_BLOCK_ALL) >= (cutoff ?? ""),
  );

  const visible = [...noteItems, ...prescriptionItems, ...qrItems].filter(
    (item) => cutoff === undefined || item.day > cutoff,
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
    .sort((a, b) => b.day.localeCompare(a.day));

  return {
    groups,
    hasMore: input.noteHasNext || input.prescriptionHasNext || input.responseHasNext,
    pending: { note: notePending, prescription: prescriptionPending, qr: qrPending },
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
 * プロブレムの絞り込み(filterKarteGroups)と同じく、ページングの判定より後に行う。
 */
export function filterKarteGroupsByCard(
  groups: KarteDayGroup[],
  filter: KarteCardFilter,
): KarteDayGroup[] {
  return groups
    .map((group) => ({ ...group, items: group.items.filter((item) => matchesCardFilter(item, filter)) }))
    .filter((group) => group.items.length > 0);
}

// ---- プロブレム(POMR)との紐付け ----

// この情報が対象としているプロブレム。現状プロブレムを持つのは診療記録と
// 処方・注射・検体検査(テンプレートの紐付けは未実装)。いずれも reasonReference
// なので処方と同じ関数で引ける。
export function itemProblem(item: KarteTimelineItem): ProblemRef | null {
  if (item.kind === "note") return clinicalNoteProblem(item.note);
  if (item.kind === "lab-order") return labOrderProblem(item.serviceRequest);
  if (item.kind === "micro-order") return microOrderProblem(item.serviceRequest);
  if (item.kind === "rad-order") return radOrderProblem(item.serviceRequest);
  if (item.kind === "prescription" || item.kind === "injection") {
    return prescriptionProblem(item.serviceRequest);
  }
  return null;
}

export function referencesProblem(item: KarteTimelineItem, conditionId: string | null): boolean {
  if (!conditionId) return false;
  return itemProblem(item)?.conditionId === conditionId;
}

/**
 * 指定したプロブレムに紐付く情報だけを残す(「関連する記録のみ表示」)。
 * 空になった診療日のグループは落とす。
 *
 * 絞り込みはページングの判定より後に行う。カットオフや次ページの要否は
 * 「読み込み済みの全データ」で決まるので、ここで件数が減ってもタイムラインの
 * 読み進みには影響しない(絞り込みの結果 0 件でも、末尾のセンチネルが見えている
 * 限り古いページを読み続ける)。
 */
export function filterKarteGroups(
  groups: KarteDayGroup[],
  conditionId: string,
): KarteDayGroup[] {
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => referencesProblem(item, conditionId)),
    }))
    .filter((group) => group.items.length > 0);
}
