import { simpleMasterClient, type SimpleMasterRow } from "./radiotherapy";

// ---- 処方監査の介入種別マスタ(docs/rx-verification-design.md §4.1) ----

export type PharmacistInterventionType = SimpleMasterRow;

export const pharmacistInterventionTypeClient = simpleMasterClient<PharmacistInterventionType>(
  "/master/pharmacist_intervention_types",
);
