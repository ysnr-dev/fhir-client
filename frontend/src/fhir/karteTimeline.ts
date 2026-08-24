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
import { prescriptionProblem } from "./prescriptionHelpers";
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
  | "rad-order"
  | "physio-order"
  | "endoscopy-order"
  | "qr";

export const KARTE_KIND_LABELS: Record<KarteItemKind, string> = {
  note: "診療記録",
  vital: "バイタル",
  prescription: "処方",
  injection: "注射",
  "lab-order": "検体検査",
  "micro-order": "細菌検査",
  "rad-order": "放射線検査",
  "physio-order": "生理検査",
  "endoscopy-order": "内視鏡",
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

  // 診療記録のセクション・放射線オーダーの検査目的/特別指示から参照されている回答は、
  // そのカードの本文として既に描画されるので単独カードにしない。
  const linkedResponseIds = new Set([
    ...compositions.flatMap((c) => referencedResponseIds(c)),
    ...radOrderResponseIds(serviceRequests),
    ...physioOrderResponseIds(serviceRequests),
    ...endoscopyOrderResponseIds(serviceRequests),
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
    .sort((a, b) => b.localeCompare(a))
    .map((day) => ({
      day,
      items: byDay.get(day) ?? (cutoff === undefined || day > cutoff ? [] : null),
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
  if (item.kind === "rad-order") return radOrderProblem(item.serviceRequest);
  if (item.kind === "physio-order") return physioOrderProblem(item.serviceRequest);
  if (item.kind === "endoscopy-order") return endoscopyOrderProblem(item.serviceRequest);
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

