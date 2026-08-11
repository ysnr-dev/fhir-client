import { useQuery } from "@tanstack/react-query";
import { searchResource } from "../api/fhirClient";
import { fetchMedicinesByCodes } from "../api/masterClient";
import { MEDICINE_CODE_SYSTEM, codingBySystem } from "../fhir/prescriptionHelpers";

// 細菌検査オーダーの前投与抗菌薬「処方から取り込み」の候補。
//
// 患者の処方・注射(ServiceRequest + MedicationRequest)を新しい順に取り、薬剤の
// レセ電算コードで医薬品マスタを引いて、薬効分類が抗菌薬(61x=抗生物質製剤・
// 622=抗結核剤・624=合成抗菌剤)のものだけを候補にする。
//
// 「現在投与中」の厳密判定はしない(MedicationRequest.status は常に active で
// 登録されるため判定できない)。直近のオーダーから新しい順に出す割り切り
// (docs/micro-order-design.md §7.2)。

// 抗菌薬とみなす薬効分類(4桁)の先頭一致。
const ANTIMICROBIAL_YAKKO_PREFIXES = ["61", "622", "624"];
// 遡る処方・注射オーダーの数。1 オーダーに複数薬剤が入るので候補としては十分。
const RECENT_ORDER_COUNT = 20;

export interface AntimicrobialSuggestion {
  /** 薬品名。 */
  name: string;
  /** オーダー日(YYYY-MM-DD)。 */
  authoredDate: string;
  /** 内服の日数。無ければ null(注射・外用・頓服)。 */
  doseDays: number | null;
  /** テキスト欄へ挿入する 1 行(「セファゾリン注 1g（2026-08-05〜 7日分）」)。 */
  label: string;
}

function suggestionLabel(name: string, authoredDate: string, doseDays: number | null): string {
  const period = [authoredDate ? `${authoredDate}〜` : "", doseDays ? `${doseDays}日分` : ""]
    .filter(Boolean)
    .join(" ");
  return period ? `${name}（${period}）` : name;
}

async function fetchSuggestions(patientId: string): Promise<AntimicrobialSuggestion[]> {
  // 処方・注射のヘッダと薬剤を新しい順に取る(タイムラインと同じ検索の縮小版)。
  const params = new URLSearchParams();
  params.set("patient", `Patient/${patientId}`);
  params.set("based-on:missing", "true");
  params.set("_sort", "-authoredon");
  params.set("_count", String(RECENT_ORDER_COUNT));
  params.set("_revinclude", "MedicationRequest:based-on");
  const { data: bundle } = await searchResource<fhir4.Resource>("ServiceRequest", params);

  const medicationRequests = (bundle.entry ?? [])
    .map((entry) => entry.resource)
    .filter(
      (resource): resource is fhir4.MedicationRequest =>
        resource?.resourceType === "MedicationRequest",
    );
  if (medicationRequests.length === 0) return [];

  // 薬効分類は FHIR リソースに載っていないので、レセ電算コードで医薬品マスタを引く。
  const codes = Array.from(
    new Set(
      medicationRequests
        .map((mr) => codingBySystem(mr.medicationCodeableConcept?.coding, MEDICINE_CODE_SYSTEM)?.code)
        .filter((code): code is string => Boolean(code)),
    ),
  );
  if (codes.length === 0) return [];

  const medicines = await fetchMedicinesByCodes(codes);
  const antimicrobialCodes = new Set(
    medicines.items
      .filter((medicine) =>
        ANTIMICROBIAL_YAKKO_PREFIXES.some((prefix) => medicine.yakko_code?.startsWith(prefix)),
      )
      .map((medicine) => medicine.medicine_code),
  );

  // 同じ薬剤が繰り返し処方されていたら最新の 1 件だけを出す(新しい順に走査)。
  const seen = new Set<string>();
  const suggestions: AntimicrobialSuggestion[] = [];
  for (const mr of medicationRequests) {
    const code = codingBySystem(mr.medicationCodeableConcept?.coding, MEDICINE_CODE_SYSTEM)?.code;
    if (!code || !antimicrobialCodes.has(code) || seen.has(code)) continue;
    seen.add(code);

    const name =
      mr.medicationCodeableConcept?.text ??
      mr.medicationCodeableConcept?.coding?.[0]?.display ??
      "";
    if (!name) continue;

    const authoredDate = mr.authoredOn?.slice(0, 10) ?? "";
    const duration = mr.dispenseRequest?.expectedSupplyDuration;
    const doseDays = duration?.code === "d" && duration.value != null ? duration.value : null;
    suggestions.push({
      name,
      authoredDate,
      doseDays,
      label: suggestionLabel(name, authoredDate, doseDays),
    });
  }
  return suggestions;
}

export function useAntimicrobialSuggestions(patientId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["ServiceRequest", "antimicrobial-suggestions", patientId],
    queryFn: () => fetchSuggestions(patientId),
    enabled: enabled && Boolean(patientId),
  });
}
