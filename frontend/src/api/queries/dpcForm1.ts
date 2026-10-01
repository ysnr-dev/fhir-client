import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HEIGHT_LOINC, WEIGHT_LOINC } from "../../fhir/bodyMeasureHelpers";
import type { DpcForm1Sources, DpcSurgerySource } from "../../fhir/dpcForm1Draft";
import { DPC_FORM1_QUESTIONNAIRE } from "../../fhir/dpcForm1Helpers";
import {
  ADMISSION_CLASS_CODE,
  ADMISSION_STATUS,
  DISCHARGED_STATUS,
} from "../../fhir/encounterHelpers";
import { ORDER_TYPE_SYSTEM } from "../../fhir/prescriptionHelpers";
import { referenceId, transactionBundle } from "../../fhir/shared";
import { resourceFromBundleResponse } from "../../fhir/schemaImage";
import { summarizeSurgeryOrder } from "../../fhir/surgeryOrderHelpers";
import { isSurgeryProcedure } from "../../fhir/surgeryResultHelpers";
import { today } from "../../lib/dates";
import {
  type FhirResult,
  postBundle,
  readResource,
  searchResource,
  updateResource,
} from "../fhirClient";
import { searchMedicalProcedures } from "../masterClient";
import { resourcesOfType } from "./core";

// ---- DPC 様式1 ----

const SURGERY_PROCEDURE_CODE_SYSTEM = "http://fhir-client.local/CodeSystem/surgery-procedure-code";
const SURGERY_KIND = "surgery";

/** その入院の様式1 を引く検索条件(1 入院 1 件)。作成時の重複防止にも同じ条件を使う。 */
function dpcForm1Query(encounterId: string): URLSearchParams {
  const params = new URLSearchParams();
  params.set("questionnaire", DPC_FORM1_QUESTIONNAIRE);
  params.set("encounter", `Encounter/${encounterId}`);
  return params;
}

/** その入院の様式1。あれば登録ではなく編集に切り替える。 */
export function useDpcForm1For(encounterId: string | undefined) {
  return useQuery({
    queryKey: ["QuestionnaireResponse", "search", "dpc-form1", encounterId],
    queryFn: async () => {
      const params = dpcForm1Query(encounterId as string);
      params.set("_count", "5");
      params.set("_sort", "-_lastUpdated");
      const { data: bundle } = await searchResource<fhir4.QuestionnaireResponse>(
        "QuestionnaireResponse",
        params,
      );
      return (
        resourcesOfType<fhir4.QuestionnaireResponse>(bundle, "QuestionnaireResponse")[0] ?? null
      );
    },
    enabled: Boolean(encounterId),
  });
}

export function useDpcForm1(id: string | undefined) {
  return useQuery({
    queryKey: ["QuestionnaireResponse", id],
    queryFn: () => readResource<fhir4.QuestionnaireResponse>("QuestionnaireResponse", id as string),
    enabled: Boolean(id),
  });
}

/**
 * 実施した手術(術式ごと)。手術の実施記録は入院を参照していないので、患者 + 入院期間で引く。
 * 麻酔の手技料(L 章)も同じ形の Procedure で残っているため、点数表コードが K で始まるもの
 * (と、診療行為マスタで引けなかったもの)だけを手術として返す。
 */
async function fetchSurgeries(
  patientId: string,
  start: string,
  end: string,
): Promise<DpcSurgerySource[]> {
  const params = new URLSearchParams();
  params.set("patient", `Patient/${patientId}`);
  params.set("category", `${ORDER_TYPE_SYSTEM}|${SURGERY_KIND}`);
  params.append("date", `ge${start}`);
  params.append("date", `le${end}`);
  params.set("status:not", "entered-in-error,not-done");
  params.set("_count", "100");
  params.append("_include", "Procedure:based-on");
  const { data: bundle } = await searchResource<fhir4.Resource>("Procedure", params);
  const procedures = resourcesOfType<fhir4.Procedure>(bundle, "Procedure").filter(isSurgeryProcedure);
  if (!procedures.length) return [];

  const orders = new Map(
    resourcesOfType<fhir4.ServiceRequest>(bundle, "ServiceRequest").map((sr) => [sr.id, sr]),
  );
  const codeOf = (procedure: fhir4.Procedure) =>
    procedure.code?.coding?.find((c) => c.system === SURGERY_PROCEDURE_CODE_SYSTEM)?.code ?? "";
  const codes = Array.from(new Set(procedures.map(codeOf).filter(Boolean)));
  const master = codes.length
    ? await searchMedicalProcedures({ procedure_code: codes.join(","), per: 100 })
    : { items: [] };
  const kCodes = new Map(master.items.map((item) => [item.procedure_code, item.k_code ?? ""]));

  return procedures
    .map((procedure) => {
      const code = codeOf(procedure);
      const order = orders.get(referenceId(procedure.basedOn?.[0]?.reference));
      return {
        procedureId: procedure.id ?? "",
        date: (procedure.performedPeriod?.start ?? procedure.performedDateTime ?? "").slice(0, 10),
        name: procedure.code?.text ?? procedure.code?.coding?.[0]?.display ?? "",
        kCode: kCodes.get(code) ?? "",
        known: kCodes.has(code),
        // 主たる手術(ハブ)を先に並べる。
        hub: !procedure.partOf?.length,
        anesthesiaMethods: order ? summarizeSurgeryOrder(order).anesthesiaMethods : [],
      };
    })
    .filter((s) => !s.known || s.kCode === "" || s.kCode.startsWith("K"))
    .sort((a, b) => a.date.localeCompare(b.date) || Number(b.hub) - Number(a.hub))
    .map(({ known: _known, hub: _hub, ...surgery }) => surgery);
}

async function fetchObservations(patientId: string, codes: string[]): Promise<fhir4.Observation[]> {
  const params = new URLSearchParams();
  params.set("patient", `Patient/${patientId}`);
  params.set("code", codes.map((code) => `http://loinc.org|${code}`).join(","));
  params.set("_count", "100");
  params.set("_sort", "-date");
  const { data: bundle } = await searchResource<fhir4.Observation>("Observation", params);
  return resourcesOfType<fhir4.Observation>(bundle, "Observation");
}

/**
 * 様式1 の初期値に使う情報。入院期間のものは患者 + 期間で引く(入院中は今日まで)。
 * institutionNumber は自院の保険医療機関番号。
 */
export function useDpcForm1Sources(
  patientId: string | undefined,
  encounter: fhir4.Encounter | undefined,
  institutionNumber: string,
) {
  const encounterId = encounter?.id;
  return useQuery({
    queryKey: [
      "dpc-form1",
      "sources",
      patientId,
      encounterId,
      encounter?.period?.end ?? "",
      institutionNumber,
    ],
    queryFn: async (): Promise<DpcForm1Sources> => {
      const enc = encounter as fhir4.Encounter;
      const id = patientId as string;
      const start = enc.period?.start?.slice(0, 10) ?? "";
      const end = enc.period?.end?.slice(0, 10) ?? today();

      const admissionParams = new URLSearchParams();
      admissionParams.set("subject", `Patient/${id}`);
      admissionParams.set("status", `${ADMISSION_STATUS},${DISCHARGED_STATUS}`);
      admissionParams.set("class", ADMISSION_CLASS_CODE);
      admissionParams.set("_sort", "-date");
      admissionParams.set("_count", "50");

      const [patient, admissions, surgeries, bodyMeasures, pregnancy] = await Promise.all([
        readResource<fhir4.Patient>("Patient", id),
        searchResource<fhir4.Encounter>("Encounter", admissionParams),
        fetchSurgeries(id, start, end),
        fetchObservations(id, [HEIGHT_LOINC, WEIGHT_LOINC]),
        fetchObservations(id, ["82810-3", "63895-7"]),
      ]);

      return {
        patient: patient.data,
        encounter: enc,
        admissions: resourcesOfType<fhir4.Encounter>(admissions.data, "Encounter"),
        surgeries,
        bodyMeasures,
        pregnancy,
        institutionNumber,
      };
    },
    enabled: Boolean(patientId) && Boolean(encounterId),
  });
}

/**
 * 様式1 の保存。新規は「その入院の様式1 がまだ無いこと」を条件に作る(2 人が同時に
 * 作っても 1 入院 1 件を保つ)。更新は etag で他者の更新を検出する。
 */
export function useSaveDpcForm1() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      response,
      encounterId,
      etag,
    }: {
      response: fhir4.QuestionnaireResponse;
      encounterId: string;
      etag?: string;
    }): Promise<FhirResult<fhir4.QuestionnaireResponse>> => {
      if (response.id && etag) return updateResource(response, etag);
      const { data: bundle } = await postBundle(
        transactionBundle([
          {
            fullUrl: `urn:uuid:${crypto.randomUUID()}`,
            resource: response,
            request: {
              method: "POST",
              url: "QuestionnaireResponse",
              ifNoneExist: dpcForm1Query(encounterId).toString(),
            },
          },
        ]),
      );
      const saved = resourceFromBundleResponse<fhir4.QuestionnaireResponse>(bundle);
      if (!saved.resource) throw new Error("保存結果を取得できませんでした。");
      return { data: saved.resource, etag: saved.etag };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["QuestionnaireResponse", "search"] });
      queryClient.invalidateQueries({ queryKey: ["QuestionnaireResponse", result.data.id] });
    },
  });
}
