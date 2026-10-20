import type { RadDatasetDetail } from "../api/masterClient";
import { radDatasetHooks } from "../api/masterQueries";
import { RadMaterialSearchModal } from "../components/RadMaterialSearchModal";
import { RAD_ROUTE_OPTIONS } from "../fhir/radResultHelpers";
import { PerformDatasetPage, type PerformDatasetPageConfig } from "./PerformDatasetPage";

// 器材は施設内の器材マスタから選ぶが、算定はレセ電算の特定器材コードで行うので併記する。
const CONFIG: PerformDatasetPageConfig<RadDatasetDetail> = {
  hooks: radDatasetHooks,
  itemTerm: "撮影項目",
  namePlaceholder: "造影CT標準セット など",
  routeOptions: RAD_ROUTE_OPTIONS,
  medicineTitle: "造影剤",
  contrastMedium: true,
  materialTitle: "放射線器材",
  MaterialSearchModal: RadMaterialSearchModal,
  receiptCodeOf: (detail) => detail.receipt_material_code,
};

export function RadDatasetPage() {
  return <PerformDatasetPage config={CONFIG} />;
}
