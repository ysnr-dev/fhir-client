import { simpleMasterClient, type SimpleMasterRow } from "./radiotherapy";

// ---- 留置物種別マスタ(docs/line-drain-design.md §3) ----

/** 集計の系統。中心静脈・尿路・気道がデバイス日数の分母になる。 */
export const LINE_DRAIN_KINDS = [
  "vascular-central",
  "vascular-peripheral",
  "arterial",
  "urinary",
  "airway",
  "gi",
  "drain",
  "other",
] as const;
export type LineDrainKind = (typeof LINE_DRAIN_KINDS)[number];

export interface LineDrainType extends SimpleMasterRow {
  kind: LineDrainKind;
  /** 留置日数をこの日数を超えたら赤く出す。無ければ出さない。 */
  warn_days: number | null;
}

export const lineDrainTypeClient = simpleMasterClient<LineDrainType>("/master/line_drain_types");
