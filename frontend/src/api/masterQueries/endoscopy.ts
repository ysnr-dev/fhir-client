import { endoscopyMasterClient } from "../masterClient";
import { examMasterHooks, examTypeNameOf } from "./examMaster";

// ---- 内視鏡オーダーのマスタ ----
//
// hook の中身は examMaster.ts を参照。

const hooks = examMasterHooks("endoscopy", endoscopyMasterClient);

export const useEndoscopyExamTypeSearch = hooks.useExamTypeSearch;
export const useEndoscopyExamTypeOptions = hooks.useExamTypeOptions;
export const useEndoscopyExamTypeMutations = hooks.useExamTypeMutations;
export const useEndoscopyItemSearch = hooks.useItemSearch;
export const useEndoscopyItem = hooks.useItem;
export const useEndoscopyItemMutations = hooks.useItemMutations;
export const useEndoscopySetItemMutations = hooks.useSetItemMutations;
export const useEndoscopyItemsByCodes = hooks.useItemsByCodes;
export const useEndoscopySetMembers = hooks.useSetMembers;
export const endoscopyItemLayoutHooks = hooks.itemLayoutHooks;
export const endoscopyDatasetHooks = hooks.datasetHooks;
export const endoscopyExamTypeName = examTypeNameOf;
