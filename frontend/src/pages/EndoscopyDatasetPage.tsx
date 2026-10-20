import type { PerformDatasetDetail } from "../api/masterClient";
import { endoscopyDatasetHooks } from "../api/masterQueries";
import { MedicalMaterialSearchModal } from "../components/MedicalMaterialSearchModal";
import { ENDOSCOPY_ROUTE_OPTIONS } from "../fhir/endoscopyResultHelpers";
import { PerformDatasetPage, type PerformDatasetPageConfig } from "./PerformDatasetPage";

// 内視鏡で使う薬剤は造影剤に限らない(鎮静剤・前処置など)ので、全医薬品から選ぶ。
// 器材は施設内の器材マスタを挟まず特定保険医療材料そのものを指す。
const CONFIG: PerformDatasetPageConfig<PerformDatasetDetail> = {
  hooks: endoscopyDatasetHooks,
  itemTerm: "オーダー項目",
  namePlaceholder: "上部内視鏡標準セット など",
  routeOptions: ENDOSCOPY_ROUTE_OPTIONS,
  medicineTitle: "薬剤",
  materialTitle: "特定器材",
  MaterialSearchModal: MedicalMaterialSearchModal,
};

export function EndoscopyDatasetPage() {
  return <PerformDatasetPage config={CONFIG} />;
}
