import type { LineDrainType } from "../api/masterClient";
import { lineDrainTypeHooks } from "../api/masterQueries";
import { LINE_DRAIN_KIND_OPTIONS } from "../fhir/lineDrainHelpers";
import { SimpleMasterPage } from "./RadiotherapyMasterPages";

// 留置物(ライン・ドレーン・カテーテル)の種別マスタ(docs/line-drain-design.md §3)。区分は集計の系統、
// 警告日数は留置日数を赤く出す既定値。

export function LineDrainTypePage() {
  return (
    <SimpleMasterPage<LineDrainType>
      title="留置物種別マスタ"
      itemLabel="種別"
      hooks={lineDrainTypeHooks}
      defaults={{ kind: "other", warn_days: null }}
      fields={[
        { key: "kind", label: "区分", type: "select", options: LINE_DRAIN_KIND_OPTIONS, column: true, compact: true },
        { key: "warn_days", label: "警告日数", type: "text", column: true, compact: true },
      ]}
    />
  );
}
