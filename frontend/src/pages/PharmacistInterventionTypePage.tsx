import type { PharmacistInterventionType } from "../api/masterClient";
import { pharmacistInterventionTypeHooks } from "../api/masterQueries";
import { SimpleMasterPage } from "./RadiotherapyMasterPages";

// 処方監査で薬剤師が介入したときに選ぶ種別のマスタ(docs/rx-verification-design.md §4.1)。
// コード・名称・表示順・有効だけの単純編集型。

export function PharmacistInterventionTypePage() {
  return (
    <SimpleMasterPage<PharmacistInterventionType>
      title="薬剤師介入種別マスタ"
      itemLabel="介入種別"
      hooks={pharmacistInterventionTypeHooks}
      defaults={{}}
      fields={[]}
    />
  );
}
