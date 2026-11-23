// 検体検査の外注(docs/lab-outsource-design.md)。
//
// 外注先は連携先の Organization のうち「検査委託先」の印を持つもの(organizationHelpers の
// isClinicalLab)。項目ごとの行き先はオーダー項目マスタの実施区分と外注先で決まり、外注先を
// 決めていない外注項目は施設設定の既定の外注先に出す。

import {
  groupBySpecimen,
  labOrderItems,
  memberSummary,
  type LabSpecimenGroup,
} from "./labOrderHelpers";
import { specimenShippedAt, tubeOfGroup } from "./labSpecimenHelpers";
import { labTaskStatus } from "./labTaskHelpers";

/** 施設設定 lab_outsource(backend の DEFAULT_LAB_OUTSOURCE と同じ形)。 */
export interface LabOutsourceSettings {
  /** 既定の外注先(Organization.id)。空なら未設定。 */
  default_organization_id: string;
}

export const DEFAULT_LAB_OUTSOURCE: LabOutsourceSettings = { default_organization_id: "" };

/** 行き先を決めるのに要る項目マスタの列。 */
interface OutsourceSource {
  execution_type: string | null;
  outsource_organization_id: string | null;
}

/**
 * 項目の外注先(Organization.id)。院内で測る項目と、外注だが行き先がどこにも
 * 決まっていない項目は空。
 */
export function outsourceOrganizationIdOf(item: OutsourceSource, settings: LabOutsourceSettings): string {
  if (item.execution_type !== "outsourced") return "";
  return item.outsource_organization_id || settings.default_organization_id;
}

// ---- 外注の管(提出待ち・結果未着の一覧) ----

/**
 * 外注の管の状況。
 * unissued … ラベル未発行(管の台帳がまだ無く、提出を記録できない)
 * waiting  … 提出待ち(発行済みで、まだ提出していない)
 * pending  … 結果未着(提出したが、その管の結果がまだ確定していない)
 * reported … 結果済(その管を参照する結果の項目が確定している)
 */
export type LabOutsourceTubeStatus = "unissued" | "waiting" | "pending" | "reported";

export const LAB_OUTSOURCE_TUBE_STATUS_OPTIONS: { code: LabOutsourceTubeStatus; display: string }[] = [
  { code: "waiting", display: "提出待ち" },
  { code: "pending", display: "結果未着" },
  { code: "reported", display: "結果済" },
  { code: "unissued", display: "ラベル未発行" },
];

/** 管の元になる行(api/queries の LabWorklistRow と同じ形)。 */
interface OutsourceSourceRow {
  order: fhir4.ServiceRequest;
  itemRequests: fhir4.ServiceRequest[];
  task?: fhir4.Task;
  specimens: fhir4.Specimen[];
  /** オーダーの検査結果の項目。 */
  observations: fhir4.Observation[];
}

/** 外注に出す管 1 本(オーダーの検体グループ 1 つ)。 */
export interface LabOutsourceTube<R extends OutsourceSourceRow = OutsourceSourceRow> {
  key: string;
  row: R;
  group: LabSpecimenGroup;
  /** 発行済みの管。未発行なら無い。 */
  specimen?: fhir4.Specimen;
  status: LabOutsourceTubeStatus;
  /** 提出した日時。提出していなければ空。 */
  shippedAt: string;
}

// 確定した報告(中間報告・登録中は含めない)。
const FINAL_REPORT_STATUSES = ["final", "amended", "corrected", "appended"];

/**
 * オーダーの行を外注の管に展開する。中止のオーダーは出さない。
 *
 * 結果が着いたかは管ごとに見る。結果の項目は自分の検体(管の Specimen)を参照するので、
 * その管を参照する確定した項目があれば結果済。院内の項目だけ先に確定しても、外注の管は
 * 結果未着に残る。外注先が一部の項目だけ先に返したときも、1 項目でも着けば結果済になる。
 */
export function labOutsourceTubes<R extends OutsourceSourceRow>(rows: R[]): LabOutsourceTube<R>[] {
  return rows.flatMap((row) => {
    if (labTaskStatus(row.task) === "cancelled") return [];
    const reportedSpecimenIds = new Set(
      row.observations
        .filter((observation) => FINAL_REPORT_STATUSES.includes(observation.status))
        .flatMap((observation) => observation.specimen?.reference?.split("/").pop() ?? []),
    );

    return groupBySpecimen(labOrderItems(row.order, row.itemRequests))
      .filter((group) => group.outsourceOrganizationId)
      .map((group) => {
        const specimen = tubeOfGroup(row.specimens, group);
        const shippedAt = specimen ? specimenShippedAt(specimen) : "";
        const reported = Boolean(specimen?.id && reportedSpecimenIds.has(specimen.id));
        const status: LabOutsourceTubeStatus = reported
          ? "reported"
          : !specimen
            ? "unissued"
            : shippedAt
              ? "pending"
              : "waiting";
        return { key: `${row.order.id}|${group.key}`, row, group, specimen, status, shippedAt };
      });
  });
}

/** 管に入る検査項目の並び(「TSH・末梢血液一般検査（WBC, RBC）」)。 */
export function labOutsourceTubeItemsLabel(tube: LabOutsourceTube): string {
  return tube.group.entries
    .map((entry) =>
      entry.members.length > 0
        ? `${entry.item.name}（${memberSummary(entry.members)}）`
        : entry.item.name,
    )
    .join("・");
}
