import type { PerformDatasetDetail } from "../api/masterClient";
import { treatmentDatasetHooks } from "../api/masterQueries";
import { MedicalMaterialSearchModal } from "../components/MedicalMaterialSearchModal";
import { TREATMENT_ROUTE_OPTIONS } from "../fhir/treatmentResultHelpers";
import { PerformDatasetPage, type PerformDatasetPageConfig } from "./PerformDatasetPage";

// 処置で使う薬剤は造影剤に限らない(局所麻酔・消毒・外用薬など)ので、全医薬品から選ぶ。
// 器材は施設内の器材マスタを挟まず特定保険医療材料そのものを指す。
const CONFIG: PerformDatasetPageConfig<PerformDatasetDetail> = {
  hooks: treatmentDatasetHooks,
  itemTerm: "処置項目",
  namePlaceholder: "創傷処置標準セット など",
  routeOptions: TREATMENT_ROUTE_OPTIONS,
  medicineTitle: "薬剤",
  materialTitle: "特定器材",
  MaterialSearchModal: MedicalMaterialSearchModal,
  procedureSection: "J",
};

export function TreatmentDatasetPage() {
  return <PerformDatasetPage config={CONFIG} />;
}
