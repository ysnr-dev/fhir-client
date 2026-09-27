import type { PatientCaution } from "../api/masterClient";
import type { useInfectionsForPatients } from "../api/queries";
import {
  OUTPATIENT_ORDER_STAGE_LABELS,
  type OutpatientOrderSummary,
} from "../fhir/outpatientOrderProgressHelpers";
import {
  AllergyPictogramBadges,
  CautionPictogramBadges,
  InfectionPictogramBadge,
} from "./PatientPictograms";

// 外来・救急の患者一覧で共用する、行の中の部品。

type RowPictogramsProps = {
  patientId: string;
  flags: Map<string, fhir4.Flag[]>;
  allergies: Map<string, fhir4.AllergyIntolerance[]>;
  infections: ReturnType<typeof useInfectionsForPatients>["byPatient"];
  cautionsByCode: Map<string, PatientCaution>;
};

/**
 * 氏名の後ろに並べる注意のピクトグラム(カルテの患者帯・病棟マップと同じもの)。
 * 表は横スクロールの入れ物に入っていて行の中では吹き出しが縁で切れるので、body 直下に出す。
 */
export function RowPictograms({
  patientId,
  flags,
  allergies,
  infections,
  cautionsByCode,
}: RowPictogramsProps) {
  if (!patientId) return null;
  return (
    <span className="outpatient__pictograms">
      <CautionPictogramBadges
        flags={flags.get(patientId) ?? []}
        cautionsByCode={cautionsByCode}
        patientId={patientId}
        size={16}
        portal
      />
      <AllergyPictogramBadges
        allergies={allergies.get(patientId) ?? []}
        patientId={patientId}
        size={16}
        portal
      />
      <InfectionPictogramBadge
        rows={infections.get(patientId) ?? []}
        patientId={patientId}
        size={16}
        portal
      />
    </span>
  );
}

/**
 * 当日オーダーの印。種別ごとに 1 文字の四角を 1 つ並べ、いちばん進んでいない段階を
 * 色と塗りで出す。種別の正式名と一件ずつの内訳はホバーで読む。
 */
export function OrderSummaryChips({ orders }: { orders: OutpatientOrderSummary[] }) {
  if (orders.length === 0) return <>-</>;
  return (
    <span className="outpatient__orders">
      {orders.map((order) => {
        const heading = `${order.kindLabel}（${OUTPATIENT_ORDER_STAGE_LABELS[order.stage]}）`;
        return (
          <span
            key={order.kind}
            className={`outpatient__order outpatient__order--${order.stage}`}
            title={[heading, ...order.details].join("\n")}
            aria-label={heading}
          >
            {order.mark}
          </span>
        );
      })}
    </span>
  );
}

/** 当日オーダーの列見出しのホバーに出す、印の見方。 */
export const ORDER_LEGEND =
  "青の塗り=結果あり / 青の枠=中間報告 / 灰の塗り=実施済 / 紫の枠=受付済 / 枠のみ=依頼";
