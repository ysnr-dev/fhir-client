import { referencedResponseIds } from "./clinicalNoteHelpers";
import { isInjectionServiceRequest } from "./injectionHelpers";
import { isLabServiceRequest } from "./labOrderHelpers";
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

export type KarteItemKind = "note" | "prescription" | "injection" | "lab-order" | "qr";

export const KARTE_KIND_LABELS: Record<KarteItemKind, string> = {
  note: "診療記録",
  prescription: "処方",
  injection: "注射",
  "lab-order": "検体検査",
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
    // 検体検査は明細リソースを持たず、依頼した項目を ServiceRequest の
    // orderDetail に持つ。
    | { kind: "lab-order"; serviceRequest: fhir4.ServiceRequest }
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

  // 診療記録のセクションから参照されている回答は、記録カードの本文として既に
  // 描画されるので単独カードにしない。
  const linkedResponseIds = new Set(compositions.flatMap((c) => referencedResponseIds(c)));

  // canonical("<url>|<version>")と url 単独の両方で引けるようにしておく
  // (QuestionnaireResponse.questionnaire はバージョン無しのこともある)。
  const questionnaireByCanonical = new Map<string, fhir4.Questionnaire>();
  for (const questionnaire of questionnaires) {
    questionnaireByCanonical.set(questionnaireCanonical(questionnaire), questionnaire);
    if (questionnaire.url && !questionnaireByCanonical.has(questionnaire.url)) {
      questionnaireByCanonical.set(questionnaire.url, questionnaire);
    }
  }

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

  // 処方・注射・検体検査は同じ検索結果に混ざって届くので、category のオーダー種別で
  // 振り分ける(注射より前から存在する処方の ServiceRequest はオーダー種別を持たない)。
  const prescriptionItems: KarteTimelineItem[] = serviceRequests.map((serviceRequest) => {
    const base = {
      id: serviceRequest.id ?? "",
      day: dayOf(serviceRequest.authoredOn),
      dateTime: serviceRequest.authoredOn ?? "",
      serviceRequest,
    };
    if (isLabServiceRequest(serviceRequest)) {
      return { ...base, kind: "lab-order" as const, label: KARTE_KIND_LABELS["lab-order"] };
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
