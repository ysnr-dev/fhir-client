import { type PharmacistInterventionType, pharmacistInterventionTypeClient } from "../masterClient";
import { simpleMasterHooks } from "./radiotherapy";

// ---- 処方監査の介入種別マスタ ----

export const pharmacistInterventionTypeHooks = simpleMasterHooks<PharmacistInterventionType>(
  "pharmacist_intervention_types",
  pharmacistInterventionTypeClient,
);

/** 監査で選ぶ介入種別(有効な行だけ、表示順)。 */
export function usePharmacistInterventionTypes(): PharmacistInterventionType[] {
  return pharmacistInterventionTypeHooks.useOptions().items;
}
