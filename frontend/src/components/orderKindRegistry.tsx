import type { ComponentType } from "react";
import {
  useDeleteConsultOrder,
  useDeleteEndoscopyOrder,
  useDeleteLabOrder,
  useDeleteMealOrder,
  useDeleteMicroOrder,
  useDeleteNutritionGuidanceOrder,
  useDeletePathoOrder,
  useDeletePhysioOrder,
  useDeleteRadOrder,
  useDeleteRadiotherapyOrder,
  useDeleteRehabOrder,
  useDeleteSurgeryOrder,
  useDeleteTransfusionOrder,
  useDeleteTreatmentOrder,
} from "../api/queries";
import { summarizeConsultOrder } from "../fhir/consultOrderHelpers";
import { consultTaskStatusDisplay } from "../fhir/consultTaskHelpers";
import { endoscopyOrderTime, summarizeEndoscopyOrder } from "../fhir/endoscopyOrderHelpers";
import { endoscopyTaskStatusDisplay } from "../fhir/endoscopyTaskHelpers";
import type { KarteOrderItem } from "../fhir/karteTimeline";
import { summarizeLabOrder } from "../fhir/labOrderHelpers";
import { labTaskStatusDisplay } from "../fhir/labTaskHelpers";
import { summarizeMealOrder } from "../fhir/mealOrderHelpers";
import { summarizeMicroOrder } from "../fhir/microOrderHelpers";
import { summarizeNutritionGuidanceOrder } from "../fhir/nutritionGuidanceOrderHelpers";
import { nutritionGuidanceTaskStatusDisplay } from "../fhir/nutritionGuidanceTaskHelpers";
import type { OrderKind } from "../fhir/orderKinds";
import { summarizePathoOrder } from "../fhir/pathoOrderHelpers";
import { pathoTaskStatusDisplay } from "../fhir/pathoTaskHelpers";
import { physioOrderTime, summarizePhysioOrder } from "../fhir/physioOrderHelpers";
import { physioTaskStatusDisplay } from "../fhir/physioTaskHelpers";
import { radOrderTime, summarizeRadOrder } from "../fhir/radOrderHelpers";
import { radTaskStatusDisplay } from "../fhir/radTaskHelpers";
import { summarizeRadiotherapyOrder } from "../fhir/radiotherapyOrderHelpers";
import { radiotherapyTaskStatusDisplay } from "../fhir/radiotherapyTaskHelpers";
import { summarizeRehabOrder } from "../fhir/rehabOrderHelpers";
import { rehabTaskStatusDisplay } from "../fhir/rehabTaskHelpers";
import { summarizeSurgeryOrder } from "../fhir/surgeryOrderHelpers";
import { surgeryTaskStatusDisplay } from "../fhir/surgeryTaskHelpers";
import { summarizeTransfusionOrder } from "../fhir/transfusionOrderHelpers";
import { transfusionTaskStatusDisplay } from "../fhir/transfusionTaskHelpers";
import { summarizeTreatmentOrder, treatmentOrderTime } from "../fhir/treatmentOrderHelpers";
import { treatmentTaskStatusDisplay } from "../fhir/treatmentTaskHelpers";
import { clockTime } from "../lib/dates";
import { ConsultOrderCardBody } from "./karteCardBodies/ConsultOrderCardBody";
import { EndoscopyOrderCardBody } from "./karteCardBodies/EndoscopyOrderCardBody";
import { LabOrderCardBody } from "./karteCardBodies/LabOrderCardBody";
import { MealOrderCardBody } from "./karteCardBodies/MealOrderCardBody";
import { MicroOrderCardBody } from "./karteCardBodies/MicroOrderCardBody";
import { NutritionGuidanceOrderCardBody } from "./karteCardBodies/NutritionGuidanceOrderCardBody";
import { PathoOrderCardBody } from "./karteCardBodies/PathoOrderCardBody";
import { PhysioOrderCardBody } from "./karteCardBodies/PhysioOrderCardBody";
import { RadOrderCardBody } from "./karteCardBodies/RadOrderCardBody";
import { RadiotherapyOrderCardBody } from "./karteCardBodies/RadiotherapyOrderCardBody";
import { RehabOrderCardBody } from "./karteCardBodies/RehabOrderCardBody";
import { SurgeryOrderCardBody } from "./karteCardBodies/SurgeryOrderCardBody";
import { TransfusionOrderCardBody } from "./karteCardBodies/TransfusionOrderCardBody";
import { TreatmentOrderCardBody } from "./karteCardBodies/TreatmentOrderCardBody";

// 部門オーダーの種別ごとの「カルテでどう見せるか」をまとめた対応表。FHIR の読み方
// (種別の判定・プロブレム)は fhir/orderKinds.ts、ここは画面だけを持つ。
//
// 新しい種別を足すときは、fhir/orderKinds.ts に 1 行、カードの形(karteTimeline の
// KarteTimelineItem と組み立て)、そしてここに 1 要素を足す。対応表は Record<OrderKind, …> なので、
// 足し忘れは型エラーになる。

type OrderItem<K extends OrderKind> = Extract<KarteOrderItem, { kind: K }>;

/** 見出し・メタ行の部品を「|」でつなぐ(空の部品は落とす)。 */
type Part = string | false | null | undefined;
const joinParts = (...parts: Part[]) => parts.filter(Boolean).join(" | ");

export interface OrderKindDef<K extends OrderKind> {
  /** カードの見出し(入外区分、至急のときだけ至急区分 など)。 */
  title(item: OrderItem<K>): string;
  /** メタ行で依頼科・依頼医師の前に添える項目(指定した時刻・手術室など)。 */
  metaLead?(item: OrderItem<K>): Part[];
  /** 部門の進捗(依頼済・受付済・実施済・中止)の表示。カードに進捗を出さない種別は持たない。 */
  status?(item: OrderItem<K>): { code: string; label: string };
  /** DO(複写して新規登録)を出すか。 */
  doable: boolean;
  /** カードの本文。 */
  Body: ComponentType<{ item: OrderItem<K> }>;
}

/** 入外区分と、至急のときだけ至急区分(通常はわざわざ出さない)。 */
function settingAndUrgency(summary: { settingDisplay: string; urgent: boolean; priorityDisplay: string }) {
  return joinParts(summary.settingDisplay, summary.urgent && summary.priorityDisplay);
}

export const ORDER_KIND_DEFS: { [K in OrderKind]: OrderKindDef<K> } = {
  "lab-order": {
    title: (item) => settingAndUrgency(summarizeLabOrder(item.serviceRequest)),
    status: (item) => ({ code: item.status, label: labTaskStatusDisplay(item.status) }),
    doable: true,
    Body: ({ item }) => (
      <LabOrderCardBody serviceRequest={item.serviceRequest} itemRequests={item.itemRequests} />
    ),
  },
  "micro-order": {
    title: (item) => settingAndUrgency(summarizeMicroOrder(item.serviceRequest)),
    doable: true,
    Body: ({ item }) => (
      <MicroOrderCardBody serviceRequest={item.serviceRequest} itemRequests={item.itemRequests} />
    ),
  },
  "patho-order": {
    // 病理は検査区分(組織診・細胞診・術中迅速)が「何を依頼したか」そのものなので見出しに並べる。
    // 本文は検体の一覧なので、区分が見出しに無いと何の検査か分からない。
    title: (item) => {
      const summary = summarizePathoOrder(item.serviceRequest);
      return joinParts(
        summary.settingDisplay,
        summary.examCategoryDisplay,
        summary.urgent && summary.priorityDisplay,
      );
    },
    status: (item) => ({ code: item.status, label: pathoTaskStatusDisplay(item.status) }),
    doable: true,
    Body: ({ item }) => (
      <PathoOrderCardBody serviceRequest={item.serviceRequest} itemRequests={item.itemRequests} />
    ),
  },
  "rad-order": {
    title: (item) => settingAndUrgency(summarizeRadOrder(item.serviceRequest)),
    // 撮影時刻を指定できるので、依頼科・依頼医師の前に添える。記入時刻を出す診療記録と
    // 紛れないよう「撮影」と付ける(未指定のオーダーでは出さない)。
    metaLead: (item) => {
      const time = radOrderTime(item.serviceRequest);
      return [time && `撮影 ${time}`];
    },
    status: (item) => ({ code: item.status, label: radTaskStatusDisplay(item.status) }),
    doable: true,
    Body: ({ item }) => (
      <RadOrderCardBody
        serviceRequest={item.serviceRequest}
        itemRequests={item.itemRequests}
        performs={item.performs}
      />
    ),
  },
  "physio-order": {
    title: (item) => settingAndUrgency(summarizePhysioOrder(item.serviceRequest)),
    metaLead: (item) => {
      const time = physioOrderTime(item.serviceRequest);
      return [time && `検査 ${time}`];
    },
    status: (item) => ({ code: item.status, label: physioTaskStatusDisplay(item.status) }),
    doable: true,
    Body: ({ item }) => (
      <PhysioOrderCardBody
        serviceRequest={item.serviceRequest}
        itemRequests={item.itemRequests}
        performs={item.performs}
      />
    ),
  },
  "endoscopy-order": {
    title: (item) => settingAndUrgency(summarizeEndoscopyOrder(item.serviceRequest)),
    metaLead: (item) => {
      const time = endoscopyOrderTime(item.serviceRequest);
      return [time && `検査 ${time}`];
    },
    status: (item) => ({ code: item.status, label: endoscopyTaskStatusDisplay(item.status) }),
    doable: true,
    Body: ({ item }) => (
      <EndoscopyOrderCardBody
        serviceRequest={item.serviceRequest}
        itemRequests={item.itemRequests}
        performs={item.performs}
      />
    ),
  },
  "treatment-order": {
    // 処置は至急区分を持たないので入外区分だけ。
    title: (item) => summarizeTreatmentOrder(item.serviceRequest).settingDisplay,
    metaLead: (item) => {
      const time = treatmentOrderTime(item.serviceRequest);
      return [time && `実施 ${time}`];
    },
    status: (item) => ({ code: item.status, label: treatmentTaskStatusDisplay(item.status) }),
    doable: true,
    Body: ({ item }) => (
      <TreatmentOrderCardBody
        serviceRequest={item.serviceRequest}
        itemRequests={item.itemRequests}
        performs={item.performs}
      />
    ),
  },
  "surgery-order": {
    // 入外区分と、緊急・準緊急のときだけ予定区分(予定はわざわざ出さない)。
    title: (item) => {
      const summary = summarizeSurgeryOrder(item.serviceRequest);
      return joinParts(summary.settingDisplay, summary.priority !== "routine" && summary.priorityDisplay);
    },
    // 入室予定時刻と手術室を添える(日付はカードの載る日で分かる。未定なら明示)。
    metaLead: (item) => {
      const summary = summarizeSurgeryOrder(item.serviceRequest);
      const scheduled = summary.scheduledDate
        ? `予定 ${summary.scheduledDate} ${summary.scheduledTime}`.trim()
        : "日付未定";
      return [scheduled, summary.roomName];
    },
    status: (item) => ({ code: item.status, label: surgeryTaskStatusDisplay(item.status) }),
    doable: true,
    Body: ({ item }) => (
      <SurgeryOrderCardBody
        serviceRequest={item.serviceRequest}
        itemRequests={item.itemRequests}
        performs={item.performs}
      />
    ),
  },
  "meal-order": {
    // 食事は入外区分が常に入院なので見出しに出さず、いつからいつまでかを出す。
    title: (item) => {
      const summary = summarizeMealOrder(item.serviceRequest);
      return `${summary.startLabel}〜${summary.continuing ? " 継続中" : ` ${summary.endLabel}`}`;
    },
    doable: false,
    Body: ({ item }) => <MealOrderCardBody serviceRequest={item.serviceRequest} />,
  },
  "transfusion-order": {
    // 検査区分(交差適合試験・T&S)が輸血部門の作業を決める軸なので見出しに並べる。
    // 同意書が未取得のオーダーは例外なので、そのことも見出しに出す。
    title: (item) => {
      const summary = summarizeTransfusionOrder(item.serviceRequest);
      return joinParts(
        summary.settingDisplay,
        summary.testTypeDisplay,
        summary.urgent && summary.priorityDisplay,
        !summary.consentConfirmed && "同意書未取得",
      );
    },
    metaLead: (item) => {
      const time = clockTime(item.serviceRequest.occurrenceDateTime ?? "");
      return [time && `投与 ${time}`];
    },
    status: (item) => ({ code: item.status, label: transfusionTaskStatusDisplay(item.status) }),
    doable: true,
    Body: ({ item }) => (
      <TransfusionOrderCardBody
        serviceRequest={item.serviceRequest}
        itemRequests={item.itemRequests}
        performs={item.performs}
      />
    ),
  },
  "rehab-order": {
    // 期間継続型なので「いつからいつまで」が見出しに要る(食事と同じ。ただし入外区分は
    // 入院・外来どちらもありうるので出す)。
    title: (item) => {
      const summary = summarizeRehabOrder(item.serviceRequest);
      return joinParts(summary.settingDisplay, summary.periodLabel);
    },
    status: (item) => ({ code: item.status, label: rehabTaskStatusDisplay(item.status) }),
    doable: true,
    Body: ({ item }) => (
      <RehabOrderCardBody serviceRequest={item.serviceRequest} performs={item.performs} />
    ),
  },
  "radiotherapy-order": {
    // 「第何コースで何が目的か」が見出し。
    title: (item) => {
      const summary = summarizeRadiotherapyOrder(item.serviceRequest);
      return joinParts(summary.settingDisplay, `第${summary.courseNumber}コース`, summary.intentDisplay);
    },
    status: (item) => ({ code: item.status, label: radiotherapyTaskStatusDisplay(item.status) }),
    doable: true,
    Body: ({ item }) => (
      <RadiotherapyOrderCardBody
        serviceRequest={item.serviceRequest}
        fractions={item.fractions}
        hasCourseSummary={item.hasCourseSummary}
      />
    ),
  },
  "nutrition-guidance-order": {
    // リハビリと同じ期間継続型なので、入外区分と期間を見出しに出す。
    title: (item) => {
      const summary = summarizeNutritionGuidanceOrder(item.serviceRequest);
      return joinParts(summary.settingDisplay, summary.periodLabel);
    },
    status: (item) => ({ code: item.status, label: nutritionGuidanceTaskStatusDisplay(item.status) }),
    doable: true,
    Body: ({ item }) => (
      <NutritionGuidanceOrderCardBody serviceRequest={item.serviceRequest} performs={item.performs} />
    ),
  },
  "consult-order": {
    // 「どこへ出したか」が見出しそのもの。至急のときだけ緊急度も並べる。
    title: (item) => {
      const summary = summarizeConsultOrder(item.serviceRequest);
      return joinParts(summary.settingDisplay, summary.targetLabel, summary.urgent && "至急");
    },
    // 希望日が必須でカードもその日に載るので、日付は添えない。
    metaLead: (item) => {
      const summary = summarizeConsultOrder(item.serviceRequest);
      return [summary.replierName && `回答 ${summary.replierName}`];
    },
    status: (item) => ({ code: item.status, label: consultTaskStatusDisplay(item.status) }),
    doable: true,
    Body: ({ item }) => <ConsultOrderCardBody serviceRequest={item.serviceRequest} />,
  },
};

/**
 * カードの種別に合った定義。種別と項目の型の対応は kind で決まるが、union のままでは
 * TypeScript が追えないので、ここで 1 回だけ型を緩める。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function orderKindDefOf(item: KarteOrderItem): OrderKindDef<any> {
  return ORDER_KIND_DEFS[item.kind];
}

/**
 * 種別ごとの削除。明細(これも ServiceRequest)や予約を道連れに消す種別があるので、
 * 種別ごとの mutation を使う。回答済の他科依頼・受付後の放射線治療は mutation 側で拒否する。
 */
export function useOrderKindDeletes() {
  return {
    "lab-order": useDeleteLabOrder(),
    "micro-order": useDeleteMicroOrder(),
    "patho-order": useDeletePathoOrder(),
    "rad-order": useDeleteRadOrder(),
    "physio-order": useDeletePhysioOrder(),
    "endoscopy-order": useDeleteEndoscopyOrder(),
    "treatment-order": useDeleteTreatmentOrder(),
    "surgery-order": useDeleteSurgeryOrder(),
    "meal-order": useDeleteMealOrder(),
    "transfusion-order": useDeleteTransfusionOrder(),
    "rehab-order": useDeleteRehabOrder(),
    "radiotherapy-order": useDeleteRadiotherapyOrder(),
    "nutrition-guidance-order": useDeleteNutritionGuidanceOrder(),
    "consult-order": useDeleteConsultOrder(),
  } satisfies Record<OrderKind, unknown>;
}
