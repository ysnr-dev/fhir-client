import { useQuery } from "@tanstack/react-query";
import { fetchMedicinesByCodes } from "../api/masterClient";
import { fetchMedicationOrdersSince } from "../api/queries";
import { isAntimicrobialYakko } from "../fhir/antimicrobialHelpers";
import { MEDICINE_CODE_SYSTEM, codingBySystem } from "../fhir/prescriptionHelpers";
import { addDays, localDay } from "../lib/dates";

// 細菌検査オーダーの前投与抗菌薬「処方取込」の候補。
//
// 患者の処方・注射(ServiceRequest + MedicationRequest)を期間で絞って新しい順に取り、
// 薬剤のレセ電算コードで医薬品マスタを引いて、薬効分類が抗菌薬(61x=抗生物質製剤・
// 622=抗結核剤・624=合成抗菌剤)のものだけを候補にする。
//
// 「現在投与中」の厳密判定はしない(MedicationRequest.status は常に active で
// 登録されるため判定できない)。期間内のオーダーの日付から投与期間を出す割り切り
// (docs/micro-order-design.md §7.2)。

// 読む処方・注射オーダーの上限。超えたら一覧に欠けがあることを出す。
const ORDER_LIMIT = 100;

export interface AntimicrobialSuggestion {
  /** 薬剤のレセ電算コード。同じ薬剤は 1 行にまとめる。 */
  code: string;
  /** 薬品名。 */
  name: string;
  kind: "prescription" | "injection";
  /** 期間内で最初のオーダー日(YYYY-MM-DD)。 */
  start: string;
  /** 投与の終わり(内服は日数ぶん進めた日、注射は最後のオーダー日)。 */
  end: string;
  /** 投与期間の表示(「2026/08/05〜2026/08/11」。1 日だけなら日付だけ)。 */
  period: string;
  /** テキスト欄へ挿入する 1 行(「セファゾリン注 1g（2026/08/05〜2026/08/11）」)。 */
  label: string;
}

function slashDay(day: string): string {
  return day.replaceAll("-", "/");
}

function periodLabel(start: string, end: string): string {
  if (!start) return "";
  return end && end !== start ? `${slashDay(start)}〜${slashDay(end)}` : slashDay(start);
}

async function fetchSuggestions(
  patientId: string,
  since: string,
): Promise<{ suggestions: AntimicrobialSuggestion[]; truncated: boolean }> {
  const { medicationRequests, truncated } = await fetchMedicationOrdersSince(
    patientId,
    since,
    ORDER_LIMIT,
  );
  if (medicationRequests.length === 0) return { suggestions: [], truncated };

  // 薬効分類は FHIR リソースに載っていないので、レセ電算コードで医薬品マスタを引く。
  const codes = Array.from(
    new Set(
      medicationRequests
        .map(({ request }) => codingBySystem(request.medicationCodeableConcept?.coding, MEDICINE_CODE_SYSTEM)?.code)
        .filter((code): code is string => Boolean(code)),
    ),
  );
  if (codes.length === 0) return { suggestions: [], truncated };

  const medicines = await fetchMedicinesByCodes(codes);
  const antimicrobialCodes = new Set(
    medicines.items
      .filter((medicine) => isAntimicrobialYakko(medicine.yakko_code))
      .map((medicine) => medicine.medicine_code),
  );

  // 同じ薬剤が繰り返し出ていたら 1 行にまとめ、最初のオーダー日から投与の終わりまでを期間にする。
  const byCode = new Map<string, Omit<AntimicrobialSuggestion, "period" | "label">>();
  for (const { request, kind } of medicationRequests) {
    const code = codingBySystem(request.medicationCodeableConcept?.coding, MEDICINE_CODE_SYSTEM)?.code;
    if (!code || !antimicrobialCodes.has(code)) continue;
    const name =
      request.medicationCodeableConcept?.text ??
      request.medicationCodeableConcept?.coding?.[0]?.display ??
      "";
    if (!name) continue;

    const day = localDay(request.authoredOn);
    const duration = request.dispenseRequest?.expectedSupplyDuration;
    const doseDays = duration?.code === "d" && duration.value ? duration.value : 0;
    const end = day && doseDays > 1 ? addDays(day, doseDays - 1) : day;
    const current = byCode.get(code);
    if (!current) {
      byCode.set(code, { code, name, kind, start: day, end });
      continue;
    }
    if (day && (!current.start || day < current.start)) current.start = day;
    if (end > current.end) current.end = end;
  }
  const suggestions = Array.from(byCode.values())
    .sort((a, b) => b.end.localeCompare(a.end))
    .map((s) => {
      const period = periodLabel(s.start, s.end);
      return { ...s, period, label: period ? `${s.name}（${period}）` : s.name };
    });
  return { suggestions, truncated };
}

export function useAntimicrobialSuggestions(patientId: string, since: string, enabled: boolean) {
  return useQuery({
    queryKey: ["ServiceRequest", "antimicrobial-suggestions", patientId, since],
    queryFn: () => fetchSuggestions(patientId, since),
    enabled: enabled && Boolean(patientId),
  });
}
