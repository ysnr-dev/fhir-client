import type { PathwayApplicationRecord } from "./pathwayApplyHelpers";

// 病日の主要イベント(手術・内視鏡治療・放射線治療など。JAHIS ePath 実装ガイド 6.4 majorEvent)。
// 名前は定義の病日から適用の病日の CarePlan に写したもの、日時は主要イベントに選んだタスクに結んだ
// オーダーの実施記録(手術は入室〜退室、内視鏡は実施時刻)から読む。自由入力(タスクに結ばない)は名前だけ。
// React に依存しない。設計は docs/clinical-pathway-design.md §7.13。

export interface PathwayMajorEvent {
  /** 病日 CarePlan の id。 */
  eventId: string;
  name: string;
  /** 病日の日付。 */
  date: string;
  /** 実施の開始・終了(実施記録が無ければ空)。 */
  start: string;
  end: string;
}

function refId(reference: string | undefined): string {
  return reference?.split("/").pop() ?? "";
}

/** 実施記録の本体(子の明細は partOf で本体を指すので除く)。取り消した記録は数えない。 */
function performHubsByOrder(performs: fhir4.Procedure[]): Map<string, fhir4.Procedure[]> {
  const map = new Map<string, fhir4.Procedure[]>();
  for (const procedure of performs) {
    if (procedure.partOf?.length || procedure.status === "entered-in-error" || procedure.status === "not-done") continue;
    for (const ref of procedure.basedOn ?? []) {
      if (!ref.reference?.startsWith("ServiceRequest/")) continue;
      const id = refId(ref.reference);
      map.set(id, [...(map.get(id) ?? []), procedure]);
    }
  }
  return map;
}

function startOf(procedure: fhir4.Procedure): string {
  return procedure.performedPeriod?.start ?? procedure.performedDateTime ?? "";
}

/** 適用の病日(CarePlan の id)→ 主要イベント。名前の無い病日は入らない。 */
export function pathwayMajorEvents(
  application: PathwayApplicationRecord,
  performs: fhir4.Procedure[],
): Map<string, PathwayMajorEvent> {
  const hubs = performHubsByOrder(performs);
  const result = new Map<string, PathwayMajorEvent>();
  for (const event of application.events) {
    if (!event.majorEventName) continue;
    const task = event.majorEventTaskId
      ? event.units.flatMap((u) => u.assessments.flatMap((a) => a.tasks)).find((t) => t.id === event.majorEventTaskId)
      : undefined;
    // 同じオーダーに実施が複数あれば最初のもの(手術の再入室などは最初の入室を開始とする)。
    const record = (task?.orderIds ?? [])
      .flatMap((id) => hubs.get(id) ?? [])
      .sort((a, b) => startOf(a).localeCompare(startOf(b)))[0];
    result.set(event.id, {
      eventId: event.id,
      name: event.majorEventName,
      date: event.date,
      start: record ? startOf(record) : "",
      end: record?.performedPeriod?.end ?? "",
    });
  }
  return result;
}

/** 実施の時刻「10:05〜11:40」。実施記録が無ければ空。病日の日付と違う日なら日付も添える。 */
export function majorEventTimeLabel(event: PathwayMajorEvent): string {
  const time = (value: string) => {
    if (!value) return "";
    const day = value.slice(0, 10);
    const hm = value.slice(11, 16);
    return day && day !== event.date ? `${day.slice(5).replace("-", "/")} ${hm}` : hm;
  };
  const start = time(event.start);
  const end = time(event.end);
  return start ? `${start}${end ? `〜${end}` : ""}` : "";
}

/** 「腹腔鏡下胆嚢摘出術 10:05〜11:40」。実施記録が無ければ名前だけ。 */
export function majorEventLabel(event: PathwayMajorEvent): string {
  const time = majorEventTimeLabel(event);
  return time ? `${event.name} ${time}` : event.name;
}
