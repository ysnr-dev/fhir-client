import { type LineDrainType, lineDrainTypeClient } from "../masterClient";
import { simpleMasterHooks } from "./radiotherapy";

// ---- ライン・ドレーン種別マスタ ----

export const lineDrainTypeHooks = simpleMasterHooks<LineDrainType>("line_drain_types", lineDrainTypeClient);

/** 登録フォームと一覧が使う種別(有効な行だけ、表示順)。 */
export function useLineDrainTypes(): LineDrainType[] {
  return lineDrainTypeHooks.useOptions().items;
}
