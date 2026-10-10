import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { acuityRecordCodes, NURSING_ACUITY_FORMS, NURSING_ACUITY_SYSTEM } from "../../fhir/nursingAcuityHelpers";
import { PRESCRIPTION_ORDER_TYPE } from "../../fhir/prescriptionHelpers";
import { ORDER_TYPE_SYSTEM } from "../../fhir/orderHeader";
import { addDays } from "../../lib/dates";
import { postBundle } from "../fhirClient";
import { searchNursingAcuityCodes, type NursingAcuityCode } from "../masterClient";
import { ORAL_LOOKBACK_DAYS, resourcesOfType, searchAllPages } from "./core";

// ---- 重症度、医療・看護必要度(docs/nursing-acuity-design.md) ----

const ACUITY_KEY = ["Observation", "nursing-acuity"];
// 1 回の検索に載せる患者数(1 か月 × 40 人 = 1,240 件が _count 500 × 4 ページに収まる幅)。
const PATIENT_CHUNK = 40;

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

/** 患者の期間 [from, to] の評価(どの版の評価票でも)。 */
export function useAcuityObservations(patientIds: string[], from: string, to: string) {
  const ids = [...new Set(patientIds.filter(Boolean))].sort();
  return useQuery({
    queryKey: [...ACUITY_KEY, ids.join(","), from, to],
    queryFn: async () => {
      const results = await Promise.all(
        chunks(ids, PATIENT_CHUNK).map((chunk) => {
          const params = new URLSearchParams();
          params.set("code", NURSING_ACUITY_FORMS.map((form) => `${NURSING_ACUITY_SYSTEM}|${form.code}`).join(","));
          params.set("patient", chunk.map((id) => `Patient/${id}`).join(","));
          params.append("date", `ge${from}`);
          params.append("date", `le${to}`);
          return searchAllPages<fhir4.Observation>("Observation", params, { page: 500, maxPages: 4 });
        }),
      );
      return {
        observations: results.flatMap((result) => result.matches),
        truncated: results.some((result) => result.truncated),
      };
    },
    enabled: ids.length > 0 && Boolean(from) && Boolean(to),
    placeholderData: keepPreviousData,
  });
}

/** 評価の初期値(記録から推す項目)に使う実施記録と、そのコードに当たる別表1・別表2 の行。 */
export interface AcuityRecords {
  /** 実施記録(注射・輸血・放射線治療・手術・処置・内視鏡・生理・放射線)。11 日ぶん。 */
  procedures: fhir4.Procedure[];
  administrations: fhir4.MedicationAdministration[];
  /** 処方(内服・外用の「管理」に使う)。その日にかかりうる 92 日ぶん。 */
  prescriptions: fhir4.ServiceRequest[];
  prescriptionItems: fhir4.MedicationRequest[];
  /** 記録に出てきたコードのうち別表1・別表2 に当たる行。 */
  acuityCodes: NursingAcuityCode[];
  truncated: boolean;
}

// 実施記録を引く種別。C 項目(手術・検査)と A 項目(処置・注射・輸血・放射線治療)のコードを持つもの。
const RECORD_CATEGORIES = ["injection", "transfusion", "radiotherapy", "surgery", "treatment", "endoscopy", "physio", "rad"];

/**
 * 患者(複数)の、評価日までの実施記録と処方。C 項目の日数(最長 11 日)ぶん遡って引き、
 * 実施記録・処方に出てきたレセプト電算コードを別表1・別表2 に問い合わせる。
 */
async function fetchAcuityRecords(patientIds: string[], date: string): Promise<AcuityRecords> {
  const paging = { page: 500, maxPages: 4 };
  const results = await Promise.all(
    chunks(patientIds, PATIENT_CHUNK).map(async (chunk) => {
      const patients = chunk.map((id) => `Patient/${id}`).join(",");
      const procedureParams = new URLSearchParams();
      procedureParams.set("patient", patients);
      procedureParams.set("category", RECORD_CATEGORIES.map((code) => `${ORDER_TYPE_SYSTEM}|${code}`).join(","));
      procedureParams.append("date", `ge${addDays(date, -10)}`);
      procedureParams.append("date", `le${date}`);
      procedureParams.set("_revinclude", "MedicationAdministration:part-of");
      const prescriptionParams = new URLSearchParams();
      prescriptionParams.set("patient", patients);
      prescriptionParams.set("category", `${ORDER_TYPE_SYSTEM}|${PRESCRIPTION_ORDER_TYPE.code}`);
      prescriptionParams.append("occurrence", `ge${addDays(date, -ORAL_LOOKBACK_DAYS)}`);
      prescriptionParams.append("occurrence", `le${date}`);
      prescriptionParams.set("status:not", "revoked,entered-in-error");
      prescriptionParams.set("_revinclude", "MedicationRequest:based-on");
      const [procedures, prescriptions] = await Promise.all([
        searchAllPages<fhir4.Procedure>("Procedure", procedureParams, paging),
        searchAllPages<fhir4.ServiceRequest>("ServiceRequest", prescriptionParams, paging),
      ]);
      return { procedures, prescriptions };
    }),
  );
  const of = <T extends fhir4.Resource>(bundles: fhir4.Bundle[], type: T["resourceType"]) =>
    bundles.flatMap((bundle) => resourcesOfType<T>(bundle, type));
  const procedures = results.flatMap((r) => r.procedures.matches);
  const administrations = results.flatMap((r) => of<fhir4.MedicationAdministration>(r.procedures.bundles, "MedicationAdministration"));
  const prescriptions = results.flatMap((r) => r.prescriptions.matches);
  const prescriptionItems = results.flatMap((r) => of<fhir4.MedicationRequest>(r.prescriptions.bundles, "MedicationRequest"));
  const acuityCodes = await searchNursingAcuityCodes(
    acuityRecordCodes({ procedures, administrations, prescriptionItems }),
  );
  return {
    procedures,
    administrations,
    prescriptions,
    prescriptionItems,
    acuityCodes,
    truncated: results.some((r) => r.procedures.truncated || r.prescriptions.truncated),
  };
}

/** 1 人ずつの評価(モーダル)の初期値に使う実施記録。 */
export function useAcuityRecords(patientId: string | undefined, date: string) {
  return useQuery({
    queryKey: ["Procedure", "nursing-acuity-records", patientId ?? "", date],
    queryFn: () => fetchAcuityRecords([patientId ?? ""], date),
    enabled: Boolean(patientId) && Boolean(date),
  });
}

function acuityEntry(observation: fhir4.Observation): fhir4.BundleEntry {
  return observation.id
    ? {
        fullUrl: `Observation/${observation.id}`,
        resource: observation,
        request: { method: "PUT", url: `Observation/${observation.id}` },
      }
    : {
        fullUrl: `urn:uuid:${crypto.randomUUID()}`,
        resource: observation,
        request: { method: "POST", url: "Observation" },
      };
}

/**
 * 評価の登録・更新(1 件でも、一括入力の複数件でも 1 つの transaction)。既存(id あり)は版を添えて
 * PUT する(postBundle が meta.versionId を If-Match にする)。
 */
export function useSaveAcuity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (observations: fhir4.Observation | fhir4.Observation[]) =>
      postBundle({
        resourceType: "Bundle",
        type: "transaction",
        entry: (Array.isArray(observations) ? observations : [observations]).map(acuityEntry),
      }),
    retry: false,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ACUITY_KEY }),
  });
}

/** 評価のグリッドの初期値に使う、病棟の患者ぶんの実施記録(useAcuityRecords を患者をまとめて引く形)。 */
export function useAcuityRecordsForPatients(patientIds: string[], date: string) {
  const ids = [...new Set(patientIds.filter(Boolean))].sort();
  return useQuery({
    queryKey: ["Procedure", "nursing-acuity-records-ward", ids.join(","), date],
    queryFn: () => fetchAcuityRecords(ids, date),
    enabled: ids.length > 0 && Boolean(date),
  });
}
