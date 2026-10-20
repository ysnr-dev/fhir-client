import type { PerformDatasetDetail } from "../api/masterClient";
import { physioDatasetHooks } from "../api/masterQueries";
import { MedicalMaterialSearchModal } from "../components/MedicalMaterialSearchModal";
import { PHYSIO_ROUTE_OPTIONS } from "../fhir/physioResultHelpers";
import { PerformDatasetPage, type PerformDatasetPageConfig } from "./PerformDatasetPage";

// 生理検査で使う薬剤は造影剤に限らない(負荷心電図の薬剤負荷など)ので、全医薬品から選ぶ。
// 器材は施設内の器材マスタを挟まず特定保険医療材料そのものを指す。
const CONFIG: PerformDatasetPageConfig<PerformDatasetDetail> = {
  hooks: physioDatasetHooks,
  itemTerm: "検査項目",
  namePlaceholder: "負荷心電図標準セット など",
  routeOptions: PHYSIO_ROUTE_OPTIONS,
  medicineTitle: "薬剤",
  materialTitle: "特定器材",
  MaterialSearchModal: MedicalMaterialSearchModal,
};

export function PhysioDatasetPage() {
  return <PerformDatasetPage config={CONFIG} />;
}
