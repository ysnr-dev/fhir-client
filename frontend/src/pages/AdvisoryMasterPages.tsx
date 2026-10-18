import type { AdvisoryOverrideReason } from "../api/masterClient";
import { advisoryOverrideReasonHooks } from "../api/masterQueries";
import { SimpleMasterPage } from "./RadiotherapyMasterPages";

// 警告(判断支援)を無視して登録するときに選ぶ理由のマスタ(docs/advisory-design.md §3.1)。
// コード・名称・表示順・有効だけの単純編集型。

export function AdvisoryOverrideReasonPage() {
  return (
    <SimpleMasterPage<AdvisoryOverrideReason>
      title="警告の確認理由マスタ"
      itemLabel="理由"
      hooks={advisoryOverrideReasonHooks}
      defaults={{}}
      fields={[]}
    />
  );
}
