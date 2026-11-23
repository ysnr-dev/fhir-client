// 検体検査の外注(docs/lab-outsource-design.md)。
//
// 外注先は連携先の Organization のうち「検査委託先」の印を持つもの(organizationHelpers の
// isClinicalLab)。項目ごとの行き先はオーダー項目マスタの実施区分と外注先で決まり、外注先を
// 決めていない外注項目は施設設定の既定の外注先に出す。

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
