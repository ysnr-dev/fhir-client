import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LOT_RECORD_ORDER_TYPES,
  lotRecordRows,
  medicineCodeOf,
  type LotRecordRow,
} from "../../fhir/lotManagementHelpers";
import { lotNumberOf, normalizeLotNumber, withLotNumber } from "../../fhir/lotNumberHelpers";
import { ORDER_TYPE_SYSTEM } from "../../fhir/orderHeader";
import { resourcesOfType, versionEtag } from "../../fhir/shared";
import { lookupMedicineAttributes } from "../masterClient";
import { updateResource } from "../fhirClient";
import { searchAllPages, type PagedItems } from "./core";

// ロット管理(docs/lot-number-design.md)。ロットからの逆引きは上流の
// MedicationAdministration?lot-number(薬剤と輸血の製剤番号の両方の拡張を索引)で引く。

const LOT_MANAGEMENT_KEY = "lot-management";
const LOT_PAGE = 500;
const LOT_MAX_PAGES = 4;

async function fetchLotRecords(lotNumber: string, exact: boolean): Promise<PagedItems<LotRecordRow>> {
  const params = new URLSearchParams();
  params.set(exact ? "lot-number:exact" : "lot-number", lotNumber);
  params.append("_include", "MedicationAdministration:subject");
  params.append("_include", "MedicationAdministration:part-of");
  const { matches, bundles, truncated } = await searchAllPages<fhir4.MedicationAdministration>(
    "MedicationAdministration",
    params,
    { page: LOT_PAGE, maxPages: LOT_MAX_PAGES },
  );
  return { items: lotRecordRows(matches, bundles), truncated };
}

/** ロット番号(前方一致、exact で完全一致)で投与と患者を引く。 */
export function useLotRecordSearch(lotNumber: string, exact: boolean) {
  const lot = normalizeLotNumber(lotNumber);
  return useQuery({
    queryKey: [LOT_MANAGEMENT_KEY, "search", lot, exact],
    queryFn: () => fetchLotRecords(lot, exact),
    enabled: lot.length > 0,
    placeholderData: keepPreviousData,
  });
}

/**
 * 期間内の実施記録(注射・処置・手術・内視鏡・放射線)に伴う投与のうち、ロット管理の薬で
 * ロットが入っていないもの。どの薬がロット管理かは backend の薬剤付加情報が決めるので、
 * 投与を読んでから薬剤付加情報に照会して絞る。
 */
async function fetchMissingLotRecords(from: string, to: string): Promise<PagedItems<LotRecordRow>> {
  const params = new URLSearchParams();
  params.set("category", LOT_RECORD_ORDER_TYPES.map((type) => `${ORDER_TYPE_SYSTEM}|${type.code}`).join(","));
  params.append("date", `ge${from}`);
  params.append("date", `le${to}`);
  params.set("part-of:missing", "true");
  params.set("status:not", "entered-in-error,not-done");
  params.append("_revinclude", "MedicationAdministration:part-of");
  params.append("_include", "Procedure:subject");
  const { bundles, truncated } = await searchAllPages<fhir4.Procedure>("Procedure", params, {
    page: LOT_PAGE,
    maxPages: LOT_MAX_PAGES,
  });
  const administrations = bundles
    .flatMap((bundle) => resourcesOfType<fhir4.MedicationAdministration>(bundle, "MedicationAdministration"))
    .filter((administration) => !lotNumberOf(administration));
  const flags = await lookupMedicineAttributes(administrations.map(medicineCodeOf));
  const missing = administrations.filter((a) => flags.get(medicineCodeOf(a))?.lot_required);
  return { items: lotRecordRows(missing, bundles), truncated };
}

export function useMissingLotRecords(from: string, to: string) {
  return useQuery({
    queryKey: [LOT_MANAGEMENT_KEY, "missing", from, to],
    queryFn: () => fetchMissingLotRecords(from, to),
    enabled: Boolean(from && to),
    placeholderData: keepPreviousData,
  });
}

/**
 * 実施後のロット入力。実施記録には編集が無いので、これが投与記録の唯一の書き換えになる。
 * 読んだ版に拡張だけを足して PUT する(版違いは 412)。
 */
export function useRegisterLotNumber() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      administration,
      lotNumber,
    }: {
      administration: fhir4.MedicationAdministration;
      lotNumber: string;
    }) => {
      const etag = versionEtag(administration);
      if (!etag) throw new Error("投与記録の版が分かりません。一覧を読み直してください。");
      return updateResource(withLotNumber(administration, lotNumber), etag);
    },
    retry: false,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [LOT_MANAGEMENT_KEY] });
      queryClient.invalidateQueries({ queryKey: ["Procedure", "search"] });
    },
  });
}
