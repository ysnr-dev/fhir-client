import { physioMasterClient } from "../masterClient";
import { examMasterHooks, examTypeNameOf } from "./examMaster";

// ---- 生理検査オーダーのマスタ ----
//
// hook の中身は examMaster.ts を参照。

const hooks = examMasterHooks("physio", physioMasterClient);

export const usePhysioExamTypeSearch = hooks.useExamTypeSearch;
export const usePhysioExamTypeOptions = hooks.useExamTypeOptions;
export const usePhysioExamTypeMutations = hooks.useExamTypeMutations;
export const usePhysioItemSearch = hooks.useItemSearch;
export const usePhysioItem = hooks.useItem;
export const usePhysioItemMutations = hooks.useItemMutations;
export const usePhysioSetItemMutations = hooks.useSetItemMutations;
export const usePhysioItemsByCodes = hooks.useItemsByCodes;
export const usePhysioSetMembers = hooks.useSetMembers;
export const physioItemLayoutHooks = hooks.itemLayoutHooks;
export const physioDatasetHooks = hooks.datasetHooks;
export const physioExamTypeName = examTypeNameOf;
