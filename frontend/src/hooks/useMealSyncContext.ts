import { useCallback, useMemo } from "react";
import { fetchFastingDiet, useFastingDiet } from "../api/masterQueries";
import {
  fetchPatientMealOrders,
  useBedWardIndex,
  useMealSchedule,
  usePatientMealOrders,
} from "../api/queries";
import { encounterBedId, encounterPatientId } from "../fhir/encounterHelpers";
import type { MealSyncContext } from "../fhir/mealEncounterSync";
import { withOrderWard } from "../fhir/prescriptionHelpers";
import { useOrderContext } from "./useOrderContext";

// 入退院・外出泊の画面が食事オーダーの連動(fhir/mealEncounterSync)に渡す材料を揃える。
// 患者の有効な食事オーダー・施設の食事提供時刻・食止めの食種・登録者(依頼科 + 入院病棟)。

/** モーダル用。開いた Encounter について読み込み、プレビューにも使える。 */
export function useMealSyncContext(encounter: fhir4.Encounter) {
  const patientId = encounterPatientId(encounter) ?? "";
  const orders = usePatientMealOrders(patientId || undefined);
  const schedule = useMealSchedule();
  const requester = useOrderContext();
  const { bedWards } = useBedWardIndex();
  const diets = useFastingDiet();

  const bedId = encounterBedId(encounter);
  const ward = bedId ? bedWards.get(bedId) : undefined;

  const ctx = useMemo<MealSyncContext>(
    () => ({
      orders: orders.data ?? [],
      patientId,
      encounterId: encounter.id ?? "",
      schedule,
      requester: withOrderWard(requester, "inpatient", ward ?? { wardId: "", wardName: "" }),
      fastingDiet: diets.fastingDiet,
    }),
    [orders.data, patientId, encounter.id, schedule, requester, ward, diets.fastingDiet],
  );

  return {
    ctx,
    ready: !orders.isPending && !diets.isPending,
    error: orders.error ?? diets.error,
  };
}

/**
 * 一覧の行メニュー用。行ごとに問い合わせを張らず、押されたときに読み込む。
 * 返す関数は Encounter を受けて MealSyncContext を返す。
 */
export function useMealSyncContextLoader() {
  const schedule = useMealSchedule();
  const requester = useOrderContext();
  const { bedWards } = useBedWardIndex();

  return useCallback(
    async (encounter: fhir4.Encounter): Promise<MealSyncContext> => {
      const patientId = encounterPatientId(encounter) ?? "";
      const [orders, fastingDiet] = await Promise.all([
        patientId ? fetchPatientMealOrders(patientId) : Promise.resolve([]),
        fetchFastingDiet(),
      ]);
      const bedId = encounterBedId(encounter);
      const ward = bedId ? bedWards.get(bedId) : undefined;
      return {
        orders,
        patientId,
        encounterId: encounter.id ?? "",
        schedule,
        requester: withOrderWard(requester, "inpatient", ward ?? { wardId: "", wardName: "" }),
        fastingDiet,
      };
    },
    [schedule, requester, bedWards],
  );
}
