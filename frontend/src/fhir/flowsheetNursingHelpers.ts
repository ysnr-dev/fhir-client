import type { FlowsheetMark, FlowsheetMarkRow } from "./flowsheetEventHelpers";
import { flowsheetEventAtLabel } from "./flowsheetEventHelpers";
import { isNursingOrderRunningOn, nursingOrderItem } from "./nursingOrderHelpers";
import {
  expandNursingSchedule,
  nursingScheduleOf,
  type NursingScheduleSettings,
} from "./nursingScheduleHelpers";
import type { NursingPerformDisplay } from "./nursingPerformHelpers";

// 経過表(温度板)の看護欄。看護指示を「観察」と「行為」に分け、注射・検査と同じ
// 印の行にする。
//
//   ServiceRequest(指示)  … 観察 or 行為。頻度は root 拡張の Timing
//    ├ basedOn ← Observation … 観察の実施(値を持つ)
//    └ basedOn ← Procedure   … 行為の実施(「実施」とだけ記録)
//
// 注射・検査と違うのは 2 点。
//
// 1. **指示自体には日時が無い**(期間と頻度だけ)。予定の印は、表示している日ごとに
//    頻度から時刻を展開して作る(`expandNursingSchedule`。指示簿の実施入力と同じ関数)。
// 2. **観察はバイタルの表にも出る**。SpO2・体温のように LOINC を併記した観察は
//    測定項目の行に合流する(`buildVitalFlowsheet`)。ここで作る観察の行は
//    「いつ記録したか」を指示の単位で見るためのもので、値は title と一覧で読む。

/** 経過表が看護を組み立てるのに要るもの。 */
export interface FlowsheetNursingData {
  /** その期間に有効な看護指示(観察・行為が混在)。 */
  orders: fhir4.ServiceRequest[];
  /** 指示の id ごとの実施記録。 */
  performsByOrderId: Map<string, NursingPerformDisplay[]>;
  /** 施設の既定時刻(「1日N回」の時刻・「N時間毎」の起点)。 */
  schedule: NursingScheduleSettings;
}

/** 観察と行為で欄を分ける。 */
export type NursingRowKind = "observation" | "act";

/**
 * 「指示 × 時系列」の行を組み立てる。行 1 つが指示 1 件。
 *
 * 予定は表示している日ごとに頻度から展開する。頻度を持たない指示(自由記載の条件、
 * 「38℃以上で報告」など)は予定の時刻が決まらないので、予定の印は出さない
 * (実施したときだけ印が付く)。
 */
export function buildNursingRows(
  data: FlowsheetNursingData,
  days: string[],
  kind: NursingRowKind,
  now: Date = new Date(),
): FlowsheetMarkRow[] {
  const rows: FlowsheetMarkRow[] = [];
  const limit = now.getTime();

  for (const order of data.orders) {
    const item = nursingOrderItem(order);
    if (!item || item.kind !== kind) continue;
    const orderId = order.id ?? "";
    if (!orderId) continue;
    const label = item.display || order.code?.text || "";
    if (!label) continue;

    const marks: FlowsheetMark[] = [];
    const performs = data.performsByOrderId.get(orderId) ?? [];

    // 予定。指示が有効な日だけ、頻度から時刻を展開する。
    const timing = nursingScheduleOf(order);
    for (const day of days) {
      if (!isNursingOrderRunningOn(order, day)) continue;
      for (const time of expandNursingSchedule(timing, day, data.schedule)) {
        const at = `${day}T${time}`;
        // 未来の予定も出す(これから実施するものを見るため)。ただし実施済みの
        // 時刻に予定の印を重ねない(同じ時刻の記録があれば実施の印だけを出す)。
        if (performs.some((perform) => perform.at.slice(0, 16) === at)) continue;
        marks.push({
          at,
          kind: "planned",
          groupId: orderId,
          title: `予定 ${flowsheetEventAtLabel(at)} ${label}`,
          event: {
            at,
            kind: "nursing",
            label: "予定",
            name: "予定",
            detail: label,
          },
        });
      }
    }

    // 実施。観察は値、行為は「実施」。
    for (const perform of performs) {
      if (!perform.at || Date.parse(perform.at) > limit) continue;
      marks.push({
        at: perform.at,
        kind: "performed",
        groupId: orderId,
        title: [`実施 ${flowsheetEventAtLabel(perform.at)}`, label, perform.value]
          .filter(Boolean)
          .join(" "),
        event: {
          at: perform.at,
          kind: "nursing",
          label: "実施",
          name: "実施",
          detail: [label, perform.value].filter(Boolean).join(" "),
        },
      });
    }

    if (marks.length === 0) continue;
    rows.push({
      key: orderId,
      label,
      title: label,
      marks,
    });
  }

  return rows;
}
